import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    attachActor,
    OutboxWriter,
    UnitOfWork,
    type EventActor
} from '@orthacms/database';
import {
    apiTokenEvent,
    IDENTITY_EVENT_KINDS
} from '../../domain/events/identity-events';
import { HashingService } from '../../auth/services/hashing.service';
import type { ApiTokenScope } from '../domain/api-token-scope';
import { UnknownWorkspaceError } from '../domain/unknown-workspace.error';
import {
    WORKSPACE_DIRECTORY,
    type WorkspaceDirectory
} from './ports/workspace-directory.port';
import {
    DrizzleApiTokenRepository,
    type ApiTokenRecord
} from '../infrastructure/persistence/drizzle-api-token.repository';

/** Human-readable prefix so a raw token is recognisable as an Ortha API key. */
const TOKEN_PREFIX = 'ortha_';

/** Bytes of entropy in the secret portion of a token (256-bit). */
const TOKEN_ENTROPY_BYTES = 32;

/**
 * Characters of the raw token stored as the non-secret display prefix — the
 * literal `ortha_` plus the first few secret chars, enough for an admin to
 * tell two tokens apart without ever seeing the secret again.
 */
const LOOKUP_PREFIX_LENGTH = TOKEN_PREFIX.length + 6;

/**
 * Only touch `last_used_at` when the recorded value is this many milliseconds
 * stale, so a burst of API calls doesn't write the row on every request.
 */
const LAST_USED_TOUCH_INTERVAL_MS = 60_000;

/** Input to {@link ApiTokenService.mint}. */
export interface MintApiTokenInput {
    name: string;
    /**
     * Every workspace the token may act in — at least one. Duplicates are
     * collapsed by {@link ApiTokenService.mint}; an empty list is rejected.
     */
    workspaceIds: readonly string[];
    scope: ApiTokenScope;
    /** Absolute expiry, or `null`/omitted for a token that never expires. */
    expiresAt?: Date | null;
    /** The user minting the token. */
    createdBy: string;
    /**
     * The acting admin, as the audit log should name them. Defaults to
     * `{ id: createdBy, email: null }` — pass the email so the log carries a
     * frozen snapshot rather than requiring a join against a user who may later
     * be renamed or deleted.
     */
    actor?: EventActor;
}

/** The metadata-only view of a token (never carries the secret). */
export interface ApiTokenView {
    id: string;
    name: string;
    /** Every workspace the token may act in — always at least one. */
    workspaceIds: string[];
    scope: ApiTokenScope;
    lookupPrefix: string;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
}

/** The mint result: the view plus the plaintext token, returned exactly once. */
export interface MintedApiToken {
    token: ApiTokenView;
    /** The raw bearer token — shown to the creator once, never persisted. */
    secret: string;
}

/**
 * Mints, verifies, lists, and revokes external-API bearer tokens.
 *
 * A token's secret is a 256-bit random string; only its SHA-256 hash is stored
 * (same primitive that backs session ids — {@link HashingService.hashToken}),
 * so a read-only DB/backup leak yields no usable tokens. The plaintext is
 * returned by {@link mint} once and never again. Verification hashes the
 * presented bearer, looks the row up by hash, and rejects revoked or expired
 * tokens — every failure mode reads as "no token" to the caller.
 */
@Injectable()
export class ApiTokenService {
    constructor(
        private readonly repo: DrizzleApiTokenRepository,
        private readonly hashing: HashingService,
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Optional()
        @Inject(WORKSPACE_DIRECTORY)
        private readonly workspaces?: WorkspaceDirectory
    ) {}

    /**
     * Generates a token, persists its hash and workspace bucket, and returns
     * the plaintext once. Duplicate workspace ids are collapsed, so the bucket
     * a caller sees back is the set it actually granted.
     *
     * The insert and the `api_token.created` event commit in one transaction.
     * Auditing a credential's creation is not optional bookkeeping: an API
     * token is a long-lived key to workspace content, so "who minted this, when,
     * scoped to what" has to be answerable — and a token that existed while its
     * audit row did not would be exactly the credential nobody can account for.
     *
     * @throws UnknownWorkspaceError when the bucket names a workspace that does
     * not exist. `api_token_workspaces` carries no cross-plugin foreign key, so
     * without this check a typo mints a token scoped to nothing that reads as
     * correctly configured.
     */
    async mint(input: MintApiTokenInput): Promise<MintedApiToken> {
        const secret =
            TOKEN_PREFIX +
            randomBytes(TOKEN_ENTROPY_BYTES).toString('base64url');
        const workspaceIds = [...new Set(input.workspaceIds)];
        await this.assertWorkspacesExist(workspaceIds);

        const row = await this.uow.run(async () => {
            const inserted = await this.repo.insert({
                workspaceIds,
                name: input.name,
                tokenHash: this.hashing.hashToken(secret),
                lookupPrefix: secret.slice(0, LOOKUP_PREFIX_LENGTH),
                scope: input.scope,
                expiresAt: input.expiresAt ?? null,
                createdBy: input.createdBy
            });
            await this.outbox.append(
                attachActor(
                    [
                        apiTokenEvent(
                            IDENTITY_EVENT_KINDS.API_TOKEN_CREATED,
                            inserted.id,
                            {
                                name: inserted.name,
                                scope: inserted.scope,
                                workspaceIds: inserted.workspaceIds,
                                // The non-secret display prefix, never the
                                // secret or its hash — the audit log must not
                                // become a second place a token can leak from.
                                lookupPrefix: inserted.lookupPrefix,
                                expiresAt:
                                    inserted.expiresAt?.toISOString() ?? null
                            }
                        )
                    ],
                    input.actor ?? { id: input.createdBy, email: null }
                )
            );
            return inserted;
        });

        return { token: toView(row), secret };
    }

    /**
     * Resolves a raw bearer token to its live record — the row **plus its
     * workspace bucket**, which is what the caller scopes a request with — or
     * `null` if it is unknown, revoked, or expired. On a successful resolve it
     * also refreshes `last_used_at` (throttled, fire-and-forget) so the update
     * never blocks the request it is authenticating.
     */
    async verify(secret: string): Promise<ApiTokenRecord | null> {
        const row = await this.repo.findByHash(this.hashing.hashToken(secret));
        if (!row || row.revokedAt) {
            return null;
        }
        const now = new Date();
        if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
            return null;
        }
        this.maybeTouchLastUsed(row, now);
        return row;
    }

    /**
     * One page of token metadata for the management UI. `workspaceId` narrows
     * to the tokens whose bucket **contains** it — a multi-workspace token
     * shows up under each of its workspaces.
     */
    async list(options: {
        workspaceId?: string;
        page: number;
        pageSize: number;
    }): Promise<{
        items: ApiTokenView[];
        total: number;
        page: number;
        pageSize: number;
    }> {
        const { items, total } = await this.repo.list({
            workspaceId: options.workspaceId,
            limit: options.pageSize,
            offset: (options.page - 1) * options.pageSize
        });
        return {
            items: items.map(toView),
            total,
            page: options.page,
            pageSize: options.pageSize
        };
    }

    /**
     * Revokes a token by id; `false` if it was unknown or already revoked.
     *
     * Emits `api_token.revoked` in the same transaction — but **only when a
     * live token was actually revoked**, so replaying the idempotent DELETE
     * writes one audit row rather than one per attempt. Killing a credential is
     * as much of an audited act as minting one: it is the line that explains why
     * an integration stopped working at 04:12.
     */
    revoke(id: string, actor?: EventActor): Promise<boolean> {
        return this.uow.run(async () => {
            // Read first so the event can name the token; inside the same
            // transaction as the update, so the row cannot change underneath.
            const token = await this.repo.findById(id);
            const revoked = await this.repo.revoke(id);
            if (!revoked || !token) {
                return revoked;
            }
            await this.outbox.append(
                attachActor(
                    [
                        apiTokenEvent(
                            IDENTITY_EVENT_KINDS.API_TOKEN_REVOKED,
                            token.id,
                            {
                                name: token.name,
                                scope: token.scope,
                                workspaceIds: token.workspaceIds,
                                lookupPrefix: token.lookupPrefix
                            }
                        )
                    ],
                    actor ?? { id: token.createdBy, email: null }
                )
            );
            return revoked;
        });
    }

    /**
     * Rejects a bucket naming workspaces that do not exist.
     *
     * A no-op when nothing is bound to {@link WORKSPACE_DIRECTORY}: with no
     * workspaces plugin there is no directory to check against, and failing
     * every mint would be worse than the referential gap. In the assembled app
     * the binding is always present.
     */
    private async assertWorkspacesExist(
        workspaceIds: readonly string[]
    ): Promise<void> {
        if (!this.workspaces || workspaceIds.length === 0) {
            return;
        }
        const existing = new Set(await this.workspaces.existing(workspaceIds));
        const missing = workspaceIds.filter((id) => !existing.has(id));
        if (missing.length > 0) {
            throw new UnknownWorkspaceError(missing);
        }
    }

    /**
     * Refreshes `last_used_at` only when it is stale, and records
     * `api_token.used` on the same schedule — never awaiting either, because a
     * failed touch must not fail the authenticated request.
     *
     * **The staleness check is what bounds the audit volume**, which is why the
     * event is raised here rather than in `verify`. A busy integration
     * authenticates thousands of times an hour and the answer an operator wants
     * — was this credential live, and over what period — needs one row a
     * minute, not one per request. Sharing the existing interval means there is
     * a single knob and the row and the column can never disagree about when
     * the token was last seen.
     *
     * The touch and the event go in **one** unit of work so they commit
     * together: a `last_used_at` that moved without a row, or a row claiming
     * use that rolled back, would each be a small lie in the one place that
     * exists to not tell them.
     *
     * There is **no actor**. A token acts as itself (the minting user's grants
     * are deliberately not consulted — see `verify`), so naming that user here
     * would attribute a request to a person who may have left the company. The
     * token *is* the subject, and `api_tokens.created_by` is where "who minted
     * it" already lives.
     */
    private maybeTouchLastUsed(row: ApiTokenRecord, now: Date): void {
        const last = row.lastUsedAt?.getTime() ?? 0;
        if (now.getTime() - last < LAST_USED_TOUCH_INTERVAL_MS) {
            return;
        }
        void this.uow
            .run(async () => {
                await this.repo.touchLastUsed(row.id, now);
                await this.outbox.append([
                    apiTokenEvent(IDENTITY_EVENT_KINDS.API_TOKEN_USED, row.id, {
                        name: row.name,
                        scope: row.scope,
                        workspaceIds: row.workspaceIds,
                        lookupPrefix: row.lookupPrefix,
                        // How long the credential had been quiet before this
                        // request. A six-month gap is the interesting number
                        // and it is not recoverable from the row afterwards —
                        // the touch overwrites the only copy of it.
                        previousUseAt: row.lastUsedAt ?? null
                    })
                ]);
            })
            .catch(() => undefined);
    }
}

/** Projects a stored record to the secret-free view. */
function toView(row: ApiTokenRecord): ApiTokenView {
    return {
        id: row.id,
        name: row.name,
        workspaceIds: row.workspaceIds,
        scope: row.scope,
        lookupPrefix: row.lookupPrefix,
        expiresAt: row.expiresAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
        createdAt: row.createdAt
    };
}
