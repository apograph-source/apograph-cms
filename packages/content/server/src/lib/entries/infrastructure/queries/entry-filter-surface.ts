import { and, eq, getTableColumns, isNull, type AnyColumn } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
    FilterSchemaException,
    RelationKind,
    ScalarFieldType,
    type FieldSchema,
    type FilterSchema,
    type RelationSchema,
    type RelationScope,
    type ScalarFieldSchema
} from '@orthacms/utils-server';
import { ENTRY_STATUS, type AnyContentType } from '../../../types/content-type';
import { CONTENT_FIELD_TYPE, type AnyFieldSpec } from '../../../types/fields';
import type { WireFilterField } from '../../types/filter-surface';
// `scalarTypeFor` is the single scalar-coercion mapping — shared with the
// sort whitelist (`isScalarField`), so "filterable" and "sortable" can't
// disagree on which field types are backed by a comparable column.
import { scalarTypeFor } from './entry-scalar-fields';

/**
 * Relation hops offered by default. 2 hops means `author.company.name` is
 * reachable and `…company.country.name` is not. Each hop is an EXISTS
 * subquery, so this directly bounds worst-case query cost. The engine's
 * `maxDepth` counts path SEGMENTS (hops + 1), so it is derived as
 * `hops + 1` below — raising one without the other would let the picker
 * offer paths the parser rejects with a 400.
 */
const DEFAULT_RELATION_HOPS = 2;

/** Options for {@link buildEntryFilterSurface}. */
export interface FilterSurfaceOptions {
    /** Request workspace — scopes every relation subquery. */
    workspaceId: string;
    /** Extension-contributed virtual filter fields (locale aggregates, …). */
    extensionFields?: FieldSchema;
    /**
     * Content-type names granted to this workspace. A relation whose target
     * is not granted is omitted entirely — mirroring the entry editor's
     * `availableTypeNames`, so the filter picker never offers a traversal
     * into a collection the caller cannot see. When absent, no pruning.
     */
    grantedTypes?: ReadonlySet<string>;
    /** Override the default relation-hop budget. */
    maxRelationHops?: number;
}

/** Humanize a field name — mirrors the admin's `fieldLabel` fallback. */
function humanize(name: string): string {
    return name
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/^\w/, (c) => c.toUpperCase());
}

/** A field's display label — its admin label, else a humanized name. */
function fieldLabel(name: string, spec: AnyFieldSpec): string {
    const label = spec.admin?.label;
    return typeof label === 'string' && label.length > 0
        ? label
        : humanize(name);
}

/**
 * Resolve a column on a generated table by its JS property name.
 *
 * `Object.hasOwn`-guarded, and it throws rather than returning `undefined`.
 * Every caller today passes a literal or a name off `Object.entries(type.fields)`,
 * so nothing request-supplied reaches it — but drizzle's column map is a plain
 * object, an unguarded lookup resolves `constructor`/`valueOf`/`toString` to
 * truthy non-columns, and handing one of those to drizzle as a `Column` emits a
 * broken fragment (a 500) rather than failing here. Its `utils-server`
 * counterpart (`columnOf`) is guarded the same way, so the two helpers can't
 * disagree about what a name means.
 */
function col(table: PgTable, name: string): AnyColumn {
    const cols = getTableColumns(table) as unknown as Record<string, AnyColumn>;
    const column = Object.hasOwn(cols, name) ? cols[name] : undefined;
    if (!column) {
        throw new FilterSchemaException(
            `column "${name}" does not exist on the generated table`
        );
    }
    return column;
}

/**
 * The scope predicate for one target type: the workspace boundary plus the
 * soft-delete guard, resolved against whatever table the translator queries
 * (the physical target, or an alias for a self-relation). Without this a
 * relation filter matches rows the root list itself excludes — a
 * soft-deleted author would still match `author.name`.
 *
 * Publish status is deliberately NOT filtered here: an editor filtering
 * articles by author expects to match a draft author, and hiding
 * unpublished targets would silently drop rows. A published-only traversal
 * is expressible as an explicit `author.status` rule instead.
 */
function scopeFor(target: AnyContentType, workspaceId: string): RelationScope {
    return (tbl) => {
        const cols = getTableColumns(tbl as PgTable) as unknown as Record<
            string,
            AnyColumn
        >;
        return and(
            eq(cols['workspaceId'], workspaceId),
            target.paranoid ? isNull(cols['deletedAt']) : undefined
        );
    };
}

/** The scalar (envelope + field) whitelist for one type at one level. */
function scalarFieldsOf(type: AnyContentType): FieldSchema {
    const fields: FieldSchema = {
        // `id` so a relation's record picker (`author.id in (…)`) resolves,
        // and the envelope timestamps so they stay API-filterable.
        id: { type: ScalarFieldType.Uuid },
        createdAt: { type: ScalarFieldType.Date },
        updatedAt: { type: ScalarFieldType.Date }
    };
    if (type.publishable) {
        fields['status'] = {
            type: ScalarFieldType.Enum,
            enumValues: [ENTRY_STATUS.Draft, ENTRY_STATUS.Published]
        };
        fields['publishedAt'] = { type: ScalarFieldType.Date };
    }
    if (type.i18n) {
        fields['locale'] = { type: ScalarFieldType.String };
        // The translation-group key, so a caller holding one row's group can
        // ask for the group's row in another locale (`localeGroupId eq X` +
        // `?locale=de`). Whitelisted for SQL only — `scalarWireOf` below builds
        // the admin's filter *picker*, and this envelope column stays out of
        // it, so the UI is unchanged.
        fields['localeGroupId'] = { type: ScalarFieldType.Uuid };
    }
    for (const [name, spec] of Object.entries(type.fields)) {
        const scalar = scalarTypeFor(spec);
        if (scalar) fields[name] = scalar;
    }
    return fields;
}

/** The wire fields the picker shows at one level: user scalars + status. */
function scalarWireOf(
    type: AnyContentType,
    path: readonly string[],
    group: readonly string[],
    wire: WireFilterField[]
): void {
    if (type.publishable) {
        wire.push({
            path: [...path, 'status'].join('.'),
            label: 'Status',
            type: ScalarFieldType.Enum,
            enumValues: [ENTRY_STATUS.Draft, ENTRY_STATUS.Published],
            group
        });
    }
    for (const [name, spec] of Object.entries(type.fields)) {
        const scalar: ScalarFieldSchema | null = scalarTypeFor(spec);
        if (!scalar) continue;
        wire.push({
            path: [...path, name].join('.'),
            label: fieldLabel(name, spec),
            type: scalar.type,
            enumValues: scalar.enumValues,
            group
        });
    }
}

/** Shared recursion state — everything constant across a single build. */
type Ctx = {
    workspaceId: string;
    grantedTypes?: ReadonlySet<string>;
    /** Wire fields accumulated across the whole traversal. */
    wire: WireFilterField[];
};

/**
 * Build one relation's `RelationSchema`, recursing into the target's own
 * relations while hops remain, and pushing the wire fields for the target
 * level as it goes. Returns `null` to omit the relation entirely (ungranted
 * target, a cycle back to an ancestor, or a self-referential shape not yet
 * supported).
 */
function relationFor(
    name: string,
    spec: AnyFieldSpec,
    owner: AnyContentType,
    path: readonly string[],
    group: readonly string[],
    hopsLeft: number,
    visited: ReadonlySet<string>,
    ctx: Ctx
): RelationSchema | null {
    const rel = spec.relation;
    if (!rel) return null;

    // `to()` is the target for an owning side, the OWNER of the storage for
    // an inverse — either way, the type this hop traverses to.
    const target = rel.to();
    if (ctx.grantedTypes && !ctx.grantedTypes.has(target.name)) return null;

    const selfRef = target.name === owner.name;
    // A cycle back to an ANCESTOR is never a filter a user wants. A
    // self-reference is allowed (page trees) and bounded by hops instead.
    if (!selfRef && visited.has(target.name)) return null;

    const relLabel = fieldLabel(name, spec);
    const nextPath = [...path, name];
    const nextGroup = [...group, relLabel];

    // The relation's record-picker entry: `author.id`, rendered as a picker
    // over `target` rather than a raw uuid input.
    ctx.wire.push({
        path: [...nextPath, 'id'].join('.'),
        label: relLabel,
        type: ScalarFieldType.Uuid,
        group: nextGroup,
        relationTarget: target.name
    });

    // The target's own scalar fields + (if hops remain) its relations. This
    // is the SAME walk that emits the wire fields, so the SQL whitelist and
    // the picker's field list are one traversal and cannot drift.
    const nested = walk(
        target,
        nextPath,
        nextGroup,
        hopsLeft - 1,
        visited,
        ctx
    );
    const common = {
        fields: nested.fields,
        relations: nested.relations,
        scope: scopeFor(target, ctx.workspaceId)
    };

    const ownerT = owner.table as PgTable;
    const targetT = target.table as PgTable;

    // ---- inverse: storage lives on the owning side, reused swapped ----
    if (rel.inverse) {
        const ownerField = rel.inverse.field;
        const ownerSpec = target.fields[ownerField];
        if (!ownerSpec?.relation) return null;

        if (ownerSpec.relation.many) {
            // Inverse of a many-to-many: OUR rows are the join's targets.
            if (selfRef) return null; // self many-to-many — not supported yet
            const join = target.joinTables[ownerField];
            if (!join) return null;
            return {
                kind: RelationKind.ManyToMany,
                through: join,
                fk: col(join, 'targetId'),
                targetFk: col(join, 'sourceId'),
                table: target.table,
                parentKey: col(ownerT, 'id'),
                targetKey: col(targetT, 'id'),
                ...common
            };
        }
        // Inverse of a single = one-to-many: the owner's FK points at us.
        return {
            kind: RelationKind.OneToMany,
            table: target.table,
            fk: col(targetT, ownerField),
            parentKey: col(ownerT, 'id'),
            ...common
        };
    }

    // ---- owning many-to-many ----
    if (rel.many) {
        if (selfRef) return null; // self many-to-many — not supported yet
        const join = owner.joinTables[name];
        if (!join) return null;
        return {
            kind: RelationKind.ManyToMany,
            through: join,
            fk: col(join, 'sourceId'),
            targetFk: col(join, 'targetId'),
            table: target.table,
            parentKey: col(ownerT, 'id'),
            targetKey: col(targetT, 'id'),
            ...common
        };
    }

    // ---- owning single ----
    if (selfRef) {
        return {
            kind: RelationKind.SelfReferential,
            table: target.table,
            fk: col(ownerT, name),
            // Unique per OCCURRENCE, not per relation: two rules on the same
            // self-relation must not share a correlation name.
            alias: `qb_${nextPath.join('__')}`,
            ...common
        };
    }
    return {
        kind: RelationKind.ManyToOne,
        table: target.table,
        fk: col(ownerT, name),
        targetKey: col(targetT, 'id'),
        ...common
    };
}

/**
 * One node of the surface: the scalar fields filterable at this level and
 * the relations traversable from it. Emits the wire fields for this level
 * as a side effect on `ctx.wire`, so the SQL whitelist (the return value)
 * and the picker's field list (the accumulator) are produced by a single
 * traversal.
 */
function walk(
    type: AnyContentType,
    path: readonly string[],
    group: readonly string[],
    hopsLeft: number,
    visited: ReadonlySet<string>,
    ctx: Ctx
): { fields: FieldSchema; relations?: Record<string, RelationSchema> } {
    const fields = scalarFieldsOf(type);
    scalarWireOf(type, path, group, ctx.wire);
    if (hopsLeft <= 0) return { fields };

    const nextVisited = new Set([...visited, type.name]);
    const relations: Record<string, RelationSchema> = {};
    for (const [name, spec] of Object.entries(type.fields)) {
        if (spec.type !== CONTENT_FIELD_TYPE.Relation) continue;
        const r = relationFor(
            name,
            spec,
            type,
            path,
            group,
            hopsLeft,
            nextVisited,
            ctx
        );
        if (r) relations[name] = r;
    }
    return {
        fields,
        relations: Object.keys(relations).length ? relations : undefined
    };
}

/**
 * The filterable surface for one content type: the Drizzle `FilterSchema`
 * (the security boundary — only listed paths reach SQL) AND the flat
 * `WireFilterField[]` the admin's query builder renders, produced by a
 * single traversal so they cannot drift.
 *
 * `extensionFields` are virtual fields contributed by the bound
 * `CONTENT_ENTRY_EXTENSION` (locale aggregates, …): they merge into the
 * root `fields` (so the parser can coerce their values) and their names are
 * registered on `extensionFields` (so the translator routes them to the
 * extension's own SQL resolver). A real column always wins a name clash.
 * They are NOT surfaced as wire fields here — a contributing plugin adds
 * those via the admin's `RECORDS_FILTER_FIELDS_SLOT`, as today.
 */
export function buildEntryFilterSurface(
    type: AnyContentType,
    opts: FilterSurfaceOptions
): { schema: FilterSchema; fields: WireFilterField[] } {
    const hops = opts.maxRelationHops ?? DEFAULT_RELATION_HOPS;
    const ctx: Ctx = {
        workspaceId: opts.workspaceId,
        grantedTypes: opts.grantedTypes,
        wire: []
    };
    const root = walk(type, [], [], hops, new Set(), ctx);

    const schema: FilterSchema = {
        fields: root.fields,
        relations: root.relations,
        // Path SEGMENTS = hops + 1 (`author.company.name` is 3 at 2 hops),
        // so the engine cap must track the traversal cap or it silently
        // rejects paths the picker offers.
        maxDepth: hops + 1
    };

    if (opts.extensionFields) {
        const merged = schema.fields ?? {};
        const extra = Object.keys(opts.extensionFields).filter(
            (n) => !(n in merged)
        );
        for (const n of extra) merged[n] = opts.extensionFields[n];
        schema.fields = merged;
        if (extra.length) schema.extensionFields = new Set(extra);
    }

    return { schema, fields: ctx.wire };
}
