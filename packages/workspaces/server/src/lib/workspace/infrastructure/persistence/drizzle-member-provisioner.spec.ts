import type { UnitOfWork } from '@orthacms/database';
import { roles } from '@orthacms/identity-server';
import { DrizzleMemberProvisioner } from './drizzle-member-provisioner';
import type { MemberInput } from '../../application/ports/member-provisioner.port';

const VIEWER_ROLE = 'role-viewer';

/** Awaitable query builder: every chain method resolves the same rows. */
function chain<T>(rows: T[]) {
    const awaitable = Promise.resolve(rows) as Promise<T[]> & {
        where(condition?: unknown): typeof awaitable;
        limit(count: number): typeof awaitable;
    };
    awaitable.where = () => awaitable;
    awaitable.limit = () => awaitable;
    return awaitable;
}

/** What the fake database already holds, and what the insert hands back. */
interface Fixtures {
    /** Rows the case-insensitive email lookup finds. */
    usersByEmail?: { id: string; email: string }[];
    /** Rows the `viewer` role lookup finds — empty models a database missing it. */
    viewerRole?: { id: string }[];
    /** Rows the provisioning insert returns. */
    created?: { id: string; email: string }[];
    /** Ids the final existence check confirms. */
    existingIds?: string[];
}

/**
 * A Drizzle executor recording every statement. The three selects are told
 * apart by the table and the projection: the invited lookup asks for
 * `{id, email}` from `users`, the existence check for `{id}` alone, and the
 * role lookup reads `roles`.
 */
function fakeExecutor(fixtures: Fixtures) {
    const calls: string[] = [];
    const inserted: Record<string, unknown>[][] = [];
    const executor = {
        select(projection: Record<string, unknown>) {
            const wantsEmail = Object.keys(projection).includes('email');
            return {
                from(table: object) {
                    if (table === roles) {
                        calls.push('select:roles');
                        return chain(
                            fixtures.viewerRole ?? [{ id: VIEWER_ROLE }]
                        );
                    }
                    if (wantsEmail) {
                        calls.push('select:users-by-email');
                        return chain(fixtures.usersByEmail ?? []);
                    }
                    calls.push('select:users-by-id');
                    return chain(
                        (fixtures.existingIds ?? []).map((id) => ({ id }))
                    );
                }
            };
        },
        insert() {
            calls.push('insert:users');
            return {
                values(rows: Record<string, unknown>[]) {
                    inserted.push(rows);
                    return {
                        returning: () => Promise.resolve(fixtures.created ?? [])
                    };
                }
            };
        }
    };
    return { executor, calls, inserted };
}

/** A provisioner over the fake executor, plus its recording handles. */
function provisioner(fixtures: Fixtures = {}) {
    const { executor, calls, inserted } = fakeExecutor(fixtures);
    const uow = { current: () => executor } as unknown as UnitOfWork;
    return {
        subject: new DrizzleMemberProvisioner(uow),
        calls,
        inserted
    };
}

/** An invited member — the address is the key, the id is whatever was typed. */
function invited(email: string): MemberInput {
    return { id: email, email, invited: true };
}

/** An existing account being linked by directory id. */
function existing(id: string): MemberInput {
    return { id, email: `${id}@example.com`, invited: false };
}

/**
 * Resolving the create wizard's member list to real user ids.
 *
 * Two rules carry weight here. The first is **normalisation**: an invited
 * member is provisioned as a permanent directory account keyed on the typed
 * address, so `Grace@Example.com` and `grace@example.com ` have to collapse to
 * one account before anything is written — otherwise a workspace seeded with
 * both gets two rows for one person, and every later invite to either spelling
 * picks one at random. The second is **tolerance**: a directory id that no
 * longer resolves is dropped rather than inserted, because the alternative is
 * a foreign-key violation that aborts the whole create over a stale entry in
 * somebody's member picker.
 *
 * Resolution is also set-based rather than per member — one lookup for every
 * invited address, one role lookup, one multi-row insert — because the walk
 * happens inside the create transaction, so its length is how long that write
 * transaction stays open.
 */
describe('DrizzleMemberProvisioner', () => {
    describe('invited members', () => {
        it('normalises and de-dupes an address, issuing one lookup and one insert [workspaces:I-25]', async () => {
            const { subject, calls, inserted } = provisioner({
                created: [{ id: 'user-1', email: 'grace@example.com' }],
                existingIds: ['user-1']
            });

            const resolved = await subject.resolve([
                invited(' Grace@Example.COM '),
                invited('grace@example.com'),
                invited('GRACE@EXAMPLE.COM')
            ]);

            expect(calls).toEqual([
                'select:users-by-email',
                'select:roles',
                'insert:users',
                'select:users-by-id'
            ]);
            // One row written, carrying the normalised address — three
            // spellings of one person are one account.
            expect(inserted).toEqual([
                [
                    {
                        email: 'grace@example.com',
                        status: 'pending',
                        roleId: VIEWER_ROLE
                    }
                ]
            ]);
            expect(resolved).toEqual(['user-1']);
        });

        it('reuses an existing account rather than provisioning a second', async () => {
            const { subject, calls, inserted } = provisioner({
                usersByEmail: [{ id: 'user-1', email: 'Grace@Example.com' }],
                existingIds: ['user-1']
            });

            const resolved = await subject.resolve([
                invited('grace@example.com')
            ]);

            // Nothing inserted: no role lookup either, because the batch had
            // nothing missing to provision.
            expect(inserted).toEqual([]);
            expect(calls).not.toContain('select:roles');
            expect(resolved).toEqual(['user-1']);
        });

        it('matches a stored address case-insensitively on the way back', async () => {
            const { subject } = provisioner({
                usersByEmail: [{ id: 'user-1', email: '  GRACE@example.com ' }],
                existingIds: ['user-1']
            });

            expect(
                await subject.resolve([invited('grace@example.com')])
            ).toEqual(['user-1']);
        });

        it('provisions only the addresses the lookup did not find', async () => {
            const { subject, inserted } = provisioner({
                usersByEmail: [{ id: 'user-1', email: 'grace@example.com' }],
                created: [{ id: 'user-2', email: 'ada@example.com' }],
                existingIds: ['user-1', 'user-2']
            });

            const resolved = await subject.resolve([
                invited('grace@example.com'),
                invited('ada@example.com')
            ]);

            expect(inserted[0]).toHaveLength(1);
            expect(inserted[0][0]).toMatchObject({ email: 'ada@example.com' });
            expect(resolved).toEqual(['user-1', 'user-2']);
        });
    });

    describe('directory ids', () => {
        it('drops an id the users table does not have, and still succeeds [workspaces:I-26]', async () => {
            const { subject } = provisioner({ existingIds: ['real-user'] });

            // A stale id in somebody's member picker would otherwise hit the
            // membership foreign key and abort the entire create.
            await expect(
                subject.resolve([existing('real-user'), existing('ghost-user')])
            ).resolves.toEqual(['real-user']);
        });

        it('returns an empty list when none of them resolve', async () => {
            const { subject } = provisioner({ existingIds: [] });

            await expect(
                subject.resolve([existing('ghost-user')])
            ).resolves.toEqual([]);
        });

        it('de-dupes a repeated id', async () => {
            const { subject } = provisioner({ existingIds: ['real-user'] });

            await expect(
                subject.resolve([existing('real-user'), existing('real-user')])
            ).resolves.toEqual(['real-user']);
        });
    });

    it('issues no query at all for an empty member list', async () => {
        // The creator is added by the aggregate, not here, so an empty list is
        // the ordinary case for a workspace created for one person.
        const { subject, calls } = provisioner();

        await expect(subject.resolve([])).resolves.toEqual([]);
        expect(calls).toEqual([]);
    });

    it('throws a raw TypeError when the database has no viewer role', async () => {
        // A sharp edge, asserted as it stands rather than smoothed over. The
        // role lookup destructures `const [viewer] = …` and then reads
        // `viewer.id`, so a database whose system roles were never seeded
        // fails with `Cannot read properties of undefined` — a 500, not a
        // domain error naming the missing role. It is unreachable through a
        // migrated host (the seeder runs at boot), which is why it has
        // survived; changing it is a production-code decision, and this case
        // exists so the change is a deliberate one.
        const { subject } = provisioner({
            viewerRole: [],
            existingIds: []
        });

        await expect(
            subject.resolve([invited('grace@example.com')])
        ).rejects.toThrow(TypeError);
    });
});
