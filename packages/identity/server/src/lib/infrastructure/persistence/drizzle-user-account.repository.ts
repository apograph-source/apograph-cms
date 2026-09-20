import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { users } from '../../schema';
import { UserAccount } from '../../domain/user-account';
import type { UserId } from '../../domain/value-objects/user-id';
import type { UserAccountRepository } from '../../domain/user-account.repository';
import { UserAccountMapper } from './user-account.mapper';

/**
 * Drizzle-backed {@link UserAccountRepository} over identity's `users` table.
 * Runs every statement through {@link UnitOfWork.current}, so it transparently
 * joins the use case's transaction.
 */
@Injectable()
export class DrizzleUserAccountRepository implements UserAccountRepository {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly mapper: UserAccountMapper
    ) {}

    /** {@inheritDoc UserAccountRepository.findById} */
    async findById(id: UserId): Promise<UserAccount | null> {
        const [row] = await this.uow
            .current()
            .select({
                id: users.id,
                email: users.email,
                status: users.status,
                passwordHash: users.passwordHash
            })
            .from(users)
            .where(eq(users.id, id.value))
            .limit(1);
        if (!row) {
            return null;
        }
        return this.mapper.toDomain(row);
    }

    /** {@inheritDoc UserAccountRepository.save} */
    async save(account: UserAccount): Promise<void> {
        const changes = account.changes();
        const patch: Partial<typeof users.$inferInsert> = {};
        if (changes.statusChanged) {
            patch.status = account.status.value;
        }
        if (changes.credentialChanged) {
            patch.passwordHash = account.passwordHash?.value ?? null;
        }
        if (Object.keys(patch).length === 0) {
            return;
        }
        await this.uow
            .current()
            .update(users)
            .set(patch)
            .where(eq(users.id, account.id.value));
    }
}
