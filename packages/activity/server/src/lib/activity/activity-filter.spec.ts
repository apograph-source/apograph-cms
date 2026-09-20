import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Database } from '@orthacms/database';
import { activityEvents } from '../schema';
import { ACTIVITY_FILTER_SCHEMA } from './activity-filter';
import type { ListActivityQueryDto } from './dto/list-activity-query.dto';
import { ActivityService } from './services/activity.service';

/**
 * The filterable surface, and what the actor search does with a needle that
 * contains LIKE's own metacharacters.
 *
 * The e2e suite pins that an unknown `?filter=` field is a 400 and that the
 * search is case-insensitive. Neither of those can see the two clauses here: a
 * schema that quietly gained `meta` would answer 200 rather than 400 and no
 * existing test would notice, and an unescaped `%` behaves like a wildcard,
 * which on a substring search is invisible — `%` matches everything and a
 * search for it returns rows, just not the right ones.
 *
 * The predicate is read by rendering it with Drizzle's own dialect, so what is
 * asserted is the parameter Postgres would receive rather than a shape this
 * test invented.
 */

/**
 * The schema's declared fields.
 *
 * `FilterSchema.fields` is optional on the shared type — a schema may declare
 * only relations — so an absent one is a real possibility the assertions below
 * must not silently read as "no forbidden field here".
 */
const FIELDS = ACTIVITY_FILTER_SCHEMA.fields ?? {};

/** Renders a Drizzle predicate the way the driver would send it. */
const render = (where: SQL) => new PgDialect().sqlToQuery(where);

/**
 * Captures the `where` a `list(...)` call builds.
 *
 * Both of `list`'s queries take the same predicate, so the first one seen is
 * the whole answer; the builder is thenable and resolves empty either way.
 */
async function whereFor(query: Partial<ListActivityQueryDto>): Promise<SQL> {
    let captured: SQL | undefined;
    const db = {
        select() {
            let ordered = false;
            const builder = {
                from: () => builder,
                where(value: SQL | undefined) {
                    captured ??= value;
                    return builder;
                },
                orderBy: () => {
                    ordered = true;
                    return builder;
                },
                limit: () => builder,
                offset: () => builder,
                then: (resolve: (value: unknown) => unknown) =>
                    Promise.resolve(ordered ? [] : [{ total: 0 }]).then(resolve)
            };
            return builder;
        }
    };

    await new ActivityService(db as unknown as Database).list(
        query as ListActivityQueryDto
    );

    if (!captured) {
        throw new Error(
            'The list query built no predicate at all. This helper reads the ' +
                'filter off the chain, so an absent one proves nothing rather ' +
                'than failing quietly below.'
        );
    }
    return captured;
}

describe('the audit log’s filterable surface', () => {
    describe('the `?filter=` schema', () => {
        it('offers eight columns and neither meta nor created_at [activity:I-16]', () => {
            // Named exhaustively rather than counted: a field swapped for
            // another keeps the count and changes the contract, and "eight" is
            // what the dossier says because these eight are the indexed,
            // frozen-snapshot columns.
            expect(Object.keys(FIELDS).sort()).toEqual([
                'actorEmail',
                'actorId',
                'actorType',
                'at',
                'kind',
                'subjectId',
                'subjectType',
                'workspaceId'
            ]);

            // `meta` is open jsonb a filter cannot reason about; `created_at`
            // is deliberately off the wire entirely, and a filter on a column
            // no response carries is a way to read it one bit at a time.
            expect(FIELDS).not.toHaveProperty('meta');
            expect(FIELDS).not.toHaveProperty('createdAt');
        });

        it('names only columns the table actually has [activity:I-16]', () => {
            // The complement: a misspelt field is not a widening but it is a
            // filter nobody can use, and the translator resolves field keys to
            // columns by property name.
            const columns = Object.keys(activityEvents);
            const unknown = Object.keys(FIELDS).filter(
                (field) => !columns.includes(field)
            );
            expect(`no such column: ${unknown.join(', ')}`).toBe(
                'no such column: '
            );
        });

        /**
         * ORT-205 — the admin's copy of this schema, in both directions.
         *
         * `activityFilterFields` calls itself "a static mirror of the server's
         * `ACTIVITY_FILTER_SCHEMA`", and nothing held it to that: it had
         * drifted to six of these eight, so `actorType` and `workspaceId` were
         * filterable over HTTP and unreachable from the UI, with every test
         * green. The other direction is the louder failure — a field the admin
         * offers and the server does not whitelist is a rule the user can
         * build and the API answers 400 to.
         *
         * Read as **text**, like the kind catalogue in
         * `audit-event-mapping.spec.ts`, and for the same reason: importing the
         * admin module would put a React package in this plugin's TypeScript
         * project graph. The parse is deliberately dumb and fails loudly — a
         * reformat that defeats it yields an empty list and fails both
         * assertions rather than passing silently.
         */
        describe('the admin’s mirror of it', () => {
            const adminFields = (): string[] => {
                const source = readFileSync(
                    join(
                        __dirname,
                        '../../../../admin/src/lib/presentation/activityFilterFields/index.ts'
                    ),
                    'utf8'
                );
                const block =
                    /export const ACTIVITY_FILTER_FIELDS[\s\S]*?\n\];/.exec(
                        source
                    );
                if (!block) {
                    throw new Error(
                        'Could not find ACTIVITY_FILTER_FIELDS in the admin ' +
                            'plugin. If it moved, point this test at its new ' +
                            'home rather than deleting the check.'
                    );
                }
                return [...block[0].matchAll(/id: '([^']+)'/g)].map(
                    (match) => match[1]
                );
            };

            it('offers every field this schema whitelists [activity:I-37]', () => {
                const offered = adminFields();
                const missing = Object.keys(FIELDS).filter(
                    (field) => !offered.includes(field)
                );
                expect(
                    `filterable over HTTP but absent from the UI: ${missing.join(', ')}`
                ).toBe('filterable over HTTP but absent from the UI: ');
            });

            it('offers no field this schema would reject [activity:I-37]', () => {
                const extra = adminFields().filter(
                    (field) => !Object.hasOwn(FIELDS, field)
                );
                expect(
                    `offered by the UI and answered 400: ${extra.join(', ')}`
                ).toBe('offered by the UI and answered 400: ');
            });
        });
    });

    describe('the actor-email search', () => {
        it('escapes LIKE metacharacters so a `%` search means a `%` [activity:I-19]', async () => {
            const { sql, params } = render(await whereFor({ actorEmail: '%' }));

            expect(sql).toContain('ilike');
            // The needle is `%\%%`: the outer pair are the substring wildcards
            // the search adds, the escaped one in the middle is the character
            // the reader typed. Drop the escaping and this is `%%%`, which
            // matches every address in the table.
            expect(params).toEqual(['%\\%%']);
        });

        it('escapes the underscore and the backslash too [activity:I-19]', async () => {
            // `_` is LIKE's single-character wildcard — the quieter of the two,
            // because a search for `a_b` silently matching `axb` looks like a
            // result rather than like a bug. The backslash is escaped because
            // it is the escape character itself.
            expect(
                (await render(await whereFor({ actorEmail: 'a_b' }))).params
            ).toEqual(['%a\\_b%']);
            expect(
                (await render(await whereFor({ actorEmail: 'a\\b' }))).params
            ).toEqual(['%a\\\\b%']);
        });

        it('leaves an ordinary address alone [activity:I-19]', async () => {
            // The control: escaping that fired on every character would pass
            // both checks above while mangling every real search.
            expect(
                (
                    await render(
                        await whereFor({ actorEmail: 'ada@example.com' })
                    )
                ).params
            ).toEqual(['%ada@example.com%']);
        });
    });
});
