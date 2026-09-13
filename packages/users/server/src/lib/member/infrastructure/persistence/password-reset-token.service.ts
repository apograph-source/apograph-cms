import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@apograph/database';
import {
    InjectIdentityConfig,
    tokens,
    type IdentityPluginConfig
} from '@apograph/identity-server';
import { PasswordResetRecentlySentError } from '../../domain/errors';

/**
 * Namespace for the per-user advisory lock that serializes {@link
 * PasswordResetTokenService.rotate}. Deliberately **distinct** from the invite
 * service's namespace: the two flows write different rows of `tokens` and must
 * not queue behind each other, and sharing a namespace would make a reset for
 * one person block an invite rotation for another whose id happens to hash the
 * same way.
 */
const RESET_LOCK_NAMESPACE = 0x52534554; // "RSET"

/**
 * Issues the one-time password-reset tokens backing the reset flow, stored in
 * identity's `tokens` table under `type = 'reset'`. Mirrors the invite service
 * exactly — only the SHA-256 of the raw token is persisted, so a read-only DB
 * leak yields nothing usable, and the raw token is returned to the caller solely
 * for delivery. Today the admin who issued it copies the link out of the
 * response; once a mailer exists it is emailed instead (identity epic #11).
 */
@Injectable()
export class PasswordResetTokenService {
    constructor(
        @InjectDatabase() private readonly db: Database,
        @InjectIdentityConfig()
        private readonly identityConfig: IdentityPluginConfig
    ) {}

    /**
     * Replaces any live reset tokens for the user with a fresh one, so at most
     * one reset link is valid per account at a time — issuing a second link
     * kills the first, and an admin who re-issues has to hand over the new one.
     * Returns the raw token for delivery.
     *
     * Lifetime comes from the host's `token.resetTtlSeconds`, so a deployment
     * that shortens or extends reset validity actually gets what it configured.
     * It is deliberately a different knob from the invite TTL: a reset link is
     * handed to someone who is standing by, an invite may sit in an inbox for
     * days.
     *
     * The delete/insert pair runs under a per-user advisory lock: without it two
     * concurrent issues can each take their `DELETE` snapshot before the other's
     * `INSERT` commits, leaving **two** live links where the contract promises
     * one.
     *
     * Pass `minIntervalSeconds` to refuse an issue that would destroy a link
     * handed over moments ago ({@link PasswordResetRecentlySentError}). Unlike
     * the invite flow there is no "first issue" exemption — every reset
     * potentially invalidates a live link, so the cooldown always applies.
     */
    async rotate(
        userId: string,
        executor?: TokenExecutor,
        options?: RotateResetOptions
    ): Promise<string> {
        const raw = randomBytes(32).toString('hex');
        const expiresAt = new Date(
            Date.now() + this.identityConfig.token.resetTtlSeconds * 1000
        );
        const cooldownMs = (options?.minIntervalSeconds ?? 0) * 1000;

        const run = async (db: TokenExecutor): Promise<void> => {
            // Transaction-scoped: released at commit/rollback, so there is
            // nothing to unlock by hand.
            await db.execute(
                sql`select pg_advisory_xact_lock(${RESET_LOCK_NAMESPACE}, hashtext(${userId}))`
            );

            // The cooldown is checked *inside* the lock, so two concurrent
            // issues cannot both read "no recent token" and both rotate —
            // which is the very race this lock exists for.
            if (cooldownMs > 0) {
                const [current] = await db
                    .select({ createdAt: tokens.createdAt })
                    .from(tokens)
                    .where(
                        and(eq(tokens.userId, userId), eq(tokens.type, 'reset'))
                    )
                    .limit(1);
                if (current) {
                    const elapsedMs = Date.now() - current.createdAt.getTime();
                    if (elapsedMs < cooldownMs) {
                        throw new PasswordResetRecentlySentError(
                            userId,
                            Math.ceil((cooldownMs - elapsedMs) / 1000)
                        );
                    }
                }
            }

            await db
                .delete(tokens)
                .where(
                    and(eq(tokens.userId, userId), eq(tokens.type, 'reset'))
                );
            await db.insert(tokens).values({
                type: 'reset',
                userId,
                tokenHash: this.hash(raw),
                expiresAt
            });
        };

        // Reuse the caller's transaction when given one (so the token commits
        // in-band with the audit event); otherwise open our own for atomicity.
        if (executor) {
            await run(executor);
        } else {
            await this.db.transaction(run);
        }

        return raw;
    }

    private hash(raw: string): string {
        return createHash('sha256').update(raw).digest('hex');
    }
}

/**
 * The executor `rotate` accepts: the root client or an open transaction. Lets a
 * caller hand in its `tx` so the token swap commits in-band with the use case.
 * `execute` is part of the shape because the advisory lock has to be taken on
 * the **same** transaction as the swap it guards, and `select` because the
 * cooldown reads the current token under that same lock.
 */
type TokenExecutor = Pick<Database, 'delete' | 'insert' | 'execute' | 'select'>;

/** Options for {@link PasswordResetTokenService.rotate}. */
export type RotateResetOptions = {
    /**
     * Refuse the rotation when the current reset token is younger than this.
     * Omit (or `0`) to always rotate.
     */
    minIntervalSeconds?: number;
};
