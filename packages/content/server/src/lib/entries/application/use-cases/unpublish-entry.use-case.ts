import {
    BadRequestException,
    Injectable,
    NotFoundException
} from '@nestjs/common';
import {
    attachActor,
    type EventActor,
    OutboxWriter,
    UnitOfWork
} from '@orthacms/database';
import { type EntryStatus } from '@orthacms/content-domain';
import type { AnyContentType } from '../../../types/content-type';
import { EntryWriterService } from '../../infrastructure/persistence/entry-writer.service';
import { toRecord } from '../../infrastructure/persistence/entry-row';
import type { EntryRecord } from '../../types/entry-list-view';
import { entryTitle } from '../../infrastructure/persistence/entry-row';
import { Entry } from '../../domain/entry';

/**
 * Revert one entry to draft. Runs inside a {@link UnitOfWork} so the status
 * write and the `entry.unpublished` outbox event commit atomically. The
 * {@link Entry} domain model applies the `published → draft` transition (an
 * already-draft row is an idempotent no-op that raises no event). The write is
 * unconditional, preserving the original behavior; 400 on a non-publishable
 * type, 404 on a missing live row.
 */
@Injectable()
export class UnpublishEntryUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly writer: EntryWriterService
    ) {}

    async execute(
        type: AnyContentType,
        id: string,
        workspaceId: string,
        /**
         * The acting user, merged onto the outbox events so the audit log can
         * name who did this. Without it every content row in the activity log
         * read "System".
         */
        actor?: EventActor
    ): Promise<EntryRecord> {
        if (!type.publishable) {
            throw new BadRequestException(
                `Content type "${type.name}" is not publishable.`
            );
        }
        return this.uow.run(async () => {
            const exec = this.uow.current();
            const current = await this.writer.findLive(
                type,
                id,
                workspaceId,
                exec
            );
            if (!current) throw this.notFound(type, id);

            const entry = Entry.rehydrate({
                id,
                contentType: type.name,
                status: current['status'] as EntryStatus,
                workspaceId,
                // The stored row is already loaded, so the audit row gets a
                // readable name for free rather than a bare uuid.
                title: entryTitle(type, current)
            });
            entry.unpublish();

            const updated = await this.writer.markDraft(
                exec,
                type,
                id,
                workspaceId
            );
            if (!updated) throw this.notFound(type, id);
            // Revert the entry's published revision back to draft so the history
            // timeline no longer shows a live version.
            await this.writer.markRevisionUnpublished(exec, id, workspaceId);
            await this.outbox.append(
                actor
                    ? attachActor(entry.pullEvents(), actor)
                    : entry.pullEvents()
            );
            return toRecord(type, updated);
        });
    }

    private notFound(type: AnyContentType, id: string): NotFoundException {
        return new NotFoundException(
            `No entry "${id}" on content type "${type.name}".`
        );
    }
}
