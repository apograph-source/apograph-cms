import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { Database } from '@orthacms/database';
import { permissions, rolePermissions, roles } from '../../schema';
import { PERMISSION_KEYS, SYSTEM_ROLES } from '../system-roles';

/**
 * **Reconciles** the permission catalogue, the three system roles, and the
 * grants between them against {@link PERMISSION_KEYS} / {@link SYSTEM_ROLES} —
 * the code is the source of truth in both directions.
 *
 * Safe to run on every boot: the inserts are `ON CONFLICT DO NOTHING` and the
 * deletes are set-differences, so a second run changes nothing, and it stays
 * correct if several instances boot at once (no read-then-write race). Runs in
 * one transaction so a crash can never leave a role without its grants (a
 * privilege gap).
 *
 * ## Why it prunes, and not just adds
 *
 * The seeder used to be **additive only**, which meant a permission could be
 * deleted from the code and stay granted in the database forever. ADR-0009
 * removed `copilot:configure`, yet every admin was still handed the key,
 * because the `permissions` row and its `role_permissions` grant simply
 * persisted. Nothing gated on it, so the impact was nil — but the shape is the
 * problem: **a permission that no longer exists in code must not remain
 * granted**, and if a key is ever renamed rather than dropped, the old grant
 * would stay live alongside the new one, which for a security-relevant
 * permission is a real privilege leak.
 *
 * The pruning is scoped to what this seeder owns:
 *
 * - permission rows whose key is not in `PERMISSION_KEYS` — deleted, and the
 *   `role_permissions` FK cascade removes every grant of them, including
 *   grants held by operator-defined custom roles. That is intended: the
 *   permission does not exist any more, so no role can hold it;
 * - grants **to a system role** that the matrix no longer lists — deleted, so
 *   narrowing a built-in role's grants in code actually narrows it in the
 *   database.
 *
 * A **custom** role's grants of still-existing permissions are left completely
 * alone; those are the operator's configuration, not this seeder's.
 */
export async function seedSystemRoles(db: Database): Promise<void> {
    await db.transaction(async (tx) => {
        // 1. Permission catalogue.
        await tx
            .insert(permissions)
            .values(PERMISSION_KEYS.map((key) => ({ key })))
            .onConflictDoNothing({ target: permissions.key });

        // 1b. Prune permissions the code no longer defines. The cascade on
        //     `role_permissions.permission_id` takes their grants with them —
        //     the only way a retired key stops being handed to anyone.
        await tx
            .delete(permissions)
            .where(notInArray(permissions.key, [...PERMISSION_KEYS]));

        // 2. System roles.
        await tx
            .insert(roles)
            .values(
                SYSTEM_ROLES.map(({ key, name }) => ({
                    key,
                    name,
                    isSystem: true
                }))
            )
            .onConflictDoNothing({ target: roles.key });

        // 3. Resolve ids. Rows may already exist from a prior boot, so we
        //    SELECT rather than rely on INSERT ... RETURNING. Sequential on
        //    purpose: a transaction runs on a single pg client.
        const roleKeys = SYSTEM_ROLES.map((role) => role.key);
        const roleRows = await tx
            .select({ id: roles.id, key: roles.key })
            .from(roles)
            .where(inArray(roles.key, roleKeys));
        const permRows = await tx
            .select({ id: permissions.id, key: permissions.key })
            .from(permissions)
            .where(inArray(permissions.key, [...PERMISSION_KEYS]));

        const roleId = new Map(roleRows.map((row) => [row.key, row.id]));
        const permId = new Map(permRows.map((row) => [row.key, row.id]));

        // 4. Grants — the composite PK makes the insert a no-op on re-run.
        //    Both ids are guaranteed by steps 1–2 (same transaction); the
        //    guard turns an impossible-state bug into a clear error rather
        //    than silently inserting a null FK.
        const grants = SYSTEM_ROLES.flatMap((role) =>
            role.permissions.map((key) => {
                const grantRoleId = roleId.get(role.key);
                const grantPermissionId = permId.get(key);
                if (!grantRoleId || !grantPermissionId) {
                    throw new Error(
                        `Seed failed: unresolved id for ${role.key} → ${key}`
                    );
                }
                return {
                    roleId: grantRoleId,
                    permissionId: grantPermissionId
                };
            })
        );

        if (grants.length > 0) {
            await tx
                .insert(rolePermissions)
                .values(grants)
                .onConflictDoNothing();
        }

        // 5. Prune grants a system role no longer holds in the matrix. Step 1b
        //    already removed grants of retired permissions; this is the other
        //    direction — a permission that still exists but was taken away from
        //    a built-in role. Scoped per role, and only for the three system
        //    roles: a custom role's grants belong to the operator.
        for (const role of SYSTEM_ROLES) {
            const id = roleId.get(role.key);
            if (!id) {
                continue;
            }
            const keep = permRows
                .filter((row) =>
                    (role.permissions as readonly string[]).includes(row.key)
                )
                .map((row) => row.id);
            await tx.delete(rolePermissions).where(
                keep.length > 0
                    ? and(
                          eq(rolePermissions.roleId, id),
                          notInArray(rolePermissions.permissionId, keep)
                      )
                    : // A role granted nothing keeps nothing. `notInArray`
                      // with an empty list is not a valid predicate, so this
                      // branch drops every grant instead.
                      eq(rolePermissions.roleId, id)
            );
        }
    });
}
