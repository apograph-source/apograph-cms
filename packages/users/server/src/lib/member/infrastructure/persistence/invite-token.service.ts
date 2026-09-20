import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import {
    InjectIdentityConfig,
    tokens,
    type IdentityPluginConfig
} from '@orthacms/identity-server';
import { InviteRecentlySentError } from '../../domain/errors';
import type { IssuedToken } from './issued-token';

/**
 * Namespace for the per-user advisory lock that serializes {@link
 * InviteTokenService.rotate}. Paired with `hashtext(userId)`, so the lock is
 * scoped to one invitee — rotations for *different* people never block each
 * other.
 */
const INVITE_LOCK_NAMESPACE = 0x494e5654; // "INVT"

/**
 * Issues and rotates the one-time invite tokens backing the invite flow,
 * stored in identity's `tokens` table. Mirrors identity's session convention:
 * only the SHA-256 of the raw token is persisted, so a read-only DB leak
 * yields nothing usable. The raw token is returned to the caller solely for
 * delivery — today the inviting admin copies the link out of the response;
 * once a mailer exists it is emailed instead (identity epic #11).
 */
@Injectable()
export class InviteTokenService {
    constructor(
        @InjectDatabase() private readonly db: Database,
        @InjectIdentityConfig()
        private readonly identityConfig: IdentityPluginConfig
    ) {}

    /**
     * Replaces any live invite tokens for the user with a fresh one — used
     * both on first invite and on resend, so at most one invite token is
     * valid per user at a time. Returns the raw token for delivery.
     *
     * Lifetime comes from the host's `token.inviteTtlSeconds`, so a deployment
     * that shortens or extends invite validity actually gets what it configured.
     *
     * The delete/insert pair runs under a per-user advisory lock: without it two
     * concurrent resends can each take their `DELETE` snapshot before the
     * other's `INSERT` commits, leaving **two** live links where the contract
     * promises one.
     *
     * Pass `minIntervalSeconds` to refuse a rotation that would destroy a link
     * issued moments ago ({@link InviteRecentlySentError}). The invite path
     * omits it — there is nothing to protect on a first issue.
     *
     * Returns the expiry alongside the token because the caller has one more
     * thing to do with it than hand it over: a queued message is swept unsent
     * once its link has died, so the mail row needs the same instant this
     * insert wrote, not a second computation of it.
     */
    async rotate(
        userId: string,
        executor?: TokenExecutor,
        options?: RotateOptions
    ): Promise<IssuedToken> {
        const raw = randomBytes(32).toString('hex');
        const expiresAt = new Date(
            Date.now() + this.identityConfig.token.inviteTtlSeconds * 1000
        );
        const cooldownMs = (options?.minIntervalSeconds ?? 0) * 1000;

        const run = async (db: TokenExecutor): Promise<void> => {
            // Transaction-scoped: released at commit/rollback, so there is
            // nothing to unlock by hand.
            await db.execute(
                sql`select pg_advisory_xact_lock(${INVITE_LOCK_NAMESPACE}, hashtext(${userId}))`
            );

            // The cooldown is checked *inside* the lock, so two concurrent
            // resends cannot both read "no recent token" and both rotate —
            // which is the very race this lock exists for.
            if (cooldownMs > 0) {
                const [current] = await db
                    .select({ createdAt: tokens.createdAt })
                    .from(tokens)
                    .where(
                        and(
                            eq(tokens.userId, userId),
                            eq(tokens.type, 'invite')
                        )
                    )
                    .limit(1);
                if (current) {
                    const elapsedMs = Date.now() - current.createdAt.getTime();
                    if (elapsedMs < cooldownMs) {
                        throw new InviteRecentlySentError(
                            userId,
                            Math.ceil((cooldownMs - elapsedMs) / 1000)
                        );
                    }
                }
            }

            await db
                .delete(tokens)
                .where(
                    and(eq(tokens.userId, userId), eq(tokens.type, 'invite'))
                );
            await db.insert(tokens).values({
                type: 'invite',
                userId,
                tokenHash: this.hash(raw),
                expiresAt
            });
        };

        // Reuse the caller's transaction when given one (so rotation commits
        // in-band with the invite); otherwise open our own for atomicity.
        if (executor) {
            await run(executor);
        } else {
            await this.db.transaction(run);
        }

        return { raw, expiresAt };
    }

    private hash(raw: string): string {
        return createHash('sha256').update(raw).digest('hex');
    }
}

/**
 * The executor `rotate` accepts: the root client or an open transaction. Lets a
 * caller hand in its `tx` so the token swap commits in-band with the invite.
 * `execute` is part of the shape because the advisory lock has to be taken on
 * the **same** transaction as the swap it guards, and `select` because the
 * resend cooldown reads the current token under that same lock.
 */
type TokenExecutor = Pick<Database, 'delete' | 'insert' | 'execute' | 'select'>;

/** Options for {@link InviteTokenService.rotate}. */
export type RotateOptions = {
    /**
     * Refuse the rotation when the current invite token is younger than this.
     * Omit (or `0`) to always rotate — the first-issue behaviour.
     */
    minIntervalSeconds?: number;
};
