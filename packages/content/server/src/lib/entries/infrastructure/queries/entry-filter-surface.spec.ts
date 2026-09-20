import type { SQL } from 'drizzle-orm';
import { PgDialect, QueryBuilder } from 'drizzle-orm/pg-core';
import { applyFilterTree, parseFilterTree } from '@orthacms/utils-server';
import { collection } from '../../../collection/define';
import { field } from '../../../fields';
import type { AnyContentType } from '../../../types/content-type';
import { buildEntryFilterSurface } from './entry-filter-surface';

/**
 * `buildEntryFilterSurface` walks a content type into BOTH the Drizzle
 * `FilterSchema` (the SQL whitelist) and the flat `WireFilterField[]` the admin
 * renders, in one pass. These tests pin the cardinality mapping, the cycle
 * guard, the depth cap, the workspace scope on every relation, and — the
 * guarantee that replaces the old hand-mirror — that every wire path the picker
 * offers actually parses against the sibling schema.
 */
const WS = '00000000-0000-4000-8000-000000000001';
const UUID = '00000000-0000-4000-8000-0000000000aa';

const company = collection('company', {
    fields: { name: field.text() }
});
const author = collection('author', {
    fields: {
        name: field.text(),
        company: field.relation({ to: () => company }),
        articles: field.relationInverse({ of: () => article, field: 'author' })
    }
});
const tag = collection('tag', {
    fields: {
        label: field.text(),
        articles: field.relationInverse({ of: () => article, field: 'tags' })
    }
});
const article: AnyContentType = collection('article', {
    publishable: true,
    fields: {
        title: field.text(),
        author: field.relation({ to: () => author }),
        tags: field.relation({ to: () => tag, many: true })
    }
});

/** A localized type — the only shape that carries the locale envelope columns. */
const localized: AnyContentType = collection('localized', {
    i18n: true,
    fields: { title: field.text() }
});

/**
 * A self-referencing type (a page tree). Its `parent` hop is the one
 * cardinality that has to alias the target, and the one under which every
 * nested relation's correlation is at risk — see the engine's
 * `relation-nesting.spec`.
 */
const page: AnyContentType = collection('page', {
    fields: {
        name: field.text(),
        parent: field.relation({ to: () => page }),
        owner: field.relation({ to: () => author })
    }
});

// A client-less query builder emits the real SQL for a surface-derived
// schema, so the builder and the translator are asserted TOGETHER — the
// drift these two halves exist to prevent is only visible end to end.
const qb = new QueryBuilder();
const dialect = new PgDialect();

/** Build the surface for `type`, translate one filter, return the SQL text. */
async function sqlFor(
    type: AnyContentType,
    rule: Record<string, unknown>
): Promise<string> {
    const { schema } = buildEntryFilterSurface(type, { workspaceId: WS });
    const tree = parseFilterTree(JSON.stringify({ and: [rule] }), schema);
    const sql = await applyFilterTree(tree, schema, type.table, qb as never);
    return dialect
        .sqlToQuery(sql as SQL)
        .sql.replace(/\s+/g, ' ')
        .trim();
}

/** Recursively assert every emitted relation carries a scope builder. */
function assertAllScoped(
    relations:
        | Record<string, { scope?: unknown; relations?: unknown }>
        | undefined
): void {
    for (const rel of Object.values(relations ?? {})) {
        expect(typeof rel.scope).toBe('function');
        assertAllScoped(rel.relations as Parameters<typeof assertAllScoped>[0]);
    }
}

describe('buildEntryFilterSurface', () => {
    it('maps an owning single relation to many-to-one with a record picker', () => {
        const { schema, fields } = buildEntryFilterSurface(article, {
            workspaceId: WS
        });
        expect(schema.relations?.author?.kind).toBe('many-to-one');

        const paths = fields.map((f) => f.path);
        expect(paths).toContain('author.name');

        const picker = fields.find((f) => f.path === 'author.id');
        expect(picker?.relationTarget).toBe('author');
        expect(picker?.type).toBe('uuid');
        expect(picker?.group).toEqual(['Author']);
    });

    it('maps an owning many relation to many-to-many', () => {
        const { schema, fields } = buildEntryFilterSurface(article, {
            workspaceId: WS
        });
        expect(schema.relations?.tags?.kind).toBe('many-to-many');
        expect(fields.map((f) => f.path)).toContain('tags.label');
    });

    it('maps an inverse-of-single to one-to-many', () => {
        const { schema } = buildEntryFilterSurface(author, { workspaceId: WS });
        expect(schema.relations?.articles?.kind).toBe('one-to-many');
    });

    it('maps an inverse-of-many to many-to-many', () => {
        const { schema } = buildEntryFilterSurface(tag, { workspaceId: WS });
        expect(schema.relations?.articles?.kind).toBe('many-to-many');
    });

    it('traverses two hops (author.company.name) with breadcrumbs', () => {
        const { fields } = buildEntryFilterSurface(article, {
            workspaceId: WS
        });
        const leaf = fields.find((f) => f.path === 'author.company.name');
        expect(leaf).toBeDefined();
        expect(leaf?.group).toEqual(['Author', 'Company']);
    });

    it('stops a cycle back to an ancestor type', () => {
        const { schema } = buildEntryFilterSurface(article, {
            workspaceId: WS
        });
        const authorRel = schema.relations?.author;
        // author.articles would loop article → author → article; pruned.
        expect(
            authorRel && 'relations' in authorRel
                ? authorRel.relations?.articles
                : undefined
        ).toBeUndefined();
        // ...but the non-cyclic hop (author.company) is still expanded.
        expect(
            authorRel && 'relations' in authorRel
                ? authorRel.relations?.company?.kind
                : undefined
        ).toBe('many-to-one');
    });

    it('maps a self-relation to self-referential with a per-occurrence alias', () => {
        const { schema } = buildEntryFilterSurface(page, { workspaceId: WS });
        const parent = schema.relations?.parent;
        expect(parent?.kind).toBe('self-referential');
        // The alias is keyed by PATH, not by relation name, so two rules on
        // different depths of the same self-relation can't collide on one
        // correlation name.
        expect(parent && 'alias' in parent ? parent.alias : undefined).toBe(
            'qb_parent'
        );
        const nested =
            parent && 'relations' in parent
                ? parent.relations?.parent
                : undefined;
        expect(nested?.kind).toBe('self-referential');
        expect(nested && 'alias' in nested ? nested.alias : undefined).toBe(
            'qb_parent__parent'
        );
    });

    it('expands relations UNDER a self-relation (parent.owner.name)', () => {
        const { schema, fields } = buildEntryFilterSurface(page, {
            workspaceId: WS
        });
        expect(fields.map((f) => f.path)).toContain('parent.owner.name');

        const parent = schema.relations?.parent;
        const owner =
            parent && 'relations' in parent
                ? parent.relations?.owner
                : undefined;
        // The nested hop must carry its own scope, or a traversal through
        // the parent could reach a soft-deleted / foreign owner.
        expect(typeof owner?.scope).toBe('function');
    });

    it('bounds a self-relation by the hop budget, not the cycle guard', () => {
        // `visited` would stop a self-relation immediately; hops are what
        // terminate it, so a 1-hop budget offers `parent.name` and no deeper.
        const { fields } = buildEntryFilterSurface(page, {
            workspaceId: WS,
            maxRelationHops: 1
        });
        const paths = fields.map((f) => f.path);
        expect(paths).toContain('parent.name');
        expect(paths).not.toContain('parent.parent.name');
    });

    it('derives maxDepth from the hop budget (segments = hops + 1)', () => {
        expect(
            buildEntryFilterSurface(article, { workspaceId: WS }).schema
                .maxDepth
        ).toBe(3);
        expect(
            buildEntryFilterSurface(article, {
                workspaceId: WS,
                maxRelationHops: 1
            }).schema.maxDepth
        ).toBe(2);
    });

    it('scopes every emitted relation (workspace + soft-delete guard)', () => {
        const { schema } = buildEntryFilterSurface(article, {
            workspaceId: WS
        });
        assertAllScoped(
            schema.relations as Parameters<typeof assertAllScoped>[0]
        );
    });

    it('offers the publishable status field at the root', () => {
        const { fields } = buildEntryFilterSurface(article, {
            workspaceId: WS
        });
        const status = fields.find((f) => f.path === 'status');
        expect(status?.type).toBe('enum');
        expect(status?.enumValues).toEqual(['draft', 'published']);
    });

    it('whitelists the locale envelope columns on an i18n type, SQL-only', () => {
        const { schema, fields } = buildEntryFilterSurface(localized, {
            workspaceId: WS
        });
        // Filterable in SQL: `localeGroupId` is what lets a caller holding one
        // row's group ask for the group's row in another locale.
        expect(schema.fields?.['locale']?.type).toBe('string');
        expect(schema.fields?.['localeGroupId']?.type).toBe('uuid');
        // …but NOT offered by the picker. The admin filters locales through
        // i18n's own virtual fields (`hasLocale` / `missingLocale`), and a raw
        // group-uuid input is not a control a user has any use for.
        expect(fields.some((f) => f.path === 'localeGroupId')).toBe(false);
    });

    it('omits the locale columns on a type that is not localized', () => {
        const { schema } = buildEntryFilterSurface(article, {
            workspaceId: WS
        });
        expect(schema.fields?.['locale']).toBeUndefined();
        expect(schema.fields?.['localeGroupId']).toBeUndefined();
    });

    it('prunes a relation whose target is not granted', () => {
        const { schema, fields } = buildEntryFilterSurface(article, {
            workspaceId: WS,
            grantedTypes: new Set(['article', 'tag'])
        });
        expect(schema.relations?.author).toBeUndefined();
        expect(fields.some((f) => f.path.startsWith('author.'))).toBe(false);
        // A granted relation is still offered.
        expect(schema.relations?.tags?.kind).toBe('many-to-many');
    });

    it('correlates a relation under a self-relation to the ALIAS', async () => {
        // The end-to-end shape of the aliasing hazard: `parent.owner.name`
        // must read the PARENT page's owner. Bound to the physical table it
        // would resolve from the outer `FROM`, silently filtering the ROOT
        // page's owner instead — valid SQL, wrong rows, no error.
        const out = await sqlFor(page, {
            field: 'parent.owner.name',
            op: 'ilike',
            value: '%Ada%'
        });
        expect(out).toContain('"qb_parent"."owner_id"');
        expect(out).not.toContain('"content_page"."owner_id"');
    });

    it('correlates a nested self-relation to its outer alias', async () => {
        const out = await sqlFor(page, {
            field: 'parent.parent.name',
            op: 'ilike',
            value: '%x%'
        });
        // The grandparent hangs off the parent alias, not off the root — the
        // difference between "grandparent" and a second reading of "parent".
        expect(out).toContain(
            '"qb_parent__parent"."id" = "qb_parent"."parent_id"'
        );
        expect(out).toContain('"qb_parent"."id" = "content_page"."parent_id"');
    });

    it('scopes a relation nested under a self-relation to the workspace', async () => {
        const out = await sqlFor(page, {
            field: 'parent.owner.name',
            op: 'ilike',
            value: '%Ada%'
        });
        // Two workspace guards: one on the aliased parent, one on the owner.
        expect(out.match(/"workspace_id" =/g)?.length).toBeGreaterThanOrEqual(
            2
        );
    });

    it('negates a to-many relation rule as NOT EXISTS', async () => {
        // "no tag labelled x" — not "has some tag that isn't x", which would
        // match an article tagged [x, y].
        const out = await sqlFor(article, {
            field: 'tags.label',
            op: 'nin',
            value: ['x']
        });
        expect(out.startsWith('not exists')).toBe(true);
        expect(out).not.toContain('not in (');
    });

    it('turns "is empty" on a relation id into "has no related row"', async () => {
        const out = await sqlFor(article, {
            field: 'author.id',
            op: 'null',
            value: true
        });
        expect(out.startsWith('not exists')).toBe(true);
        // The target's `id` is a NOT NULL primary key, so the naive reading
        // (`EXISTS(author WHERE id IS NULL)`) could never match anything.
        expect(out).not.toContain('"id" is null');
    });

    it.each([
        ['article', article],
        // The self-referencing shape produces the deepest paths, so it is the
        // one most likely to outrun `maxDepth`.
        ['page', page]
    ])(
        // covers: content:I-25
        'every offered %s path parses against its schema (no drift)',
        (_name, type) => {
            const { schema, fields } = buildEntryFilterSurface(type, {
                workspaceId: WS
            });
            for (const f of fields) {
                const value =
                    f.type === 'uuid'
                        ? UUID
                        : f.type === 'number'
                          ? '1'
                          : f.type === 'boolean'
                            ? 'true'
                            : f.type === 'date'
                              ? '2020-01-01T00:00:00.000Z'
                              : f.type === 'enum'
                                ? f.enumValues![0]
                                : 'x';
                const json = JSON.stringify({
                    and: [{ field: f.path, op: 'eq', value }]
                });
                expect(() => parseFilterTree(json, schema)).not.toThrow();
            }
        }
    );
});
