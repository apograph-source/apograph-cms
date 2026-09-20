import { BadRequestException } from '@nestjs/common';
import {
    CONTENT_FIELD_TYPE,
    DEFAULT_EXPANSION_LIMIT,
    MAX_PAGE_SIZE,
    PREVIEW,
    PublicEntryQueryDto,
    PublicListEntriesQueryDto,
    type AnyContentType
} from '@orthacms/content-server';
import { validateSync } from 'class-validator';
import {
    Kind,
    type FieldNode,
    type FragmentDefinitionNode,
    type GraphQLResolveInfo,
    type SelectionSetNode,
    type ValueNode
} from 'graphql';

/**
 * Turns a GraphQL selection set into the query parameters the **existing REST
 * read** already takes.
 *
 * This module is where "GraphQL is an adapter, not a second implementation"
 * actually happens. A resolver does not decide what to fetch; it translates the
 * caller's selection into `?fields=`, `?relations=preview&relationFields=…`,
 * `?media=preview&mediaFields=…` and `?translations=preview`, hands that to
 * `PublicEntriesQuery`, and lets the one visibility rule do the rest. The direct
 * payoff is that a query asking for `{ id title }` narrows the **SQL
 * projection** exactly as `?fields=id,title` does, so an unselected richtext
 * column is never read — for free, because it is the same code path.
 */

/** Variable values by name, already coerced against their declared types. */
export type VariableMap = Readonly<Record<string, unknown>>;

/**
 * The operation's variables as a plain name → value map.
 *
 * On graphql-js v16 (what we run) `info.variableValues` **is** that map, so this
 * is a pass-through. v17 replaces it with a `{ sources, coerced }` pair, where
 * reading it directly yields an object holding two keys and none of the
 * caller's variables — a silent wrong answer rather than a type error. Handling
 * both here means the major upgrade is a version bump rather than a hunt, and
 * it costs one property check per field.
 */
export function coercedVariables(info: GraphQLResolveInfo): VariableMap {
    const raw = info.variableValues as unknown;
    if (raw && typeof raw === 'object' && 'coerced' in raw) {
        return ((raw as { coerced?: Record<string, unknown> }).coerced ??
            {}) as VariableMap;
    }
    return (raw as VariableMap | undefined) ?? {};
}

/** One field the caller selected, with the arguments they passed it. */
export interface SelectedField {
    /** The schema field name (not the response alias). */
    name: string;
    /** The field's own selection set, when it has one. */
    selectionSet?: SelectionSetNode;
    /** Literal/variable argument values, by argument name. */
    args: Record<string, unknown>;
}

/** What a selection set asks a content type for. */
export interface EntrySelection {
    /** Pure value fields to return in `values`, or `undefined` for "all". */
    valueFields: string[];
    /** Relation fields to expand, with the page size each asked for. */
    relations: Map<string, number>;
    /** Media fields to expand, with the item cap each asked for. */
    media: Map<string, number>;
    /** Whether the caller selected the entry's sibling translations. */
    translations: boolean;
}

/**
 * Flattens a selection set to its field nodes, following fragment spreads and
 * inline fragments.
 *
 * Fragments are not an edge case to tolerate — they are how real clients
 * (Relay, generated hooks, any `...ArticleFields`) express a selection, and a
 * derivation that ignored them would silently under-fetch `?fields=` and return
 * `null` for a field the caller definitely asked for.
 */
export function flattenSelection(
    selectionSet: SelectionSetNode | undefined,
    fragments: Record<string, FragmentDefinitionNode>,
    variables: VariableMap
): SelectedField[] {
    if (!selectionSet) {
        return [];
    }
    const out: SelectedField[] = [];
    for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
            out.push(toSelectedField(selection, variables));
            continue;
        }
        const nested =
            selection.kind === Kind.INLINE_FRAGMENT
                ? selection.selectionSet
                : fragments[selection.name.value]?.selectionSet;
        out.push(...flattenSelection(nested, fragments, variables));
    }
    return out;
}

/** The selection set of the first field named `name`, if the caller selected it. */
export function selectionUnder(
    fields: readonly SelectedField[],
    name: string
): SelectionSetNode | undefined {
    return fields.find((field) => field.name === name)?.selectionSet;
}

/**
 * Reads what a selection set asks of one content type.
 *
 * Unknown names are ignored rather than rejected: `__typename`, and the
 * envelope fields, are legal selections that map to no content field. A name
 * that is neither is impossible — the schema validated the document before any
 * of this ran.
 */
export function readEntrySelection(
    type: AnyContentType,
    selectionSet: SelectionSetNode | undefined,
    fragments: Record<string, FragmentDefinitionNode>,
    variables: VariableMap
): EntrySelection {
    const selection: EntrySelection = {
        valueFields: [],
        relations: new Map(),
        media: new Map(),
        translations: false
    };
    for (const field of flattenSelection(selectionSet, fragments, variables)) {
        if (field.name === 'translations') {
            selection.translations = true;
            continue;
        }
        const spec = type.fields[field.name];
        if (!spec) {
            continue;
        }
        if (spec.type === CONTENT_FIELD_TYPE.Relation) {
            selection.relations.set(
                field.name,
                clampPageSize(field.args['pageSize'])
            );
            continue;
        }
        if (spec.type === CONTENT_FIELD_TYPE.Media) {
            selection.media.set(field.name, clampPageSize(field.args['limit']));
            continue;
        }
        selection.valueFields.push(field.name);
    }
    return selection;
}

/**
 * Applies a selection to the query DTO the read services take.
 *
 * Two details worth knowing:
 *
 * - **`fields` is left unset when nothing was selected.** An empty `?fields=`
 *   reads as "no preference" downstream, but building the string at all only to
 *   have it ignored hides the intent; a caller selecting `{ total }` on a list
 *   wants no entry columns, and the projection cannot express that anyway
 *   (the envelope is always read).
 * - **One `relationLimit` serves every expanded field**, because the REST
 *   parameter is per-request rather than per-field. We send the **largest** page
 *   size any field asked for, so nothing is truncated below its request, and the
 *   per-field resolver slices its own view back down to what that field wanted.
 *   `total` is the true visible count either way, so the slice is observable and
 *   never passes itself off as the whole set.
 */
export function applySelection(
    dto: PublicEntryQueryDto,
    selection: EntrySelection
): void {
    if (selection.valueFields.length > 0) {
        dto.fields = selection.valueFields.join(',');
    }
    if (selection.relations.size > 0) {
        dto.relations = PREVIEW;
        dto.relationFields = [...selection.relations.keys()].join(',');
        dto.relationLimit = Math.max(...selection.relations.values());
    }
    if (selection.media.size > 0) {
        dto.media = PREVIEW;
        dto.mediaFields = [...selection.media.keys()].join(',');
        dto.mediaLimit = Math.max(...selection.media.values());
    }
    if (selection.translations) {
        dto.translations = PREVIEW;
    }
}

/**
 * The selection a **list** field implies for its entries — the same derivation,
 * reached through the list envelope's `items`. A list that selects only `total`
 * asks nothing of the entries.
 */
export function readListSelection(
    type: AnyContentType,
    info: GraphQLResolveInfo,
    fieldNodes: readonly FieldNode[] = info.fieldNodes
): EntrySelection {
    const variables = coercedVariables(info);
    const fields = fieldNodes.flatMap((node) =>
        flattenSelection(node.selectionSet, info.fragments, variables)
    );
    return readEntrySelection(
        type,
        selectionUnder(fields, 'items'),
        info.fragments,
        variables
    );
}

/** The selection a **single-entry** field implies. */
export function readSingleSelection(
    type: AnyContentType,
    info: GraphQLResolveInfo
): EntrySelection {
    return readEntrySelection(
        type,
        info.fieldNodes[0]?.selectionSet,
        info.fragments,
        coercedVariables(info)
    );
}

/**
 * Builds a list DTO from resolved arguments plus the caller's selection.
 *
 * The DTO is **validated**, for the same reason `mutation-resolvers.ts`
 * validates the write body: a REST query string meets the host's global
 * `ValidationPipe` and a GraphQL argument never does. Without this the
 * `@Min(1)`/`@Max(MAX_PAGE_SIZE)` on `page`/`pageSize` and the `@MaxLength` on
 * `search`/`locale` simply are not applied over this protocol, so `pageSize:
 * -1` — a clean 400 over REST — reaches `.limit(-1)` and comes back as an
 * opaque 500, and a 100 KB `search` needle sails past a cap the REST route
 * enforces. ADR-0008's premise is that a token cannot reach further over
 * GraphQL than over REST; this is what makes that true of read arguments.
 */
export function listDtoFrom(
    args: Record<string, unknown>,
    selection: EntrySelection
): PublicListEntriesQueryDto {
    const dto = new PublicListEntriesQueryDto();
    if (typeof args['page'] === 'number') dto.page = args['page'];
    if (typeof args['pageSize'] === 'number') dto.pageSize = args['pageSize'];
    if (typeof args['sort'] === 'string') dto.sort = args['sort'];
    if (typeof args['search'] === 'string') dto.search = args['search'];
    if (typeof args['locale'] === 'string') dto.locale = args['locale'];
    if (typeof args['status'] === 'string') {
        dto.status = args['status'] as PublicListEntriesQueryDto['status'];
    }
    if (args['filter'] !== undefined && args['filter'] !== null) {
        // The filter tree crosses as a `JSON` scalar and is re-serialised here,
        // because the engine's entry point takes the raw string the REST
        // `?filter=` parameter carries. Re-encoding rather than reaching past it
        // keeps ONE parser, one set of node/depth caps, and one error shape for
        // a malformed tree across both protocols.
        dto.filter = JSON.stringify(args['filter']);
    }
    applySelection(dto, selection);
    assertValidQuery(dto);
    return dto;
}

/** Builds a single-entry DTO from resolved arguments plus the selection. */
export function entryDtoFrom(
    args: Record<string, unknown>,
    selection: EntrySelection
): PublicEntryQueryDto {
    const dto = new PublicEntryQueryDto();
    if (typeof args['locale'] === 'string') dto.locale = args['locale'];
    if (typeof args['status'] === 'string') {
        dto.status = args['status'] as PublicEntryQueryDto['status'];
    }
    applySelection(dto, selection);
    assertValidQuery(dto);
    return dto;
}

/**
 * Runs a read DTO's own validators — the ones the host's `ValidationPipe`
 * applies to a REST query string. A failure is a 400 naming the offending
 * argument, so the two protocols refuse the same input the same way.
 */
function assertValidQuery(dto: PublicEntryQueryDto): void {
    const errors = validateSync(dto, {
        whitelist: true,
        forbidNonWhitelisted: true
    });
    if (errors.length > 0) {
        throw new BadRequestException(
            errors.flatMap((error) =>
                Object.values(error.constraints ?? { error: error.toString() })
            )
        );
    }
}

/** One field node as a {@link SelectedField}, with its arguments resolved. */
function toSelectedField(
    node: FieldNode,
    variables: VariableMap
): SelectedField {
    const args: Record<string, unknown> = {};
    for (const argument of node.arguments ?? []) {
        const value = literalValue(argument.value, variables);
        if (value !== undefined) {
            args[argument.name.value] = value;
        }
    }
    return {
        name: node.name.value,
        ...(node.selectionSet ? { selectionSet: node.selectionSet } : {}),
        args
    };
}

/**
 * An argument's value, whether written inline or passed as a variable.
 *
 * Only the scalar cases are handled, because this is used purely to size an
 * expansion (`pageSize`, `limit`). The *executed* arguments a resolver acts on
 * come from graphql-js's own coercion, which is authoritative; this is a peek
 * at the document before execution reaches the nested field.
 */
function literalValue(node: ValueNode, variables: VariableMap): unknown {
    switch (node.kind) {
        case Kind.INT:
        case Kind.FLOAT:
            return Number(node.value);
        case Kind.STRING:
        case Kind.ENUM:
        case Kind.BOOLEAN:
            return node.value;
        case Kind.VARIABLE:
            return variables[node.name.value];
        default:
            return undefined;
    }
}

/**
 * A requested page size, clamped into the range the REST API accepts. Falls
 * back to the shared expansion default so an unsized field costs exactly what
 * `?relations=preview` costs.
 */
function clampPageSize(raw: unknown): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return DEFAULT_EXPANSION_LIMIT;
    }
    return Math.min(Math.max(Math.trunc(raw), 1), MAX_PAGE_SIZE);
}
