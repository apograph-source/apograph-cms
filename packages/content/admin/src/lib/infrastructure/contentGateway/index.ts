import type {
    BulkActionResult,
    BulkPublishPreview,
    BulkPublishResult,
    ContentType,
    ContentTypeDetail,
    EntryRecord,
    MediaRef,
    RelationDelta,
    RelationFieldView,
    RevisionDetail,
    RevisionListView,
    WireFilterField
} from '../../domain/types/contentType';
import type { ContentEntriesParams } from '../contentKeys';

/** The paginated records envelope, matching the admin list-page convention. */
export type ContentEntriesResult = {
    items: EntryRecord[];
    total: number;
    page: number;
    pageSize: number;
};

/** A single page of a relation type's entries, as served by the list endpoint. */
export type RelationCandidatesPage = {
    items: EntryRecord[];
    /** Total matches across the whole (filtered) set, not just what's loaded. */
    total: number;
};

/** Params for one candidate page — the picker's search + serialized filter. */
export type RelationCandidatesPageParams = {
    /** Free-text search across the record's string values. */
    search: string;
    /** The serialized `?filter=` wire JSON, or null when no rules are set. */
    filter: string | null;
    /** 1-based offset page. */
    page: number;
    /** Slot-contributed list params (e.g. locale scoping), forwarded verbatim. */
    extra: Record<string, string>;
};

/** What a save submits: the field values, staged relation deltas, and the id. */
export type SaveEntryInput = {
    /** Present for an update; absent for a create. */
    id?: string;
    /** The field values to persist, keyed by field name. */
    values: Record<string, unknown>;
    /**
     * Staged per-field relation deltas (many/inverse relations) — the editor's
     * local link/unlink/reorder, applied with the save in one transaction. Only
     * non-empty fields are included; single relations ride in `values`.
     */
    relations?: Record<string, RelationDelta>;
    /**
     * Slot-contributed body params (e.g. the `locale` a create targets, from the
     * entry-params slot), merged into the **create** body verbatim. Each key must
     * be declared on the server's `SaveEntryDto`. Ignored on update.
     */
    extra?: Record<string, string>;
    /**
     * State a **different plugin** owns about this entry, keyed by its extension
     * key — sent in the save body's `extensions` bag, on create **and** update.
     * `@orthacms/segments-admin` puts the entry's audiences there.
     *
     * Unlike {@link extra} this is not create-only, because it is not an
     * envelope param: it is the plugin's own state, which an edit changes as
     * readily as a create sets it. It rides the save rather than a request of
     * its own so the entry, the plugin's state, and the revision recording both
     * commit in one transaction — see content-server's entry-write extension
     * port.
     */
    extensions?: Record<string, unknown>;
};

/**
 * The port over the remote content API — the single seam the admin's application
 * hooks talk to instead of `apiClient` directly. Every method returns the admin's
 * models (mapped where the wire diverges) and normalizes every failure to
 * `ApiError`, so the hooks and presentation stay off the transport. Requests are
 * implicitly workspace-scoped via `apiClient`'s ambient `X-Workspace-Id` header;
 * the caches, not the gateway, key on the workspace id.
 * {@link httpContentGateway} is the HTTP implementation.
 */
export type ContentGateway = {
    /** Lists every code-defined content type via `GET /content-schema`. */
    listTypes(): Promise<ContentType[]>;
    /** Loads one type's full field schema via `GET /content-schema/:name`. */
    getSchema(name: string): Promise<ContentTypeDetail>;
    /**
     * Loads the type's filterable surface via
     * `GET /content-schema/:name/filter-fields` — every scalar path the query
     * builder may filter on, including recursive relation paths. Served by the
     * same traversal that builds the SQL whitelist, so the picker can't offer a
     * path the API rejects.
     */
    listFilterFields(name: string): Promise<WireFilterField[]>;
    /** Loads one page of a collection's records via `GET /content/:name`. */
    listEntries(
        name: string,
        params: ContentEntriesParams
    ): Promise<ContentEntriesResult>;
    /** Loads one entry via `GET /content/:name/:id`. */
    getEntry(name: string, id: string): Promise<EntryRecord>;
    /** Loads all of an entry's relation links via `GET /content/:name/:id/relations`. */
    getEntryRelations(
        name: string,
        id: string
    ): Promise<Record<string, RelationFieldView>>;
    /** Loads an entry's media fields resolved to refs via `GET …/:id/media`. */
    getEntryMedia(
        name: string,
        id: string
    ): Promise<Record<string, MediaRef[]>>;
    /** Loads one relation field's link page via `GET …/relations/:field`. */
    getRelationField(
        name: string,
        id: string,
        field: string,
        page: number
    ): Promise<RelationFieldView>;
    /** Loads one candidate page of a relation's target type via `GET /content/:type`. */
    listRelationCandidates(
        targetName: string,
        params: RelationCandidatesPageParams
    ): Promise<RelationCandidatesPage>;
    /** Creates or updates one entry via `POST`/`PATCH /content/:name(/:id)`. */
    saveEntry(name: string, input: SaveEntryInput): Promise<EntryRecord>;
    /** Lists one entry's revision timeline via `GET …/:id/revisions`. */
    listRevisions(name: string, id: string): Promise<RevisionListView>;
    /** Loads one revision + snapshot via `GET …/:id/revisions/:number`. */
    getRevision(
        name: string,
        id: string,
        number: number
    ): Promise<RevisionDetail>;
    /** Restores an entry to a revision via `POST …/:id/revisions/:number/restore`. */
    restoreRevision(
        name: string,
        id: string,
        number: number
    ): Promise<EntryRecord>;
    /** Publishes a specific version live via `POST …/:id/revisions/:number/publish`. */
    publishRevision(
        name: string,
        id: string,
        number: number
    ): Promise<EntryRecord>;
    /**
     * Publishes one entry via `POST /content/:name/:id/publish`. `bypass` is
     * forwarded for a registered publish guard to judge — this package does not
     * interpret it, exactly as the server's own use-case does not.
     */
    publish(
        name: string,
        id: string,
        options?: { bypass?: boolean }
    ): Promise<EntryRecord>;
    /** Unpublishes one entry via `POST /content/:name/:id/unpublish`. */
    unpublish(name: string, id: string): Promise<EntryRecord>;
    /** Soft-deletes one entry via `DELETE /content/:name/:id`. */
    remove(name: string, id: string): Promise<void>;
    /** Restores one entry via `POST /content/:name/:id/restore`. */
    restore(name: string, id: string): Promise<EntryRecord>;
    /** Permanently purges one entry via `DELETE /content/:name/:id/permanent`. */
    purge(name: string, id: string): Promise<void>;
    /** Dry-runs a bulk publish via `POST /content/:name/bulk/publish/preview`. */
    bulkPreviewPublish(
        name: string,
        ids: string[]
    ): Promise<BulkPublishPreview>;
    /** Commits a bulk publish via `POST /content/:name/bulk/publish`. */
    bulkPublish(name: string, ids: string[]): Promise<BulkPublishResult>;
    /** Bulk unpublish via `POST /content/:name/bulk/unpublish`. */
    bulkUnpublish(name: string, ids: string[]): Promise<BulkActionResult>;
    /** Bulk soft-delete via `POST /content/:name/bulk/delete`. */
    bulkRemove(name: string, ids: string[]): Promise<BulkActionResult>;
    /** Bulk restore via `POST /content/:name/bulk/restore`. */
    bulkRestore(name: string, ids: string[]): Promise<BulkActionResult>;
    /** Bulk purge via `POST /content/:name/bulk/purge`. */
    bulkPurge(name: string, ids: string[]): Promise<BulkActionResult>;
};
