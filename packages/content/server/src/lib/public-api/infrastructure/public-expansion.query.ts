import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import {
    and,
    eq,
    inArray,
    isNull,
    type AnyColumn,
    type SQL
} from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { toMediaValueRef, type MediaValueRef } from '@orthacms/content-domain';
import { ENTRY_STATUS, type AnyContentType } from '../../types/content-type';
import { CONTENT_FIELD_TYPE, type AnyFieldSpec } from '../../types/fields';
import {
    InjectMediaAssetResolver,
    type MediaAssetResolver
} from '../../extension/media-asset-resolver';
import { ContentReadScopeRegistry } from '../../extension/read-scope';
import { RelationLinkService } from '../../entries/infrastructure/persistence/relation-link.service';
import { DEFAULT_EXPANSION_LIMIT } from '../http/dto/public-list-entries-query.dto';
import type {
    PublicMediaFieldView,
    PublicMediaRef,
    PublicRelationFieldView
} from '../types/public-expansion';
import type { PublicEntry } from '../types/public-entry';
import { toPublicEntry } from './public-entry-row';

/** A generated content row seen as a bag of values by property name. */
type Row = Record<string, unknown>;

/** A generated content table seen as a bag of columns by property name. */
type ContentTable = Record<string, AnyColumn>;

/**
 * Upper bound on how many fields one request may expand, per kind. The cost of
 * a preview scales with the number of **fields**, not rows (each relation field
 * is one or two queries spanning the whole page), so this is the knob that
 * actually bounds a request — the admin caps only the raw string length, which
 * on a public endpoint would leave a type with a dozen relations open to a
 * request asking for all of them.
 */
export const MAX_EXPANDED_FIELDS = 10;

/**
 * Route prefix the public API reports for an asset's bytes.
 *
 * The `MEDIA_ASSET_RESOLVER` hands back the **admin's** URLs, which derive their
 * scope from the caller's workspace *membership* — something a token does not
 * have, so a bearer got a 404 on every one of them. Media-server's
 * `/api/v1/media` sibling derives the same scope from the token's resolved
 * workspace instead, so these are the URLs a public consumer can actually fetch,
 * with the very token it already holds.
 *
 * A literal rather than an import: content-server does not depend on
 * media-server (the dependency runs the other way — media binds content's
 * resolver port), so this package cannot ask for the route. It mirrors the
 * default `publicBasePath` the media config already hardcodes.
 */
const PUBLIC_MEDIA_BASE_PATH = '/api/v1/media/assets';

/**
 * Rewrites a track's admin URL to the public one.
 *
 * The resolver builds `/api/media/assets/<id>/raw`, whose scope comes from the
 * caller's workspace **membership** — which a bearer token does not have. The
 * id is the only part worth keeping, so it is lifted out and re-addressed
 * against the public base, same as {@link publicAssetUrl} does for the asset
 * itself. A src that does not match is passed through: an unexpected shape is
 * better published as-is than silently rewritten to a 404.
 */
function publicTrackUrl(src: string): string {
    const id = /\/assets\/([^/]+)\/raw/.exec(src)?.[1];
    return id ? publicAssetUrl(id) : src;
}

/** The public download URL for one asset, optionally a generated derivative. */
function publicAssetUrl(id: string, variant?: 'thumb' | 'preview'): string {
    const base = `${PUBLIC_MEDIA_BASE_PATH}/${id}/raw`;
    return variant ? `${base}?variant=${variant}` : base;
}

/**
 * Resolves the public API's opt-in **relation** and **media** expansions for a
 * page of entries.
 *
 * Both are batched across the whole page — one bounded set of queries per
 * *field*, never one per row. Relations delegate to
 * `RelationLinkService.previewForEntries` (windowed `row_number()` for the cap,
 * `count(*) over` for the total, batched title resolution). Media deliberately
 * does **not** reuse `MediaRefsQuery.forValues`: that method takes one entry's
 * values, so calling it per row would be exactly the N+1 the relation preview
 * was built to avoid. Instead every media id on the page is collected and
 * resolved in a single batched lookup.
 */
@Injectable()
export class PublicExpansionQuery {
    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly relationLinks: RelationLinkService,
        @Optional()
        @InjectMediaAssetResolver()
        private readonly media?: MediaAssetResolver,
        // Read-scope providers, consulted per **hop**: a reader allowed to see
        // an entry is not thereby allowed to see everything it points at, and
        // an expansion that skipped this would be a way around the scope.
        @Optional()
        private readonly readScopes?: ContentReadScopeRegistry
    ) {}

    /**
     * The read-scope fragments for one hop's target type.
     *
     * The target is a different content type from the one the request named, so
     * the scope is asked about **it** — a scope keyed to the requested type
     * would leave every relation target unguarded.
     */
    private readScopeWhere(
        type: AnyContentType,
        workspaceId: string
    ): (SQL | undefined)[] {
        return this.readScopes?.fragments({ type, workspaceId }) ?? [];
    }

    /**
     * Validate a `?relationFields=` list: every name must be a relation field
     * on the type, and its target must be a content type the workspace was
     * granted. An ungranted target is a **400**, matching how `?filter=` treats
     * a traversal into one — a public caller should not be able to expand into
     * content the workspace does not expose, and saying so beats silently
     * returning an empty field.
     */
    parseRelationFields(
        type: AnyContentType,
        raw: string | undefined,
        granted: ReadonlySet<string>
    ): string[] {
        if (!raw?.trim()) {
            // No list given: expand everything expandable. An ungranted target
            // is skipped rather than refused — the caller didn't name it, so
            // there is nothing to correct them about, and this matches what the
            // `/relations` sibling route returns.
            return this.allFieldsOfKind(
                type,
                'relationFields',
                (spec) =>
                    spec.type === CONTENT_FIELD_TYPE.Relation &&
                    !!spec.relation &&
                    granted.has(spec.relation.to().name)
            );
        }
        return this.parseFields(type, raw, 'relationFields', (name, spec) => {
            if (spec.type !== CONTENT_FIELD_TYPE.Relation || !spec.relation) {
                throw new BadRequestException(
                    `relationFields: "${name}" is not a relation field on "${type.name}".`
                );
            }
            const target = spec.relation.to();
            if (!granted.has(target.name)) {
                throw new BadRequestException(
                    `relationFields: "${name}" cannot be expanded — this workspace has no access to "${target.name}".`
                );
            }
        });
    }

    /** Validate a `?mediaFields=` list: every name must be a media field. */
    parseMediaFields(type: AnyContentType, raw: string | undefined): string[] {
        if (!raw?.trim()) {
            return this.allFieldsOfKind(
                type,
                'mediaFields',
                (spec) => spec.type === CONTENT_FIELD_TYPE.Media
            );
        }
        return this.parseFields(type, raw, 'mediaFields', (name, spec) => {
            if (spec.type !== CONTENT_FIELD_TYPE.Media) {
                throw new BadRequestException(
                    `mediaFields: "${name}" is not a media field on "${type.name}".`
                );
            }
        });
    }

    /**
     * One capped page of links per requested relation field, for every row on
     * the page, keyed by entry id.
     *
     * `publishedOnly` is the public difference: a draft target — or one a bound
     * read scope hides from this reader — is neither shown **nor counted**, so
     * `total` is the number of links this caller can actually reach. Counting
     * them would leak the cardinality of what is hidden: "5 links, 2 visible"
     * says three restricted records exist here.
     */
    async relationsForRows(
        type: AnyContentType,
        fields: string[],
        rows: Row[],
        workspaceId: string,
        limit = DEFAULT_EXPANSION_LIMIT
    ): Promise<Map<string, Record<string, PublicRelationFieldView>>> {
        const out = new Map<string, Record<string, PublicRelationFieldView>>();
        if (!fields.length || !rows.length) {
            return out;
        }
        const previews = await this.relationLinks.previewForEntries(
            type,
            fields,
            rows,
            workspaceId,
            limit,
            { publishedOnly: true }
        );
        // The preview yields ordered link ids; hydrate them into full entries
        // with one batched read per distinct TARGET TYPE, so a page costs a
        // query per type rather than per link.
        const entriesById = await this.linkedEntriesById(
            type,
            fields,
            previews,
            workspaceId
        );
        for (const [entryId, byField] of previews) {
            const view: Record<string, PublicRelationFieldView> = {};
            for (const [field, value] of Object.entries(byField)) {
                const linked = entriesById.get(field);
                view[field] = {
                    // Preserve the preview's link order. Nothing should drop
                    // here any more — `previewForEntries` applies the same
                    // visibility (published-only **and** the bound read scopes)
                    // inside its window, so an unreachable target is already
                    // out of both `items` and `total`. The filter stays as a
                    // belt: a hydration miss must never leave a hole in the
                    // array, and it is cheap to keep honest.
                    items: value.items
                        .map((ref) => linked?.get(ref.id))
                        .filter((entry): entry is PublicEntry => !!entry),
                    total: value.total
                };
            }
            out.set(entryId, view);
        }
        return out;
    }

    /**
     * Hydrate already-read link views (the `/relations` sibling routes' output
     * from `readAll` / `readField`) into the same full-entry shape the list
     * preview returns, so both surfaces speak one contract.
     */
    async hydrateRelationViews(
        type: AnyContentType,
        views: Record<string, { items: { id: string }[]; total: number }>,
        workspaceId: string
    ): Promise<Record<string, PublicRelationFieldView>> {
        const fields = Object.keys(views);
        const linked = await this.linkedEntriesById(
            type,
            fields,
            new Map([['one', views]]),
            workspaceId
        );
        const out: Record<string, PublicRelationFieldView> = {};
        for (const [field, view] of Object.entries(views)) {
            const byId = linked.get(field);
            out[field] = {
                items: view.items
                    .map((ref) => byId?.get(ref.id))
                    .filter((entry): entry is PublicEntry => !!entry),
                total: view.total
            };
        }
        return out;
    }

    /**
     * Load every linked entry named by a preview, keyed by field and then by
     * id. One `IN (…)` read per relation field's target type, projected through
     * the same {@link toPublicEntry} the entry routes use — so a linked record
     * has exactly the shape a consumer already handles.
     *
     * Linked entries are returned **unexpanded**: nothing here recurses, which
     * is what bounds a request to one level of the graph.
     */
    private async linkedEntriesById(
        type: AnyContentType,
        fields: string[],
        previews: Map<string, Record<string, { items: { id: string }[] }>>,
        workspaceId: string
    ): Promise<Map<string, Map<string, PublicEntry>>> {
        const idsByField = new Map<string, Set<string>>();
        for (const byField of previews.values()) {
            for (const [field, value] of Object.entries(byField)) {
                let ids = idsByField.get(field);
                if (!ids) {
                    ids = new Set<string>();
                    idsByField.set(field, ids);
                }
                for (const ref of value.items) ids.add(ref.id);
            }
        }

        const out = new Map<string, Map<string, PublicEntry>>();
        await Promise.all(
            fields.map(async (field) => {
                const ids = idsByField.get(field);
                const target = type.fields[field]?.relation?.to();
                if (!target || !ids?.size) return;
                const cols = target.table as unknown as ContentTable;
                const rows = (await this.db
                    .select()
                    .from(target.table)
                    .where(
                        and(
                            inArray(cols['id'], [...ids]),
                            eq(cols['workspaceId'], workspaceId),
                            target.publishable
                                ? eq(cols['status'], ENTRY_STATUS.Published)
                                : undefined,
                            target.paranoid
                                ? isNull(cols['deletedAt'])
                                : undefined,
                            ...this.readScopeWhere(target, workspaceId)
                        )
                    )) as Row[];
                out.set(
                    field,
                    new Map(
                        rows.map((row) => [
                            row['id'] as string,
                            toPublicEntry(target, row)
                        ])
                    )
                );
            })
        );
        return out;
    }

    /**
     * The assets of each requested media field, for every row on the page,
     * keyed by entry id. One batched resolver lookup for the whole page.
     *
     * A no-op when no media plugin is registered (nothing binds the resolver),
     * exactly like the admin's media read — content boots without media.
     */
    async mediaForRows(
        type: AnyContentType,
        fields: string[],
        rows: Row[],
        workspaceId: string,
        limit = DEFAULT_EXPANSION_LIMIT
    ): Promise<Map<string, Record<string, PublicMediaFieldView>>> {
        const out = new Map<string, Record<string, PublicMediaFieldView>>();
        if (!this.media || !fields.length || !rows.length) {
            return out;
        }

        // Collect every id on the page first, so the resolver is hit once.
        // Refs rather than ids: a media value carries a per-usage `alt` and a
        // `decorative` flag since `ORT-83`, and those are what a public consumer
        // needs to emit a correct `<img alt>` — the asset row's own description
        // is only the fallback.
        const idsByRowField = new Map<string, Map<string, MediaValueRef[]>>();
        const all = new Set<string>();
        for (const row of rows) {
            const entryId = row['id'];
            if (typeof entryId !== 'string') continue;
            const byField = new Map<string, MediaValueRef[]>();
            for (const field of fields) {
                const refs = mediaRefsOf(row[field]);
                if (!refs.length) continue;
                byField.set(field, refs);
                for (const ref of refs) all.add(ref.id);
            }
            idsByRowField.set(entryId, byField);
        }
        if (!all.size) {
            return out;
        }

        const resolved = await this.media.resolve([...all], workspaceId);
        for (const [entryId, byField] of idsByRowField) {
            const view: Record<string, PublicMediaFieldView> = {};
            for (const [field, refs] of byField) {
                // An id the resolver didn't return names an asset that is gone
                // or lives in another workspace. The admin keeps it as a
                // `missing` placeholder to preserve ordering in an editor; a
                // public read has no such need and simply omits it, so every
                // ref it returns is a real asset.
                const present = refs
                    .map((ref) => {
                        const asset = resolved.get(ref.id);
                        return asset ? { ref, asset } : null;
                    })
                    .filter(
                        (pair): pair is NonNullable<typeof pair> =>
                            pair !== null
                    );
                // `total` counts every asset actually attached, before the
                // limit — so a lowered limit is visible as `items.length <
                // total` rather than silently passing off a slice as the whole.
                const items = present.slice(0, limit).map(
                    ({ ref, asset }): PublicMediaRef => ({
                        id: asset.id,
                        name: asset.name,
                        // The resolver's own URLs are the admin's; rewrite to
                        // the token-fetchable route. Presence of a derivative is
                        // still read from the resolver — it is what knows
                        // whether one was generated — but the address is ours.
                        url: publicAssetUrl(asset.id),
                        ...(asset.thumbUrl
                            ? { thumbUrl: publicAssetUrl(asset.id, 'thumb') }
                            : {}),
                        ...(asset.previewUrl
                            ? {
                                  previewUrl: publicAssetUrl(
                                      asset.id,
                                      'preview'
                                  )
                              }
                            : {}),
                        kind: asset.kind,
                        mimeType: asset.mimeType,
                        alt: publicAlt(ref, asset.alt),
                        // Rewritten to the token-fetchable route, exactly like
                        // `url` above: the resolver hands back the admin's
                        // addresses, which a bearer cannot reach (`ORT-92`).
                        tracks: asset.tracks.map((track) => ({
                            kind: track.kind,
                            srclang: track.srclang,
                            label: track.label,
                            src: publicTrackUrl(track.src),
                            ...(track.default ? { default: true } : {})
                        })),
                        ...(ref.decorative === true
                            ? { decorative: true as const }
                            : {})
                    })
                );
                view[field] = { items, total: present.length };
            }
            out.set(entryId, view);
        }
        return out;
    }

    /**
     * Every field of one kind — what `?relations=preview` / `?media=preview`
     * expand when the caller names no fields.
     *
     * A type with more expandable fields than the cap is a **400** telling the
     * caller to name the ones they want, rather than a silently truncated
     * response: quietly dropping fields would read as "this entry has no
     * links" and be near-impossible to notice.
     */
    private allFieldsOfKind(
        type: AnyContentType,
        param: string,
        matches: (spec: AnyFieldSpec) => boolean
    ): string[] {
        const names = Object.entries(type.fields)
            .filter(([, spec]) => matches(spec))
            .map(([name]) => name);
        if (names.length > MAX_EXPANDED_FIELDS) {
            throw new BadRequestException(
                `${param}: "${type.name}" has ${names.length} expandable fields, more than the ${MAX_EXPANDED_FIELDS} a single request may expand — name the ones you need with \`${param}\`.`
            );
        }
        return names;
    }

    /** Shared parse: split, trim, de-duplicate, bound, then per-kind checks. */
    private parseFields(
        type: AnyContentType,
        raw: string | undefined,
        param: string,
        check: (name: string, spec: AnyFieldSpec) => void
    ): string[] {
        if (!raw) return [];
        const names = [
            ...new Set(
                raw
                    .split(',')
                    .map((name) => name.trim())
                    .filter(Boolean)
            )
        ];
        if (names.length > MAX_EXPANDED_FIELDS) {
            throw new BadRequestException(
                `${param}: at most ${MAX_EXPANDED_FIELDS} fields may be expanded per request.`
            );
        }
        for (const name of names) {
            const spec = type.fields[name];
            if (!spec) {
                throw new BadRequestException(
                    `${param}: unknown field "${name}" on "${type.name}".`
                );
            }
            check(name, spec);
        }
        return names;
    }
}

/** The asset ids stored in a media field — one id, or an ordered list. */
function mediaRefsOf(value: unknown): MediaValueRef[] {
    return (Array.isArray(value) ? value : [value])
        .map(toMediaValueRef)
        .filter((ref): ref is MediaValueRef => ref !== null && !!ref.id);
}

/**
 * The alt text a public consumer should render for one usage.
 *
 * `decorative` resolves to `''` — the value an `<img alt="">` needs to be
 * skipped by a screen reader, which is a different claim from omitting the
 * attribute. A per-usage `alt` otherwise overrides the asset row's default,
 * because alt text is per usage: the same logo is "Acme logo" in a header and
 * decorative in a footer strip (`ORT-83`).
 */
function publicAlt(ref: MediaValueRef, assetAlt: string | null): string | null {
    if (ref.decorative === true) return '';
    if (typeof ref.alt === 'string' && ref.alt.trim() !== '') return ref.alt;
    return assetAlt;
}
