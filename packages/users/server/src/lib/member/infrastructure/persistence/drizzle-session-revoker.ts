import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { sessions } from '@orthacms/identity-server';
import type { SessionRevoker } from '../../application/ports/session-revoker.port';

/**
 * Drizzle-backed {@link SessionRevoker} over identity's `sessions` table.
 * Stamps `revokedAt` on every live session for the user, running through
 * {@link UnitOfWork.current} so the revocation commits with the disable.
 */
@Injectable()
export class DrizzleSessionRevoker implements SessionRevoker {
    constructor(private readonly uow: UnitOfWork) {}

    /** {@inheritDoc SessionRevoker.revoke} */
    async revoke(userId: string): Promise<void> {
        await this.uow
            .current()
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(eq(sessions.userId, userId));
    }
}
