import { validateToolInput } from '@orthacms/tools-server';
import type { WireFilterField } from '../entries/types/filter-surface';
import {
    FILTER_OPERATORS,
    describeFilterFields,
    filterTreeSchema
} from './filter-schema';

/** The tool's own input schema, reduced to the one property under test. */
const schema = {
    type: 'object',
    properties: { filter: filterTreeSchema() },
    additionalProperties: false
};

const check = (filter: unknown) => validateToolInput({ filter }, schema).valid;

describe('filterTreeSchema', () => {
    it('accepts the grammar the admin’s query builder emits', () => {
        expect(
            check({
                and: [
                    { field: 'status', op: 'eq', value: 'published' },
                    { field: 'author.name', op: 'ilike', value: 'Ada' }
                ]
            })
        ).toBe(true);
    });

    it('accepts a group nested inside a group', () => {
        expect(
            check({
                and: [
                    { field: 'status', op: 'eq', value: 'published' },
                    {
                        or: [
                            { field: 'number', op: 'gt', value: 5 },
                            { field: 'number', op: 'null', value: true }
                        ]
                    }
                ]
            })
        ).toBe(true);
    });

    it('rejects a bare rule at the root — the root is always a group', () => {
        expect(check({ field: 'text', op: 'eq', value: 'x' })).toBe(false);
    });

    it('rejects a key that is neither and nor or', () => {
        expect(check({ not: [{ field: 'text', op: 'eq', value: 'x' }] })).toBe(
            false
        );
    });

    it('rejects a group whose branch is not an array', () => {
        expect(check({ and: { field: 'text', op: 'eq', value: 'x' } })).toBe(
            false
        );
    });

    // What the schema checks and what actually enforces the filter are two
    // different things, and the split is deliberate: `validateToolInput` is a
    // documented JSON Schema *subset* that ignores `anyOf`, so a rule's own
    // contents pass through it untouched. `parseFilterTree` is the boundary —
    // it validates every path against the type's schema and rejects the
    // operator, which the e2e covers end to end. Pinning that here means a
    // future validator that grows `anyOf` support shows up as a failing test
    // rather than as a silently different error path.
    it('leaves a rule’s contents to parseFilterTree, not the schema', () => {
        expect(check({ and: [{ field: 'text', op: 'not-an-operator' }] })).toBe(
            true
        );
    });

    it('offers every operator the filter engine implements', () => {
        const properties = filterTreeSchema()['properties'] as Record<
            string,
            { items: { anyOf: [{ properties: { op: { enum: string[] } } }] } }
        >;
        expect(properties['and'].items.anyOf[0].properties.op.enum).toEqual([
            ...FILTER_OPERATORS
        ]);
    });
});

describe('describeFilterFields', () => {
    const fields = [
        { path: 'status', type: 'enum', enumValues: ['draft', 'published'] },
        { path: 'text', type: 'string', group: 'Article' },
        { path: 'author.name', type: 'string', relationTarget: 'test_author' }
    ] as unknown as WireFilterField[];

    it('keeps the path, type, enum values and relation target', () => {
        expect(describeFilterFields(fields)).toEqual([
            { path: 'status', type: 'enum', values: ['draft', 'published'] },
            { path: 'text', type: 'string' },
            { path: 'author.name', type: 'string', relationTo: 'test_author' }
        ]);
    });

    it('drops the picker’s breadcrumb, which is noise in a prompt', () => {
        expect(describeFilterFields(fields)[1]).not.toHaveProperty('group');
    });

    // The picker's list is narrower than the SQL whitelist, and the gap is
    // where the copilot's publish-state answers went wrong: without
    // `publishedAt` a model cannot express "live content with unpublished
    // changes" and falls back to `status eq draft`, which also counts drafts
    // that were never published.
    describe('unioning the SQL whitelist', () => {
        const sqlFields = {
            id: { type: 'uuid' },
            createdAt: { type: 'date' },
            updatedAt: { type: 'date' },
            publishedAt: { type: 'date' },
            status: { type: 'enum', enumValues: ['draft', 'published'] },
            text: { type: 'string' },
            locale: { type: 'string' },
            localeGroupId: { type: 'uuid' }
        } as unknown as Parameters<typeof describeFilterFields>[1];

        const paths = () =>
            describeFilterFields(fields, sqlFields).map((f) => f.path);

        it('advertises publishedAt, which the picker omits', () => {
            expect(paths()).toContain('publishedAt');
            expect(
                describeFilterFields(fields, sqlFields).find(
                    (f) => f.path === 'publishedAt'
                )
            ).toEqual({ path: 'publishedAt', type: 'date' });
        });

        it('advertises the envelope timestamps too', () => {
            expect(paths()).toEqual(
                expect.arrayContaining(['createdAt', 'updatedAt', 'id'])
            );
        });

        // Both spellings of one idea, and the model would pick the broken
        // one: `locale` is a tool PARAMETER the entry extension scopes with,
        // so a filter rule on it ANDs against a scope already pinned to
        // another locale and reads zero rows from a valid query.
        it('withholds the fields that already have a tool parameter', () => {
            expect(paths()).not.toContain('locale');
            expect(paths()).not.toContain('localeGroupId');
        });

        it('does not duplicate a field the picker already offered', () => {
            expect(paths().filter((path) => path === 'status')).toHaveLength(1);
            expect(paths().filter((path) => path === 'text')).toHaveLength(1);
        });

        it('keeps the picker’s richer entry when both describe a field', () => {
            const status = describeFilterFields(fields, sqlFields).find(
                (f) => f.path === 'status'
            );
            expect(status).toEqual({
                path: 'status',
                type: 'enum',
                values: ['draft', 'published']
            });
        });

        it('leaves relation paths to the picker’s traversal', () => {
            // `author.publishedAt` is SQL-filterable but unadvertised: listing
            // every hop's envelope costs more prompt than it buys.
            expect(paths()).toContain('author.name');
            expect(paths()).not.toContain('author.publishedAt');
        });

        it('is unchanged when no SQL whitelist is passed', () => {
            expect(describeFilterFields(fields)).toEqual(
                describeFilterFields(fields, undefined)
            );
        });
    });
});
