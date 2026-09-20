import { BadRequestException, Injectable } from '@nestjs/common';
import {
    attachActor,
    type EventActor,
    OutboxWriter,
    UnitOfWork
} from '@orthacms/database';
import { ENTRY_STATUS } from '@orthacms/content-domain';
import type { AnyContentType } from '../../../types/content-type';
import { EntryWriterService } from '../../infrastructure/persistence/entry-writer.service';
import type { BulkActionResult } from '../../types/bulk-publish';
import { Entry } from '../../domain/entry';
import { entryTitle } from '../../infrastructure/persistence/entry-row';

/**
 * Revert a set of live entries to draft. Runs inside one {@link UnitOfWork}, and
 * **one set of ids runs through all three effects**: the `{ count }` reported,
 * the revisions reverted, and the `entry.unpublished` events appended are the
 * rows that were `published` before the write and no others.
 *
 * The count used to be broader — every live row the id list matched, draft ones
 * included — while the events were already per real transition. Two numbers for
 * one operation, and the wider of them was the one the caller was shown. 400 on
 * a non-publishable type.
 */
@Injectable()
export class BulkUnpublishEntriesUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly writer: EntryWriterService
    ) {}

    async execute(
        type: AnyContentType,
        ids: string[],
        workspaceId: string,
        actor?: EventActor
    ): Promise<BulkActionResult> {
        if (!type.publishable) {
            throw new BadRequestException(
                `Content type "${type.name}" is not publishable.`
            );
        }
        if (!ids.length) return { count: 0 };

        return this.uow.run(async () => {
            const exec = this.uow.current();
            // The set that actually transitions (published → draft), captured
            // before the write so we emit one event per real change.
            const publishedIds = await this.writer.publishedIdsAmong(
                exec,
                type,
                ids,
                workspaceId
            );
            // Read the labels **before** the write: an audit row carries a
            // frozen title, and after `markDraftBulk` the rows are still there
            // but a later kind (a purge) would have taken them, so reading them
            // up front is the habit that keeps every bulk path the same shape.
            const byId = await this.writer.loadLiveByIds(
                type,
                publishedIds,
                workspaceId,
                exec
            );
            const count = await this.writer.markDraftBulk(
                exec,
                type,
                ids,
                workspaceId
            );
            // Revert each really-transitioned entry's published revision back to
            // draft — the same set the outbox emits an event for.
            for (const id of publishedIds) {
                await this.writer.markRevisionUnpublished(
                    exec,
                    id,
                    workspaceId
                );
            }
            const events = publishedIds.flatMap((id) => {
                const row = byId.get(id);
                const entry = Entry.rehydrate({
                    id,
                    contentType: type.name,
                    status: ENTRY_STATUS.Published,
                    workspaceId,
                    title: row ? entryTitle(type, row) : null
                });
                entry.unpublish();
                return entry.pullEvents();
            });
            await this.outbox.append(
                actor ? attachActor(events, actor) : events
            );
            return { count };
        });
    }
}
