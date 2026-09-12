import { Column } from 'drizzle-orm';
import { ProtectionWorkspacePurger } from './protection-workspace.purger';
import { protectionRules } from '../schema/protection-rules';
import { reviewApprovals } from '../schema/review-approvals';
import { reviewRequests } from '../schema/review-requests';

const WORKSPACE = '33333333-3333-4333-8333-333333333333';

/**
 * Records which table each delete targeted **and what it was narrowed by** —
 * the only chain the purger uses.
 *
 * The `where` argument used to be discarded here, and that made the suite blind
 * to the one mistake in this file that matters: a purge that deletes every
 * workspace's rules and votes passes an assertion about *which tables* were
 * emptied just as happily as a correct one.
 */
function executor(rowsPerTable: number) {
    const deletes: unknown[] = [];
    const wheres: unknown[] = [];
    return {
        deletes,
        wheres,
        db: {
            delete(table: unknown) {
                deletes.push(table);
                return {
                    where: (clause: unknown) => {
                        wheres.push(clause);
                        return {
                            returning: async () =>
                                Array.from({ length: rowsPerTable }, () => ({}))
                        };
                    }
                };
            }
        }
    };
}

/**
 * The distinct columns a Drizzle clause constrains on, by **identity**.
 *
 * It stops at a column rather than walking into it: a column holds a reference
 * back to its table, and a table holds every one of its columns, so a walk that
 * recursed through one would reach all of them and make any `toContain`
 * assertion trivially true. Identity rather than the column's name, so a
 * predicate over the *right* name on the *wrong* table cannot pass either.
 *
 * Distinct because `eq(column, value)` mentions the column twice — once as a
 * chunk of the expression and once as the bound parameter's encoder.
 */
function constrainedColumns(clause: unknown): Column[] {
    const found = new Set<Column>();
    const seen = new Set<unknown>();
    const walk = (node: unknown): void => {
        if (node === null || typeof node !== 'object') return;
        if (node instanceof Column) {
            found.add(node);
            return;
        }
        if (seen.has(node)) return;
        seen.add(node);
        for (const value of Object.values(node as Record<string, unknown>)) {
            walk(value);
        }
    };
    walk(clause);
    return [...found];
}

/** Every primitive bound into a clause — the workspace id among them. */
function boundValues(clause: unknown): unknown[] {
    const found: unknown[] = [];
    const seen = new Set<unknown>();
    const walk = (node: unknown): void => {
        if (node === null || node === undefined) return;
        if (typeof node !== 'object') {
            found.push(node);
            return;
        }
        if (seen.has(node)) return;
        seen.add(node);
        if (node instanceof Column) return;
        for (const value of Object.values(node as Record<string, unknown>)) {
            walk(value);
        }
    };
    walk(clause);
    return found;
}

describe('ProtectionWorkspacePurger', () => {
    it('names itself once, so a second registration is a loud wiring bug', () => {
        expect(new ProtectionWorkspacePurger({} as never).purgeName).toBe(
            'protection:rules-and-reviews'
        );
    });

    /**
     * All three, not just the rules. `review_approvals.revision_id` points at
     * `content_entry_revisions`, which is host-owned and therefore un-FK-able
     * from a plugin — so votes outlive the entries, the revisions *and* the
     * workspace unless something deletes them by workspace.
     */
    it('clears all three of the plugin’s tables [protection:I-16]', async () => {
        const { db, deletes } = executor(2);
        const purger = new ProtectionWorkspacePurger({
            current: () => db
        } as never);

        const outcome = await purger.purge(WORKSPACE);

        expect(deletes).toEqual([
            reviewApprovals,
            reviewRequests,
            protectionRules
        ]);
        expect(outcome).toEqual({ rows: 6 });
    });

    /**
     * Votes and requests before rules. Nothing enforces it — there is no
     * foreign key between the three — but a partial failure that left a rule
     * with no votes reads as an untouched rule, while votes with no rule read
     * as a policy that vanished.
     */
    it('deletes the dependent rows before the rule they belong to', async () => {
        const { db, deletes } = executor(0);
        const purger = new ProtectionWorkspacePurger({
            current: () => db
        } as never);

        await purger.purge(WORKSPACE);

        expect(deletes.indexOf(protectionRules)).toBe(deletes.length - 1);
    });

    /**
     * The assertion the suite was missing, and the reason it matters more than
     * the one above it: these three tables carry a plain `workspace_id` with no
     * foreign key, so nothing in the database would object to a delete that
     * forgot to name it. A purge of one workspace that emptied every
     * workspace's rules and votes satisfies `[protection:I-16]` — zero rows
     * left for the workspace that was deleted — while destroying every other
     * tenant's policy.
     */
    it('narrows every delete to the workspace being purged', async () => {
        const { db, deletes, wheres } = executor(1);
        const purger = new ProtectionWorkspacePurger({
            current: () => db
        } as never);

        await purger.purge(WORKSPACE);

        const workspaceColumn = new Map<unknown, Column>([
            [reviewApprovals, reviewApprovals.workspaceId],
            [reviewRequests, reviewRequests.workspaceId],
            [protectionRules, protectionRules.workspaceId]
        ]);

        expect(wheres).toHaveLength(deletes.length);
        deletes.forEach((table, index) => {
            const clause = wheres[index];
            expect(constrainedColumns(clause)).toEqual([
                workspaceColumn.get(table)
            ]);
            expect(boundValues(clause)).toContain(WORKSPACE);
        });
    });

    it('reports zero on a workspace that never protected anything', async () => {
        const { db } = executor(0);
        const purger = new ProtectionWorkspacePurger({
            current: () => db
        } as never);

        expect(await purger.purge(WORKSPACE)).toEqual({ rows: 0 });
    });

    it('registers itself with the workspaces registry when there is one', () => {
        const registered: unknown[] = [];
        const purger = new ProtectionWorkspacePurger(
            {} as never,
            {
                register: (entry: unknown) => registered.push(entry)
            } as never
        );

        purger.onModuleInit();

        expect(registered).toEqual([purger]);
    });

    /**
     * A host running this plugin without `WorkspacesPlugin` is not a real
     * configuration, but it must boot rather than fail on an injection it
     * cannot influence — the same optional-registry shape every purger uses.
     */
    it('tolerates a host with no workspaces plugin', () => {
        const purger = new ProtectionWorkspacePurger({} as never);

        expect(() => purger.onModuleInit()).not.toThrow();
    });
});
