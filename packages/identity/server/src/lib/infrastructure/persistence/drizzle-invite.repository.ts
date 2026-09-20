import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { tokens, users } from '../../schema';
import type {
    InviteRepository,
    PendingInvite
} from '../../domain/invite.repository';

/**
 * Drizzle-backed {@link InviteRepository} over the `invite` rows of identity's
 * one-time `tokens` table. Runs every statement through
 * {@link UnitOfWork.current}, so it joins the accept use case's transaction and
 * still works on the read-only lookup path (which opens none).
 */
@Injectable()
export class DrizzleInviteRepository implements InviteRepository {
    constructor(private readonly uow: UnitOfWork) {}

    /** {@inheritDoc InviteRepository.findPendingByTokenHash} */
    async findPendingByTokenHash(
        tokenHash: string
    ): Promise<PendingInvite | null> {
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
                    eq(tokens.type, 'invite'),
                    // Unconsumed and unexpired — a link is good exactly once,
                    // and only within its TTL.
                    isNull(tokens.consumedAt),
                    gt(tokens.expiresAt, new Date())
                )
            )
            .limit(1);
        return row ?? null;
    }

    /** {@inheritDoc InviteRepository.consume} */
    async consume(tokenId: string): Promise<boolean> {
        // Conditional update, not read-then-write: `consumedAt IS NULL` is
        // re-checked by the database as the row is locked, so of two concurrent
        // accepts exactly one gets a row back and the other sees zero.
        const burned = await this.uow
            .current()
            .update(tokens)
            .set({ consumedAt: new Date() })
            .where(and(eq(tokens.id, tokenId), isNull(tokens.consumedAt)))
            .returning({ id: tokens.id });
        return burned.length > 0;
    }
}
