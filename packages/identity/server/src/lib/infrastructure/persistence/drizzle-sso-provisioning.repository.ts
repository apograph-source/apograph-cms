import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { roles, users } from '../../schema';
import type {
    ProvisionAccountInput,
    ProvisionedAccount,
    SsoProvisioningRepository
} from '../../domain/sso-provisioning.repository';

/**
 * Drizzle-backed {@link SsoProvisioningRepository}. Every statement runs
 * through {@link UnitOfWork.current}, so a provisioned account commits with the
 * identity link and the session that created it — an account that survived a
 * failed sign-in would be a real, signed-in-able row nobody ever authenticated
 * for.
 */
@Injectable()
export class DrizzleSsoProvisioningRepository
    implements SsoProvisioningRepository
{
    constructor(private readonly uow: UnitOfWork) {}

    /** {@inheritDoc SsoProvisioningRepository.findRoleIdByKey} */
    async findRoleIdByKey(key: string): Promise<string | null> {
        const [row] = await this.uow
            .current()
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, key))
            .limit(1);
        return row?.id ?? null;
    }

    /** {@inheritDoc SsoProvisioningRepository.provision} */
    async provision(input: ProvisionAccountInput): Promise<ProvisionedAccount> {
        // `passwordHash` is left null deliberately — see the port's doc. The
        // `users_email_lower_unique` index is what decides a race between two
        // simultaneous first sign-ins: the loser's transaction rolls back
        // rather than producing a second account for one person.
        const [row] = await this.uow
            .current()
            .insert(users)
            .values({
                email: input.email,
                name: input.name,
                roleId: input.roleId,
                status: 'active'
            })
            .returning({ userId: users.id, email: users.email });
        return row;
    }

    /** {@inheritDoc SsoProvisioningRepository.setRole} */
    async setRole(userId: string, roleId: string): Promise<boolean> {
        // `ne(users.roleId, roleId)` is what makes the return value mean
        // "changed" rather than "matched a row" — so a caller can raise an
        // event only when something actually moved, instead of once per
        // sign-in for the rest of the account's life.
        const changed = await this.uow
            .current()
            .update(users)
            .set({ roleId })
            .where(and(eq(users.id, userId), ne(users.roleId, roleId)))
            .returning({ id: users.id });
        return changed.length > 0;
    }

    /** {@inheritDoc SsoProvisioningRepository.roleKeyOf} */
    async roleKeyOf(userId: string): Promise<string | null> {
        const [row] = await this.uow
            .current()
            .select({ key: roles.key })
            .from(users)
            .innerJoin(roles, eq(roles.id, users.roleId))
            .where(eq(users.id, userId))
            .limit(1);
        return row?.key ?? null;
    }
}
