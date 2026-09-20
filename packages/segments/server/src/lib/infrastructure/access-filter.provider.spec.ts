import { BadRequestException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type {
    AnyContentType,
    EntryFilterContext
} from '@orthacms/content-server';
import { FilterOperator, type ParsedRule } from '@orthacms/utils-server';
import type { Segment } from '@orthacms/segments-domain';
import { SegmentCatalogService } from '../application/segment-catalog.service';
import {
    ACCESS_FILTER_FIELD,
    AccessFilterProvider
} from './access-filter.provider';

/** A stand-in content table with the `id` column every real one has. */
const articles = pgTable('test_article', {
    id: uuid('id').primaryKey(),
    title: text('title')
});

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACME = '11111111-1111-4111-8111-111111111111';
const GLOBEX = '22222222-2222-4222-8222-222222222222';

const context = {
    type: { name: 'test_article', table: articles },
    workspaceId: WORKSPACE
} as unknown as EntryFilterContext;

/** A catalogue holding two audiences, or none. */
function catalogue(...ids: string[]): SegmentCatalogService {
    const all: Segment[] = ids.map((id) => ({
        id,
        key: id,
        label: id,
        tags: [id],
        workspaceIds: []
    }));
    return {
        configured: all.length > 0,
        all: () => all
    } as unknown as SegmentCatalogService;
}

/** The provider over a compile-only Drizzle client. */
function provider(catalog = catalogue(ACME, GLOBEX)): AccessFilterProvider {
    return new AccessFilterProvider(drizzle.mock() as never, catalog);
}

/** One parsed rule, as the filter engine hands it over. */
function rule(field: string, op: string, value: unknown): ParsedRule {
    return { kind: 'rule', path: [field], op, value } as unknown as ParsedRule;
}

/** The fragment a rule resolves to, rendered as Postgres would receive it. */
async function resolved(
    field: string,
    op: string,
    value: unknown,
    catalog?: SegmentCatalogService
) {
    const extension = provider(catalog).filterFor(
        context.type as AnyContentType
    );
    if (!extension) throw new Error('expected the fields to be offered');
    const fragment = (await extension.resolve(
        rule(field, op, value),
        context
    )) as SQL;
    return new PgDialect().sqlToQuery(fragment);
}

const FIELDS = Object.values(ACCESS_FILTER_FIELD);

describe('AccessFilterProvider', () => {
    describe('workspace scoping', () => {
        /**
         * A virtual filter field is a subquery over a table content-server has
         * never heard of, so nothing upstream can scope it: content adds its own
         * `workspace_id` to the *outer* query, and an `EXISTS` that joined only
         * on `entry_id` would match another tenant's row. `entry_access.entry_id`
         * is the primary key, so that is not merely untidy — it turns a list
         * filter into a cross-tenant read of who restricted what.
         */
        it.each([
            [ACCESS_FILTER_FIELD.Allowed, FilterOperator.Eq, ACME],
            [ACCESS_FILTER_FIELD.Denied, FilterOperator.Eq, ACME],
            [ACCESS_FILTER_FIELD.Allowed, FilterOperator.In, [ACME, GLOBEX]],
            [ACCESS_FILTER_FIELD.Denied, FilterOperator.In, [ACME, GLOBEX]],
            [ACCESS_FILTER_FIELD.Restricted, FilterOperator.Eq, true],
            [ACCESS_FILTER_FIELD.Restricted, FilterOperator.Eq, false]
        ])(
            'scopes the %s / %s subquery to the requesting workspace [segments:I-37]',
            async (field, op, value) => {
                const query = await resolved(field, op, value);

                expect(query.sql).toContain('from "entry_access"');
                expect(query.sql).toContain(
                    '"entry_access"."entry_id" = "test_article"."id"'
                );
                expect(query.sql).toContain(
                    '"entry_access"."workspace_id" = $1'
                );
                expect(query.params[0]).toBe(WORKSPACE);
            }
        );

        it('keeps the scope inside the negated form of accessRestricted [segments:I-37]', async () => {
            // `accessRestricted eq false` is the one branch that emits a `NOT`,
            // and a `NOT EXISTS` over an unscoped subquery inverts the mistake:
            // an entry restricted in *another* workspace would drop out of this
            // workspace's "not restricted" list.
            const query = await resolved(
                ACCESS_FILTER_FIELD.Restricted,
                FilterOperator.Eq,
                false
            );

            expect(query.sql.startsWith('not exists')).toBe(true);
            expect(query.sql).toContain('"entry_access"."workspace_id" = $1');
        });
    });

    describe('operators', () => {
        /**
         * Negation is absent on purpose, and the reason is that it would be
         * *wrong* rather than merely missing: `audienceAllowed ne "acme"`
         * negates **inside** the `EXISTS` — "has some allowed audience other
         * than Acme" — which an entry that also allows Acme satisfies. It would
         * read as "not visible to Acme" and would list exactly the entries Acme
         * can see.
         */
        it.each(
            FIELDS.flatMap((field) =>
                [
                    FilterOperator.Ne,
                    FilterOperator.Nin,
                    FilterOperator.Nilike,
                    FilterOperator.Null
                ].map((op) => [field, op] as const)
            )
        )('refuses %s %s [segments:I-37]', async (field, op) => {
            await expect(resolved(field, op, ACME)).rejects.toBeInstanceOf(
                BadRequestException
            );
        });

        it('offers the two audience fields only `eq` and `in` [segments:I-37]', async () => {
            // The whole answerable set, asserted positively so a *new* operator
            // — a negating one above all — cannot be added without this failing.
            const accepted: string[] = [];
            for (const op of Object.values(FilterOperator)) {
                try {
                    await resolved(ACCESS_FILTER_FIELD.Allowed, op, ACME);
                    accepted.push(op);
                } catch (error) {
                    if (!(error instanceof BadRequestException)) throw error;
                }
            }
            expect(accepted.sort()).toEqual(
                [FilterOperator.Eq, FilterOperator.In].sort()
            );
        });

        it('offers `accessRestricted` only `eq` [segments:I-37]', async () => {
            const accepted: string[] = [];
            for (const op of Object.values(FilterOperator)) {
                try {
                    await resolved(ACCESS_FILTER_FIELD.Restricted, op, true);
                    accepted.push(op);
                } catch (error) {
                    if (!(error instanceof BadRequestException)) throw error;
                }
            }
            expect(accepted).toEqual([FilterOperator.Eq]);
        });
    });

    describe('the offered fields', () => {
        it('offers nothing at all while no audience exists', async () => {
            // An enum field whose value list is empty is a rule nobody can
            // complete, so the picker must not show one.
            expect(
                provider(catalogue()).filterFor(context.type as AnyContentType)
            ).toBeUndefined();
        });

        it('offers the audiences by id, which is what an entry stores', () => {
            const extension = provider().filterFor(
                context.type as AnyContentType
            );

            expect(extension?.fields).toEqual({
                [ACCESS_FILTER_FIELD.Allowed]: {
                    type: 'enum',
                    enumValues: [ACME, GLOBEX]
                },
                [ACCESS_FILTER_FIELD.Denied]: {
                    type: 'enum',
                    enumValues: [ACME, GLOBEX]
                },
                [ACCESS_FILTER_FIELD.Restricted]: { type: 'boolean' }
            });
        });
    });
});
