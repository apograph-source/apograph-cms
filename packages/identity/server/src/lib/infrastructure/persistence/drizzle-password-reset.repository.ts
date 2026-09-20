import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { tokens, users } from '../../schema';
import type {
    PasswordResetRepository,
    PendingPasswordReset
} from '../../domain/password-reset.repository';

/**
 * Drizzle-backed {@link PasswordResetRepository} over the `reset` rows of
 * identity's one-time `tokens` table. Runs every statement through
 * {@link UnitOfWork.current}, so it joins the reset use case's transaction and
 * still works on the read-only lookup path (which opens none).
 */
@Injectable()
export class DrizzlePasswordResetRepository implements PasswordResetRepository {
    constructor(private readonly uow: UnitOfWork) {}

    /** {@inheritDoc PasswordResetRepository.findPendingByTokenHash} */
    async findPendingByTokenHash(
        tokenHash: string
    ): Promise<PendingPasswordReset | null> {
        const [row] = await this.uow
            .current()
            .select({
                tokenId: tokens.id,
                userId: users.id,
                email: users.email,
                name: users.name
            })
            .from(tokens)
            .innerJoin(users, eq(users.id, tokens.userId))
            .where(
                and(
                    eq(tokens.tokenHash, tokenHash),
                    // The `type` predicate is load-bearing, not decoration: an
                    // invite token must not open the reset path, which skips
                    // the `pending` → `active` transition entirely.
                    eq(tokens.type, 'reset'),
                    // Unconsumed and unexpired — a link is good exactly once,
                    // and only within its TTL.
                    isNull(tokens.consumedAt),
                    gt(tokens.expiresAt, new Date())
                )
            )
            .limit(1);
        return row ?? null;
    }

    /** {@inheritDoc PasswordResetRepository.consume} */
    async consume(tokenId: string): Promise<boolean> {
        // Conditional update, not read-then-write: `consumedAt IS NULL` is
        // re-checked by the database as the row is locked, so of two concurrent
        // submissions exactly one gets a row back and the other sees zero.
        const burned = await this.uow
            .current()
            .update(tokens)
            .set({ consumedAt: new Date() })
            .where(and(eq(tokens.id, tokenId), isNull(tokens.consumedAt)))
            .returning({ id: tokens.id });
        return burned.length > 0;
    }
}
