import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { permissions, rolePermissions, users } from '../../schema';
import type { PermissionKey } from '../system-roles';

/**
 * Resolves what a role is allowed to do. Reads the `role_permissions` grants
 * seeded by {@link seedSystemRoles}; the `PermissionsGuard` and `GET /auth/me`
 * both consume it so "what can this user do?" has one source of truth.
 */
@Injectable()
export class PermissionsService {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** The permission keys granted to `roleId`. */
    async forRole(roleId: string): Promise<PermissionKey[]> {
        const rows = await this.db
            .select({ key: permissions.key })
            .from(rolePermissions)
            .innerJoin(
                permissions,
                eq(permissions.id, rolePermissions.permissionId)
            )
            .where(eq(rolePermissions.roleId, roleId));
        return rows.map((row) => row.key as PermissionKey);
    }

    /**
     * The permission keys granted to the user `userId`, through whatever role
     * they hold. Empty when no such user exists — an absent principal is
     * granted nothing, never everything.
     *
     * `forRole` covers the request paths, which have already loaded the user to
     * authenticate them. This one is for a caller handed an id and nothing
     * else: a `ContentPublishGuard` is asked "may this person do it" by a
     * package that has no business loading users, so it asks the package that
     * owns them rather than joining across a schema it does not maintain.
     */
    async forUser(userId: string): Promise<PermissionKey[]> {
        const rows = await this.db
            .select({ key: permissions.key })
            .from(users)
            .innerJoin(
                rolePermissions,
                eq(rolePermissions.roleId, users.roleId)
            )
            .innerJoin(
                permissions,
                eq(permissions.id, rolePermissions.permissionId)
            )
            .where(eq(users.id, userId));
        return rows.map((row) => row.key as PermissionKey);
    }
}
