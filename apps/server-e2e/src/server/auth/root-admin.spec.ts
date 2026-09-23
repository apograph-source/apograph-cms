import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    countUsers,
    getUserByEmail,
    provisionRootAdmin,
    seedActiveUser
} from '../../support/seed';

const ROOT_EMAIL = 'root@example.com';
const ROOT_PASSWORD = 'RootSecret123!';

/**
 * Root-admin bootstrap (Option B, self-hosted). The app boots WITH a
 * `rootAdmin` config, so `RootAdminSeeder` provisions the account during
 * `app.init()` — exactly as a real boot with `ORTHACMS_ROOT_ADMIN_EMAIL` set.
 *
 * One app per spec file: the `@orthacms/database` pool is a per-file
 * singleton, so this suite does not `resetDb` (that would wipe the
 * boot-provisioned admin); the idempotency/non-destructive cases use distinct
 * emails to stay independent of the boot account.
 */
describe('Root admin bootstrap (RootAdminSeeder)', () => {
    let harness: TestApp;

    beforeAll(async () => {
        harness = await createTestApp({
            rootAdmin: { email: ROOT_EMAIL, password: ROOT_PASSWORD }
        });
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    describe('provisioning on boot', () => {
        it('creates an active admin user with the configured email', async () => {
            const row = await getUserByEmail(ROOT_EMAIL);
            expect(row).not.toBeNull();
            expect(row?.status).toBe('active');
            expect(row?.roleKey).toBe('admin');
        });

        it('lets the provisioned admin log in', async () => {
            const res = await request(harness.server)
                .post('/api/auth/login')
                .send({ email: ROOT_EMAIL, password: ROOT_PASSWORD })
                .expect(201);
            expect(res.body).toEqual({ ok: true });
        });
    });

    describe('idempotency & non-destructive behavior', () => {
        it('returns "created" then "exists" for the same email', async () => {
            const email = 'idempotent@example.com';
            expect(
                await provisionRootAdmin(harness.app, {
                    email,
                    password: 'pw-Aa1!aaaa'
                })
            ).toBe('created');
            expect(
                await provisionRootAdmin(harness.app, {
                    email,
                    password: 'pw-Aa1!aaaa'
                })
            ).toBe('exists');
        });

        it('inserts no duplicate row on a repeat ensure', async () => {
            const email = 'dedupe@example.com';
            const before = await countUsers();
            await provisionRootAdmin(harness.app, {
                email,
                password: 'pw-Aa1!aaaa'
            });
            await provisionRootAdmin(harness.app, {
                email,
                password: 'pw-Aa1!aaaa'
            });
            expect(await countUsers()).toBe(before + 1);
        });

        it('matches an existing email case-insensitively (no overwrite)', async () => {
            // Pre-seed a NON-admin user, then ensure the same email as a root
            // admin: the existing account must be left untouched.
            const email = 'taken@example.com';
            await seedActiveUser(harness.app, {
                email,
                password: 'OriginalPass1!',
                role: 'viewer'
            });

            expect(
                await provisionRootAdmin(harness.app, {
                    email: email.toUpperCase(),
                    password: 'DifferentPass1!'
                })
            ).toBe('exists');

            const row = await getUserByEmail(email);
            expect(row?.roleKey).toBe('viewer');

            // The original password still authenticates; the would-be new one
            // does not — proving the hash was never overwritten.
            await request(harness.server)
                .post('/api/auth/login')
                .send({ email, password: 'OriginalPass1!' })
                .expect(201);
            await request(harness.server)
                .post('/api/auth/login')
                .send({ email, password: 'DifferentPass1!' })
                .expect(401);
        });
    });

    describe('misconfiguration (fail-fast)', () => {
        it('aborts boot when an email is configured without a password', async () => {
            // Reuses this file's live DB pool; the failed app is never returned
            // or closed, so the shared pool stays open for the suite.
            await expect(
                createTestApp({
                    rootAdmin: {
                        email: 'no-password@example.com',
                        password: ''
                    }
                })
            ).rejects.toThrow(/password/i);
        });
    });
});
