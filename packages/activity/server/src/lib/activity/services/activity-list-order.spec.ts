import { asc, desc, type SQL } from 'drizzle-orm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Database } from '@orthacms/database';
import { activityEvents } from '../../schema';
import { SORTABLE_FIELDS } from '../activity.constants';
import { ListActivityQueryDto } from '../dto/list-activity-query.dto';
import { ActivityService } from './activity.service';

/**
 * The order clause `GET /api/activity` builds, and the allow-list that decides
 * which column it may name.
 *
 * Both halves are invisible to the e2e suite as it stands. `activity.spec.ts`
 * asserts that `order=asc` reverses the page, which a query with no tiebreaker
 * at all satisfies — and equal `at` values are exactly the case the tiebreaker
 * exists for, so the difference only shows on rows the seed does not build.
 * Here the clause itself is the observable: the service is handed a Drizzle
 * stand-in that records the arguments `orderBy` receives.
 *
 * No database, and none needed: the whole decision is made before a statement
 * is executed.
 */

/**
 * A Drizzle stand-in that captures one `list()` call's two queries.
 *
 * `list` builds both in one array literal and awaits them together, so each
 * chain gets its own builder; a builder is thenable and answers with rows or
 * with the count depending on whether `orderBy` was ever called on it — which
 * is also the only structural difference between the two chains.
 */
function capturingDb(rows: unknown[] = []) {
    const captured: { orderBy?: unknown[]; limit?: number; offset?: number } =
        {};
    const db = {
        select() {
            let ordered = false;
            const builder = {
                from: () => builder,
                where: () => builder,
                orderBy(...args: unknown[]) {
                    ordered = true;
                    captured.orderBy = args;
                    return builder;
                },
                limit(value: number) {
                    captured.limit = value;
                    return builder;
                },
                offset(value: number) {
                    captured.offset = value;
                    return builder;
                },
                then(resolve: (value: unknown) => unknown) {
                    return Promise.resolve(
                        ordered ? rows : [{ total: rows.length }]
                    ).then(resolve);
                }
            };
            return builder;
        }
    };
    return { db: db as unknown as Database, captured };
}

/** The `orderBy` arguments of one `list(...)` call. */
async function orderByFor(
    query: Partial<ListActivityQueryDto>
): Promise<SQL[]> {
    const { db, captured } = capturingDb();
    await new ActivityService(db).list(query as ListActivityQueryDto);
    if (!captured.orderBy) {
        throw new Error(
            'The list query never called orderBy. This helper reads the ' +
                'ordering off the chain, so an unordered query proves nothing ' +
                'rather than failing quietly below.'
        );
    }
    return captured.orderBy as SQL[];
}

describe('GET /api/activity — deterministic ordering', () => {
    describe('the id tiebreaker', () => {
        it('appends `id desc` under the default sort [activity:I-17]', async () => {
            expect(await orderByFor({})).toEqual([
                desc(activityEvents.at),
                desc(activityEvents.id)
            ]);
        });

        // Every allowed sort, in both directions: the tiebreaker is appended
        // unconditionally, so dropping it fails on all four rather than on the
        // one combination a single case happened to pick.
        it.each([
            ['at', 'asc', asc(activityEvents.at)],
            ['at', 'desc', desc(activityEvents.at)],
            ['kind', 'asc', asc(activityEvents.kind)],
            ['kind', 'desc', desc(activityEvents.kind)]
        ] as const)(
            'appends `id desc` after %s %s as well [activity:I-17]',
            async (sort, order, expected) => {
                expect(await orderByFor({ sort, order })).toEqual([
                    expected,
                    // `desc`, not the requested direction: the tiebreaker is a
                    // fixed second key, and flipping with `order` would make
                    // two consecutive pages of an ascending sort overlap on the
                    // rows that share a timestamp — the exact defect it exists
                    // to prevent.
                    desc(activityEvents.id)
                ]);
            }
        );
    });

    describe('the sort allow-list', () => {
        /** The DTO's own verdict — the `ValidationPipe` runs exactly this. */
        function rejects(sort: string): boolean {
            const dto = plainToInstance(ListActivityQueryDto, { sort });
            return validateSync(dto).some((error) => error.property === 'sort');
        }

        it('takes the two whitelisted columns [activity:I-17]', () => {
            expect([...SORTABLE_FIELDS]).toEqual(['at', 'kind']);
            for (const field of SORTABLE_FIELDS) {
                expect(rejects(field)).toBe(false);
            }
        });

        it('refuses any other column, indexed or not [activity:I-17]', () => {
            // `actorEmail` and `subjectId` are real columns and are filterable;
            // `meta` is neither. None of them may be sorted by — an unchecked
            // `sort` reaches `SORT_COLUMNS[...]` as `undefined` and Drizzle
            // orders by nothing at all, which is how identical timestamps stop
            // paginating deterministically.
            for (const field of [
                'meta',
                'createdAt',
                'actorEmail',
                'subjectId',
                'id'
            ]) {
                expect(rejects(field)).toBe(true);
            }
        });
    });
});
