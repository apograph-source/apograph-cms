import { Injectable, NotFoundException } from '@nestjs/common';
import type { EventActor } from '@orthacms/database';
import type { AnyContentType } from '../../../types/content-type';
import { PublishEntryUseCase } from '../../../entries/application/use-cases/publish-entry.use-case';
import type { EntryRecord } from '../../../entries/types/entry-list-view';
import {
    InjectRevisionStore,
    type RevisionStore
} from '../ports/revision-store';
import { RestoreRevisionUseCase } from './restore-revision.use-case';

/**
 * **Publish a specific version** — make any version the entry's live one, so an
 * editor can switch back to an earlier version and publish it (not only the
 * newest draft).
 *
 * Publishing marks the **chosen version itself** live: it is flipped to
 * `published` in place and the previously-published one to `superseded` (via
 * {@link PublishEntryUseCase}). Publishing an **earlier** version first
 * re-applies its content onto the live row (through
 * {@link RestoreRevisionUseCase}, with `appendRevision: false`) so the live
 * document matches what is published — but records **no new version** for it.
 * Publishing v2 therefore leaves the timeline at its existing length with v2
 * marked live, rather than minting a v6 copy of v2 on every publish.
 *
 * History is still never rewritten or deleted — only version *statuses* move,
 * which is what publish means. One consequence to know: after publishing an
 * earlier version the **latest** version is no longer the live content (it is a
 * newer draft that was not published). The timeline distinguishes the two —
 * "Live" marks the published version, "Current" the newest one — and the next
 * save appends a version equal to the live row again.
 *
 * Publishing re-validates through the publish gate, so an incomplete old version
 * surfaces the same `422 { issues }` a normal publish would (the content has
 * already been re-applied in that case, leaving it live as a draft — a
 * deliberate, recoverable state, not a rewrite of history).
 */
@Injectable()
export class PublishRevisionUseCase {
    constructor(
        private readonly restoreRevision: RestoreRevisionUseCase,
        private readonly publishEntry: PublishEntryUseCase,
        @InjectRevisionStore() private readonly store: RevisionStore
    ) {}

    async execute(
        type: AnyContentType,
        id: string,
        number: number,
        workspaceId: string,
        actor: EventActor | null
    ): Promise<EntryRecord> {
        const detail = await this.store.get(type.name, id, workspaceId, number);
        if (!detail) {
            throw new NotFoundException(
                `No revision #${number} for entry "${id}" on "${type.name}".`
            );
        }
        // Only re-apply an *earlier* version; the latest is already the live row.
        // `appendRevision: false` — this version already exists in the timeline
        // and is about to be marked live, so a copy of it would be noise.
        if (!detail.isLatest) {
            await this.restoreRevision.execute(
                type,
                id,
                number,
                workspaceId,
                actor,
                { appendRevision: false }
            );
        }
        // Mark *this* version live (not merely "the latest"), now that the live
        // row carries its content.
        return this.publishEntry.execute(
            type,
            id,
            workspaceId,
            actor ?? undefined,
            number
        );
    }
}
