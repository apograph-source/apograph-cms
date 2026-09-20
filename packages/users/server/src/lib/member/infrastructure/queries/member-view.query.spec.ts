import { Column, Param, SQL, StringChunk } from 'drizzle-orm';
import type { Database } from '@orthacms/database';
import type { ListMembersQueryDto } from '../../application/dto/list-members-query.dto';
import { MemberViewQuery } from './member-view.query';

const MEMBER_ID = '11111111-1111-4111-8111-111111111111';

/** A `users ⋈ roles` row as the query selects it. */
interface Row {
    id: string;
    email: string;
    name: string | null;
    status: string;
    createdAt: Date;
    roleId: string;
    roleKey: string;
    roleName: string;
}

/**
 * The interpolated values of a drizzle predicate, in order — structural chunks
 * (literal SQL, column references) dropped.
 */
function paramsOf(node: unknown, out: unknown[] = []): unknown[] {
    if (node instanceof Param) {
        out.push(node.value);
    } else if (node instanceof SQL) {
        for (const chunk of node.queryChunks) {
            paramsOf(chunk, out);
        }
    } else if (node instanceof StringChunk || node instanceof Column) {
        // Structure, not data.
    } else if (Array.isArray(node)) {
        for (const item of node) {
            paramsOf(item, out);
        }
    } else {
        out.push(node);
    }
    return out;
}

/**
 * `MemberViewQuery` — the two things it computes rather than reads.
 *
 * `isLastAdmin` is a three-condition conjunction the admin UI uses to grey out
 * the demote and disable controls, and every way of getting it wrong is
 * silently *permissive*: drop the status check and a disabled admin reads as
 * protected, drop the role check and everyone does. Getting it wrong the other
 * way — a true where it should be false — hands the user a control the server
 * will 409, which is the honest failure. Only the first kind is invisible.
 *
 * The search escaping is the other: a needle containing `%` or `_` is a LIKE
 * wildcard unless escaped, so searching for `a_b` would quietly match `axb`.
 */
describe('MemberViewQuery', () => {
    /** Predicates the double captured, one per query shape it recognised. */
    interface Captured {
        listWhere?: unknown;
    }

    /**
     * A `Database` double that answers each of the query's four shapes by the
     * fields it selects and whether it joined — the only distinguishing marks
     * available without a real dialect.
     */
    function dbDouble(options: {
        row?: Row | null;
        adminCount?: number;
        captured?: Captured;
    }): Database {
        const { row = null, adminCount = 1, captured = {} } = options;

        const select = (fields: Record<string, unknown>) => {
            let joined = false;
            let table: unknown;

            const resolve = async (): Promise<unknown[]> => {
                if ('total' in fields) {
                    // The list's own count has no join; the active-admin count
                    // joins `roles` to filter on the key.
                    return [{ total: joined ? adminCount : row ? 1 : 0 }];
                }
                if ('userId' in fields) {
                    return []; // No workspace memberships in these cases.
                }
                return row ? [row] : [];
            };

            const chain: Record<string, unknown> = {
                from: (from: unknown) => {
                    table = from;
                    return chain;
                },
                innerJoin: () => {
                    joined = true;
                    return chain;
                },
                where: (where: unknown) => {
                    if ('total' in fields && !joined) {
                        captured.listWhere = where;
                    }
                    return chain;
                },
                orderBy: () => chain,
                limit: () => chain,
                offset: () => chain,
                then: (
                    onFulfilled: (value: unknown[]) => unknown,
                    onRejected: (reason: unknown) => unknown
                ) => resolve().then(onFulfilled, onRejected)
            };
            void table;
            return chain;
        };

        return { select } as unknown as Database;
    }

    /** A member row, admin + active unless overridden. */
    function memberRow(overrides: Partial<Row> = {}): Row {
        return {
            id: MEMBER_ID,
            email: 'ada@example.com',
            name: 'Ada',
            status: 'active',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            roleId: '33333333-3333-4333-8333-333333333333',
            roleKey: 'admin',
            roleName: 'Admin',
            ...overrides
        };
    }

    describe('isLastAdmin', () => {
        it.each([
            ['an active admin who is the only one', {}, 1, true],
            ['an active admin with a peer', {}, 2, false],
            ['a pending admin', { status: 'pending' }, 1, false],
            ['a disabled admin', { status: 'disabled' }, 1, false],
            ['an active contributor', { roleKey: 'contributor' }, 1, false]
        ])('is %s → %s', async (_label, overrides, adminCount, expected) => {
            const query = new MemberViewQuery(
                dbDouble({
                    row: memberRow(overrides as Partial<Row>),
                    adminCount: adminCount as number
                })
            );

            const view = await query.byId(MEMBER_ID);

            expect(view?.isLastAdmin).toBe(expected);
        });

        it('returns null for an unknown member', async () => {
            const query = new MemberViewQuery(dbDouble({ row: null }));

            expect(await query.byId(MEMBER_ID)).toBeNull();
        });
    });

    describe('search', () => {
        it('escapes LIKE metacharacters so a literal needle stays literal', async () => {
            const captured: Captured = {};
            const query = new MemberViewQuery(
                dbDouble({ row: memberRow(), captured })
            );

            await query.list({
                search: 'a\\%_b'
            } as ListMembersQueryDto);

            // Unescaped, `%` and `_` are wildcards: searching for `a_b` would
            // match `axb`, and `%` would match everyone.
            const pattern = '%a\\\\\\%\\_b%';
            expect(paramsOf(captured.listWhere)).toEqual([pattern, pattern]);
        });

        it('applies no predicate for a blank search', async () => {
            const captured: Captured = {};
            const query = new MemberViewQuery(
                dbDouble({ row: memberRow(), captured })
            );

            await query.list({ search: '   ' } as ListMembersQueryDto);

            expect(captured.listWhere).toBeUndefined();
        });
    });
});
