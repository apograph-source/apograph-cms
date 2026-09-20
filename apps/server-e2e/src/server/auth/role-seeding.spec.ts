import { getDatabase, getPool } from '@orthacms/database';
import {
    PERMISSION_KEYS,
    SYSTEM_ROLES,
    seedSystemRoles,
    permissions,
    rolePermissions,
    roles
} from '@orthacms/identity-server';
import { and, eq } from 'drizzle-orm';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';

/**
 * `seedSystemRoles` — the RBAC seeder that runs on every boot.
 *
 * It used to be **additive only** (`ON CONFLICT DO NOTHING` and nothing else),
 * which meant the database was a superset of the code and could never shrink
 * back: ADR-0009 deleted `copilot:configure`, but its `permissions` row and its
 * grant to `admin` survived, so `/auth/me` kept handing every admin a key that
 * no longer existed. Nothing gated on that one, but a **renamed** key would
 * leave the old grant live alongside the new one, which for a
 * security-relevant permission is a privilege leak.
 *
 * These specs drive the real seeder against the real database, since the whole
 * behaviour is about reconciling persisted rows.
 */
describe('System role seeding', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        // Leave the shared database exactly as the seeder would: the specs
        // below insert and delete stray rows, and other suites read the
        // catalogue.
        await seedSystemRoles(getDatabase());
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await seedSystemRoles(getDatabase());
    });

    /** The permission keys currently in the catalogue. */
    async function catalogue(): Promise<string[]> {
        const rows = await getDatabase()
            .select({ key: permissions.key })
            .from(permissions);
        return rows.map((row) => row.key).sort();
    }

    /** The permission keys granted to the role with `key`. */
    async function grantsFor(key: string): Promise<string[]> {
        const { rows } = await getPool().query(
            `SELECT p.key
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.key = $1`,
            [key]
        );
        return rows.map((row: { key: string }) => row.key).sort();
    }

    it('seeds exactly the catalogue the code defines', async () => {
        expect(await catalogue()).toEqual([...PERMISSION_KEYS].sort());
    });

    it('grants each system role exactly its matrix row', async () => {
        for (const role of SYSTEM_ROLES) {
            expect(await grantsFor(role.key)).toEqual(
                [...role.permissions].sort()
            );
        }
    });

    it('is idempotent — a second run changes nothing [identity:I-13]', async () => {
        const before = await catalogue();
        const adminBefore = await grantsFor('admin');

        await seedSystemRoles(getDatabase());

        expect(await catalogue()).toEqual(before);
        expect(await grantsFor('admin')).toEqual(adminBefore);
    });

    it('survives two instances seeding at once [identity:I-13]', async () => {
        // Every write is conflict-safe, so simultaneous boots must both
        // succeed rather than racing into a unique violation.
        await Promise.all([
            seedSystemRoles(getDatabase()),
            seedSystemRoles(getDatabase())
        ]);

        expect(await catalogue()).toEqual([...PERMISSION_KEYS].sort());
        expect(await grantsFor('admin')).toEqual([...PERMISSION_KEYS].sort());
    });

    it('prunes a permission the code no longer defines', async () => {
        // Reproduces the `copilot:configure` orphan: a key that exists in the
        // database, granted to admin, and absent from the code.
        const db = getDatabase();
        const [orphan] = await db
            .insert(permissions)
            .values({ key: 'copilot:configure' })
            .returning();
        const [admin] = await db
            .select()
            .from(roles)
            .where(eq(roles.key, 'admin'));
        await db
            .insert(rolePermissions)
            .values({ roleId: admin.id, permissionId: orphan.id });

        expect(await grantsFor('admin')).toContain('copilot:configure');

        await seedSystemRoles(db);

        expect(await catalogue()).not.toContain('copilot:configure');
        expect(await grantsFor('admin')).toEqual([...PERMISSION_KEYS].sort());
    });

    it('revokes a stale grant of a permission that still exists', async () => {
        // The other direction: the key is still in the catalogue, but the
        // matrix no longer gives it to this role. Narrowing a built-in role in
        // code has to narrow it in the database.
        const db = getDatabase();
        const [viewer] = await db
            .select()
            .from(roles)
            .where(eq(roles.key, 'viewer'));
        const [deletePermission] = await db
            .select()
            .from(permissions)
            .where(eq(permissions.key, 'content:delete'));
        await db
            .insert(rolePermissions)
            .values({ roleId: viewer.id, permissionId: deletePermission.id });

        expect(await grantsFor('viewer')).toContain('content:delete');

        await seedSystemRoles(db);

        const matrixRow = SYSTEM_ROLES.find((role) => role.key === 'viewer');
        expect(await grantsFor('viewer')).not.toContain('content:delete');
        expect(await grantsFor('viewer')).toEqual(
            [...(matrixRow?.permissions ?? [])].sort()
        );
    });

    it('leaves a custom role’s grants of live permissions alone', async () => {
        // A non-system role is the operator's configuration, not the seeder's.
        const db = getDatabase();
        const [custom] = await db
            .insert(roles)
            .values({
                key: 'seeding-custom-role',
                name: 'Custom',
                isSystem: false
            })
            .onConflictDoNothing({ target: roles.key })
            .returning();
        const roleRow =
            custom ??
            (
                await db
                    .select()
                    .from(roles)
                    .where(eq(roles.key, 'seeding-custom-role'))
            )[0];
        const [readPermission] = await db
            .select()
            .from(permissions)
            .where(eq(permissions.key, 'content:read'));
        await db
            .insert(rolePermissions)
            .values({ roleId: roleRow.id, permissionId: readPermission.id })
            .onConflictDoNothing();

        await seedSystemRoles(db);

        expect(await grantsFor('seeding-custom-role')).toEqual([
            'content:read'
        ]);

        // Clean up so the row does not leak into other suites (`roles` is not
        // truncated by `resetDb`).
        await db
            .delete(rolePermissions)
            .where(
                and(
                    eq(rolePermissions.roleId, roleRow.id),
                    eq(rolePermissions.permissionId, readPermission.id)
                )
            );
        await db.delete(roles).where(eq(roles.id, roleRow.id));
    });

    it('drops a custom role’s grant of a permission the code retired', async () => {
        // The cascade is intended: the permission does not exist any more, so
        // no role — custom or built-in — can hold it.
        const db = getDatabase();
        const [orphan] = await db
            .insert(permissions)
            .values({ key: 'legacy:retired' })
            .returning();
        const [custom] = await db
            .insert(roles)
            .values({
                key: 'seeding-legacy-role',
                name: 'Legacy',
                isSystem: false
            })
            .returning();
        await db
            .insert(rolePermissions)
            .values({ roleId: custom.id, permissionId: orphan.id });

        await seedSystemRoles(db);

        expect(await catalogue()).not.toContain('legacy:retired');
        expect(await grantsFor('seeding-legacy-role')).toEqual([]);

        await db.delete(roles).where(eq(roles.id, custom.id));
    });
});
