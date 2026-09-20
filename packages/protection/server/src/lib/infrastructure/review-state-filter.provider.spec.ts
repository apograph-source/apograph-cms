import { FilterOperator } from '@orthacms/utils-server';
import {
    REVIEW_STATE,
    REVIEW_STATE_FIELD,
    ReviewStateFilterProvider
} from './review-state-filter.provider';

/**
 * A Drizzle stand-in that records what the subquery was built with.
 *
 * The point of these tests is *which columns the predicate constrains on*, and
 * that is decided before any SQL is dialect-rendered — so a recorder beats a
 * live database here, and the e2e covers the rendering.
 */
function recordingDb() {
    const wheres: unknown[] = [];
    const chain = {
        from: () => chain,
        where: (clause: unknown) => {
            wheres.push(clause);
            return chain;
        }
    };
    return { db: { select: () => chain } as never, wheres };
}

/**
 * Every primitive bound into a Drizzle clause.
 *
 * A clause holds columns whose `table` points back at them, so it cannot be
 * serialized; this walks it with a seen-set and collects the leaves, which is
 * all the assertion needs.
 */
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
        for (const value of Object.values(node as Record<string, unknown>)) {
            walk(value);
        }
    };
    walk(clause);
    return found;
}

/** A publishable content type with an `id` column, as the registry hands one over. */
const publishableType = {
    name: 'article',
    publishable: true,
    table: { id: { name: 'id' } }
} as never;

describe('the reviewState filter field', () => {
    it('is offered on a publishable type, with both states', () => {
        const { db } = recordingDb();
        const extension = new ReviewStateFilterProvider(db).filterFor(
            publishableType
        );

        expect(extension?.fields[REVIEW_STATE_FIELD]).toMatchObject({
            enumValues: [REVIEW_STATE.Awaiting, REVIEW_STATE.NotRequested]
        });
    });

    /**
     * Review guards the `draft → published` transition, so a type that is always
     * live has no transition to hold — and a filter offered there would be a
     * rule the picker proposes and nothing can ever satisfy.
     */
    it('is not offered on a non-publishable type', () => {
        const { db } = recordingDb();
        const extension = new ReviewStateFilterProvider(db).filterFor({
            name: 'settings',
            publishable: false,
            table: { id: { name: 'id' } }
        } as never);

        expect(extension).toBeUndefined();
    });

    /**
     * The first obligation the filter registry states, and the one whose failure
     * is silent: a virtual field is a subquery over a table content-server has
     * never heard of, so one that forgets the workspace turns a filter into a
     * cross-tenant read. Nothing about the returned rows would look wrong.
     */
    it('scopes its subquery to the workspace it is handed', async () => {
        const { db, wheres } = recordingDb();
        const extension = new ReviewStateFilterProvider(db).filterFor(
            publishableType
        );

        await extension?.resolve(
            {
                path: [REVIEW_STATE_FIELD],
                op: FilterOperator.Eq,
                value: REVIEW_STATE.Awaiting
            } as never,
            { type: publishableType, workspaceId: 'ws-1' } as never
        );

        expect(wheres).toHaveLength(1);
        // The workspace id reaches the predicate as a bound parameter. Walking
        // the clause is how to see it without a live dialect — and its absence
        // is exactly the defect being guarded, which no returned row would show.
        expect(boundValues(wheres[0])).toContain('ws-1');
    });

    /**
     * The registry's second obligation. An operator the resolver refuses reaches
     * the user as "couldn't load this collection" over a rule the picker itself
     * proposed, so the refusal has to be a stated 400 rather than a crash — and
     * the admin's `FilterField.operators` is narrowed to match.
     */
    it('refuses an operator it cannot answer, by name', async () => {
        const { db } = recordingDb();
        const extension = new ReviewStateFilterProvider(db).filterFor(
            publishableType
        );

        await expect(
            extension?.resolve(
                {
                    path: [REVIEW_STATE_FIELD],
                    op: FilterOperator.Like,
                    value: REVIEW_STATE.Awaiting
                } as never,
                { type: publishableType, workspaceId: 'ws-1' } as never
            )
        ).rejects.toThrow(/not supported/i);
    });

    /**
     * `in []` is a question nobody means to ask, and answering it with an empty
     * page looks like a working filter over missing data rather than a mistake.
     */
    it('refuses an empty state list rather than matching nothing', async () => {
        const { db } = recordingDb();
        const extension = new ReviewStateFilterProvider(db).filterFor(
            publishableType
        );

        await expect(
            extension?.resolve(
                {
                    path: [REVIEW_STATE_FIELD],
                    op: FilterOperator.In,
                    value: []
                } as never,
                { type: publishableType, workspaceId: 'ws-1' } as never
            )
        ).rejects.toThrow(/at least one state/i);
    });
});
