import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
    DEFAULT_EXPANSION_LIMIT,
    resolveGrantedType,
    type AnyContentType,
    type EntryLocator,
    type EntryVisibility,
    type GrantedType,
    type PublicEntry,
    type PublicMediaRef,
    type PublicRelationFieldView
} from '@orthacms/content-server';
import { PERMISSIONS } from '@orthacms/identity-server';
import type { GraphQLFieldResolver } from 'graphql';
import type { GraphqlContext } from './context';
import {
    entryDtoFrom,
    listDtoFrom,
    readListSelection,
    readSingleSelection
} from './selection';

/**
 * The read resolvers. Each one translates a GraphQL field into the DTO the
 * existing public REST read already takes and calls the same service, so the
 * two protocols share one visibility rule, one filter language, and one grant
 * gate — see `selection.ts` for the translation itself.
 */

/** `article(id: …)` / `homePage(locale: …)` — one entry. */
export function singleResolver(
    typeName: string
): GraphQLFieldResolver<unknown, GraphqlContext> {
    return async (_source, args, context, info) => {
        const { type, granted } = await resolveType(context, typeName);
        assertVisibility(context, args['status']);
        const selection = readSingleSelection(type, info);
        return context.entries.getOne(
            type,
            locatorFrom(args),
            context.workspaceId,
            entryDtoFrom(args, selection),
            granted
        );
    };
}

/** `articles(page: …, filter: …)` — one page of entries. */
export function listResolver(
    typeName: string
): GraphQLFieldResolver<unknown, GraphqlContext> {
    return async (_source, args, context, info) => {
        const { type, granted } = await resolveType(context, typeName);
        assertVisibility(context, args['status']);
        const selection = readListSelection(type, info);
        return context.entries.list(
            type,
            listDtoFrom(args, selection),
            context.workspaceId,
            granted
        );
    };
}

/**
 * `homePage(locale: …)` — the one entry of a `single` content type.
 *
 * A `single` has no id a caller could hold, so it is read as a one-row list and
 * unwrapped here. That is the same thing REST does, moved off the consumer: over
 * there a single is served by the list route and every client writes
 * `items[0]`, which is an implementation detail leaking into a published API.
 * With localization a single still stores one row per locale, so `locale:` is
 * what picks the row.
 */
export function pageResolver(
    typeName: string
): GraphQLFieldResolver<unknown, GraphqlContext> {
    return async (_source, args, context, info) => {
        const { type, granted } = await resolveType(context, typeName);
        assertVisibility(context, args['status']);
        const selection = readSingleSelection(type, info);
        const dto = listDtoFrom({ ...args, pageSize: 1 }, selection);
        const page = await context.entries.list(
            type,
            dto,
            context.workspaceId,
            granted
        );
        return page.items[0] ?? null;
    };
}

/**
 * A stored field's value out of the entry's `values` bag.
 *
 * A resolver rather than the default property lookup, because `values` is a
 * nested bag on the wire shape and GraphQL exposes its keys as top-level fields
 * — which is the whole point of putting a typed schema in front of it.
 */
export function valueResolver(
    fieldName: string
): GraphQLFieldResolver<PublicEntry, GraphqlContext> {
    return (entry) => entry.values?.[fieldName] ?? null;
}

/**
 * One relation field's links.
 *
 * Three paths, in order of how often they are taken:
 *
 * 1. **Already attached** — the parent read expanded this field because the
 *    caller selected it (see `applySelection`). No query at all; the view is
 *    sliced back to the page size *this* field asked for, since one
 *    `relationLimit` had to serve every expanded field.
 * 2. **Nested past the parent's expansion** — the parent came out of somebody
 *    else's expansion and carries no `relations`. Goes through
 *    {@link EntryLoader}, which batches every sibling in the tick into one query
 *    per level.
 * 3. **`page > 1`** — a caller paging past the first page of one field, which is
 *    the one thing an expansion parameter cannot express. Falls through to
 *    `relationField`, the same call `/v1/content/:type/:id/relations/:field`
 *    serves. Deliberately **not** batched: this is a targeted request, and on a
 *    wide list it is one query per row — which the complexity budget bounds and
 *    the docs warn about, rather than being silently absorbed here.
 */
export function relationResolver(
    type: AnyContentType,
    fieldName: string
): GraphQLFieldResolver<PublicEntry, GraphqlContext> {
    return (entry, args, context) =>
        loadRelationView(type, fieldName, entry, args, context);
}

/**
 * An owning **single** relation, resolved to the target entry itself.
 *
 * The link machinery answers in pages for every cardinality, but a many-to-one
 * holds at most one target, and handing a consumer `author { items { name } }`
 * would make them unwrap a list that structurally cannot have a second element.
 * The unwrapping belongs on this side of the wire — it is the difference between
 * a schema that describes the content model and one that describes the storage.
 *
 * Null when the field is unset, or when its target is no longer publicly
 * readable — a link to a since-unpublished entry is a normal state, not an
 * error.
 */
export function singleRelationResolver(
    type: AnyContentType,
    fieldName: string
): GraphQLFieldResolver<PublicEntry, GraphqlContext> {
    return async (entry, _args, context) => {
        const view = await loadRelationView(
            type,
            fieldName,
            entry,
            { pageSize: 1 },
            context
        );
        return view.items[0] ?? null;
    };
}

/** The shared body of both relation resolvers. @see relationResolver */
async function loadRelationView(
    type: AnyContentType,
    fieldName: string,
    entry: PublicEntry,
    args: Record<string, unknown>,
    context: GraphqlContext
): Promise<PublicRelationFieldView> {
    const page = numberArg(args['page']) ?? 1;
    const pageSize = numberArg(args['pageSize']);

    if (page === 1) {
        const attached = entry.relations?.[fieldName];
        if (attached) {
            return capped(attached, pageSize);
        }
        const { granted } = await resolveType(context, type.name);
        const loaded = await context.loader.load(
            type,
            entry.id,
            {
                relationFields: [fieldName],
                limit: pageSize ?? DEFAULT_EXPANSION_ITEMS,
                ...(entry.locale ? { locale: entry.locale } : {}),
                ...visibilityOf(entry)
            },
            granted
        );
        return capped(
            loaded?.relations?.[fieldName] ?? { items: [], total: 0 },
            pageSize
        );
    }

    const { granted } = await resolveType(context, type.name);
    return context.entries.relationField(
        type,
        { id: entry.id },
        fieldName,
        page,
        pageSize ?? DEFAULT_EXPANSION_ITEMS,
        context.workspaceId,
        granted,
        entry.locale,
        undefined
    );
}

/**
 * One media field's assets.
 *
 * Returned as a bare list rather than an `{ items, total }` envelope, because a
 * media field genuinely *is* a list of assets — the ids are stored in the row —
 * so the envelope would only ever report `total === items.length` unless
 * `limit` truncated it. Truncation is then visible as a short list, and `limit`
 * is the caller's own argument.
 */
export function mediaResolver(
    type: AnyContentType,
    fieldName: string
): GraphQLFieldResolver<PublicEntry, GraphqlContext> {
    return async (entry, args, context) => {
        const limit = numberArg(args['limit']);
        const attached = entry.media?.[fieldName];
        if (attached) {
            return sliceRefs(attached.items, limit);
        }
        const { granted } = await resolveType(context, type.name);
        const loaded = await context.loader.load(
            type,
            entry.id,
            {
                mediaFields: [fieldName],
                limit: limit ?? DEFAULT_EXPANSION_ITEMS,
                ...(entry.locale ? { locale: entry.locale } : {}),
                ...visibilityOf(entry)
            },
            granted
        );
        return sliceRefs(loaded?.media?.[fieldName]?.items ?? [], limit);
    };
}

/**
 * The entry's **other** locale rows. Attached by the parent read when selected,
 * so this normally costs nothing; a translations selection reached through
 * somebody else's expansion goes through the loader like a relation does.
 */
export function translationsResolver(
    type: AnyContentType
): GraphQLFieldResolver<PublicEntry, GraphqlContext> {
    return async (entry, _args, context) => {
        if (entry.translations) {
            return entry.translations;
        }
        const { granted } = await resolveType(context, type.name);
        const loaded = await context.loader.load(
            type,
            entry.id,
            {
                translations: true,
                limit: DEFAULT_EXPANSION_ITEMS,
                ...(entry.locale ? { locale: entry.locale } : {}),
                ...visibilityOf(entry)
            },
            granted
        );
        return loaded?.translations ?? [];
    };
}

/**
 * Resolves a content type for this request through the **same** gate the REST
 * routes use: registered, and granted to the resolved workspace, or one 404.
 *
 * The schema was already pruned to the grant set, so an ungranted type normally
 * fails earlier and harder — as a validation error naming no such field, before
 * a resolver runs. This is the second line: the schema is cached with a TTL, so
 * a grant revoked moments ago can still be *described* while this makes sure it
 * cannot be *read*.
 */
export async function resolveType(
    context: GraphqlContext,
    typeName: string
): Promise<GrantedType> {
    return resolveGrantedType(
        context.registry,
        context.grants,
        typeName,
        context.workspaceId
    );
}

/**
 * Enforces the draft rule: `DRAFT` and `ANY` need a write-scoped token.
 *
 * The logic `DraftVisibilityGuard` applies to `?status=` on the REST routes, in
 * the only place it can live here — a guard sees the request, not a field's
 * arguments, and one GraphQL document can ask for several statuses at once.
 * `content:update` is the probe rather than `content:read` for the same reason
 * it is there: read is what both scopes hold, update is what separates them.
 */
export function assertVisibility(
    context: GraphqlContext,
    status: unknown
): void {
    if (status !== 'draft' && status !== 'any') {
        return;
    }
    if (!context.can(PERMISSIONS.CONTENT_UPDATE)) {
        throw new ForbiddenException(
            `status: ${(status as string).toUpperCase()} requires a token with write scope.`
        );
    }
}

/** Items per expanded field when a nested selection named no size — the REST
 * expansion's own default, so an unsized GraphQL field costs what
 * `?relations=preview` costs. */
const DEFAULT_EXPANSION_ITEMS = DEFAULT_EXPANSION_LIMIT;

/**
 * `id` **or** `localeGroupId`, never both and never neither.
 *
 * REST spells these as two routes, which makes the exclusivity structural. One
 * field with two optional arguments cannot, so it is checked — a request naming
 * both has two different entries in mind, and picking one silently is how a
 * caller ends up reading the wrong row without ever seeing an error.
 */
function locatorFrom(args: Record<string, unknown>): EntryLocator {
    const id = args['id'];
    const localeGroupId = args['localeGroupId'];
    if (typeof id === 'string' && typeof localeGroupId === 'string') {
        throw new BadRequestException(
            'Pass either `id` or `localeGroupId`, not both.'
        );
    }
    if (typeof id === 'string') {
        return { id };
    }
    if (typeof localeGroupId === 'string') {
        return { localeGroupId };
    }
    throw new BadRequestException(
        'Pass `id`, or `localeGroupId` with an optional `locale`.'
    );
}

/** A relation view sliced to the page size the field asked for. */
function capped(
    view: PublicRelationFieldView,
    pageSize: number | undefined
): PublicRelationFieldView {
    if (pageSize === undefined || view.items.length <= pageSize) {
        return view;
    }
    // `total` is untouched on purpose: it is the true count of visible links,
    // so a short `items` is observable rather than passing for the whole set.
    return { items: view.items.slice(0, pageSize), total: view.total };
}

/** Media refs sliced to the caller's `limit`. */
function sliceRefs(
    refs: readonly PublicMediaRef[],
    limit: number | undefined
): readonly PublicMediaRef[] {
    return limit === undefined ? refs : refs.slice(0, limit);
}

/** A numeric argument, or `undefined` when the caller omitted it. */
function numberArg(raw: unknown): number | undefined {
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

/**
 * The publish states a **re-read of this same entry** may return.
 *
 * The loader's default — published only — is right for a linked target and
 * wrong for the entry already in hand. A mutation hands back a draft (a create
 * always does, an update sends a published entry back to draft), and re-reading
 * that row through the published-only rule matches nothing, so `tags { total }`
 * on a just-created entry answered `0` and a required `author` answered `null`:
 * a wrong number presented as a fact, on the very links the same call had just
 * written.
 *
 * Widening is safe because holding a draft already implies the right to see
 * one: `assertVisibility` gates `status: DRAFT|ANY` on every read, and a
 * mutation result required the write permission its resolver asserted. The
 * re-read runs through the same `readableWhere` either way — this only stops it
 * asking a narrower question than the caller was granted.
 */
function visibilityOf(entry: PublicEntry): { status?: EntryVisibility } {
    return entry.status === DRAFT ? { status: ANY } : {};
}

/** The stored publish state of an entry that has not been taken live. */
const DRAFT = 'draft';

/** The visibility that spans both publish states. @see ENTRY_VISIBILITY */
const ANY = 'any';
