import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
    Optional
} from '@nestjs/common';
import {
    and,
    asc,
    count,
    desc,
    eq,
    inArray,
    isNull,
    type AnyColumn,
    type SQL
} from 'drizzle-orm';
import type { PgColumn, SelectedFields } from 'drizzle-orm/pg-core';
import { InjectDatabase, type Database } from '@orthacms/database';
import { applyFilterTree, parseFilterTree } from '@orthacms/utils-server';
import {
    CONTENT_ENTRY_EXTENSION,
    type ContentEntryExtension
} from '../../extension/entry-extension';
import { ContentReadScopeRegistry } from '../../extension/read-scope';
import { ENTRY_STATUS, type AnyContentType } from '../../types/content-type';
import { CONTENT_FIELD_TYPE } from '../../types/fields';
import { RelationLinkService } from '../../entries/infrastructure/persistence/relation-link.service';
import type {
    PublicMediaFieldView,
    PublicRelationFieldView
} from '../types/public-expansion';
import { isScalarField } from '../../entries/infrastructure/queries/entry-scalar-fields';
import { buildEntryFilterSurface } from '../../entries/infrastructure/queries/entry-filter-surface';
import { buildSearchPredicate } from '../../entries/infrastructure/queries/entry-search';
import { parseFieldSelection } from './field-selection';
import { PublicExpansionQuery } from './public-expansion.query';
import { DEFAULT_PAGE_SIZE } from '../../entries/entries.constants';
import {
    DEFAULT_EXPANSION_LIMIT,
    PREVIEW,
    type EntryVisibility,
    type PublicEntryQueryDto,
    type PublicListEntriesQueryDto
} from '../http/dto/public-list-entries-query.dto';
import type { PublicEntry, PublicEntryListView } from '../types/public-entry';
import { toPublicEntry } from './public-entry-row';

/** A generated content table seen as a bag of columns by property name. */
type ContentTable = Record<string, AnyColumn>;

/**
 * The same table seen as `PgColumn`s — what drizzle's `.select({...})` requires.
 * Generated tables carry no static column types, so both views are casts; this
 * one is kept separate rather than widening {@link ContentTable}, which the
 * predicate helpers use against the looser `AnyColumn` operators.
 */
type ContentColumns = Record<string, PgColumn>;

/**
 * How a request names the **one** entry it wants. Two spellings, one meaning:
 * an entry id, or a translation group whose row for the requested locale is
 * taken (see `getOne`). Every single-entry read takes a locator rather than an
 * id, so each route exists in both spellings by construction — a group-addressed
 * caller is never told "that one is id-only", and neither form can drift on what
 * it hides.
 */
export type EntryLocator =
    | { readonly id: string }
    | { readonly localeGroupId: string };

/**
 * The read side of the public content API. Generic over the content type like
 * the admin's `EntriesService` — the physical table and the sortable columns
 * are derived from `type` per request, so one service serves every code-defined
 * collection and single.
 *
 * It **reuses** the admin's query machinery where the semantics are identical —
 * the same ILIKE search predicate and the same query-builder filter engine, so
 * one query language covers both surfaces — but it is deliberately **not** built
 * on `EntriesService` itself. Several of that service's knobs (`?deleted=only`
 * most obviously) select rows this API must never serve, and reaching through it
 * to subtract them would make the visibility rule an argument about what was
 * *not* passed. Instead the public read states its own WHERE, so "what can a
 * token see?" is answerable by reading one method:
 *
 * - the **workspace** the request resolved to, always;
 * - **published only**, on publishable types — a draft is unfinished work and
 *   never leaves the admin;
 * - **not soft-deleted**, on paranoid types;
 * - the bound `CONTENT_ENTRY_EXTENSION`'s scope, so a localized type reads the
 *   requested locale (and the same rules the admin gets) for free.
 *
 * `?search=` and `?filter=` narrow that set further; neither can widen it, since
 * both are AND-ed onto the predicate above.
 */
@Injectable()
export class PublicEntriesQuery {
    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly expansion: PublicExpansionQuery,
        private readonly relationLinks: RelationLinkService,
        // The entries extension port (e.g. i18n's locale scoping) — absent
        // unless a downstream plugin binds it, hence optional.
        @Optional()
        @Inject(CONTENT_ENTRY_EXTENSION)
        private readonly extension?: ContentEntryExtension,
        // Registered read scopes (e.g. segments' reader entitlements). Always
        // provided by this plugin's own module; optional so a unit test can
        // construct the query without one.
        @Optional()
        private readonly readScopes?: ContentReadScopeRegistry
    ) {}

    /**
     * One page of a type's publicly readable entries. Count and page share the
     * WHERE and run concurrently, so the request pays the slower of the two.
     */
    async list(
        type: AnyContentType,
        query: PublicListEntriesQueryDto,
        workspaceId: string,
        grantedTypes: ReadonlySet<string>
    ): Promise<PublicEntryListView> {
        const page = query.page ?? 1;
        const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
        const selected = parseFieldSelection(type, query.fields);
        const relationFields =
            query.relations === PREVIEW
                ? this.expansion.parseRelationFields(
                      type,
                      query.relationFields,
                      grantedTypes
                  )
                : [];
        const mediaFields =
            query.media === PREVIEW
                ? this.expansion.parseMediaFields(type, query.mediaFields)
                : [];
        const translations = this.wantsTranslations(type, query);
        const where = and(
            this.readableWhere(type, workspaceId, query.locale, query.status),
            buildSearchPredicate(type, query.search),
            await this.filterPredicate(
                type,
                query.filter,
                workspaceId,
                grantedTypes
            )
        );
        // An expansion reads columns that never appear in `values` — an owning
        // single relation's FK, a media field's ids — so a `?fields=` selection
        // must still carry them or the preview would find nothing to resolve.
        const projection = this.projection(type, selected, [
            ...relationFields,
            ...mediaFields
        ]);
        const rowsQuery = projection
            ? this.db.select(projection).from(type.table)
            : this.db.select().from(type.table);

        const [[{ total }], rows] = await Promise.all([
            this.db.select({ total: count() }).from(type.table).where(where),
            rowsQuery
                .where(where)
                .orderBy(...this.orderBy(type, query.sort))
                .limit(pageSize)
                .offset((page - 1) * pageSize)
        ]);

        const items = rows.map((row) =>
            toPublicEntry(type, row as Record<string, unknown>, selected)
        );
        await this.attachExpansions(
            type,
            items,
            rows as Record<string, unknown>[],
            workspaceId,
            { relations: relationFields, media: mediaFields, translations },
            {
                relation: query.relationLimit,
                media: query.mediaLimit
            },
            selected
        );
        return { items, total, page, pageSize };
    }

    /**
     * Attach the opt-in relation / media / translation previews to an
     * already-projected page. Every resolver is batched across the whole page,
     * so this adds a bounded number of queries per requested field (and one for
     * translations) — never one per row.
     */
    private async attachExpansions(
        type: AnyContentType,
        items: PublicEntry[],
        rows: Record<string, unknown>[],
        workspaceId: string,
        want: {
            relations: string[];
            media: string[];
            translations: boolean;
        },
        limits: { relation?: number; media?: number },
        selected: ReadonlySet<string> | undefined
    ): Promise<void> {
        if (
            !want.relations.length &&
            !want.media.length &&
            !want.translations
        ) {
            return;
        }
        const [relations, media, translations] = await Promise.all([
            this.expansion.relationsForRows(
                type,
                want.relations,
                rows,
                workspaceId,
                limits.relation
            ),
            this.expansion.mediaForRows(
                type,
                want.media,
                rows,
                workspaceId,
                limits.media
            ),
            want.translations
                ? this.translationsForEntries(
                      type,
                      items,
                      workspaceId,
                      selected
                  )
                : undefined
        ]);
        for (const item of items) {
            // Keys are present-but-empty when the caller asked for a field the
            // entry has no links in, so a consumer can read `relations.author`
            // without testing for the map itself.
            if (want.relations.length) {
                item.relations = relations.get(item.id) ?? {};
                for (const field of want.relations) {
                    item.relations[field] ??= { items: [], total: 0 };
                }
            }
            if (want.media.length) {
                item.media = media.get(item.id) ?? {};
                for (const field of want.media) {
                    item.media[field] ??= { items: [], total: 0 };
                }
            }
            // Likewise present-but-empty: an entry that is the only published
            // row in its group reports `[]`, not a missing key, so "no other
            // translations" and "you didn't ask" stay distinguishable.
            if (want.translations) {
                item.translations = translations?.get(item.id) ?? [];
            }
        }
    }

    /**
     * Whether this request wants sibling translations — and a **400** when it
     * asks for them on a type that isn't localized.
     *
     * Refusing rather than returning an empty list is the same call
     * `relationFields` makes for a non-relation field: the type has no
     * translation group at all, so `[]` would read as "this entry has no other
     * locales" when the truth is "this content is not localized".
     */
    private wantsTranslations(
        type: AnyContentType,
        query: PublicEntryQueryDto
    ): boolean {
        if (query.translations !== PREVIEW) {
            return false;
        }
        this.assertLocalized(type, 'translations');
        return true;
    }

    /** Guard a locale-only feature against a type that has no locale rows. */
    private assertLocalized(type: AnyContentType, param: string): void {
        if (!type.i18n) {
            throw new BadRequestException(
                `${param}: "${type.name}" is not a localized content type.`
            );
        }
    }

    /**
     * The sibling translations of every entry on a page, keyed by entry id.
     *
     * **One** query for the whole page: the group ids are collected and read
     * with a single `locale_group_id IN (…)`, which the
     * `(locale_group_id, locale)` index serves. No cap is applied — a group
     * holds at most one row per configured locale, so its size is bounded by
     * the host's own config rather than by user data.
     *
     * Deliberately built on {@link liveWhere} and not `readableWhere`: the
     * extension's `listScope` pins the read to a **single** locale, which is
     * exactly what a translation lookup must not do. Everything else about
     * visibility is unchanged — workspace, published-only, not soft-deleted —
     * so a locale that exists only as a draft stays invisible here too.
     */
    private async translationsForEntries(
        type: AnyContentType,
        items: PublicEntry[],
        workspaceId: string,
        selected: ReadonlySet<string> | undefined
    ): Promise<Map<string, PublicEntry[]>> {
        const out = new Map<string, PublicEntry[]>();
        const groupIds = [
            ...new Set(
                items
                    .map((item) => item.localeGroupId)
                    .filter((id): id is string => !!id)
            )
        ];
        if (!groupIds.length) {
            return out;
        }
        const table = type.table as unknown as ContentTable;
        const projection = this.projection(type, selected);
        const rowsQuery = projection
            ? this.db.select(projection).from(type.table)
            : this.db.select().from(type.table);
        const rows = (await rowsQuery
            .where(
                and(
                    inArray(table['localeGroupId'], groupIds),
                    this.liveWhere(type, workspaceId)
                )
            )
            .orderBy(asc(table['locale']))) as Record<string, unknown>[];

        const byGroup = new Map<string, Record<string, unknown>[]>();
        for (const row of rows) {
            const group = row['localeGroupId'] as string;
            const bucket = byGroup.get(group);
            if (bucket) bucket.push(row);
            else byGroup.set(group, [row]);
        }
        for (const item of items) {
            const siblings = byGroup.get(item.localeGroupId ?? '') ?? [];
            out.set(
                item.id,
                siblings
                    // The entry itself is the row the caller already holds;
                    // repeating it inside its own `translations` would double
                    // every payload for nothing.
                    .filter((row) => row['id'] !== item.id)
                    .map((row) => toPublicEntry(type, row, selected))
            );
        }
        return out;
    }

    /**
     * The sibling translations of one entry — the `/translations` sibling route,
     * for a consumer that has the entry and wants its other locales without
     * re-reading it. 404 for an entry that isn't publicly readable, exactly like
     * the entry route; 400 on a type that isn't localized.
     */
    async translationsOf(
        type: AnyContentType,
        locator: EntryLocator,
        workspaceId: string,
        query: PublicEntryQueryDto
    ): Promise<PublicEntry[]> {
        this.assertLocalized(type, 'translations');
        const selected = parseFieldSelection(type, query.fields);
        const row = await this.readableRow(
            type,
            locator,
            workspaceId,
            query.locale,
            query.status
        );
        const entry = toPublicEntry(type, row, selected);
        const byEntry = await this.translationsForEntries(
            type,
            [entry],
            workspaceId,
            selected
        );
        return byEntry.get(entry.id) ?? [];
    }

    /**
     * The SELECT list for a `?fields=` selection, or `undefined` to select the
     * whole row. Narrowing this is the point of a sparse fieldset: without it
     * the query still reads (and Postgres still detoasts) a richtext column the
     * caller asked to leave out, and only the serializer saves any bytes.
     *
     * The envelope is always included — `toPublicEntry` reads those columns
     * unconditionally, and they are what make an entry addressable. The WHERE
     * and ORDER BY may reference columns outside this list; SQL allows that, so
     * filtering and sorting stay unrestricted by the selection.
     */
    private projection(
        type: AnyContentType,
        selected: ReadonlySet<string> | undefined,
        alsoNeeded: readonly string[] = []
    ): SelectedFields | undefined {
        if (!selected) {
            return undefined;
        }
        const table = type.table as unknown as ContentColumns;
        const columns: ContentColumns = {
            id: table['id'],
            createdAt: table['createdAt'],
            updatedAt: table['updatedAt']
        };
        if (type.publishable) {
            columns['status'] = table['status'];
            columns['publishedAt'] = table['publishedAt'];
        }
        if (type.i18n) {
            columns['locale'] = table['locale'];
            columns['localeGroupId'] = table['localeGroupId'];
        }
        // `Object.hasOwn` on both loops. `selected` is already own-property
        // validated against the type's field map (`parseFieldSelection`), and
        // `alsoNeeded` carries internal constants — but the failure mode here
        // is putting a drizzle table's INHERITED member (a class function) into
        // a `.select()` list, which is a 500, and a reader should not have to
        // work out which of the two loops is the safe one.
        for (const name of selected) {
            if (Object.hasOwn(table, name)) columns[name] = table[name];
        }
        for (const name of alsoNeeded) {
            // Join-backed relations own no column on this table; skip them
            // rather than putting `undefined` in the SELECT list.
            if (Object.hasOwn(table, name) && table[name]) {
                columns[name] = table[name];
            }
        }
        return columns;
    }

    /**
     * One publicly readable entry, addressed by **either** spelling of
     * {@link EntryLocator}.
     *
     * By id: a draft, a soft-deleted row, an entry in another workspace, and an
     * id that never existed are all the same 404 — an unpublished entry must not
     * be distinguishable from a missing one.
     *
     * By translation group, the read a localized front-end actually wants: a
     * consumer that knows an article by its group id ("this story") renders it
     * in whatever locale the visitor is in by varying `?locale=` alone, instead
     * of keeping a per-locale id map — the group id is the stable identity of
     * the story across languages, while each locale's `id` is not. A group with
     * no published row in the requested locale is the same 404 as an unknown
     * group: the caller asked for content that isn't live in that language, and
     * which of the two it is isn't theirs to learn.
     */
    async getOne(
        type: AnyContentType,
        locator: EntryLocator,
        workspaceId: string,
        query: PublicEntryQueryDto,
        grantedTypes: ReadonlySet<string>
    ): Promise<PublicEntry> {
        const selected = parseFieldSelection(type, query.fields);
        const relationFields =
            query.relations === PREVIEW
                ? this.expansion.parseRelationFields(
                      type,
                      query.relationFields,
                      grantedTypes
                  )
                : [];
        const mediaFields =
            query.media === PREVIEW
                ? this.expansion.parseMediaFields(type, query.mediaFields)
                : [];
        const projection = this.projection(type, selected, [
            ...relationFields,
            ...mediaFields
        ]);
        const rowQuery = projection
            ? this.db.select(projection).from(type.table)
            : this.db.select().from(type.table);
        const [row] = await rowQuery
            .where(
                this.entryWhere(
                    type,
                    locator,
                    workspaceId,
                    query.locale,
                    query.status
                )
            )
            .limit(1);
        if (!row) {
            throw new NotFoundException(this.notFoundFor(type, locator));
        }
        const entry = toPublicEntry(
            type,
            row as Record<string, unknown>,
            selected
        );
        // One row is still a "page" as far as the batched resolvers care, so
        // the single read reuses exactly the list's expansion path.
        await this.attachExpansions(
            type,
            [entry],
            [row as Record<string, unknown>],
            workspaceId,
            {
                relations: relationFields,
                media: mediaFields,
                translations: this.wantsTranslations(type, query)
            },
            { relation: query.relationLimit, media: query.mediaLimit },
            selected
        );
        return entry;
    }

    /**
     * The row a locator names, for a **write** — its id addresses the write, and
     * its stored values are what a partial update merges onto.
     *
     * Resolved with `status: 'any'`, because writes address rows in whatever
     * state they are in — the overwhelmingly common case is editing a draft,
     * which the published-only default would hide. Everything else about the
     * lookup is the read rule verbatim (workspace, not soft-deleted, the
     * requested locale), so a token can never reach across a workspace with a
     * write that it could not reach with a read.
     *
     * Lives here rather than in the write service so there is exactly one
     * implementation of "which row does this locator mean?" — a second one that
     * forgot the workspace clause is the failure this avoids.
     */
    async resolveWritableRow(
        type: AnyContentType,
        locator: EntryLocator,
        workspaceId: string,
        locale?: string
    ): Promise<Record<string, unknown>> {
        // An id locator is still a real lookup, not a pass-through: an id in
        // another workspace or a soft-deleted one has to 404 here rather than
        // reach the writer, which scopes by workspace but would report the
        // mismatch as its own kind of failure.
        return this.readableRow(type, locator, workspaceId, locale, 'any');
    }

    /**
     * The full predicate for a **single-entry** read: the locator, the
     * locale-independent visibility rule, and — for a group locator only — the
     * extension's locale scope.
     *
     * That asymmetry is the point. A **group** id names a whole translation
     * group, so the locale is what picks the row out of it; `LIMIT 1` never has
     * to break a tie. An **entry id** already names exactly one row, so AND-ing
     * the locale scope onto it can do nothing except turn a valid id into a 404
     * whenever that row is not in the default locale. That used to be the
     * behaviour, documented as a sharp edge; the write API made it untenable,
     * since updating a German article by its own id would have needed
     * `?locale=de` appended to a request that already named the row uniquely.
     *
     * The narrowing is safe because `liveWhere` still carries the whole of the
     * *visibility* rule — workspace, publish state, soft delete. The extension's
     * `listScope` is, per its own name and its one implementation, about
     * choosing rows out of a *set*; a request that names one row has already
     * chosen.
     *
     * What the asymmetry must **not** cost is validation. Dropping the scope
     * from an id read also dropped the only thing that looks at `?locale=`, so
     * `?locale=zz` went from a 400 to being silently ignored — a typo that
     * quietly returns another language's content, on a contract that says
     * every route taking a locale rejects an unknown one. Hence the discarded
     * call below: `listScope` validates as well as narrows (see the port's
     * docs), and only the narrowing is unwanted here.
     */
    private entryWhere(
        type: AnyContentType,
        locator: EntryLocator,
        workspaceId: string,
        locale: string | undefined,
        visibility: EntryVisibility | undefined
    ): SQL | undefined {
        const table = type.table as unknown as ContentTable;
        if ('id' in locator) {
            // Called for its validation, not its predicate — an unknown slug
            // throws here. Do not "clean up" the unused return value.
            this.extension?.listScope(type, workspaceId, { locale });
            return and(
                eq(table['id'], locator.id),
                this.liveWhere(type, workspaceId, visibility)
            );
        }
        // A group locator is only meaningful on a localized type, and is a 400
        // elsewhere — the caller addressed the entry by something the type does
        // not have, which is a different mistake from naming a group that does
        // not exist (a 404).
        this.assertLocalized(type, 'localeGroupId');
        return and(
            eq(table['localeGroupId'], locator.localeGroupId),
            this.liveWhere(type, workspaceId, visibility),
            this.extension?.listScope(type, workspaceId, { locale })
        );
    }

    /** The 404 message for a locator that matched nothing readable. */
    private notFoundFor(type: AnyContentType, locator: EntryLocator): string {
        return 'id' in locator
            ? `No published "${type.name}" entry with id "${locator.id}".`
            : `No published "${type.name}" entry in translation group "${locator.localeGroupId}" for the requested locale.`;
    }

    /**
     * One page of a single relation field's links — the only relation read that
     * `?relations=preview` cannot express, and therefore the only one with a
     * route of its own.
     */
    async relationField(
        type: AnyContentType,
        locator: EntryLocator,
        field: string,
        page: number,
        pageSize: number,
        workspaceId: string,
        grantedTypes: ReadonlySet<string>,
        locale?: string,
        visibility?: EntryVisibility
    ): Promise<PublicRelationFieldView> {
        const spec = type.fields[field];
        if (
            !spec ||
            spec.type !== CONTENT_FIELD_TYPE.Relation ||
            !spec.relation
        ) {
            throw new BadRequestException(
                `"${field}" is not a relation field on "${type.name}".`
            );
        }
        if (!grantedTypes.has(spec.relation.to().name)) {
            throw new BadRequestException(
                `"${field}" cannot be expanded — this workspace has no access to "${spec.relation.to().name}".`
            );
        }
        const row = await this.readableRow(
            type,
            locator,
            workspaceId,
            locale,
            visibility
        );
        const view = await this.relationLinks.readField(
            type,
            row,
            field,
            spec,
            page,
            pageSize,
            workspaceId,
            { publishedOnly: true }
        );
        const hydrated = await this.expansion.hydrateRelationViews(
            type,
            { [field]: view },
            workspaceId
        );
        return hydrated[field];
    }

    /** Every media field of one entry, resolved to asset metadata + URLs. */
    async mediaOf(
        type: AnyContentType,
        locator: EntryLocator,
        workspaceId: string,
        locale?: string,
        limit = DEFAULT_EXPANSION_LIMIT,
        visibility?: EntryVisibility
    ): Promise<Record<string, PublicMediaFieldView>> {
        const row = await this.readableRow(
            type,
            locator,
            workspaceId,
            locale,
            visibility
        );
        const fields = Object.entries(type.fields)
            .filter(([, spec]) => spec.type === CONTENT_FIELD_TYPE.Media)
            .map(([name]) => name);
        const media = await this.expansion.mediaForRows(
            type,
            fields,
            [row],
            workspaceId,
            limit
        );
        // Keyed by the row's OWN id, not by anything in the locator — a group
        // locator resolved to a row whose id the caller may never have seen.
        const out = media.get(row['id'] as string) ?? {};
        for (const field of fields) out[field] ??= { items: [], total: 0 };
        return out;
    }

    /**
     * The full row of one publicly readable entry, or a 404 — the shared
     * pre-step of the sibling routes, so `/relations/:field`, `/media`, and
     * `/translations` are exactly as invisible for a draft or foreign entry as
     * the entry read itself, in either addressing form.
     */
    private async readableRow(
        type: AnyContentType,
        locator: EntryLocator,
        workspaceId: string,
        locale?: string,
        visibility?: EntryVisibility
    ): Promise<Record<string, unknown>> {
        const [row] = await this.db
            .select()
            .from(type.table)
            .where(
                this.entryWhere(type, locator, workspaceId, locale, visibility)
            )
            .limit(1);
        if (!row) {
            throw new NotFoundException(this.notFoundFor(type, locator));
        }
        return row as Record<string, unknown>;
    }

    /**
     * Translate one `?filter=` payload — the same query-builder tree the admin
     * records list takes — against a surface derived from the type.
     *
     * Two departures from the admin's version, both deliberate:
     *
     * - **Grant-pruned.** `grantedTypes` is passed, so a relation whose target
     *   the workspace was never granted is omitted from the surface and a rule
     *   naming it 400s. Without it, `author.name eq "Ada"` would let a token
     *   infer relation data by watching which entries come back — data this API
     *   deliberately does not return. The admin's list leaves this unset on
     *   purpose (there it is a SQL whitelist, not a visibility boundary); here
     *   it is exactly a visibility boundary.
     * - **No `status`.** The read already forces `status = published`, so a
     *   `status` rule could only be a no-op or match nothing. Dropping it from
     *   the schema turns a confusingly empty page into a clear 400.
     *
     * Built lazily — the surface walks the type's whole relation graph to the
     * hop budget, so an unfiltered list (the common case) never pays for it.
     * A malformed filter throws `FilterException`, which is a 400.
     */
    private async filterPredicate(
        type: AnyContentType,
        filter: string | undefined,
        workspaceId: string,
        grantedTypes: ReadonlySet<string>
    ): Promise<SQL | undefined> {
        if (!filter) {
            return undefined;
        }
        const { schema } = buildEntryFilterSurface(type, {
            workspaceId,
            grantedTypes
        });
        if (schema.fields) {
            delete schema.fields['status'];
        }
        const tree = parseFilterTree(filter, schema);
        return applyFilterTree(tree, schema, type.table, this.db);
    }

    /**
     * The predicate every public read shares — the whole visibility rule in one
     * place. `and(undefined, …)` collapses the clauses a type doesn't have, so
     * a plain non-publishable, non-paranoid type reduces to the workspace scope.
     */
    private readableWhere(
        type: AnyContentType,
        workspaceId: string,
        locale: string | undefined,
        visibility: EntryVisibility = 'published'
    ): SQL | undefined {
        return and(
            this.liveWhere(type, workspaceId, visibility),
            // No-op for types the extension doesn't apply to; for an i18n type
            // it scopes to the requested locale (rejecting an unknown one).
            this.extension?.listScope(type, workspaceId, { locale })
        );
    }

    /**
     * The locale-**independent** half of {@link readableWhere}: workspace,
     * published-only, not soft-deleted. Split out for the one read that must
     * span locales — a translation lookup, whose whole job is to find the rows
     * `listScope` would have filtered away — so that read narrows the entry
     * visibility rule in exactly one respect and inherits the rest verbatim.
     */
    private liveWhere(
        type: AnyContentType,
        workspaceId: string,
        visibility: EntryVisibility = 'published'
    ): SQL | undefined {
        const table = type.table as unknown as ContentTable;
        return and(
            eq(table['workspaceId'], workspaceId),
            this.statusWhere(type, visibility),
            type.paranoid ? isNull(table['deletedAt']) : undefined,
            ...this.readScopeWhere(type, workspaceId)
        );
    }

    /**
     * The fragments contributed by the bound `CONTENT_READ_SCOPE` providers.
     *
     * Applied here, in {@link liveWhere}, rather than in `readableWhere`: this
     * is the clause every public read shares — the list, the single-entry read
     * and the translation lookup that deliberately steps around the locale
     * scope all pass through it — so a scope cannot be missed by a read that
     * chose the narrower helper. AND-ed like everything else around them, which
     * is what makes a scope structurally incapable of widening a read.
     */
    private readScopeWhere(
        type: AnyContentType,
        workspaceId: string
    ): (SQL | undefined)[] {
        return this.readScopes?.fragments({ type, workspaceId }) ?? [];
    }

    /**
     * The publish-state clause. `published` — the default and everything a
     * read-only token can ask for — is the API's headline rule; the other two
     * exist so a write-scoped token can read back what it just created.
     *
     * A non-publishable type has no `status` column and every row is simply
     * live, so this is a no-op there rather than an error: the caller asked for
     * a distinction the type does not make.
     */
    private statusWhere(
        type: AnyContentType,
        visibility: EntryVisibility
    ): SQL | undefined {
        if (!type.publishable || visibility === 'any') {
            return undefined;
        }
        const table = type.table as unknown as ContentTable;
        return eq(
            table['status'],
            visibility === 'draft' ? ENTRY_STATUS.Draft : ENTRY_STATUS.Published
        );
    }

    /**
     * Translate `?sort=` (`col` ascending, `-col` descending) into an ORDER BY,
     * always with an `id` tiebreaker so paging is stable across requests.
     * Sortable = the envelope timestamps, `publishedAt` (publishable types),
     * `locale` (i18n types), and the type's **scalar** fields — the same
     * whitelist rule the admin list uses, so a sort key never reaches
     * `asc(undefined)`. Unknown or excluded keys fall back to newest-updated.
     */
    private orderBy(type: AnyContentType, sort: string | undefined): SQL[] {
        const table = type.table as unknown as ContentTable;
        const sortable = new Set<string>([
            'createdAt',
            'updatedAt',
            ...(type.publishable ? ['publishedAt'] : []),
            ...(type.i18n ? ['locale'] : []),
            ...Object.entries(type.fields)
                .filter(([, spec]) => isScalarField(spec))
                .map(([name]) => name)
        ]);
        const isDesc = !!sort && sort.startsWith('-');
        const columnId = sort ? (isDesc ? sort.slice(1) : sort) : '';
        const column = sortable.has(columnId) ? table[columnId] : undefined;
        if (column) {
            return [isDesc ? desc(column) : asc(column), asc(table['id'])];
        }
        return [desc(table['updatedAt']), asc(table['id'])];
    }
}
