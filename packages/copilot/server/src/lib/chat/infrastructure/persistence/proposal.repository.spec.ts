import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '@orthacms/database';
import { ProposalRepository } from './proposal.repository';

const PROPOSAL = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const REVIEWER = '33333333-3333-4333-8333-333333333333';

/** One recorded `UPDATE`: where it was rooted, what it set, and its filter. */
interface Update {
    table: string;
    set: Record<string, unknown>;
    where: SQL;
}

/**
 * A `Database` whose `update` records the **real** Drizzle expression the
 * repository built, and answers with `rows`.
 *
 * Recording the expression rather than a hand-rolled description of it is the
 * point: `and(eq(…), eq(…), eq(…))` renders to SQL through the same dialect
 * the driver uses, so a predicate that was dropped is a predicate that is
 * missing from the rendered statement — there is no place for the test to
 * agree with a stub instead of with the code.
 *
 * `where` is both awaitable and `.returning()`-able because the repository
 * uses each shape once: `reopen` awaits the update, `decide` asks for the row
 * back.
 */
function fakeDb(rows: unknown[]) {
    const updates: Update[] = [];
    const db = {
        update(table: object) {
            return {
                set(values: Record<string, unknown>) {
                    return {
                        where(where: SQL) {
                            updates.push({
                                table: getTableName(table as never),
                                set: values,
                                where
                            });
                            const settled = Promise.resolve(rows);
                            return {
                                returning: () => Promise.resolve(rows),
                                then: settled.then.bind(settled)
                            };
                        }
                    };
                }
            };
        }
    };
    return { repo: new ProposalRepository(db as unknown as Database), updates };
}

/** The SQL and bound parameters one recorded filter renders to. */
function filterOf(update: Update) {
    return new PgDialect().sqlToQuery(update.where);
}

/** A row shaped like the one `decide` reads back after a successful claim. */
const CLAIMED_ROW = {
    id: PROPOSAL,
    conversationId: 'conversation-1',
    runId: 'run-1',
    toolCallId: 'call-1',
    toolName: 'content_propose_update',
    kind: 'content.entry.update',
    workspaceId: WORKSPACE,
    createdBy: REVIEWER,
    target: { type: 'entry', id: 'entry-1' },
    patch: { title: 'New' },
    summary: 'Retitle the entry',
    changes: null,
    status: 'accepted',
    decidedBy: REVIEWER,
    decidedAt: new Date('2026-01-01T00:00:00Z'),
    result: null,
    error: null,
    createdAt: new Date('2026-01-01T00:00:00Z')
};

describe('ProposalRepository.decide', () => {
    /**
     * The concurrency guard, in the one place it can be: the `UPDATE` itself.
     *
     * A row is claimed by flipping its status *with a `status = 'pending'`
     * predicate*, so two callers racing to apply the same proposal cannot both
     * win — the loser's statement matches nothing and it gets `null` back. Move
     * the check into a read beforehand, or drop it, and the applier becomes
     * reachable twice for one row: a model that re-proposes an identical change,
     * or a retried run, writes twice.
     */
    it('claims the row with a pending predicate in the UPDATE itself [copilot:I-14]', async () => {
        const { repo, updates } = fakeDb([CLAIMED_ROW]);

        await repo.decide(PROPOSAL, WORKSPACE, 'accepted', REVIEWER);

        expect(updates).toHaveLength(1);
        expect(updates[0].table).toBe('copilot_proposals');
        // Flipped to `accepted` — and only from `pending`.
        expect(updates[0].set).toMatchObject({
            status: 'accepted',
            decidedBy: REVIEWER
        });

        const filter = filterOf(updates[0]);
        expect(filter.sql).toMatch(/"status" = \$\d/);
        expect(filter.params).toEqual([PROPOSAL, WORKSPACE, 'pending']);
    });

    /**
     * The other half: a statement that matched nothing has to be reported as a
     * refusal rather than as a success with a missing row, because
     * `DecideProposalService` keys "somebody already applied this" off exactly
     * this `null`.
     */
    it('answers null when the row was no longer pending [copilot:I-14]', async () => {
        const { repo } = fakeDb([]);

        await expect(
            repo.decide(PROPOSAL, WORKSPACE, 'accepted', REVIEWER)
        ).resolves.toBeNull();
    });

    /**
     * The claim is workspace-scoped too. `WorkspaceGuard` proves the caller
     * belongs to the workspace they named; nothing upstream proves the
     * *proposal id* does.
     */
    it('claims only inside the named workspace', async () => {
        const { repo, updates } = fakeDb([CLAIMED_ROW]);

        await repo.decide(PROPOSAL, WORKSPACE, 'accepted', REVIEWER);

        expect(filterOf(updates[0]).params).toContain(WORKSPACE);
    });
});

describe('ProposalRepository.reopen', () => {
    /**
     * Deliberately *not* guarded on `pending`: the row it reopens is `accepted`
     * by the time an apply has failed, so the same predicate would make the
     * failure unrecordable. Asserted because the difference between the two
     * statements is the whole design, and a symmetry-minded edit that "fixes"
     * the inconsistency would silently drop every failure message.
     */
    it('records the failure without a pending predicate', async () => {
        const { repo, updates } = fakeDb([]);

        await repo.reopen(PROPOSAL, WORKSPACE, 'Validation failed');

        expect(updates[0].set).toMatchObject({
            status: 'pending',
            decidedBy: null,
            error: 'Validation failed'
        });
        expect(filterOf(updates[0]).params).toEqual([PROPOSAL, WORKSPACE]);
    });
});
