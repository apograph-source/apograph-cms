import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
    Optional,
    UnprocessableEntityException
} from '@nestjs/common';
import {
    and,
    eq,
    getTableName,
    inArray,
    isNotNull,
    isNull,
    type AnyColumn,
    type SQL
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
    attachActor,
    EVENT_ACTOR_TYPE,
    InjectDatabase,
    OutboxWriter,
    UnitOfWork,
    type Database,
    type DomainEvent,
    type EventActor
} from '@orthacms/database';
import { lockWorkspaceShared } from '@orthacms/workspaces-server';
import {
    isForeignKeyViolation,
    violatedConstraint
} from '@orthacms/utils-server';
import { mediaValueIds } from '@orthacms/content-domain';
import {
    CONTENT_ENTRY_EXTENSION,
    type ContentEntryExtension
} from '../../../extension/entry-extension';
import {
    InjectMediaAssetResolver,
    type MediaAssetResolver
} from '../../../extension/media-asset-resolver';
import { EntryWriteExtensionRegistry } from '../../../extension/entry-write-extension';
import { acceptsAsset, describeAccept } from './media-accept';
import type { AnyContentType } from '../../../types/content-type';
import { ENTRY_STATUS } from '../../../types/content-type';
import { CONTENT_FIELD_TYPE } from '../../../types/fields';
import {
    EntryValidationService,
    type ValidationIssue
} from '../../../validation/services/entry-validation.service';
import type {
    EntryRecord,
    RelationDelta,
    RelationFieldView
} from '../../types/entry-list-view';
import type { BulkActionResult } from '../../types/bulk-publish';
import { snakeCase } from '../../../collection/table-builder';
import { coerceValues, entryTitle, toColumns, toRecord } from './entry-row';
import {
    assertSameLocale,
    RelationLinkService,
    type DbTransaction
} from './relation-link.service';
import {
    InjectRevisionStore,
    type RevisionStore
} from '../../../revisions/application/ports/revision-store';
import {
    entryCreated,
    entryDeleted,
    entryPurged,
    entryRestored,
    entryUpdated,
    type EntrySubject
} from '../../domain/events/entry-events';
import { Revision } from '../../../revisions/domain/revision';
import { buildSnapshot } from '../../../revisions/infrastructure/persistence/revision-snapshot';

/** A generated content table seen as a bag of values / columns by property name. */
type Row = Record<string, unknown>;

/**
 * RFC-4122 uuid, matched case-insensitively.
 *
 * A relation id that isn't one must be rejected **before** it reaches the
 * existence probe: `inArray(<uuid column>, ['not-a-uuid'])` is a Postgres cast
 * error, i.e. a 500 on ordinary bad input. The relation-*delta* path has been
 * shape-checked at the DTO since it was written; a single relation's FK arrives
 * inside the free-form `values` bag, which no decorator can reach, so the guard
 * has to live here.
 */
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The infrastructure persistence engine for entry writes — create / read-one /
 * update / delete / restore / purge, plus their bulk variants, plus the small
 * status read/write primitives the **publish-lifecycle use-cases** compose
 * (`findLive`, `markPublished`/`markDraft`, the bulk selectors, and
 * `requiredRelationIssues`). Generic over the content type (like
 * {@link EntriesService}): the physical table and its envelope columns are
 * derived from `type` at request time, so one engine backs every collection.
 *
 * Layering note (ADR-0003): the entries engine is generic and registry-driven —
 * one service backs every content type, with no per-aggregate table — so the
 * heavy, battle-tested column/relation/extension persistence stays here as
 * infrastructure rather than being forced into a row⇄aggregate mapper. The
 * publish **lifecycle** (the part with real invariants) is modelled by the
 * `Entry` domain object and driven by application use-cases, which call the
 * status primitives below through the {@link UnitOfWork} so the write and its
 * outbox events commit atomically. {@link EntryValidationService} remains the
 * gate — nothing is written or published without passing it.
 */
@Injectable()
export class EntryWriterService {
    constructor(
        @InjectDatabase() private readonly db: Database,
        // The transaction boundary every write now runs inside, and the outbox
        // that joins it. Together they are what makes an entry's domain event
        // commit with — and never without — the row it describes.
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly validation: EntryValidationService,
        private readonly relations: RelationLinkService,
        // The generic revision store — every save appends an immutable snapshot
        // inside the same transaction, so the version and the write commit as one.
        @InjectRevisionStore()
        private readonly revisionStore: RevisionStore,
        // Every bound entry-write extension (segments' reader entitlements
        // today) — state another plugin owns *about* the entry, written on this
        // save's transaction and captured by its revision. A registry rather
        // than a token because Nest cannot merge two bindings of one token, and
        // an extension that silently stopped being called would silently stop
        // restricting content.
        private readonly writeExtensions: EntryWriteExtensionRegistry,
        // The entries extension port (e.g. the i18n plugin's locale stamping
        // and sibling sync) — absent unless a plugin binds it, hence optional.
        @Optional()
        @Inject(CONTENT_ENTRY_EXTENSION)
        private readonly extension?: ContentEntryExtension,
        // The media-asset resolver — bound by the media plugin so a media field's
        // ids can be checked for existence + `accept` in the workspace. Absent
        // when media isn't registered, in which case media fields shape-validate
        // and store only (no existence/restriction check).
        @Optional()
        @InjectMediaAssetResolver()
        private readonly mediaResolver?: MediaAssetResolver
    ) {}

    /**
     * The active unit-of-work transaction, typed as the handle drizzle hands a
     * `db.transaction` callback.
     *
     * `UnitOfWork` stores exactly that object and publishes it as `Database`,
     * because most callers only need the query surface — while this file's
     * helpers, `RelationLinkService`, and the `CONTENT_ENTRY_EXTENSION` port are
     * all typed against the transaction handle. Only ever called from inside
     * `uow.run(...)`, where the two are the same object.
     */
    private tx(): DbTransaction {
        return this.uow.current() as unknown as DbTransaction;
    }

    /**
     * One event per affected row, built from each row's own id **and the row
     * itself** — the latter because an entry event carries a frozen `title`
     * snapshot, and a title is per row rather than per batch.
     */
    private eventsFor(
        rows: readonly Row[],
        build: (id: string, row: Row) => DomainEvent
    ): DomainEvent[] {
        return rows.map((row) => build(row['id'] as string, row));
    }

    /**
     * What an entry event says about its subject: the type, the workspace, and
     * a **frozen** human label read off the row being written.
     *
     * Frozen rather than looked up, for the same reason `actor_email` is: the
     * audit row has to outlive its subject. `entry.purged` destroys the only
     * other copy of the name, so a row that stored just the uuid could never
     * answer "what did they delete" — not even in principle.
     */
    private subjectOf(
        type: AnyContentType,
        workspaceId: string,
        row?: Row
    ): EntrySubject {
        return {
            contentType: type.name,
            workspaceId,
            title: row ? entryTitle(type, row) : null
        };
    }

    /**
     * Append `events` to the transactional outbox, stamped with the acting
     * principal, from inside the active unit of work.
     *
     * A **token** may be the actor here, and that is the whole difference from
     * {@link revisionActorId} below: the audit row now carries an `actor_type`,
     * so naming a credential is a fact rather than a misused user column. A
     * write made with a bearer token used to reach the log as "System", which
     * left every write over the public REST API, GraphQL and MCP unattributable
     * to the credential that made it.
     */
    private async emit(
        events: readonly DomainEvent[],
        actor?: EventActor | null
    ): Promise<void> {
        if (events.length === 0) return;
        const stamped = [...events];
        await this.outbox.append(actor ? attachActor(stamped, actor) : stamped);
    }

    /**
     * The declared fields whose stored value differs between two rows — what
     * `entry.updated` reports, and the test for whether it is raised at all.
     *
     * Compared by JSON shape rather than identity so a jsonb field (`json`,
     * `multiselect`, a media array) is judged on content, and only over
     * `type.fields`: the envelope columns a save always rewrites
     * (`updated_at`, and `status` on a publishable type) are not editorial
     * changes and would make every save look like one.
     */
    private changedFields(
        type: AnyContentType,
        before: Row | undefined,
        after: Row
    ): string[] {
        if (!before) return Object.keys(type.fields);
        return Object.keys(type.fields).filter(
            (name) =>
                JSON.stringify(before[name] ?? null) !==
                JSON.stringify(after[name] ?? null)
        );
    }

    /**
     * Fold any `relations: { <singleField>: { set } }` entries into the values
     * bag, resolving `by: "localeGroup"` on the way, and return the deltas with
     * those fields removed.
     *
     * Done **before** the write rather than alongside the link deltas, because a
     * single relation is a column on the row itself: routing it through `values`
     * means the row is written once, and the resolved id then passes through
     * `assertRelationTargets` — existence, workspace, and the same-locale rule —
     * with no second implementation of any of them.
     *
     * The field must not appear in both bags. One of the two would have to win
     * silently, and a caller who set it twice does not know which they meant.
     * Reads the **raw** submitted values for that test — `coerceValues` stamps
     * every declared field, so after coercion every field is "present".
     */
    private async foldSingleRelationSets(
        type: AnyContentType,
        values: Record<string, unknown>,
        relations: Record<string, RelationDelta> | undefined,
        workspaceId: string,
        sourceLocale: string | undefined
    ): Promise<{
        values: Record<string, unknown>;
        relations?: Record<string, RelationDelta>;
    }> {
        if (!relations) return { values, relations };
        const singles = Object.entries(relations).filter(([field]) => {
            const rel = type.fields[field]?.relation;
            return !!rel && !rel.many && !rel.inverse;
        });
        if (!singles.length) return { values, relations };

        const merged = { ...values };
        const rest = { ...relations };
        for (const [field, delta] of singles) {
            if (delta.set === undefined) {
                // Left to the caller's own error below: the arrays are
                // meaningless on a single relation, and saying so beats a
                // silent no-op.
                continue;
            }
            if (Object.hasOwn(values, field)) {
                throw new BadRequestException(
                    `Relation "${type.name}.${field}" was set in both \`values\` and \`relations\` — ` +
                        'send it in one of them.'
                );
            }
            const target = type.fields[field].relation?.to();
            if (delta.set === null || !target) {
                merged[field] = null;
            } else if (delta.by === 'localeGroup') {
                const byGroup = await this.relations.resolveLocaleGroups(
                    this.db,
                    target,
                    [delta.set],
                    workspaceId,
                    field,
                    sourceLocale
                );
                merged[field] = byGroup.get(delta.set) ?? null;
            } else {
                merged[field] = delta.set;
            }
            delete rest[field];
        }
        return {
            values: merged,
            relations: Object.keys(rest).length ? rest : undefined
        };
    }

    /**
     * The locale of one live row, or `undefined` on a type that has none.
     *
     * A relation link may not cross locales, and an update's target checks run
     * before the transaction opens — so the row's locale has to be read up
     * front. Costs one indexed lookup, and only on localized types: a non-i18n
     * type short-circuits without touching the database.
     */
    private async localeOf(
        type: AnyContentType,
        id: string,
        workspaceId: string
    ): Promise<{ locale?: string; localeGroupId?: string }> {
        if (!type.i18n) return {};
        // `PgColumn`, not the looser `AnyColumn` the predicate helpers use —
        // drizzle's select builder accepts only the former.
        const cols = type.table as unknown as Record<string, PgColumn>;
        const [row] = (await this.db
            .select({
                locale: cols['locale'],
                // Read alongside the locale rather than in a second probe: the
                // one-to-one check needs the row's *record* identity, since the
                // locale siblings of one record legitimately share a target.
                localeGroupId: cols['localeGroupId']
            })
            .from(type.table)
            .where(this.liveWhere(type, id, workspaceId))
            .limit(1)) as { locale: string; localeGroupId: string }[];
        return { locale: row?.locale, localeGroupId: row?.localeGroupId };
    }

    /**
     * Append an immutable **draft** revision for a just-saved row, on the save's
     * own transaction so the snapshot commits atomically with it. Captures the
     * whole document — the field `values` bag plus the full ordered link sets of
     * every join-backed relation (read back inside `tx`, so it reflects the
     * committed state). The entry's append lock serializes concurrent savers so
     * each allocates a distinct version number.
     */
    private async appendRevision(
        tx: DbTransaction,
        type: AnyContentType,
        row: Row,
        workspaceId: string,
        actorId: string | null
    ): Promise<void> {
        const id = row['id'] as string;
        const links = await this.relations.snapshotLinks(tx, type, row);
        // Whatever the bound extensions hold for this row *now* — read on the
        // save's own transaction, after any `apply` has run, so the version
        // records what committed. Captured unconditionally, including for a
        // sibling row this save only touched indirectly: a version that omitted
        // the state it did not change would restore as a version that had none.
        const extra = await this.writeExtensions.captureAll({
            executor: tx,
            type,
            entryId: id,
            workspaceId
        });
        await this.revisionStore.lockEntry(tx, id);
        const number = await this.revisionStore.nextNumber(tx, id);
        const revision = Revision.createDraft({
            contentType: type.name,
            entryId: id,
            workspaceId,
            localeGroupId: (row['localeGroupId'] as string | undefined) ?? null,
            locale: (row['locale'] as string | undefined) ?? null,
            number,
            snapshot: buildSnapshot(type, row, links, extra),
            createdBy: actorId
        });
        await this.revisionStore.append(tx, revision);
    }

    /**
     * Append a revision for each row an extension changed as a side-effect of
     * this save — the locale siblings a shared (non-localized) field is synced
     * to, today.
     *
     * Without this their stored values move while their timeline doesn't, so
     * the history claims a change that never happened to them and hides one
     * that did. Rows are sorted by id before appending: each takes a per-entry
     * advisory lock, and a stable order across concurrent savers is what keeps
     * two of them from deadlocking on the pair.
     */
    private async appendRevisionsFor(
        tx: DbTransaction,
        type: AnyContentType,
        rows: Record<string, unknown>[] | void,
        workspaceId: string,
        actorId: string | null,
        /**
         * Ids of further rows an **entry-write extension** changed, which it
         * reports rather than returns whole — it wrote a table of its own, not
         * these ones, so it has no row to hand back. Merged with `rows` and
         * deduplicated by id: one save can reach a sibling through both paths
         * (a shared field *and* an audience), and appending two revisions for it
         * would read as two edits.
         */
        alsoChangedIds: readonly string[] = []
    ): Promise<void> {
        const byId = new Map<string, Record<string, unknown>>();
        for (const row of rows ?? []) byId.set(String(row['id']), row);
        const missing = alsoChangedIds.filter((id) => !byId.has(id));
        for (const row of await this.rowsByIds(
            tx,
            type,
            missing,
            workspaceId
        )) {
            byId.set(String(row['id']), row);
        }
        if (!byId.size) return;
        const ordered = [...byId.values()].sort((a, b) =>
            String(a['id']).localeCompare(String(b['id']))
        );
        for (const row of ordered) {
            await this.appendRevision(
                tx,
                type,
                row as Row,
                workspaceId,
                actorId
            );
        }
    }

    /**
     * The rows behind a set of ids, on this transaction.
     *
     * Soft-deleted rows are **included**: a locale in the trash is still a row
     * whose state an extension just changed, and it comes back on restore
     * expecting a timeline that says so.
     */
    private async rowsByIds(
        tx: DbTransaction,
        type: AnyContentType,
        ids: readonly string[],
        workspaceId: string
    ): Promise<Record<string, unknown>[]> {
        if (!ids.length) return [];
        const columns = type.table as unknown as Record<
            string,
            PgColumn | undefined
        >;
        const id = columns['id'];
        const workspace = columns['workspaceId'];
        if (!id || !workspace) return [];
        return (await tx
            .select()
            .from(type.table)
            .where(
                and(inArray(id, [...ids]), eq(workspace, workspaceId))
            )) as Record<string, unknown>[];
    }

    /**
     * Create an entry **owned by `workspaceId`** (stamped onto the row so the
     * reader's workspace filter and every later scoped write see it). A
     * publishable type starts as a **draft** and may be incomplete — validation
     * is deferred to publish. A non-publishable type is always live, so its
     * values must validate now.
     *
     * The insert runs in a transaction that first takes the workspace's *shared*
     * content lock ({@link lockWorkspaceShared}): it coordinates with the
     * workspace delete / content-revoke guards (which take the lock exclusively),
     * so a new entry can't land between their emptiness check and their mutation
     * and be orphaned. Shared mode keeps concurrent creates non-blocking.
     *
     * `locale` / `localeGroupId` are opaque, extension-owned params: the bound
     * extension validates them and stamps the envelope columns (a
     * `localeGroupId` makes the row a **sibling** in that translation group). A
     * duplicate `(group, locale)` surfaces as a **409** via {@link uniqueGuarded}.
     *
     * `extensions` is the same kind of thing one plugin further out: an opaque
     * bag forwarded to the bound {@link EntryWriteExtensionRegistry}, so a plugin
     * that owns state *about* an entry (segments' audiences) writes it inside
     * this transaction and has it captured by the same version.
     */
    async create(
        type: AnyContentType,
        values: Record<string, unknown>,
        workspaceId: string,
        relations?: Record<string, RelationDelta>,
        locale?: string,
        localeGroupId?: string,
        actor?: EventActor | null,
        extensions?: Record<string, unknown>
    ): Promise<EntryRecord> {
        const actorId = revisionActorId(actor);
        // `coerceValues` stamps every declared field onto the bag, so the
        // "sent in both places" check below has to read the RAW body — after
        // coercion every field looks present.
        let coerced = coerceValues(type, values);
        // Extension-stamped envelope columns (e.g. the validated locale + group
        // id). Resolved before the transaction so an invalid param — unknown
        // locale, or a group id that names no group in the workspace — fails
        // fast. May read the DB (the group check), hence awaited.
        //
        // Resolved **before** the relation checks because the locale it stamps is
        // what those compare against: a link may not cross locales, and the
        // locale this row will be written in is not known until the extension
        // has defaulted and validated it.
        const extensionColumns =
            (await this.extension?.createColumns(type, workspaceId, {
                locale,
                localeGroupId
            })) ?? {};
        const rowLocale = extensionColumns['locale'] as string | undefined;
        // A `{ set }` on an owning single relation becomes a plain value here, so
        // everything below — existence, workspace, the same-locale rule — sees
        // one shape and needs no second implementation.
        const folded = await this.foldSingleRelationSets(
            type,
            values,
            relations,
            workspaceId,
            rowLocale
        );
        coerced = coerceValues(type, folded.values);
        relations = folded.relations;
        await this.assertRelationTargets(type, coerced, workspaceId, rowLocale);
        await this.assertUniqueRelations(
            type,
            coerced,
            workspaceId,
            rowLocale,
            {
                id: '',
                // The group the new row joins, when it joins one. Absent means a
                // fresh group, so every existing claimant is a different record.
                localeGroupId: extensionColumns['localeGroupId'] as
                    | string
                    | undefined
            }
        );
        await this.assertMediaTargets(type, coerced, workspaceId);
        if (!type.publishable) this.assertValid(type, coerced);
        // One transaction: take the workspace's shared content lock (coordinates
        // with the delete / content-revoke guards so a new entry can't be
        // orphaned), then write the row, its whole-set join-table links (a
        // many-relation submitted in `values`), and the staged relation deltas —
        // all together, so a failed link write never leaves a half-linked entry.
        // Wrapped in uniqueGuarded so a duplicate (group, locale) on an i18n
        // type is a clean 409 rather than a 500.
        const row = await this.uniqueGuarded(
            () =>
                this.uow.run(async () => {
                    const tx = this.tx();
                    await lockWorkspaceShared(tx, workspaceId);
                    // Same seam as the update path: the extension locks the
                    // set it will rewrite in `afterUpdate` before any row of
                    // that set is touched, so a create joining a group orders
                    // itself against concurrent saves on the group's members.
                    await this.extension?.beforeWrite?.(
                        tx,
                        type,
                        {
                            localeGroupId: extensionColumns['localeGroupId'] as
                                | string
                                | undefined
                        },
                        workspaceId
                    );
                    const [inserted] = await tx
                        .insert(type.table)
                        .values({
                            ...toColumns(type, coerced),
                            workspaceId,
                            ...extensionColumns
                        } as never)
                        .returning();
                    const id = (inserted as Row)['id'] as string;
                    await this.relations.writeLinks(
                        tx,
                        type,
                        id,
                        coerced,
                        workspaceId,
                        rowLocale
                    );
                    await this.applyRelationDeltas(
                        tx,
                        type,
                        id,
                        relations,
                        workspaceId,
                        rowLocale
                    );
                    // A non-publishable type is always live, so — like its scalar
                    // values — a required link-managed relation must be satisfied now.
                    // Checked after the links are written (inside the txn, so it sees
                    // them), so a 422 rolls the whole create back.
                    if (!type.publishable)
                        await this.assertRequiredRelations(
                            tx,
                            type,
                            inserted as Row,
                            workspaceId
                        );
                    // Same side-effects as an update (e.g. syncing shared fields
                    // to locale siblings): a sibling created into an existing
                    // group must land consistent with the group's shared values.
                    // A no-op for a fresh, sibling-less group.
                    const touched = await this.extension?.afterUpdate(
                        tx,
                        type,
                        inserted as Row,
                        coerced,
                        workspaceId,
                        { created: true }
                    );
                    // Anything a bound plugin was asked to store about this
                    // entry — the row exists now, so it finally has something to
                    // hang off, and it lands before the snapshot below reads it
                    // back. A create is the case that forced this into the write
                    // at all: until the insert there is no id to write against.
                    const alsoChanged = await this.writeExtensions.applyAll(
                        {
                            executor: tx,
                            type,
                            entryId: id,
                            workspaceId
                        },
                        extensions
                    );
                    // …and, for a row joining an existing locale group, whatever
                    // that group already holds. `applyAll` runs only for keys
                    // the caller sent, and "create a translation" sends none —
                    // so without this a translation of a restricted article was
                    // a public copy of it. After `applyAll`, so an extension the
                    // caller just told what to store is not overwritten.
                    await this.writeExtensions.inheritAll({
                        executor: tx,
                        type,
                        entryId: id,
                        workspaceId
                    });
                    // Snapshot the just-created document as its first revision,
                    // inside this same transaction.
                    await this.appendRevision(
                        tx,
                        type,
                        inserted as Row,
                        workspaceId,
                        actorId ?? null
                    );
                    // …and one for every sibling either extension path rewrote,
                    // so a shared value — or an audience — landing on them is in
                    // their history too.
                    await this.appendRevisionsFor(
                        tx,
                        type,
                        touched,
                        workspaceId,
                        actorId ?? null,
                        alsoChanged
                    );
                    // Inside the transaction, so the fact and the row it
                    // describes commit together or not at all — the whole point
                    // of the outbox.
                    await this.emit(
                        [
                            entryCreated(
                                id,
                                this.subjectOf(
                                    type,
                                    workspaceId,
                                    inserted as Row
                                )
                            )
                        ],
                        actor
                    );
                    return inserted as Row;
                }),
            type
        );
        return toRecord(type, row);
    }

    /**
     * First page (+ total) of every relation field's links for one live entry,
     * keyed by field name — what the editor loads on open. Each field is
     * paginated, so a relation with many links contributes only its first page.
     * 404 if the entry is missing (or soft-deleted) in this workspace.
     */
    async getRelations(
        type: AnyContentType,
        id: string,
        workspaceId: string
    ): Promise<Record<string, RelationFieldView>> {
        const row = await this.findLive(type, id, workspaceId);
        if (!row) throw this.notFound(type, id);
        return this.relations.readAll(type, row, workspaceId);
    }

    /**
     * One page of a single relation field's links (infinite-scroll for a
     * many/inverse relation). 404 if the entry is missing; 400 if `field` isn't a
     * relation on the type.
     */
    async getRelationField(
        type: AnyContentType,
        id: string,
        field: string,
        page: number,
        pageSize: number,
        workspaceId: string
    ): Promise<RelationFieldView> {
        const spec = this.relationSpec(type, field);
        const row = await this.findLive(type, id, workspaceId);
        if (!row) throw this.notFound(type, id);
        return this.relations.readField(
            type,
            row,
            field,
            spec,
            page,
            pageSize,
            workspaceId
        );
    }

    /**
     * Apply the staged per-field relation deltas of a save, inside the entry's
     * transaction — so the row and every link change commit or roll back as one.
     * Each field must be a **many/inverse** relation (a single relation is set
     * through `values`); a single-relation or unknown key is a 400. `applyDelta`
     * validates the linked ids against the workspace (422 on a bad target).
     */
    private async applyRelationDeltas(
        tx: DbTransaction,
        type: AnyContentType,
        id: string,
        relations: Record<string, RelationDelta> | undefined,
        workspaceId: string,
        sourceLocale?: string
    ): Promise<void> {
        if (!relations) return;
        for (const [field, delta] of Object.entries(relations)) {
            const spec = this.relationSpec(type, field);
            const rel = spec.relation;
            // Only a join-backed relation this side owns can persist a delta: an
            // owning many-to-many, or the inverse of a many-to-many (it reuses
            // the owning join table). A single relation (set via `values`) — and,
            // crucially, the inverse of a *single* relation (one-to-many), which
            // owns no writable link from this side — must be rejected here, else
            // `applyDelta` would silently no-op and the save would drop the edit.
            const writable = rel?.inverse
                ? !!rel.to().fields[rel.inverse.field]?.relation?.many
                : !!rel?.many;
            if (!writable) {
                throw new BadRequestException(
                    `Relation "${type.name}.${field}" owns no writable links from this side — ` +
                        `set a single relation via the entry's values; the inverse of a single relation is read-only.`
                );
            }
            await this.relations.applyDelta(
                tx,
                type,
                id,
                field,
                delta,
                workspaceId,
                sourceLocale
            );
        }
    }

    /** Resolve a relation field spec on the type, or 400 if it isn't one. */
    private relationSpec(type: AnyContentType, field: string) {
        const spec = type.fields[field];
        if (spec?.type !== CONTENT_FIELD_TYPE.Relation || !spec.relation) {
            throw new BadRequestException(
                `"${field}" is not a relation field on content type "${type.name}".`
            );
        }
        return spec;
    }

    /** Read one live entry in the workspace, or 404. */
    async getOne(
        type: AnyContentType,
        id: string,
        workspaceId: string
    ): Promise<EntryRecord> {
        const row = await this.findLive(type, id, workspaceId);
        if (!row) throw this.notFound(type, id);
        return toRecord(type, row);
    }

    /**
     * Replace a live entry's values, or 404. As with {@link create}, a
     * publishable type's values aren't validated here (a draft may be saved
     * incomplete; publish enforces the rules) — a non-publishable, always-live
     * type validates now.
     */
    async update(
        type: AnyContentType,
        id: string,
        values: Record<string, unknown>,
        workspaceId: string,
        relations?: Record<string, RelationDelta>,
        actor?: EventActor | null,
        options?: {
            /**
             * Whether this write appends a version of its own (default `true`).
             * Set `false` by the publish-a-specific-version path, which re-applies
             * an existing version's snapshot to the live row: that version is
             * marked published in place, so minting a copy of it would add a
             * duplicate entry to the timeline for every publish. Locale siblings
             * the extension rewrites still get their versions — their content
             * really did change.
             */
            appendRevision?: boolean;
            /**
             * Opaque per-plugin state to store alongside the entry, forwarded to
             * the bound {@link EntryWriteExtensionRegistry} inside this write's
             * transaction. A key the caller omits is left alone — a save that
             * said nothing about audiences must not clear them.
             *
             * A **restore** passes the restored version's `snapshot.extra` here,
             * which is what makes going back to Tuesday put Tuesday's audiences
             * back too rather than leaving today's readers on Tuesday's words.
             */
            extensions?: Record<string, unknown>;
        }
    ): Promise<EntryRecord> {
        const actorId = revisionActorId(actor);
        let coerced = coerceValues(type, values);
        // The row's own locale is what a relation link must match. Read up front
        // (one indexed lookup, and only on localized types) so the pre-transaction
        // target checks can apply the same rule the in-transaction link writes do.
        const { locale: rowLocale, localeGroupId: rowGroup } =
            await this.localeOf(type, id, workspaceId);
        const folded = await this.foldSingleRelationSets(
            type,
            values,
            relations,
            workspaceId,
            rowLocale
        );
        coerced = coerceValues(type, folded.values);
        relations = folded.relations;
        await this.assertRelationTargets(type, coerced, workspaceId, rowLocale);
        await this.assertUniqueRelations(
            type,
            coerced,
            workspaceId,
            rowLocale,
            { id, localeGroupId: rowGroup }
        );
        await this.assertMediaTargets(type, coerced, workspaceId);
        // Whether this write must satisfy the type's required rules now (its
        // scalar values up front, its link-managed relations after the links are
        // written). A **publishable** type's save always produces a **draft**
        // working copy: a draft may be incomplete, so it isn't eagerly validated,
        // and editing an already-published entry moves it back to draft (its
        // previously-published *version* stays live in history until the next
        // publish). A non-publishable type is always live, so every write must
        // validate now.
        const enforceRequired = !type.publishable;
        if (!type.publishable) {
            this.assertValid(type, coerced);
        }
        // One transaction: replace the row's columns, re-sync a whole-set
        // many-relation submitted in `values`, and apply the staged relation
        // deltas — so a save is all-or-nothing.
        const row = await this.uow.run(async () => {
            const tx = this.tx();
            // Read the stored row before the UPDATE rewrites it — inside the
            // transaction, so it is the row this write actually replaces — so
            // `entry.updated` can name the fields that changed instead of
            // asserting only that a save happened.
            const before = await this.findLive(type, id, workspaceId, tx);
            // Before the row is locked by the UPDATE below: the extension's
            // chance to take a deterministic lock over the wider set it will
            // rewrite in `afterUpdate` (the i18n plugin locks the translation
            // group). Taken first, so two concurrent saves on two members of
            // one group queue instead of deadlocking on each other's row locks.
            await this.extension?.beforeWrite?.(
                tx,
                type,
                { localeGroupId: rowGroup ?? undefined },
                workspaceId
            );
            const [updated] = await tx
                .update(type.table)
                .set({
                    ...toColumns(type, coerced),
                    // Editing a publishable entry produces a draft working copy —
                    // a published entry moves back to draft (its live version
                    // stays published in history until the next publish).
                    //
                    // `published_at` is deliberately **kept**: it records that
                    // this entry has a live published version, which an edit
                    // does not retract (only `unpublish` does, and `markDraft`
                    // clears it there). `draft` + a `published_at` is what the
                    // admin reads as **Modified** — unsaved-to-live changes on
                    // top of published content — versus a never-published
                    // `draft`.
                    ...(type.publishable ? { status: ENTRY_STATUS.Draft } : {}),
                    updatedAt: new Date()
                } as never)
                .where(this.liveWhere(type, id, workspaceId))
                .returning();
            if (!updated) throw this.notFound(type, id);
            await this.relations.writeLinks(
                tx,
                type,
                id,
                coerced,
                workspaceId,
                rowLocale
            );
            await this.applyRelationDeltas(
                tx,
                type,
                id,
                relations,
                workspaceId,
                rowLocale
            );
            // Enforce required link-managed relations against the post-delta
            // link set (inside the txn, so it sees the just-written rows); a
            // 422 rolls the whole update back.
            if (enforceRequired)
                await this.assertRequiredRelations(
                    tx,
                    type,
                    updated as Row,
                    workspaceId
                );
            // Extension side-effects of a save (e.g. syncing shared fields to
            // locale siblings) run inside the same transaction — a failure
            // rolls the whole save back.
            const touched = await this.extension?.afterUpdate(
                tx,
                type,
                updated as Row,
                coerced,
                workspaceId,
                { created: false }
            );
            // Whatever a bound plugin was asked to store about this entry, on
            // this transaction and before the snapshot reads it back — so the
            // version records the audiences the save actually applied rather
            // than the ones it replaced. This runs even when no version is
            // appended (publish-a-version): the state is the entry's, not the
            // revision's.
            const alsoChanged = await this.writeExtensions.applyAll(
                { executor: tx, type, entryId: id, workspaceId },
                options?.extensions
            );
            // Snapshot the updated document as a new draft revision, inside this
            // same transaction — unless the caller is re-applying a version that
            // already exists in the timeline (publish-a-version).
            if (options?.appendRevision ?? true) {
                await this.appendRevision(
                    tx,
                    type,
                    updated as Row,
                    workspaceId,
                    actorId ?? null
                );
            }
            // …and one for every sibling either extension path rewrote — the
            // rows i18n synced a shared field to, and the rows a write extension
            // reports it also changed (segments writes an entry's audiences to
            // its whole locale group). Both are the same defect if skipped: a
            // row whose state moved while its timeline did not.
            await this.appendRevisionsFor(
                tx,
                type,
                touched,
                workspaceId,
                actorId ?? null,
                alsoChanged
            );
            // A save that changed no field value raises nothing: it is a round
            // trip, not an editorial change, and the log is read by people.
            const fields = this.changedFields(type, before, updated as Row);
            if (fields.length > 0) {
                await this.emit(
                    [
                        entryUpdated(
                            id,
                            this.subjectOf(type, workspaceId, updated as Row),
                            fields
                        )
                    ],
                    actor
                );
            }
            return updated as Row;
        });
        return toRecord(type, row);
    }

    // ---- publish-lifecycle status primitives -------------------------------
    // These are the SQL the publish/unpublish/bulk use-cases compose; they run
    // on the executor the caller passes (the active unit-of-work transaction),
    // so the status write and its outbox event commit atomically. The
    // validation gate + status transition + event raising live in the `Entry`
    // domain model and its use-cases, not here.

    /**
     * Stamp `status='published'` + `published_at`/`updated_at` on one live row,
     * returning the updated row (or undefined if none matched, i.e. a 404).
     */
    async markPublished(
        exec: Database | DbTransaction,
        type: AnyContentType,
        id: string,
        workspaceId: string
    ): Promise<Row | undefined> {
        const [row] = await exec
            .update(type.table)
            .set({
                status: ENTRY_STATUS.Published,
                publishedAt: new Date(),
                updatedAt: new Date()
            } as never)
            .where(this.liveWhere(type, id, workspaceId))
            .returning();
        return row as Row | undefined;
    }

    /**
     * Transition the entry's **revision history** to reflect a publish: one
     * revision becomes the live (`published`) version and any prior published
     * one is `superseded`. Runs on the publish transaction's executor (the
     * active unit of work) so the row's status and its history commit as one.
     * Delegates to the revision store — every revision is minted a draft, so
     * this is what makes a published entry read as "Live" in the timeline.
     *
     * `revisionNumber` targets a **specific** version (publishing an earlier one
     * in place); omitted, it targets the latest — the row that was just saved.
     */
    async markRevisionPublished(
        exec: Database | DbTransaction,
        entryId: string,
        workspaceId: string,
        revisionNumber?: number
    ): Promise<void> {
        await this.revisionStore.markPublished(
            exec,
            entryId,
            workspaceId,
            revisionNumber
        );
    }

    /**
     * Revert the entry's published revision back to `draft` on `exec` — the
     * unpublish counterpart to {@link markRevisionPublished}.
     */
    async markRevisionUnpublished(
        exec: Database | DbTransaction,
        entryId: string,
        workspaceId: string
    ): Promise<void> {
        await this.revisionStore.markUnpublished(exec, entryId, workspaceId);
    }

    /** Revert one live row to `status='draft'` (clearing `published_at`) on `exec`. */
    async markDraft(
        exec: Database | DbTransaction,
        type: AnyContentType,
        id: string,
        workspaceId: string
    ): Promise<Row | undefined> {
        const [row] = await exec
            .update(type.table)
            .set({
                status: ENTRY_STATUS.Draft,
                publishedAt: null,
                updatedAt: new Date()
            } as never)
            .where(this.liveWhere(type, id, workspaceId))
            .returning();
        return row as Row | undefined;
    }

    /**
     * Load the workspace's live rows for `ids` **`FOR UPDATE`** on `exec`, keyed
     * by id — the locked candidate set a bulk publish re-validates inside its
     * transaction (closing the preview→commit TOCTOU window the comments on the
     * original single-transaction bulk publish defended).
     */
    async loadLiveByIdsForUpdate(
        exec: Database | DbTransaction,
        type: AnyContentType,
        ids: string[],
        workspaceId: string
    ): Promise<Map<string, Row>> {
        if (!ids.length) return new Map();
        const t = this.columns(type);
        const deletedGuard = type.paranoid ? isNull(t['deletedAt']) : undefined;
        const rows = (await exec
            .select()
            .from(type.table)
            .where(
                and(
                    inArray(t['id'], ids),
                    this.scope(type, workspaceId),
                    deletedGuard
                )
            )
            .for('update')) as Row[];
        return new Map(rows.map((row) => [row['id'] as string, row]));
    }

    /** Publish a set of ids in one statement on `exec` (the caller pre-filtered them). */
    async markPublishedBulk(
        exec: Database | DbTransaction,
        type: AnyContentType,
        ids: string[],
        workspaceId: string
    ): Promise<void> {
        if (!ids.length) return;
        const t = this.columns(type);
        const deletedGuard = type.paranoid ? isNull(t['deletedAt']) : undefined;
        await exec
            .update(type.table)
            .set({
                status: ENTRY_STATUS.Published,
                publishedAt: new Date(),
                updatedAt: new Date()
            } as never)
            .where(
                and(
                    inArray(t['id'], ids),
                    this.scope(type, workspaceId),
                    deletedGuard
                )
            );
    }

    /**
     * Which of `ids` are currently `published` and live in the workspace, on
     * `exec` — the set a bulk unpublish actually transitions, so it raises one
     * `entry.unpublished` per real change rather than per matched row.
     */
    async publishedIdsAmong(
        exec: Database | DbTransaction,
        type: AnyContentType,
        ids: string[],
        workspaceId: string
    ): Promise<string[]> {
        if (!ids.length) return [];
        const t = this.columns(type);
        const deletedGuard = type.paranoid ? isNull(t['deletedAt']) : undefined;
        const rows = (await exec
            .select()
            .from(type.table)
            .where(
                and(
                    inArray(t['id'], ids),
                    this.scope(type, workspaceId),
                    eq(t['status'], ENTRY_STATUS.Published),
                    deletedGuard
                )
            )) as Row[];
        return rows.map((row) => row['id'] as string);
    }

    /**
     * Revert the **published** rows among `ids` to draft on `exec`, returning
     * how many actually transitioned — the `{ count }` the bulk endpoint
     * reports.
     *
     * The status predicate is the whole of it, and it was missing: without it
     * the `UPDATE` matched every live row in the list, so unpublishing two ids
     * of which one was already a draft answered `{ count: 2 }` — which is what
     * the route's own OpenAPI description promises it never does ("an id that
     * was not a live published row … is not counted"). It also stamped
     * `updatedAt` on rows nothing happened to, moving an entry up a
     * last-modified sort because somebody unpublished a *different* one.
     */
    async markDraftBulk(
        exec: Database | DbTransaction,
        type: AnyContentType,
        ids: string[],
        workspaceId: string
    ): Promise<number> {
        if (!ids.length) return 0;
        const t = this.columns(type);
        const rows = await exec
            .update(type.table)
            .set({
                status: ENTRY_STATUS.Draft,
                publishedAt: null,
                updatedAt: new Date()
            } as never)
            .where(
                and(
                    inArray(t['id'], ids),
                    this.scope(type, workspaceId),
                    eq(t['status'], ENTRY_STATUS.Published),
                    type.paranoid ? isNull(t['deletedAt']) : undefined
                )
            )
            .returning();
        return rows.length;
    }

    /**
     * Delete an entry: soft (stamp `deleted_at`) for a paranoid type, hard
     * `DELETE` otherwise. 404 if there's no live row to remove **in this
     * workspace** — an id from another workspace is indistinguishable from a
     * missing one.
     */
    async remove(
        type: AnyContentType,
        id: string,
        workspaceId: string,
        actor?: EventActor | null
    ): Promise<void> {
        const t = this.columns(type);
        const scope = this.scope(type, workspaceId);
        // In a unit of work purely so the `entry.deleted` event commits with
        // the delete. Nothing else here needs a transaction — it is one
        // statement — but an event that can outlive a rolled-back delete is the
        // exact failure the outbox exists to prevent.
        await this.uow.run(async () => {
            const exec = this.uow.current();
            const [row] = await this.restrictGuarded(
                () =>
                    type.paranoid
                        ? exec
                              .update(type.table)
                              .set({
                                  deletedAt: new Date(),
                                  updatedAt: new Date()
                              } as never)
                              .where(
                                  and(
                                      eq(t['id'], id),
                                      scope,
                                      isNull(t['deletedAt'])
                                  )
                              )
                              .returning()
                        : exec
                              .delete(type.table)
                              .where(and(eq(t['id'], id), scope))
                              .returning(),
                type
            );
            if (!row) throw this.notFound(type, id);
            await this.emit(
                [
                    entryDeleted(
                        id,
                        this.subjectOf(type, workspaceId, row as Row),
                        Boolean(type.paranoid)
                    )
                ],
                actor
            );
        });
    }

    /**
     * Clear a soft-deleted entry's tombstone (paranoid types only), or 404.
     * On an i18n type the restore can collide with a row created in the same
     * (locale group, locale) slot after the soft delete — the partial unique
     * index rejects it, surfaced as a 409 rather than a 500.
     */
    async restore(
        type: AnyContentType,
        id: string,
        workspaceId: string,
        actor?: EventActor | null
    ): Promise<EntryRecord> {
        this.assertParanoid(type);
        const t = this.columns(type);
        return this.uow.run(async () => {
            const exec = this.uow.current();
            const [row] = await this.uniqueGuarded(
                () =>
                    exec
                        .update(type.table)
                        .set({
                            deletedAt: null,
                            updatedAt: new Date()
                        } as never)
                        .where(
                            and(
                                eq(t['id'], id),
                                this.scope(type, workspaceId),
                                isNotNull(t['deletedAt'])
                            )
                        )
                        .returning(),
                type
            );
            if (!row) throw this.notFound(type, id);
            await this.emit(
                [
                    entryRestored(
                        id,
                        this.subjectOf(type, workspaceId, row as Row)
                    )
                ],
                actor
            );
            return toRecord(type, row as Row);
        });
    }

    /** Permanently delete a tombstoned entry (paranoid types only), or 404. */
    async purge(
        type: AnyContentType,
        id: string,
        workspaceId: string,
        actor?: EventActor | null
    ): Promise<void> {
        this.assertParanoid(type);
        const t = this.columns(type);
        await this.uow.run(async () => {
            const exec = this.uow.current();
            const [row] = await this.restrictGuarded(
                () =>
                    exec
                        .delete(type.table)
                        .where(
                            and(
                                eq(t['id'], id),
                                this.scope(type, workspaceId),
                                isNotNull(t['deletedAt'])
                            )
                        )
                        .returning(),
                type
            );
            if (!row) throw this.notFound(type, id);
            // The one content action that leaves nothing behind to inspect, so
            // the event is the only remaining record that it happened.
            await this.emit(
                [
                    entryPurged(
                        id,
                        this.subjectOf(type, workspaceId, row as Row)
                    )
                ],
                actor
            );
        });
    }

    /** Delete a set of entries: soft for paranoid types, hard otherwise. */
    async bulkRemove(
        type: AnyContentType,
        ids: string[],
        workspaceId: string,
        actor?: EventActor | null
    ): Promise<BulkActionResult> {
        if (!ids.length) return { count: 0 };
        const t = this.columns(type);
        const scope = this.scope(type, workspaceId);
        return this.uow.run(async () => {
            const exec = this.uow.current();
            const rows = await this.restrictGuarded(
                () =>
                    type.paranoid
                        ? exec
                              .update(type.table)
                              .set({
                                  deletedAt: new Date(),
                                  updatedAt: new Date()
                              } as never)
                              .where(
                                  and(
                                      inArray(t['id'], ids),
                                      scope,
                                      isNull(t['deletedAt'])
                                  )
                              )
                              .returning()
                        : exec
                              .delete(type.table)
                              .where(and(inArray(t['id'], ids), scope))
                              .returning(),
                type
            );
            // One event per row actually removed, not one per id asked for:
            // batching is a way of asking, and the log records what happened.
            await this.emit(
                this.eventsFor(rows as Row[], (id, row) =>
                    entryDeleted(
                        id,
                        this.subjectOf(type, workspaceId, row),
                        Boolean(type.paranoid)
                    )
                ),
                actor
            );
            return { count: rows.length };
        });
    }

    /** Permanently delete a set of tombstoned entries (paranoid types only). */
    async bulkPurge(
        type: AnyContentType,
        ids: string[],
        workspaceId: string,
        actor?: EventActor | null
    ): Promise<BulkActionResult> {
        this.assertParanoid(type);
        if (!ids.length) return { count: 0 };
        const t = this.columns(type);
        return this.uow.run(async () => {
            const exec = this.uow.current();
            const rows = await this.restrictGuarded(
                () =>
                    exec
                        .delete(type.table)
                        .where(
                            and(
                                inArray(t['id'], ids),
                                this.scope(type, workspaceId),
                                isNotNull(t['deletedAt'])
                            )
                        )
                        .returning(),
                type
            );
            await this.emit(
                this.eventsFor(rows as Row[], (id, row) =>
                    entryPurged(id, this.subjectOf(type, workspaceId, row))
                ),
                actor
            );
            return { count: rows.length };
        });
    }

    /**
     * Restore a set of soft-deleted entries (paranoid types only). As with
     * {@link restore}, a restored row colliding with a live sibling in its
     * (locale group, locale) slot is a 409 — the whole batch rolls back
     * (single statement), so the caller can retry without the conflicting id.
     */
    async bulkRestore(
        type: AnyContentType,
        ids: string[],
        workspaceId: string,
        actor?: EventActor | null
    ): Promise<BulkActionResult> {
        this.assertParanoid(type);
        if (!ids.length) return { count: 0 };
        const t = this.columns(type);
        return this.uow.run(async () => {
            const exec = this.uow.current();
            const rows = await this.uniqueGuarded(
                () =>
                    exec
                        .update(type.table)
                        .set({
                            deletedAt: null,
                            updatedAt: new Date()
                        } as never)
                        .where(
                            and(
                                inArray(t['id'], ids),
                                this.scope(type, workspaceId),
                                isNotNull(t['deletedAt'])
                            )
                        )
                        .returning(),
                type
            );
            await this.emit(
                this.eventsFor(rows as Row[], (id, row) =>
                    entryRestored(id, this.subjectOf(type, workspaceId, row))
                ),
                actor
            );
            return { count: rows.length };
        });
    }

    /**
     * Run a write, translating a Postgres unique violation (23505) into a 409.
     * Only i18n types carry a restore-relevant unique index — the partial
     * `(locale_group_id, locale)` one — so the mapping is scoped to them and
     * any other type's violation still surfaces as the bug it is.
     */
    /**
     * Run a delete and translate a Postgres **foreign-key** violation into a
     * `409`.
     *
     * A required single relation declares `onDelete: 'restrict'` (a NOT NULL FK
     * cannot be nulled on delete), so deleting a row something still points at
     * is refused by the database. That refusal is legitimate and actionable —
     * "detach the referring records first" — but it surfaced as a raw `500`,
     * which tells the caller the server broke and gives them nothing to do. The
     * symmetric counterpart of {@link uniqueGuarded}.
     *
     * Deliberately does not name the referring rows: finding them means a query
     * per inbound relation across every type in the registry, and the caller
     * cannot be told about records in workspaces they cannot see.
     */
    private async restrictGuarded<T>(
        write: () => Promise<T>,
        type: AnyContentType
    ): Promise<T> {
        try {
            return await write();
        } catch (error) {
            if (!isForeignKeyViolation(error)) throw error;
            throw new ConflictException(
                `This "${type.name}" entry is still referenced by other entries and cannot be deleted.`
            );
        }
    }

    private async uniqueGuarded<T>(
        write: () => Promise<T>,
        type: AnyContentType
    ): Promise<T> {
        try {
            return await write();
        } catch (error) {
            const constraint = violatedConstraint(error);
            if (constraint === undefined || !type.i18n) throw error;
            // A localized table carries more than one unique index, so the
            // message has to follow the constraint that actually tripped.
            // `<table>_<field>_locale_unique` is a one-to-one relation already
            // claimed in this locale — a 422 about that field, not a 409 about
            // the locale, which would send the user to fix the wrong thing.
            // `assertUniqueRelations` normally catches this first; reaching here
            // means a concurrent writer took the target in between, and the
            // constraint is what settles the race.
            if (constraint.endsWith('_locale_unique')) {
                // Map the index name back to the field by re-deriving each
                // field's own index name, rather than un-snake-casing the
                // capture: `snakeCase` is not injective, so the reverse guess
                // could name a field that doesn't exist.
                const field = Object.keys(type.fields).find(
                    (name) =>
                        constraint ===
                        `${getTableName(type.table)}_${snakeCase(name)}_locale_unique`
                );
                if (field) {
                    throw new UnprocessableEntityException({
                        message: 'Entry validation failed',
                        issues: [
                            {
                                field,
                                message:
                                    'is already linked to another entry in this locale'
                            }
                        ]
                    });
                }
            }
            throw new ConflictException(
                `An entry already occupies this locale in its translation group on "${type.name}".`
            );
        }
    }

    /** The type's generated table seen as a column bag (envelope + fields). */
    private columns(type: AnyContentType): Record<string, AnyColumn> {
        return type.table as unknown as Record<string, AnyColumn>;
    }

    /**
     * `workspace_id = :workspaceId` — the ownership predicate every read and
     * write AND-s in, so a request scoped to one workspace can neither see nor
     * mutate another's rows.
     */
    private scope(type: AnyContentType, workspaceId: string): SQL {
        return eq(this.columns(type)['workspaceId'], workspaceId);
    }

    /**
     * `id = :id` AND the workspace scope AND (for paranoid types)
     * `deleted_at IS NULL`.
     */
    private liveWhere(
        type: AnyContentType,
        id: string,
        workspaceId: string
    ): SQL | undefined {
        const t = this.columns(type);
        return and(
            eq(t['id'], id),
            this.scope(type, workspaceId),
            type.paranoid ? isNull(t['deletedAt']) : undefined
        );
    }

    /**
     * Fetch one live row by id in the workspace, or undefined. Public + executor
     * parameterized so the publish-lifecycle use-cases can read it under the
     * active unit of work; internal callers use the default (base connection).
     */
    async findLive(
        type: AnyContentType,
        id: string,
        workspaceId: string,
        exec: Database | DbTransaction = this.db
    ): Promise<Row | undefined> {
        const [row] = await exec
            .select()
            .from(type.table)
            .where(this.liveWhere(type, id, workspaceId))
            .limit(1);
        return row as Row | undefined;
    }

    /**
     * Fetch the workspace's live rows for a set of ids, keyed by id — the
     * bulk-publish **dry run** (no `FOR UPDATE`; the committed path uses
     * {@link loadLiveByIdsForUpdate}).
     */
    async loadLiveByIds(
        type: AnyContentType,
        ids: string[],
        workspaceId: string,
        exec: Database | DbTransaction = this.db
    ): Promise<Map<string, Row>> {
        if (!ids.length) return new Map();
        const t = this.columns(type);
        const rows = (await exec
            .select()
            .from(type.table)
            .where(
                and(
                    inArray(t['id'], ids),
                    this.scope(type, workspaceId),
                    type.paranoid ? isNull(t['deletedAt']) : undefined
                )
            )) as Row[];
        return new Map(rows.map((row) => [row['id'] as string, row]));
    }

    /**
     * Verify every referenced relation target exists **in the same workspace** —
     * single FKs, many-to-many links, and the inverse (back-reference) side of a
     * two-way relation. Neither the FK column nor the join table has a workspace
     * constraint of its own (the target table is workspace-scoped only at the app
     * layer), so without this a caller could reference — or probe the existence
     * of — an entry in another workspace. Batched one existence query per
     * referenced target type; a missing or cross-workspace target surfaces as a
     * uniform 422 validation issue (indistinguishable from a plain "invalid id",
     * so no not-found-vs-forbidden enumeration signal). Runs on every
     * create/update, draft or not, because links are written eagerly either way.
     * An inverse-of-single (one-to-many) field owns no writable link from this
     * side, so it's skipped.
     */
    /**
     * Reject a `unique: true` single relation whose target is already claimed
     * — by a **different record**, in the locale being written.
     *
     * The database settles this too (a column-wide UNIQUE on a plain type, a
     * per-locale `(<field>_id, locale)` index on a localized one), and it has to
     * stay there: it is the only thing that holds under concurrency. This check
     * exists for the message, not the guarantee. A raw 23505 surfaces as a 500
     * with a constraint name in it; the caller needs to know *which field* is
     * taken, in the same `{ field, message }` shape as every other entry
     * validation error.
     *
     * "Different record" is the whole subtlety on a localized type. The English
     * and German rows of one article are two rows and one record, and a relation
     * synced across the group deliberately puts the same id in both — so this
     * compares translation **groups**, not row ids. Excluding only `entryId`
     * would make the second locale of a record look like a rival claimant to the
     * target the record already owns.
     */
    private async assertUniqueRelations(
        type: AnyContentType,
        values: Record<string, unknown>,
        workspaceId: string,
        locale: string | undefined,
        current?: { id: string; localeGroupId?: string }
    ): Promise<void> {
        const unique = Object.entries(type.fields).filter(
            ([, spec]) =>
                spec.type === CONTENT_FIELD_TYPE.Relation &&
                spec.relation?.unique &&
                !spec.relation.many &&
                !spec.relation.inverse
        );
        if (!unique.length) return;

        const cols = this.columns(type);
        const issues: ValidationIssue[] = [];
        for (const [field] of unique) {
            const target = values[field];
            if (typeof target !== 'string' || !UUID_RE.test(target)) continue;
            const rows = (await this.db
                .select()
                .from(type.table)
                .where(
                    and(
                        eq(cols[field], target),
                        eq(cols['workspaceId'], workspaceId),
                        // Scoped to the locale being written on an i18n type,
                        // mirroring the index: another language's row holding
                        // this target is the same record's sibling, not a rival.
                        type.i18n && locale
                            ? eq(cols['locale'], locale)
                            : undefined,
                        type.paranoid ? isNull(cols['deletedAt']) : undefined
                    )
                )
                .limit(2)) as Row[];
            const claimedByOther = rows.some((row) =>
                type.i18n && current?.localeGroupId
                    ? row['localeGroupId'] !== current.localeGroupId
                    : row['id'] !== current?.id
            );
            if (claimedByOther) {
                issues.push({
                    field,
                    message: type.i18n
                        ? 'is already linked to another entry in this locale'
                        : 'is already linked to another entry'
                });
            }
        }
        if (issues.length) {
            throw new UnprocessableEntityException({
                message: 'Entry validation failed',
                issues
            });
        }
    }

    private async assertRelationTargets(
        type: AnyContentType,
        values: Record<string, unknown>,
        workspaceId: string,
        sourceLocale?: string
    ): Promise<void> {
        // Group referenced ids by target content type so each type is probed once.
        const byTarget = new Map<
            AnyContentType,
            { field: string; id: string }[]
        >();
        for (const [name, spec] of Object.entries(type.fields)) {
            if (spec.type !== CONTENT_FIELD_TYPE.Relation || !spec.relation)
                continue;
            const relation = spec.relation;
            // An owning many-to-many array submitted in `values` is re-validated
            // in-transaction by `writeLinks` (the same uniform 422), so skip it
            // here to avoid a duplicate existence probe. The inverse array and
            // owning single FKs aren't checked in-tx, so they stay validated here.
            if (relation.many && !relation.inverse) continue;
            if (relation.inverse) {
                // Inverse of a single relation writes nothing from this side;
                // only the inverse of a many-to-many links (its ids are owner
                // rows of the referenced type).
                const owningField =
                    relation.to().fields[relation.inverse.field];
                if (!owningField?.relation?.many) continue;
            }
            const ids =
                relation.many || relation.inverse
                    ? Array.isArray(values[name])
                        ? (values[name] as unknown[])
                        : []
                    : [values[name]];
            const target = relation.to();
            const refs = byTarget.get(target) ?? [];
            for (const id of ids) {
                if (typeof id !== 'string' || !id) continue;
                refs.push({ field: name, id });
            }
            if (refs.length) byTarget.set(target, refs);
        }
        if (!byTarget.size) return;

        const issues: ValidationIssue[] = [];
        for (const [target, refs] of byTarget) {
            const t = target.table as unknown as Record<string, AnyColumn>;
            // A malformed id is the same uniform 422 as a missing one, and never
            // reaches the query — see UUID_RE.
            const malformed = refs.filter((ref) => !UUID_RE.test(ref.id));
            for (const ref of malformed) {
                issues.push({
                    field: ref.field,
                    message: 'must reference an existing entry'
                });
            }
            const ids = [
                ...new Set(
                    refs
                        .filter((ref) => UUID_RE.test(ref.id))
                        .map((ref) => ref.id)
                )
            ];
            if (!ids.length) continue;
            // `uow.current()`, not `this.db`. Outside a unit of work the two
            // are the same connection, so an ordinary save is unaffected. Inside
            // one they are not, and the difference decides whether a caller can
            // write a graph: an import creates the author and then the article
            // that points at it in a single transaction, and a probe on the base
            // pool cannot see the uncommitted author — so a link to a record
            // created moments earlier in the same unit of work was rejected as
            // "must reference an existing entry".
            const rows = (await this.uow
                .current()
                .select()
                .from(target.table)
                .where(
                    and(
                        inArray(t['id'], ids),
                        eq(t['workspaceId'], workspaceId)
                    )
                )) as Row[];
            const present = new Set(rows.map((row) => row['id'] as string));
            for (const ref of refs) {
                if (UUID_RE.test(ref.id) && !present.has(ref.id))
                    issues.push({
                        field: ref.field,
                        message: 'must reference an existing entry'
                    });
            }
            // Same cross-locale rule the join-backed links get, applied to the
            // owning single FKs and inverse arrays that only pass through here.
            // Reported per field so a save touching two of them names both.
            for (const field of new Set(refs.map((ref) => ref.field))) {
                const ids = new Set(
                    refs.filter((ref) => ref.field === field).map((r) => r.id)
                );
                assertSameLocale(
                    rows.filter((row) => ids.has(row['id'] as string)),
                    target,
                    field,
                    sourceLocale
                );
            }
        }
        if (issues.length) {
            throw new UnprocessableEntityException({
                message: 'Entry validation failed',
                issues
            });
        }
    }

    /**
     * Validate every media field's asset ids: each must reference an asset that
     * **exists in the same workspace** and whose kind/MIME satisfies the field's
     * `accept` restriction. Mirrors {@link assertRelationTargets} — asset ids are
     * plain uuids with no FK (the assets live in the media plugin's schema), so
     * without this a caller could reference — or probe — an asset in another
     * workspace, or attach a disallowed file type. Batched: one resolver lookup
     * across every media id on the entry.
     *
     * A **missing** asset and a **cross-workspace** one both read as the same
     * uniform 422 (the resolver simply omits them from its map — no
     * not-found-vs-forbidden enumeration signal). When no resolver is bound (the
     * media plugin isn't registered) this is a no-op: media fields shape-validate
     * and store their ids, but existence/restriction aren't enforced.
     */
    private async assertMediaTargets(
        type: AnyContentType,
        values: Record<string, unknown>,
        workspaceId: string
    ): Promise<void> {
        if (!this.mediaResolver) return;
        // Collect every referenced asset id, remembering which field each came
        // from so a violation names the right field.
        const refs: { field: string; id: string }[] = [];
        for (const [name, spec] of Object.entries(type.fields)) {
            if (spec.type !== CONTENT_FIELD_TYPE.Media) continue;
            // Through the kernel, because a media value is `{ id, alt?,
            // decorative? }` as well as a bare id since `ORT-83` — and a
            // hand-rolled `typeof value === 'string'` silently skipped the
            // object form, so an asset attached with alt text was never checked
            // for existence or against `accept`.
            for (const id of mediaValueIds(values[name])) {
                if (id) refs.push({ field: name, id });
            }
        }
        if (!refs.length) return;

        const resolved = await this.mediaResolver.resolve(
            [...new Set(refs.map((ref) => ref.id))],
            workspaceId
        );
        const issues: ValidationIssue[] = [];
        for (const ref of refs) {
            const asset = resolved.get(ref.id);
            if (!asset) {
                issues.push({
                    field: ref.field,
                    message: 'must reference an existing asset'
                });
                continue;
            }
            const spec = type.fields[ref.field];
            if (!acceptsAsset(spec.accept, asset)) {
                issues.push({
                    field: ref.field,
                    message: `must be ${describeAccept(spec.accept)}`
                });
            }
        }
        if (issues.length) {
            throw new UnprocessableEntityException({
                message: 'Entry validation failed',
                issues
            });
        }
    }

    /**
     * Enforce required **link-managed** relations (an owning many-to-many, or the
     * inverse of one) against the entry's actual link set — the check
     * {@link EntryValidationService} can't make, because those links never travel
     * in the `values` bag it sees. A required such relation with zero links is a
     * 422 `is required`, matching how a required scalar field reads. A single FK
     * relation is validated in `values` already; an inverse-of-single owns no
     * writable link from this side, so it's skipped (it can't be satisfied here).
     * `exec` is the write transaction on create/update (so it counts the
     * just-written, uncommitted rows) or the root client on publish (committed).
     */
    private async assertRequiredRelations(
        exec: Database | DbTransaction,
        type: AnyContentType,
        row: Row,
        workspaceId: string
    ): Promise<void> {
        const issues = await this.requiredRelationIssues(
            exec,
            type,
            row,
            workspaceId
        );
        if (issues.length) {
            throw new UnprocessableEntityException({
                message: 'Entry validation failed',
                issues
            });
        }
    }

    /**
     * The `is required` issues for required **link-managed** relations (an owning
     * many-to-many, or the inverse of one) whose link set is empty — the check
     * {@link EntryValidationService} can't make, since those links never travel
     * in the `values` bag. Returns the issues rather than throwing, so the
     * publish use-case can fold them into the `Entry` domain publish gate. `exec`
     * is the write transaction (counting just-written rows) on create/update, or
     * the unit-of-work transaction on publish.
     */
    async requiredRelationIssues(
        exec: Database | DbTransaction,
        type: AnyContentType,
        row: Row,
        workspaceId: string
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];
        for (const [name, spec] of Object.entries(type.fields)) {
            if (
                spec.type !== CONTENT_FIELD_TYPE.Relation ||
                !spec.relation ||
                !spec.required
            )
                continue;
            const rel = spec.relation;
            // Only relations this side owns writable links for are counted:
            // an owning many-to-many, or the inverse of a many-to-many.
            const writable = rel.inverse
                ? !!rel.to().fields[rel.inverse.field]?.relation?.many
                : !!rel.many;
            if (!writable) continue;
            const total = await this.relations.countLinks(
                exec,
                type,
                row,
                name,
                spec,
                workspaceId
            );
            if (total === 0)
                issues.push({ field: name, message: 'is required' });
        }
        return issues;
    }

    /** Throw 422 with the issue list when the values fail validation. */
    private assertValid(
        type: AnyContentType,
        values: Record<string, unknown>
    ): void {
        const result = this.validation.validate(type, values);
        if (!result.valid) {
            throw new UnprocessableEntityException({
                message: 'Entry validation failed',
                issues: result.issues
            });
        }
    }

    /** Reject restore/purge on a type without soft delete. */
    private assertParanoid(type: AnyContentType): void {
        if (!type.paranoid) {
            throw new BadRequestException(
                `Content type "${type.name}" does not support trash/restore.`
            );
        }
    }

    private notFound(type: AnyContentType, id: string): NotFoundException {
        return new NotFoundException(
            `No entry "${id}" on content type "${type.name}".`
        );
    }
}

/**
 * The **user** id to stamp on a revision, or `null` when the writer is not a
 * person.
 *
 * `content_entry_revisions.created_by` records a `users` row. A token is not
 * one, so writing its id there would make the history resolve every version to
 * a nonexistent person — which is why the public API used to pass no actor at
 * all rather than pass the token. The audit path has since gained an
 * `actor_type` and can name a credential honestly, so the two answers had to be
 * separated: {@link EntryWriterService.emit} gets the real principal, and this
 * gets a user id or nothing.
 *
 * An actor with no `type` is a person — every actor predates the field except
 * the token ones that introduced it.
 */
function revisionActorId(actor?: EventActor | null): string | null {
    if (!actor) return null;
    return (actor.type ?? EVENT_ACTOR_TYPE.User) === EVENT_ACTOR_TYPE.User
        ? actor.id
        : null;
}
