import { Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { roles, users } from '@orthacms/identity-server';
import { Member } from '../../domain/member';
import type { MemberId } from '../../domain/value-objects/member-id';
import type { MemberRepository } from '../../domain/member.repository';
import { EmailTakenError } from '../../domain/errors';
import { ADMIN_ROLE_KEY } from '../../domain/value-objects/role';
import { MemberMapper } from './member.mapper';
import { lockActiveAdmins } from './member-lock';

/**
 * Drizzle-backed {@link MemberRepository} over identity's `users`/`roles`
 * tables (owned and migrated by `@orthacms/identity-server`). Runs every
 * statement through {@link UnitOfWork.current}, so it transparently joins the
 * use case's transaction.
 *
 * The last-admin invariant's race-safety lives here: {@link findByIdForAdminGuard}
 * takes the transaction-scoped active-admin advisory lock before loading, so a
 * concurrent demote/disable serializes behind it and {@link countActiveAdmins}
 * reads a stable count the aggregate can trust.
 */
@Injectable()
export class DrizzleMemberRepository implements MemberRepository {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly mapper: MemberMapper
    ) {}

    /** {@inheritDoc MemberRepository.findById} */
    findById(id: MemberId): Promise<Member | null> {
        return this.load(id);
    }

    /**
     * Loads the aggregate after taking the **active-admin** advisory lock — the
     * loading strategy for demote / disable, which must serialize against
     * concurrent admin-count mutations. The lock auto-releases at
     * commit/rollback, so it must be called inside the unit of work.
     */
    async findByIdForAdminGuard(id: MemberId): Promise<Member | null> {
        await lockActiveAdmins(this.uow.current());
        return this.load(id);
    }

    /** {@inheritDoc MemberRepository.countActiveAdmins} */
    async countActiveAdmins(): Promise<number> {
        const [{ total }] = await this.uow
            .current()
            .select({ total: count() })
            .from(users)
            .innerJoin(roles, eq(users.roleId, roles.id))
            .where(
                and(eq(roles.key, ADMIN_ROLE_KEY), eq(users.status, 'active'))
            );
        return total;
    }

    /** {@inheritDoc MemberRepository.existsByEmail} */
    async existsByEmail(email: string): Promise<boolean> {
        const [existing] = await this.uow
            .current()
            .select({ id: users.id })
            .from(users)
            .where(eq(sql`lower(${users.email})`, email))
            .limit(1);
        return !!existing;
    }

    /** {@inheritDoc MemberRepository.save} */
    async save(member: Member): Promise<void> {
        const changes = member.changes();
        const executor = this.uow.current();

        if (changes.isNew) {
            const roleId = await this.roleIdByKey(member.role.value);
            try {
                await executor.insert(users).values({
                    id: member.id.value,
                    email: member.email,
                    name: member.name,
                    roleId,
                    status: member.status.value
                });
            } catch (error) {
                // The DB's case-insensitive unique index is the race-proof
                // backstop for the invite's up-front email check.
                if (isUniqueViolation(error)) {
                    throw new EmailTakenError(member.email);
                }
                throw error;
            }
            return;
        }

        const patch: Partial<typeof users.$inferInsert> = {};
        if (changes.nameChanged) {
            patch.name = member.name;
        }
        if (changes.roleChanged) {
            patch.roleId = await this.roleIdByKey(member.role.value);
        }
        if (changes.statusChanged) {
            patch.status = member.status.value;
        }
        if (Object.keys(patch).length === 0) {
            return;
        }
        await executor
            .update(users)
            .set(patch)
            .where(eq(users.id, member.id.value));
    }

    /** {@inheritDoc MemberRepository.delete} */
    async delete(member: Member): Promise<void> {
        await this.uow
            .current()
            .delete(users)
            .where(eq(users.id, member.id.value));
    }

    /** Loads the aggregate for `id`, or `null` when no such member exists. */
    private async load(id: MemberId): Promise<Member | null> {
        const [row] = await this.uow
            .current()
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                status: users.status,
                roleKey: roles.key
            })
            .from(users)
            .innerJoin(roles, eq(users.roleId, roles.id))
            .where(eq(users.id, id.value))
            .limit(1);
        if (!row) {
            return null;
        }
        return this.mapper.toDomain(row);
    }

    /** Resolves a seeded system-role key to its id. */
    private async roleIdByKey(key: string): Promise<string> {
        const [role] = await this.uow
            .current()
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, key))
            .limit(1);
        if (!role) {
            // The system roles are seeded on boot, so this indicates a broken
            // deployment rather than bad input — let it surface as a 500.
            throw new Error(`System role not seeded: ${key}`);
        }
        return role.id;
    }
}

/** Whether an error (or its cause) is a Postgres unique violation (23505). */
function isUniqueViolation(error: unknown): boolean {
    for (
        let current: unknown = error;
        current instanceof Error;
        current = current.cause
    ) {
        if ((current as { code?: string }).code === '23505') {
            return true;
        }
    }
    return false;
}
