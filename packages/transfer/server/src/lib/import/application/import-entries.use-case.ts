/**
 * Writing a document back into a workspace.
 *
 * Three decisions shape the whole file.
 *
 * **One pipeline, two phases.** The dry run and the real run are the same code
 * with `dryRun` flipped. A preview computed separately would eventually promise
 * something the apply pass does differently, and the preview is precisely the
 * thing people trust before clicking.
 *
 * **Values first, links second.** Records are written without their relations,
 * then the links are applied once every row exists. This costs a second pass
 * and buys correctness on the shapes a topological sort cannot handle at all:
 * a cycle (`post.related → post`), and a pair that reference each other. It
 * also means a document's internal order never matters.
 *
 * **Every write goes through `EntryWriterService`.** Not "mostly" — every one.
 * That service is where field validation, the workspace scope, the
 * relation-target checks, the same-locale rule, the media-asset check,
 * revisions, outbox events and the bound i18n extension all live. An import
 * that reached for the table directly would be a supported way to write rows
 * that none of those rules ever saw.
 */

import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { InjectDatabase, UnitOfWork, type Database } from '@orthacms/database';
import type { EventActor } from '@orthacms/database';
import {
    EntryWriterService,
    InjectContentRegistry,
    type AnyContentType,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import {
    CONFLICT_POLICY,
    IMPORT_ACTION,
    IMPORT_REASON,
    RELATION_POLICY,
    TransferAssetMap,
    TransferIdMap,
    countVerdict,
    emptyCounts,
    hasChanges,
    keyFingerprint,
    naturalKeyOf,
    type ConflictPolicy,
    type ImportCounts,
    type ImportPreview,
    type ImportReason,
    type ImportResult,
    type ImportVerdict,
    type RelationPolicy,
    type TransferDocument,
    type TransferRecord,
    type TransferRef
} from '@orthacms/transfer-domain';
import { TransferSchemaCatalog } from '../../schema/schema-catalog.service';
import {
    ImportMediaService,
    beginMediaRun,
    type ImportMediaRun
} from '../infrastructure/import-media.service';

/** What to import. */
export interface ImportCommand {
    document: TransferDocument;
    /** Asset bytes from the archive, keyed by archive path. */
    assets: Map<string, Buffer>;
    workspaceId: string;
    policy: ConflictPolicy;
    /**
     * What to do with the document's **related** (depth-1) records, which
     * `policy` deliberately does not govern — see {@link RelationPolicy}.
     */
    relations: RelationPolicy;
    /** Report only — write nothing. */
    dryRun: boolean;
    actor?: EventActor | null;
    /** Permissions the caller actually holds, checked per write. */
    can: { create: boolean; update: boolean };
}

/** A row matched in the target workspace. */
interface Match {
    targetId: string;
}

/**
 * Every match the document could be resolved against, looked up two ways.
 *
 * `byKey` is the identity that survives a trip to another installation.
 * `bySourceId` is the one that only works when the file came back to the
 * database it left — which is, in practice, most imports.
 */
interface MatchIndex {
    /** Keyed by {@link keyFingerprint}. */
    byKey: Map<string, Match>;
    /** Keyed by the record's source row id. */
    bySourceId: Map<string, Match>;
}

/**
 * Whether a string is shaped like the uuid a content table's `id` column is.
 *
 * A document's `$id` is not necessarily one: the CSV format carries the column,
 * and a person filling in a spreadsheet may put anything there. Handing that
 * straight to a `uuid` comparison is a Postgres syntax error and a 500 — so the
 * shape is checked here, before the value ever reaches a query.
 */
function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
    );
}

@Injectable()
export class ImportEntriesUseCase {
    constructor(
        @InjectDatabase() private readonly db: Database,
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService,
        private readonly catalog: TransferSchemaCatalog,
        private readonly media: ImportMediaService,
        private readonly uow: UnitOfWork
    ) {}

    /**
     * Runs the import.
     *
     * The real run happens inside **one** transaction, so a failure halfway
     * leaves nothing behind — a half-imported graph is worse than no import,
     * because nobody can tell which half is real. Asset bytes are the exception
     * the database cannot cover and are handled in `ImportMediaService`.
     */
    async execute(
        command: ImportCommand
    ): Promise<ImportPreview & ImportResult> {
        const mediaRun = beginMediaRun();
        if (command.dryRun) return this.run(command, mediaRun);
        try {
            return await this.uow.run(() => this.run(command, mediaRun));
        } catch (error) {
            // The rows rolled back with the transaction; the blobs cannot, so
            // they are removed here or they are orphaned forever.
            await this.media.rollbackRun(mediaRun);
            throw error;
        }
    }

    private async run(
        command: ImportCommand,
        mediaRun: ImportMediaRun
    ): Promise<ImportPreview & ImportResult> {
        const { document, workspaceId } = command;
        const counts = emptyCounts();
        const verdicts: ImportVerdict[] = [];
        const ids = new TransferIdMap();
        const assets = new TransferAssetMap();
        const localeGroups = new Map<string, string>();

        // Records whose values were written, paired with the target row and the
        // exact bag that was written, so the second pass can apply their links.
        //
        // Carrying `written` is not an optimisation. `toColumns` writes a field
        // absent from the bag as `null` — a save replaces the whole document —
        // so a second update carrying only the relation fields would blank
        // every scalar the first pass just wrote.
        //
        // It is `withLinks`, not the pre-link bag, and the difference is the
        // whole point: the second pass decides whether to write at all by
        // comparing what it resolved against what is already on the row. Handed
        // the bag *before* the links went in, every non-null relation compares
        // `undefined` against a real id, the guard never holds, and one import
        // costs every record a second UPDATE and a second revision.
        const linkPass: {
            record: TransferRecord;
            targetId: string;
            written: Record<string, unknown>;
        }[] = [];

        const matches = await this.matchAll(document, workspaceId);

        // Context first. A depth-1 record is something a depth-0 record points
        // at, so writing those first means most references already resolve on
        // the first pass — which matters for a required relation on a
        // non-publishable type, where a null FK would be rejected outright.
        const ordered = [...document.records].sort(
            (a, b) => b.$depth - a.$depth
        );

        for (const record of ordered) {
            const type = this.registry.get(record.$type);
            const schema = this.catalog.schemaOf(record.$type);
            if (!type || !schema) {
                verdicts.push(
                    this.verdict(
                        record,
                        IMPORT_ACTION.Error,
                        IMPORT_REASON.UnknownType
                    )
                );
                continue;
            }

            const identity = this.identityFor(document, record.$type);
            const key = naturalKeyOf(identity, record.values);
            // The locale is part of the match on a localized type: its key
            // values are per-row, so `en`/`hello` and `de`/`hallo` are two rows
            // of one record and must not collapse into each other.
            // Key first — it is the identity that means something anywhere.
            // The source row id is the fallback, and it resolves only when the
            // file came home to the database it was exported from; there it is
            // not a guess but a fact, and it is what lets a type with no
            // natural key be linked to rather than written again.
            const match =
                matches.byKey.get(
                    keyFingerprint(record.$type, key, record.$locale)
                ) ?? matches.bySourceId.get(record.$id);

            const decision = this.decide(
                identity.length > 0,
                match,
                record.$depth === 0 ? command.policy : command.relations
            );
            if (decision.action === IMPORT_ACTION.Skip) {
                verdicts.push(
                    this.verdict(
                        record,
                        IMPORT_ACTION.Skip,
                        decision.reason,
                        match?.targetId
                    )
                );
                countVerdict(counts, verdicts[verdicts.length - 1]);
                // Still remembered: a skipped record is a row that *exists*, so
                // other records' references to it must still resolve.
                if (match) {
                    ids.remember(
                        record.$type,
                        record.$id,
                        key,
                        match.targetId,
                        record.$locale
                    );
                }
                continue;
            }
            if (decision.action === IMPORT_ACTION.Error) {
                verdicts.push(
                    this.verdict(record, IMPORT_ACTION.Error, decision.reason)
                );
                countVerdict(counts, verdicts[verdicts.length - 1]);
                continue;
            }

            const needed =
                decision.action === IMPORT_ACTION.Create ? 'create' : 'update';
            if (!command.can[needed]) {
                verdicts.push(
                    this.verdict(
                        record,
                        IMPORT_ACTION.Error,
                        IMPORT_REASON.Forbidden
                    )
                );
                countVerdict(counts, verdicts[verdicts.length - 1]);
                continue;
            }

            const values = await this.resolveMedia(
                record,
                schema,
                command,
                assets,
                counts,
                mediaRun
            );
            // Whatever already resolves goes in on the first write, so a
            // required relation is satisfied at insert time where the document's
            // own ordering allows. The link pass fixes up the rest.
            const withLinks = { ...values, ...this.resolvedLinks(record, ids) };

            if (command.dryRun) {
                verdicts.push(
                    this.verdict(
                        record,
                        decision.action,
                        decision.reason,
                        match?.targetId
                    )
                );
                countVerdict(counts, verdicts[verdicts.length - 1]);
                // The dry run has no new row to point at, but the *key* is
                // enough for the reference report below to be accurate.
                if (match) {
                    ids.remember(
                        record.$type,
                        record.$id,
                        key,
                        match.targetId,
                        record.$locale
                    );
                }
                continue;
            }

            try {
                // `decide` only returns Update when a row matched, but the
                // compiler cannot see that — so read it once and fall back to a
                // create rather than assert it away.
                const targetId =
                    decision.action === IMPORT_ACTION.Create || !match
                        ? await this.create(
                              type,
                              record,
                              withLinks,
                              workspaceId,
                              localeGroups,
                              command.actor
                          )
                        : await this.update(
                              type,
                              match.targetId,
                              withLinks,
                              workspaceId,
                              command.actor
                          );
                ids.remember(
                    record.$type,
                    record.$id,
                    key,
                    targetId,
                    record.$locale
                );
                linkPass.push({ record, targetId, written: withLinks });
                verdicts.push(
                    this.verdict(
                        record,
                        decision.action,
                        decision.reason,
                        targetId
                    )
                );
            } catch (error) {
                verdicts.push({
                    ...this.verdict(
                        record,
                        IMPORT_ACTION.Error,
                        IMPORT_REASON.ValidationFailed
                    ),
                    issues: [messageOf(error)]
                });
            }
            countVerdict(counts, verdicts[verdicts.length - 1]);
        }

        // Second pass: every row now exists, so links can be applied — and the
        // unresolved ones reported rather than silently dropped.
        await this.applyLinks(linkPass, ids, verdicts, command);
        this.reportUnresolved(document.records, ids, verdicts, command.dryRun);

        return {
            version: document.manifest.version,
            counts,
            verdicts,
            hasChanges: hasChanges(counts)
        };
    }

    /**
     * The relation fields of one record that already resolve, as target ids.
     *
     * Best-effort by design: whatever is known at first-write time goes in, and
     * `applyLinks` completes the rest once every row exists. A reference that
     * resolves to nothing is simply absent here rather than written as null,
     * so it does not clear a link the target may already have.
     */
    private resolvedLinks(
        record: TransferRecord,
        ids: TransferIdMap
    ): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(record.relations)) {
            if (value === undefined) continue;
            if (value === null) {
                out[field] = null;
                continue;
            }
            const refs = Array.isArray(value) ? value : [value];
            const resolved = refs
                .map((ref) => ids.resolve(ref).targetId)
                .filter((id): id is string => !!id);
            if (Array.isArray(value)) {
                out[field] = resolved;
            } else if (resolved.length > 0) {
                out[field] = resolved[0];
            }
        }
        return out;
    }

    /**
     * Which fields identify this type, preferring what the **exporter** recorded.
     *
     * The manifest's copy is authoritative because it is what the exporter keyed
     * on. Re-deriving locally would silently move the matching target whenever
     * the schema has drifted since the export — and "the same records imported
     * twice" is exactly the failure that produces.
     */
    private identityFor(
        document: TransferDocument,
        typeName: string
    ): readonly string[] {
        const declared = document.manifest.identity?.[typeName];
        if (declared && declared.length > 0) return declared;
        return this.catalog.identityFieldsOf(typeName);
    }

    /**
     * What to do with one record, given whether it matched and which policy
     * governs it.
     *
     * Two policies reach this, and which one depends only on the record's
     * depth: a record the caller selected is governed by the conflict policy, a
     * record that came along because something pointed at it by the relation
     * policy. They are separate settings because they answer separate
     * questions, and the two share this switch only because their values do not
     * collide — `link` and `recreate` are not conflict policies, `skip`,
     * `duplicate` and `fail` are not relation policies, and `update` means the
     * same thing to both.
     *
     * No match means create under **every** policy, `recreate` included: a
     * related record with nothing to link to has to be written or the link it
     * exists to serve would dangle.
     */
    private decide(
        keyable: boolean,
        match: Match | undefined,
        policy: ConflictPolicy | RelationPolicy
    ): { action: ImportVerdict['action']; reason: ImportReason } {
        if (!match) {
            return {
                action: IMPORT_ACTION.Create,
                reason: keyable ? IMPORT_REASON.New : IMPORT_REASON.NoIdentity
            };
        }
        switch (policy) {
            case CONFLICT_POLICY.Update:
                return {
                    action: IMPORT_ACTION.Update,
                    reason: IMPORT_REASON.Matched
                };
            case CONFLICT_POLICY.Duplicate:
                return {
                    action: IMPORT_ACTION.Create,
                    reason: IMPORT_REASON.ConflictDuplicated
                };
            case CONFLICT_POLICY.Fail:
                return {
                    action: IMPORT_ACTION.Error,
                    reason: IMPORT_REASON.Matched
                };
            case RELATION_POLICY.Link:
                // Skip, like the conflict policy's `skip` — but reported
                // differently, because it is not a conflict. The record exists,
                // the link will point at it, and that is the whole intent.
                return {
                    action: IMPORT_ACTION.Skip,
                    reason: IMPORT_REASON.RelationLinked
                };
            case RELATION_POLICY.Recreate:
                return {
                    action: IMPORT_ACTION.Create,
                    reason: IMPORT_REASON.RelationRecreated
                };
            default:
                return {
                    action: IMPORT_ACTION.Skip,
                    reason: IMPORT_REASON.ConflictSkipped
                };
        }
    }

    /**
     * Matches every record against existing rows, one batched query per type.
     *
     * Per-record lookups would be an N+1 over a file that may hold thousands of
     * rows; this reads each type's candidate rows once, keyed on the identity
     * columns, and matches in memory.
     */
    private async matchAll(
        document: TransferDocument,
        workspaceId: string
    ): Promise<MatchIndex> {
        const out: MatchIndex = {
            byKey: new Map(),
            bySourceId: new Map()
        };
        const byType = new Map<string, TransferRecord[]>();
        for (const record of document.records) {
            const bucket = byType.get(record.$type);
            if (bucket) bucket.push(record);
            else byType.set(record.$type, [record]);
        }

        for (const [typeName, typeRecords] of byType) {
            const type = this.registry.get(typeName);
            if (!type) continue;
            await this.matchBySourceId(type, typeRecords, workspaceId, out);

            // The **same** answer `run` looks the match up with. Deriving it
            // locally here while the lookup used the manifest's copy is how a
            // record that exists gets created anyway: the two sides fingerprint
            // on different fields, so the map is never hit and every match
            // silently degrades to a create.
            const identity = this.identityFor(document, typeName);
            if (identity.length === 0) continue;

            // Narrower than `AnyColumn` because the select builder needs it.
            const columns = type.table as unknown as Record<string, PgColumn>;
            // Only the columns the key is made of are readable as a match, and
            // only if they exist — a configured identity naming a dropped field
            // should match nothing rather than throw.
            const usable = identity.filter((field) => !!columns[field]);
            if (usable.length !== identity.length) continue;

            const wanted = new Set(
                typeRecords.map((record) =>
                    keyFingerprint(
                        typeName,
                        naturalKeyOf(identity, record.values),
                        record.$locale
                    )
                )
            );
            if (wanted.size === 0) continue;

            const projection: Record<string, PgColumn> = { id: columns['id'] };
            for (const field of usable) projection[field] = columns[field];
            // Read back the locale so a candidate row is fingerprinted the same
            // way the incoming record is.
            if (type.i18n && columns['locale']) {
                projection['locale'] = columns['locale'];
            }

            // Narrowed by the first key column's values, so a large collection
            // is not read whole to match a twenty-row file.
            const lead = usable[0];
            const leadValues = [
                ...new Set(
                    typeRecords
                        .map((record) => record.values[lead])
                        .filter(
                            (value): value is string | number =>
                                typeof value === 'string' ||
                                typeof value === 'number'
                        )
                )
            ];
            if (leadValues.length === 0) continue;

            const where: SQL | undefined = and(
                eq(columns['workspaceId'], workspaceId),
                inArray(columns[lead], leadValues),
                type.paranoid ? isNull(columns['deletedAt']) : undefined
            );
            const rows = (await this.db
                .select(projection)
                .from(type.table)
                .where(where)) as Record<string, unknown>[];

            for (const row of rows) {
                const rowLocale = row['locale'];
                const fingerprint = keyFingerprint(
                    typeName,
                    naturalKeyOf(identity, row),
                    typeof rowLocale === 'string' ? rowLocale : undefined
                );
                if (!wanted.has(fingerprint) || out.byKey.has(fingerprint)) {
                    continue;
                }
                out.byKey.set(fingerprint, { targetId: row['id'] as string });
            }
        }
        return out;
    }

    /**
     * Registers every record whose **source row id** still names a live row in
     * this workspace.
     *
     * This is what makes a re-import into the database the file came from link
     * rather than duplicate, and it is the only thing that can do it for a type
     * whose schema offers no natural key — a category with one optional `name`
     * resolves no identity fields at all, so without this every import of it
     * adds another copy of every row.
     *
     * It is a fallback, never a preference: `run` tries the natural key first,
     * because that is the identity that means something on another
     * installation. And it is not a guess. The id is a uuid; if a row with that
     * id exists in this type, in this workspace, and is not deleted, it *is*
     * the row the document was written from.
     */
    private async matchBySourceId(
        type: AnyContentType,
        records: readonly TransferRecord[],
        workspaceId: string,
        into: MatchIndex
    ): Promise<void> {
        const sourceIds = [
            ...new Set(
                records
                    .map((record) => record.$id)
                    .filter(
                        (id): id is string =>
                            typeof id === 'string' && isUuid(id)
                    )
            )
        ];
        if (sourceIds.length === 0) return;

        const columns = type.table as unknown as Record<string, PgColumn>;
        const rows = (await this.db
            .select({ id: columns['id'] })
            .from(type.table)
            .where(
                and(
                    eq(columns['workspaceId'], workspaceId),
                    inArray(columns['id'], sourceIds),
                    type.paranoid ? isNull(columns['deletedAt']) : undefined
                )
            )) as { id: string }[];

        for (const row of rows) {
            into.bySourceId.set(row.id, { targetId: row.id });
        }
    }

    /** Creates a row, joining the right translation group when it has siblings. */
    private async create(
        type: AnyContentType,
        record: TransferRecord,
        values: Record<string, unknown>,
        workspaceId: string,
        localeGroups: Map<string, string>,
        actor?: EventActor | null
    ): Promise<string> {
        // The i18n plugin validates the locale and the group id behind
        // content's extension port — transfer passes them through and stays out
        // of it, which is why this package has no dependency on i18n at all.
        const sourceGroup = record.$localeGroup;
        const targetGroup = sourceGroup
            ? localeGroups.get(sourceGroup)
            : undefined;

        const created = await this.writer.create(
            type,
            values,
            workspaceId,
            undefined,
            record.$locale,
            targetGroup,
            actor ?? null
        );

        // The first sibling of a group creates it; the rest join what it made.
        if (sourceGroup && !targetGroup && created.localeGroupId) {
            localeGroups.set(sourceGroup, created.localeGroupId);
        }
        return created.id;
    }

    private async update(
        type: AnyContentType,
        targetId: string,
        values: Record<string, unknown>,
        workspaceId: string,
        actor?: EventActor | null
    ): Promise<string> {
        const updated = await this.writer.update(
            type,
            targetId,
            values,
            workspaceId,
            undefined,
            actor ?? null
        );
        return updated.id;
    }

    /**
     * The second pass: turn each record's references into real links.
     *
     * Written as a plain update carrying only the relation fields, so it goes
     * through the same writer — and therefore the same target checks and
     * same-locale rule — as any other save. A reference that resolved to
     * nothing is dropped from the payload and reported on the record's verdict;
     * refusing the record for a missing neighbour would fail a whole import
     * over one link.
     */
    private async applyLinks(
        pass: readonly {
            record: TransferRecord;
            targetId: string;
            written: Record<string, unknown>;
        }[],
        ids: TransferIdMap,
        verdicts: ImportVerdict[],
        command: ImportCommand
    ): Promise<void> {
        if (command.dryRun) return;

        for (const { record, targetId, written } of pass) {
            const type = this.registry.get(record.$type);
            if (!type) continue;

            // Start from what was written, not from an empty bag — see the
            // note on `linkPass`.
            const values: Record<string, unknown> = { ...written };
            const unresolved: string[] = [];
            let any = false;

            for (const [field, value] of Object.entries(record.relations)) {
                if (value === undefined) continue;
                if (value === null) {
                    values[field] = null;
                    continue;
                }
                const refs = Array.isArray(value) ? value : [value];
                const resolved: string[] = [];
                for (const ref of refs) {
                    const found = ids.resolve(ref);
                    if (found.targetId) resolved.push(found.targetId);
                    else unresolved.push(describeRef(ref));
                }
                const next = Array.isArray(value)
                    ? resolved
                    : (resolved[0] ?? null);
                values[field] = next;
                // Only a link the first write could not resolve is worth a
                // second write. Re-saving a record whose links already landed
                // costs a redundant UPDATE and, worse, a second revision — so
                // every imported record would carry two entries in its history
                // for one import.
                if (!sameLink(written[field], next)) any = true;
            }

            if (any) {
                try {
                    await this.writer.update(
                        type,
                        targetId,
                        values,
                        command.workspaceId,
                        undefined,
                        command.actor ?? null
                    );
                } catch (error) {
                    unresolved.push(messageOf(error));
                }
            }
            if (unresolved.length > 0) {
                const verdict = verdicts.find(
                    (item) =>
                        item.$type === record.$type && item.$id === record.$id
                );
                if (verdict) verdict.unresolved = unresolved;
            }
        }
    }

    /** On a dry run, report which references would not resolve. */
    private reportUnresolved(
        records: readonly TransferRecord[],
        ids: TransferIdMap,
        verdicts: ImportVerdict[],
        dryRun: boolean
    ): void {
        if (!dryRun) return;
        // In a dry run nothing was written, so a reference resolves only if its
        // target already exists or is itself in the document. Both are known.
        const inDocument = new Set(
            records.map((record) =>
                keyFingerprint(record.$type, record.$key, record.$locale)
            )
        );
        for (const record of records) {
            const unresolved: string[] = [];
            for (const value of Object.values(record.relations)) {
                const refs =
                    value == null ? [] : Array.isArray(value) ? value : [value];
                for (const ref of refs) {
                    const known =
                        ids.resolve(ref).targetId !== undefined ||
                        inDocument.has(
                            keyFingerprint(ref.$type, ref.$key, ref.$locale)
                        );
                    if (!known) unresolved.push(describeRef(ref));
                }
            }
            if (unresolved.length === 0) continue;
            const verdict = verdicts.find(
                (item) => item.$type === record.$type && item.$id === record.$id
            );
            if (verdict) verdict.unresolved = unresolved;
        }
    }

    /** Replaces a record's media references with target asset ids. */
    private async resolveMedia(
        record: TransferRecord,
        schema: {
            fields: readonly {
                name: string;
                type: string;
                multiple?: boolean;
            }[];
        },
        command: ImportCommand,
        assets: TransferAssetMap,
        counts: ImportCounts,
        mediaRun: ImportMediaRun
    ): Promise<Record<string, unknown>> {
        const values = { ...record.values };
        if (record.media.length === 0) return values;

        const byField = new Map<string, string[]>();
        for (const ref of record.media) {
            const targetId = await this.media.resolveAsset(
                ref,
                command.assets,
                assets,
                command.workspaceId,
                command.dryRun,
                command.actor ?? null,
                counts,
                mediaRun
            );
            if (!targetId) continue;
            const bucket = byField.get(ref.field) ?? [];
            bucket.push(targetId);
            byField.set(ref.field, bucket);
        }

        for (const field of schema.fields) {
            if (field.type !== 'media') continue;
            const resolved = byField.get(field.name);
            if (!resolved) continue;
            values[field.name] = field.multiple ? resolved : resolved[0];
        }
        return values;
    }

    private verdict(
        record: TransferRecord,
        action: ImportVerdict['action'],
        reason: ImportReason,
        targetId?: string
    ): ImportVerdict {
        return {
            $type: record.$type,
            $id: record.$id,
            label: labelOf(record),
            ...(record.$locale ? { locale: record.$locale } : {}),
            action,
            reason,
            ...(targetId ? { targetId } : {})
        };
    }
}

/**
 * Whether a relation field's value is unchanged between the two write passes.
 *
 * Order matters for a many-relation — the owner's order is the order — so this
 * is a positional comparison, not a set comparison.
 */
function sameLink(before: unknown, after: unknown): boolean {
    if (Array.isArray(before) && Array.isArray(after)) {
        return (
            before.length === after.length &&
            before.every((item, index) => item === after[index])
        );
    }
    return (before ?? null) === (after ?? null);
}

/** Names a record the way an editor would recognise it. */
function labelOf(record: TransferRecord): string {
    const keyValue = Object.values(record.$key)[0];
    if (keyValue) return keyValue;
    const firstText = Object.values(record.values).find(
        (value) => typeof value === 'string' && value.trim() !== ''
    );
    return typeof firstText === 'string' ? firstText : record.$id;
}

/** `type:key` — how an unresolved reference is reported. */
function describeRef(ref: TransferRef): string {
    const key = Object.values(ref.$key).join('|');
    return `${ref.$type}:${key || (ref.$id ?? '?')}`;
}

/**
 * The message from an unknown throwable, without leaking a stack.
 *
 * The field-level `issues` are unpacked rather than collapsed to the exception's
 * own summary. `EntryWriterService` refuses a write with
 * `{ message: 'Entry validation failed', issues: [{ field, message }] }`, and
 * that summary alone is the least useful sentence a reader could be given about
 * a rejected record: it says something was wrong and names nothing.
 */
function messageOf(error: unknown): string {
    if (error instanceof ForbiddenException) return 'Not permitted.';
    if (error instanceof HttpException) {
        const response = error.getResponse();
        const issues =
            typeof response === 'object' && response !== null
                ? (response as { issues?: unknown }).issues
                : undefined;
        if (Array.isArray(issues) && issues.length > 0) {
            return issues.map(describeIssue).join('; ');
        }
    }
    if (error instanceof Error) return error.message;
    return 'Write failed.';
}

/** One `{ field, message }` issue as a sentence. */
function describeIssue(issue: unknown): string {
    const { field, message } =
        typeof issue === 'object' && issue !== null
            ? (issue as { field?: unknown; message?: unknown })
            : {};
    const text = typeof message === 'string' ? message : 'is not valid';
    return typeof field === 'string' ? `${field} ${text}` : text;
}
