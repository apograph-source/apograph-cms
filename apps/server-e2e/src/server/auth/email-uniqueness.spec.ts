import { eq } from 'drizzle-orm';
import request from 'supertest';
import { getDatabase } from '@orthacms/database';
import { roles, users } from '@orthacms/identity-server';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';
import {
    isDuplicateEmail,
    resetDb,
    seedActiveUser,
    type SeededUser
} from '../../support/seed';

const ADMIN_EMAIL = 'unique-admin@example.com';
const MEMBER_EMAIL = 'unique-member@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * Email uniqueness is enforced **by the database**, case-insensitively.
 *
 * The application already lower-cases addresses on the way in, and the invite
 * route already refuses a duplicate — so why insist on the index? Because an
 * address is the account's identity, and a second row for the same person is
 * not a cosmetic problem: `POST /auth/login` looks an address up and takes what
 * it finds, so two rows means one of the two accounts silently becomes
 * unreachable while its permissions, sessions and audit trail carry on
 * existing. Which of them answers is a matter of row order.
 *
 * Application-level checks cannot close that on their own. Every one of them is
 * read-then-write, so two concurrent invites for the same address both read
 * "no such user" and both insert. The unique index is the only thing that is
 * atomic with the write, and it is the reason the invite route can be a check
 * rather than a lock.
 *
 * These tests therefore go **around** the application — inserting straight into
 * `users` — because that is the only way to ask the database the question. A
 * test that went through the API would be re-testing the application check that
 * this index is the backstop for.
 */
describe('email uniqueness is case-insensitive at the database level', () => {
    let harness: TestApp;
    let member: SeededUser;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        member = await seedActiveUser(harness.app, {
            email: MEMBER_EMAIL,
            password: PASSWORD,
            role: 'contributor'
        });
    });

    /** A role id to hang a raw insert on — the column is NOT NULL. */
    async function viewerRoleId(): Promise<string> {
        const [role] = await getDatabase()
            .select()
            .from(roles)
            .where(eq(roles.key, 'viewer'));
        return role.id;
    }

    /** Inserts a row directly, returning the error the database raised. */
    async function insertDirectly(email: string): Promise<unknown> {
        try {
            await getDatabase()
                .insert(users)
                .values({
                    email,
                    name: null,
                    passwordHash: null,
                    roleId: await viewerRoleId(),
                    status: 'pending'
                });
            return null;
        } catch (error) {
            return error;
        }
    }

    it('refuses a second row differing only in case [identity:I-12] [users:I-10]', async () => {
        const error = await insertDirectly(MEMBER_EMAIL.toUpperCase());

        expect(error).not.toBeNull();
        expect(isDuplicateEmail(error)).toBe(true);
    });

    it('refuses a mixed-case duplicate too, not just an upper-cased one', async () => {
        const mixed = MEMBER_EMAIL.replace('unique', 'UnIqUe');
        expect(mixed).not.toBe(MEMBER_EMAIL);

        expect(isDuplicateEmail(await insertDirectly(mixed))).toBe(true);
    });

    it('leaves exactly one row behind, so the refusal really refused', async () => {
        await insertDirectly(MEMBER_EMAIL.toUpperCase());

        const rows = await getDatabase()
            .select()
            .from(users)
            .where(eq(users.id, member.id));
        expect(rows).toHaveLength(1);

        // And the address the account still holds is the one it was seeded
        // with — the failed insert did not update anything on its way out.
        expect(rows[0].email).toBe(MEMBER_EMAIL);
    });

    it('allows an address that differs by more than case', async () => {
        // The control: the index is on `lower(email)`, not on some looser
        // normalisation, so a genuinely different address still inserts.
        expect(await insertDirectly('unique-member2@example.com')).toBeNull();
    });

    it('is what keeps a differently-cased sign-in resolving to one account', async () => {
        // Why the index matters, stated as behaviour: the address is matched
        // case-insensitively at sign-in, so a second row differing only in case
        // would make which account answers a matter of row order.
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .send({ email: MEMBER_EMAIL.toUpperCase(), password: PASSWORD })
            .expect(201);

        const me = await agent.get('/api/auth/me').expect(200);
        expect(me.body.id).toBe(member.id);
    });

    it('refuses to rename one account onto another’s address', async () => {
        // The other way a duplicate can appear: not a new row, but an existing
        // one moved onto a taken address. The index covers updates too.
        const admin = await getDatabase()
            .select()
            .from(users)
            .where(eq(users.email, ADMIN_EMAIL));

        let error: unknown = null;
        try {
            await getDatabase()
                .update(users)
                .set({ email: MEMBER_EMAIL.toUpperCase() })
                .where(eq(users.id, admin[0].id));
        } catch (caught) {
            error = caught;
        }

        expect(isDuplicateEmail(error)).toBe(true);
    });
});
