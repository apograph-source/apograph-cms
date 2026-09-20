import {
    CONTENT_FIELD_TYPE,
    type AnyFieldSpec
} from '@orthacms/content-server';
import {
    GraphQLBoolean,
    GraphQLEnumType,
    GraphQLFloat,
    GraphQLID,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLString,
    type GraphQLEnumValueConfigMap,
    type GraphQLInputType,
    type GraphQLOutputType
} from 'graphql';
import { enumValueName, pascalCase } from './naming';
import { GraphQLDate, GraphQLDateTime, GraphQLJSON } from './scalars';

/**
 * Maps one content field spec onto its GraphQL type, for both directions of the
 * wire. Pure — no Nest, no Drizzle, no registry lookups — so the mapping is
 * exhaustively unit-testable, and it is the only place that decides how a field
 * kind appears in the schema.
 */

/**
 * Names a type has already claimed in the schema under construction.
 *
 * Enum types are derived from a field (`Article.category` → `ArticleCategory`),
 * which is a different namespace from content types (`article_category` →
 * `ArticleCategory`) but the *same* GraphQL one. Rather than encode a
 * disambiguating suffix and hope, every named type is registered here and a
 * clash throws at build time — a loud failure at boot instead of a schema that
 * silently serves one definition under two meanings.
 */
export class TypeNameRegistry {
    private readonly claimed = new Set<string>();
    private readonly enums = new Map<string, GraphQLEnumType>();

    /** Claims `name`, throwing if something already holds it. */
    claim(name: string, owner: string): void {
        if (this.claimed.has(name)) {
            throw new Error(
                `GraphQL type name "${name}" is claimed twice (by ${owner}). Rename the colliding content type or field.`
            );
        }
        this.claimed.add(name);
    }

    /**
     * The enum for `name`, built once and reused.
     *
     * A `select` field is mapped twice — once for the entry object and once for
     * the write input — and both must land on the **same** enum instance, or the
     * schema would carry two identically-named types and graphql-js would reject
     * it. Memoising here rather than at each call site also means the second
     * mapping does not trip the duplicate-name check above.
     */
    enumFor(
        name: string,
        build: () => GraphQLEnumType,
        owner: string
    ): GraphQLEnumType {
        const existing = this.enums.get(name);
        if (existing) {
            return existing;
        }
        this.claim(name, owner);
        const built = build();
        this.enums.set(name, built);
        return built;
    }
}

/**
 * Publish states a read may ask for — the GraphQL spelling of the REST
 * `?status=` parameter. `DRAFT` and `ANY` need a write-scoped token; the
 * resolver enforces that, exactly as `DraftVisibilityGuard` does for REST.
 */
export const EntryVisibilityEnum = new GraphQLEnumType({
    name: 'EntryVisibility',
    description:
        'Which publish states a read returns. `PUBLISHED` is the default and all a `read`-scoped token may ask for; `DRAFT` and `ANY` require a `full`-scoped token and are otherwise a `FORBIDDEN` error.',
    values: {
        PUBLISHED: { value: 'published' },
        DRAFT: { value: 'draft' },
        ANY: { value: 'any' }
    }
});

/** The publish state an entry of a `publishable` type is currently in. */
export const EntryStatusEnum = new GraphQLEnumType({
    name: 'EntryStatus',
    description:
        'Publish state of an entry on a `publishable` type. `DRAFT` with a non-null `publishedAt` is the admin’s **Modified** state: live content carrying unpublished edits.',
    values: {
        DRAFT: { value: 'draft' },
        PUBLISHED: { value: 'published' }
    }
});

/** How the ids in a relation delta name their targets. */
export const RelationRefByEnum = new GraphQLEnumType({
    name: 'RelationRefBy',
    description:
        'How the ids in a relation delta name their targets. `ID` (the default) is a literal entry id; `LOCALE_GROUP` reads them as translation-group ids, each resolved to that group’s row in the source entry’s own locale.',
    values: {
        ID: { value: 'id' },
        LOCALE_GROUP: { value: 'localeGroup' }
    }
});

/**
 * The GraphQL type of a field's **stored value** — the thing that appears in
 * `PublicEntry.values` and is settable through a write's `values` bag.
 *
 * Returns `null` for a field that carries no such value: a many-relation and an
 * inverse relation live in a join table, so they are not part of `values` in
 * either direction and are served as their own object field instead.
 *
 * **Nothing here is non-null.** On a publishable type `required` means *required
 * to publish* — a draft may legally be missing it, and a `full`-scoped token
 * reads drafts — so a non-null output type would make a valid draft
 * unreadable. `values` also collapses an unset field to `null` rather than
 * omitting the key, so every value field is genuinely nullable.
 */
export function valueTypeFor(
    spec: AnyFieldSpec,
    context: { objectName: string; fieldName: string; names: TypeNameRegistry }
): GraphQLOutputType | null {
    switch (spec.type) {
        case CONTENT_FIELD_TYPE.Text:
            return GraphQLString;
        case CONTENT_FIELD_TYPE.RichText:
            // A body is a **structured document** (the editor's node tree), so
            // it is JSON on the wire, not a string. A body written before that
            // change is still an HTML string in the same column and comes back
            // as a JSON string — which `JSON` covers and `String` would have
            // made a serialisation error the day the first document was saved.
            return GraphQLJSON;
        case CONTENT_FIELD_TYPE.Number:
            return spec.validation.integer === true ? GraphQLInt : GraphQLFloat;
        case CONTENT_FIELD_TYPE.Money:
            // Stored as integer MINOR UNITS (cents). `Float` rather than `Int`
            // because GraphQL's `Int` is 32-bit signed, which overflows at
            // ~$21.4M in cents — a real ceiling for a price field, and one that
            // would surface as a serialisation error on the one entry that
            // exceeds it. `Float` is IEEE-754 double: exact for every integer up
            // to 2^53, so the value is never approximated. It stays an integer
            // count of minor units on the wire, exactly as REST sends it.
            return GraphQLFloat;
        case CONTENT_FIELD_TYPE.Boolean:
            return GraphQLBoolean;
        case CONTENT_FIELD_TYPE.Date:
            return GraphQLDate;
        case CONTENT_FIELD_TYPE.Datetime:
            return GraphQLDateTime;
        case CONTENT_FIELD_TYPE.Select:
            return selectEnum(spec, context) ?? GraphQLString;
        case CONTENT_FIELD_TYPE.Multiselect: {
            const member = selectEnum(spec, context) ?? GraphQLString;
            return new GraphQLList(new GraphQLNonNull(member));
        }
        case CONTENT_FIELD_TYPE.Json:
            return GraphQLJSON;
        case CONTENT_FIELD_TYPE.Relation:
            // Only an OWNING SINGLE relation has a stored value (its `<field>_id`
            // FK). It is exposed as the resolved target object, not as the raw
            // id — resolving the reference is the whole reason to offer GraphQL
            // — so it is not a `values` field here either.
            return null;
        case CONTENT_FIELD_TYPE.Media:
            // Media is served as resolved assets, not as stored ids.
            return null;
        default:
            return null;
    }
}

/**
 * The GraphQL **input** type of a field, for a write's `values` bag, or `null`
 * when the field is not settable that way.
 *
 * Diverges from {@link valueTypeFor} in exactly the two places the REST write
 * body does: an owning single relation is set by target id, and a media field
 * takes asset ids. Both are references on the way in and resolved objects on
 * the way out, which is asymmetric but is what the existing write pipeline
 * accepts — and reusing it verbatim is the point.
 */
export function inputTypeFor(
    fieldName: string,
    spec: AnyFieldSpec,
    context: { objectName: string; names: TypeNameRegistry }
): GraphQLInputType | null {
    if (spec.type === CONTENT_FIELD_TYPE.Relation) {
        // A join-backed relation moves only through `relations` deltas.
        return spec.relation && !spec.relation.many && !spec.relation.inverse
            ? GraphQLID
            : null;
    }
    if (spec.type === CONTENT_FIELD_TYPE.Media) {
        return spec.multiple
            ? new GraphQLList(new GraphQLNonNull(GraphQLID))
            : GraphQLID;
    }
    const output = valueTypeFor(spec, {
        objectName: context.objectName,
        fieldName,
        names: context.names
    });
    // Every scalar and enum this mapper produces is valid in both positions;
    // the list/enum instances are shared between them so a `select` field
    // accepts exactly the values it returns.
    return (output as GraphQLInputType | null) ?? null;
}

/**
 * A `select`/`multiselect` field's options as a GraphQL enum, or `null` when
 * they cannot be represented — no options declared, or an option whose text has
 * no legal GraphQL enum name.
 *
 * Falling back to `String` for the whole field is deliberate: the alternative is
 * renaming the offending value on the wire, which would make the API disagree
 * with the stored data and with REST.
 */
function selectEnum(
    spec: AnyFieldSpec,
    context: { objectName: string; fieldName: string; names: TypeNameRegistry }
): GraphQLEnumType | null {
    const options = spec.options;
    if (!options || options.length === 0) {
        return null;
    }
    const values: GraphQLEnumValueConfigMap = {};
    for (const option of options) {
        const name = enumValueName(option);
        if (!name || values[name]) {
            return null;
        }
        values[name] = { value: option };
    }
    const name = `${context.objectName}${pascalCase(context.fieldName)}`;
    return context.names.enumFor(
        name,
        () =>
            new GraphQLEnumType({
                name,
                description: `Options declared by the \`${context.fieldName}\` field.`,
                values
            }),
        `the "${context.fieldName}" options of "${context.objectName}"`
    );
}
