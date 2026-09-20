import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { EventActor } from '@ortha/database';
import type { AnyContentType } from '../../types/content-type';
import { toRecord } from '../../entries/infrastructure/persistence/entry-row';
import { EntryWriterService } from '../../entries/infrastructure/persistence/entry-writer.service';
import { PublishEntryUseCase } from '../../entries/application/use-cases/publish-entry.use-case';
import { UnpublishEntryUseCase } from '../../entries/application/use-cases/unpublish-entry.use-case';
import { BulkPublishEntriesUseCase } from '../../entries/application/use-cases/bulk-publish-entries.use-case';
import { BulkUnpublishEntriesUseCase } from '../../entries/application/use-cases/bulk-unpublish-entries.use-case';
import type {
    BulkActionResult,
    BulkPublishResult
} from '../../entries/types/bulk-publish';
import type { PublicSaveEntryDto } from '../http/dto/public-save-entry.dto';
import type { PublicBulkSaveItemDto } from '../http/dto/public-bulk.dto';
import {
    BULK_SAVE_OP,
    type BulkSaveOp,
    type PublicBulkError,
    type PublicBulkSaveItemResult,
    type PublicBulkSaveResult
} from '../types/public-bulk';
import { resolveBulkSaveOp } from './bulk-save-op';
import type { PublicEntry } from '../types/public-entry';
import { PublicEntriesQuery, type EntryLocator } from './public-entries.query';

/**
 * The write side of the public content API.
 *
 * **A thin edge over the admin's write pipeline, deliberately** — the opposite
 * call from the read side, and for the opposite reason. The read stated its own
 * WHERE because `EntriesService`'s knobs select rows a token must never see, so
 * reaching through it would have made the visibility rule an argument about what
 * was *not* passed. A write has no such hazard and a great deal more to get
 * right: `EntryWriterService` already owns field validation, relation-delta
 * application, media-target checks, revision numbering serialized by a per-entry
 * advisory lock, the transactional outbox, and the i18n extension's sibling sync
 * (which demotes rewritten published translations and re-validates them). A
 * second implementation of any of that is how you get duplicate version numbers
 * and translations that quietly drift. So this class adds exactly three things
 * the writer does not know about — the locator, the grant gate (in the
 * controller), and the public wire shape — and delegates the rest.
 *
 * **Responses are re-read through the public projection** rather than mapped
 * from the writer's `EntryRecord`. It costs one SELECT per write and buys the
 * guarantee that what a write returns is byte-identical in shape to what a read
 * returns — including the reference fields the public `values` omits, which a
 * hand-written mapper would have to remember to strip every time the field
 * vocabulary grows.
 *
 * **No `OriginGuard`.** The admin's write controllers carry it because they are
 * cookie-authenticated and therefore CSRF-able. A bearer token is not sent
 * ambiently by a browser, so there is nothing to forge here — and requiring an
 * `Origin` header would break every non-browser client, which is all of them.
 */
@Injectable()
export class PublicEntryWritesService {
    constructor(
        private readonly writer: EntryWriterService,
        private readonly entries: PublicEntriesQuery,
        private readonly publishEntry: PublishEntryUseCase,
        private readonly unpublishEntry: UnpublishEntryUseCase,
        private readonly bulkPublishEntries: BulkPublishEntriesUseCase,
        private readonly bulkUnpublishEntries: BulkUnpublishEntriesUseCase
    ) {}

    /**
     * Create an entry. It lands as a **draft** on publishable types — the same
     * as the editor's "new record", and the reason publish is its own call: a
     * create that went live immediately would have no reviewable state.
     *
     * With `localeGroupId` the row joins an existing translation group instead
     * of starting one, which is how a new locale of an existing record is
     * written.
     */
    async create(
        type: AnyContentType,
        body: PublicSaveEntryDto,
        workspaceId: string,
        grantedTypes: ReadonlySet<string>,
        actor?: EventActor
    ): Promise<PublicEntry> {
        const record = await this.writer.create(
            type,
            body.values,
            workspaceId,
            body.relations,
            body.locale,
            body.localeGroupId,
            // The **token** is the actor. Its id never reaches the revision's
            // `created_by` — that column really is a `users` FK, and the writer's
            // `revisionActorId` is what keeps the two apart — but it does reach
            // the audit row, which carries an `actor_type` saying what it names.
            actor ?? null
        );
        return this.readBack(type, record.id, workspaceId, grantedTypes, body);
    }

    /**
     * Update an entry's values and apply its relation deltas. On a publishable
     * type this moves a published row back to `draft` while its published
     * version stays live — the admin's **Modified** state — so an edit never
     * silently changes what the world is reading.
     *
     * **A genuine partial update**, and this is a deliberate divergence from the
     * admin's `PATCH`, which replaces the whole values bag because the editor
     * always submits the full document. An API client does not: it sends the two
     * fields it changed. Under replace semantics that silently nulls everything
     * else — and since `required` only bites at publish time, the damage is
     * invisible until a later publish fails on fields the caller never touched.
     * A method named PATCH that destroys unsent data is a data-loss footgun, so
     * the stored values are merged under the submitted ones here.
     *
     * Merge is **by key presence**, so nulling a field explicitly still works:
     * `{"excerpt": null}` clears it, while omitting `excerpt` leaves it alone.
     *
     * `locale` here is the **addressing** locale — the query string's, which
     * picks the row out of a translation group. It is deliberately not
     * `body.locale`: that field is create-only (it stamps a new row's locale),
     * and reading it here would let a body that omits it silently retarget a
     * group write at the default-locale row. Which is exactly what it did, until
     * a live check caught a German update rewriting the English article.
     */
    async update(
        type: AnyContentType,
        locator: EntryLocator,
        body: PublicSaveEntryDto,
        workspaceId: string,
        grantedTypes: ReadonlySet<string>,
        locale?: string,
        actor?: EventActor
    ): Promise<PublicEntry> {
        const row = await this.entries.resolveWritableRow(
            type,
            locator,
            workspaceId,
            locale
        );
        const id = row['id'] as string;
        await this.writer.update(
            type,
            id,
            // `toRecord` yields the stored column-backed values — scalars, media
            // ids, and owning single-relation FKs. Join-backed relations have no
            // column and are absent from it, which is correct: those move only
            // through `relations` deltas, and a delta left unsent changes
            // nothing by construction.
            this.mergedValues(type, row, body),
            workspaceId,
            body.relations,
            actor ?? null
        );
        return this.readBack(type, id, workspaceId, grantedTypes, { locale });
    }

    /**
     * Save many entries of one type in a single request — the batch form of
     * {@link create} and {@link update}, and the reason it is one method rather
     * than two: an import is a list of records, some of which the caller already
     * has and some of which it does not, and splitting that into two calls would
     * make the client sort them first.
     *
     * **Each item is dispatched to the very same `create` / `update` above.**
     * Nothing about what a write means is restated here — validation, relation
     * deltas, media checks, revision numbering, the outbox, i18n's sibling sync
     * all come from the one pipeline, so "saved in bulk" and "saved one at a
     * time" cannot mean different things.
     *
     * **Partial success, item by item.** The items are written one transaction
     * at a time (`EntryWriterService` opens its own per write, taking the
     * workspace's shared content lock), so there is no batch to roll back even
     * in principle — and rejecting forty-nine good entries because the fiftieth
     * names a relation that does not exist would defeat the point of the
     * endpoint. Every item therefore gets a verdict, failures carry the status
     * and message their single-entry call would have produced, and the caller
     * retries the ones it can fix. This is the same contract the bulk-publish
     * commit already reports through its `skipped` list.
     *
     * **Written in order, one after another** rather than concurrently. Every
     * write takes the workspace's shared content lock and (on a localized type)
     * an advisory lock over the translation group, so a batch touching siblings
     * would spend a fan-out contending with itself; sequential also makes the
     * per-item results deterministic, which a caller diffing two runs relies on.
     */
    async bulkSave(
        type: AnyContentType,
        items: readonly PublicBulkSaveItemDto[],
        workspaceId: string,
        grantedTypes: ReadonlySet<string>,
        actor?: EventActor
    ): Promise<PublicBulkSaveResult> {
        const results: PublicBulkSaveItemResult[] = [];

        for (const [index, item] of items.entries()) {
            // Resolved inside the loop, and inside the try: a malformed
            // locator is this item's problem, not the request's. Failing the
            // whole call on it would make one mis-addressed row cost every
            // other row's write — the very thing the per-item contract exists
            // to prevent.
            let op: BulkSaveOp = BULK_SAVE_OP.Create;
            try {
                const resolved = resolveBulkSaveOp(item);
                op = resolved.op;
                const entry =
                    resolved.op === BULK_SAVE_OP.Create
                        ? await this.create(
                              type,
                              item,
                              workspaceId,
                              grantedTypes,
                              actor
                          )
                        : await this.update(
                              type,
                              resolved.locator,
                              item,
                              workspaceId,
                              grantedTypes,
                              resolved.locale,
                              actor
                          );
                results.push({ index, op: resolved.op, ok: true, entry });
            } catch (error) {
                results.push({
                    index,
                    op,
                    ok: false,
                    error: toBulkSaveError(error)
                });
            }
        }

        return {
            items: results,
            created: results.filter(
                (result) => result.ok && result.op === BULK_SAVE_OP.Create
            ).length,
            updated: results.filter(
                (result) => result.ok && result.op === BULK_SAVE_OP.Update
            ).length,
            failed: results.filter((result) => !result.ok).length
        };
    }

    /**
     * The values bag an update submits: the stored values with the caller's
     * merged over them (see {@link update}), minus any single relation the
     * caller is setting through `relations`.
     *
     * That subtraction is what makes the two channels coexist. `toRecord`
     * re-supplies every column-backed field including single-relation FKs, so
     * without it a `relations: { author: { set } }` would always arrive
     * alongside a stored `values.author` and be rejected as "sent in both
     * places" — a collision this method created rather than the caller.
     */
    private mergedValues(
        type: AnyContentType,
        row: Record<string, unknown>,
        body: PublicSaveEntryDto
    ): Record<string, unknown> {
        const merged = { ...toRecord(type, row).values, ...body.values };
        for (const [field, delta] of Object.entries(body.relations ?? {})) {
            // Only the STORED value is dropped. A field the caller put in both
            // bags themselves stays, so the writer still sees the contradiction
            // and rejects it — the point is to hide this method's own
            // re-supplied value, not to paper over an ambiguous request.
            if (
                delta.set !== undefined &&
                !Object.hasOwn(body.values ?? {}, field)
            ) {
                delete merged[field];
            }
        }
        return merged;
    }

    /**
     * Publish many entries at once.
     *
     * **Delegates to `BulkPublishEntriesUseCase` — the admin's own** — rather
     * than looping over {@link publish}. That use-case selects the candidate
     * rows `FOR UPDATE` and re-validates them inside **one** transaction, which
     * is the only thing that closes the window between "this draft validates"
     * and "publish it"; a loop of single publishes would reopen it once per id.
     * It also reports the ids it skipped and why (already published, blocked by
     * validation, not found in this workspace), so a partial batch is legible
     * rather than a flat count.
     *
     * The grant gate has already run in the caller, and the use-case is
     * workspace-scoped, so an id from another workspace is reported as
     * `not-found` — the same answer an id that never existed gets.
     */
    bulkPublish(
        type: AnyContentType,
        ids: string[],
        workspaceId: string,
        actor?: EventActor
    ): Promise<BulkPublishResult> {
        return this.bulkPublishEntries.execute(type, ids, workspaceId, actor);
    }

    /**
     * Take many entries off the air, reverting each to a draft.
     *
     * `{ count }` rather than a per-id verdict, because unpublishing has no
     * gate to fail: an id that is not a live published row of this workspace is
     * simply not one of the rows that changed. The count is the number that
     * actually transitioned, and one `entry.unpublished` event is emitted per
     * transition — never per submitted id.
     */
    bulkUnpublish(
        type: AnyContentType,
        ids: string[],
        workspaceId: string,
        actor?: EventActor
    ): Promise<BulkActionResult> {
        return this.bulkUnpublishEntries.execute(type, ids, workspaceId, actor);
    }

    /**
     * Remove many entries — soft-deleting on a `paranoid` type (recoverable
     * from the admin's trash) and hard-deleting otherwise, exactly as
     * {@link remove} does for one.
     *
     * Rows, not records: on a localized type this deletes the listed locales
     * and leaves their siblings live.
     */
    bulkRemove(
        type: AnyContentType,
        ids: string[],
        workspaceId: string,
        actor?: EventActor
    ): Promise<BulkActionResult> {
        return this.writer.bulkRemove(type, ids, workspaceId, actor);
    }

    /** Take an entry live. 422 when the stored draft no longer validates. */
    async publish(
        type: AnyContentType,
        locator: EntryLocator,
        workspaceId: string,
        grantedTypes: ReadonlySet<string>,
        locale?: string,
        actor?: EventActor
    ): Promise<PublicEntry> {
        const row = await this.entries.resolveWritableRow(
            type,
            locator,
            workspaceId,
            locale
        );
        const id = row['id'] as string;
        await this.publishEntry.execute(type, id, workspaceId, actor);
        return this.readBack(type, id, workspaceId, grantedTypes, { locale });
    }

    /** Take an entry back off the air, reverting it to a draft. */
    async unpublish(
        type: AnyContentType,
        locator: EntryLocator,
        workspaceId: string,
        grantedTypes: ReadonlySet<string>,
        locale?: string,
        actor?: EventActor
    ): Promise<PublicEntry> {
        const row = await this.entries.resolveWritableRow(
            type,
            locator,
            workspaceId,
            locale
        );
        const id = row['id'] as string;
        await this.unpublishEntry.execute(type, id, workspaceId, actor);
        return this.readBack(type, id, workspaceId, grantedTypes, { locale });
    }

    /**
     * Remove an entry — soft delete on a `paranoid` type (recoverable from the
     * admin's trash), a hard delete otherwise. Either way it leaves the public
     * API immediately.
     *
     * Only **this** row: a translation is deleted on its own, so removing the
     * German article leaves the English one live. Deleting a whole group means
     * deleting each locale.
     */
    async remove(
        type: AnyContentType,
        locator: EntryLocator,
        workspaceId: string,
        locale?: string,
        actor?: EventActor
    ): Promise<void> {
        const row = await this.entries.resolveWritableRow(
            type,
            locator,
            workspaceId,
            locale
        );
        await this.writer.remove(type, row['id'] as string, workspaceId, actor);
    }

    /**
     * Re-read a just-written row through the public projection.
     *
     * `status: 'any'` because the row is usually a draft — the published-only
     * default would 404 the thing that was just created. The locale is carried
     * through so a sibling translation resolves to itself rather than to the
     * default-locale row of its group.
     */
    private readBack(
        type: AnyContentType,
        id: string,
        workspaceId: string,
        grantedTypes: ReadonlySet<string>,
        source: { locale?: string }
    ): Promise<PublicEntry> {
        return this.entries.getOne(
            type,
            { id },
            workspaceId,
            { locale: source.locale, status: 'any' },
            grantedTypes
        );
    }
}

/**
 * One item's failure, in the vocabulary the single-entry routes already speak.
 *
 * A Nest `HttpException` carries both halves of what the caller needs — the
 * status the same write would have failed with, and the body it would have been
 * given, `issues` and all — so a 422's per-field detail survives being one row
 * of a batch instead of being flattened to a sentence. Anything else is a bug
 * rather than a rejection, and is reported as a 500 with its message so the item
 * is still diagnosable; the batch keeps going either way, because one item
 * throwing unexpectedly is not a reason to abandon the rest.
 */
function toBulkSaveError(error: unknown): PublicBulkError {
    if (error instanceof HttpException) {
        const response = error.getResponse();
        const body =
            typeof response === 'object' && response !== null
                ? (response as Record<string, unknown>)
                : {};
        const message = body['message'];
        return {
            status: error.getStatus(),
            message: typeof message === 'string' ? message : error.message,
            ...(body['issues'] === undefined ? {} : { issues: body['issues'] })
        };
    }
    return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: error instanceof Error ? error.message : String(error)
    };
}
