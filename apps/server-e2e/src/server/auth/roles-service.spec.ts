import { getDatabase } from '@orthacms/database';
import {
    RoleNotFoundError,
    RolesService,
    SystemRoleProtectedError,
    roles
} from '@orthacms/identity-server';
import { eq } from 'drizzle-orm';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';

/**
 * `RolesService.delete` — the system-role protection rule. It has no HTTP
 * route, so this drives the real service out of DI against the real database,
 * which is where the whole guarantee lives: the guard is an `is_system = false`
 * predicate **inside the DELETE**, not a read-then-write, so it holds even if a
 * role is flipped concurrently.
 */
describe('RolesService.delete', () => {
    let harness: TestApp;
    let service: RolesService;

    beforeAll(async () => {
        harness = await createTestApp();
        service = harness.app.get(RolesService);
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    /** The id of a seeded system role. */
    async function systemRoleId(key: string): Promise<string> {
        const [row] = await getDatabase()
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, key));
        return row.id;
    }

    /** Inserts a deletable custom role and returns its id. */
    async function customRole(key: string): Promise<string> {
        const [row] = await getDatabase()
            .insert(roles)
            .values({ key, name: key, isSystem: false })
            .returning({ id: roles.id });
        return row.id;
    }

    it('deletes a custom role', async () => {
        const id = await customRole('roles-service-deletable');

        await expect(service.delete(id)).resolves.toBeUndefined();

        const [row] = await getDatabase()
            .select()
            .from(roles)
            .where(eq(roles.id, id));
        expect(row).toBeUndefined();
    });

    it.each(['admin', 'contributor', 'viewer'])(
        // covers: identity:I-13
        'refuses to delete the %s system role',
        async (key) => {
            const id = await systemRoleId(key);

            await expect(service.delete(id)).rejects.toBeInstanceOf(
                SystemRoleProtectedError
            );

            // Still there — and the refusal must not have been a no-op that
            // merely reported failure.
            const [row] = await getDatabase()
                .select()
                .from(roles)
                .where(eq(roles.id, id));
            expect(row?.isSystem).toBe(true);
        }
    );

    it('distinguishes "protected" from "missing"', async () => {
        // Both are zero-row deletes; conflating them would tell an operator a
        // protected role does not exist.
        await expect(
            service.delete('11111111-1111-4111-8111-111111111111')
        ).rejects.toBeInstanceOf(RoleNotFoundError);
    });

    it('is not idempotent — a second delete reports the role is gone', async () => {
        const id = await customRole('roles-service-twice');
        await service.delete(id);
        await expect(service.delete(id)).rejects.toBeInstanceOf(
            RoleNotFoundError
        );
    });

    it('refuses concurrently, without one racer slipping through', async () => {
        // The guard is in the SQL predicate, so simultaneous deletes of a
        // system role must all fail rather than one of them landing between
        // another's check and its write.
        const id = await systemRoleId('admin');

        const outcomes = await Promise.allSettled([
            service.delete(id),
            service.delete(id),
            service.delete(id)
        ]);

        expect(outcomes.every((o) => o.status === 'rejected')).toBe(true);
        const [row] = await getDatabase()
            .select()
            .from(roles)
            .where(eq(roles.id, id));
        expect(row).toBeDefined();
    });
});
