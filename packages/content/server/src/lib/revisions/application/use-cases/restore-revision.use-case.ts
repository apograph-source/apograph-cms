import { Injectable, NotFoundException } from '@nestjs/common';
import type { EventActor } from '@orthacms/database';
import type { AnyContentType } from '../../../types/content-type';
import { CONTENT_FIELD_TYPE } from '../../../types/fields';
import { EntryWriterService } from '../../../entries/infrastructure/persistence/entry-writer.service';
import type { EntryRecord } from '../../../entries/types/entry-list-view';
import {
    InjectRevisionStore,
    type RevisionStore
} from '../ports/revision-store';

/**
 * Restore an entry to an earlier revision. History is **append-only** — a
 * restore never rewrites or deletes past versions: it applies the chosen
 * snapshot back onto the live row through the normal save path, which in turn
 * records the restore as a **new** draft revision (so v5 restoring v2 yields a
 * fresh v6 equal to v2). The snapshot's `values` (scalars, localized + shared
 * fields, single-relation FKs) and its owning many-to-many link sets are
 * re-applied; inverse relations mirror their owning side and aren't written from
 * here.
 */
@Injectable()
export class RestoreRevisionUseCase {
    constructor(
        private readonly writer: EntryWriterService,
        @InjectRevisionStore() private readonly store: RevisionStore
    ) {}

    async execute(
        type: AnyContentType,
        id: string,
        number: number,
        workspaceId: string,
        /**
         * The acting user — stamped on the new revision and on the
         * `entry.updated` event the underlying save raises, so a restore is
         * attributable in the audit log like any other edit.
         */
        actor: EventActor | null,
        options?: {
            /**
             * Whether this restore records a new version (default `true` — the
             * append-only Restore action). {@link PublishRevisionUseCase} passes
             * `false`: it re-applies the snapshot only so the chosen version's
             * content is live, then marks *that* version published in place.
             */
            appendRevision?: boolean;
        }
    ): Promise<EntryRecord> {
        const detail = await this.store.get(type.name, id, workspaceId, number);
        if (!detail) {
            throw new NotFoundException(
                `No revision #${number} for entry "${id}" on "${type.name}".`
            );
        }
        // Merge the snapshot's owning many-to-many link sets into the values bag
        // so the writer's whole-set `writeLinks` re-applies them; single FKs and
        // scalar/localized values already ride `values`.
        const values: Record<string, unknown> = { ...detail.snapshot.values };
        for (const [field, ids] of Object.entries(detail.snapshot.relations)) {
            const spec = type.fields[field];
            if (
                spec?.type === CONTENT_FIELD_TYPE.Relation &&
                spec.relation?.many &&
                !spec.relation.inverse
            ) {
                values[field] = ids;
            }
        }
        return this.writer.update(
            type,
            id,
            values,
            workspaceId,
            undefined,
            // Restoring reaches the log as the `entry.updated` its save raises,
            // naming the fields it put back — which is right, and used to be
            // the whole story: nothing said the edit *was* a restore, or of
            // which version. `via` carries that without inventing a kind, the
            // same seam a copilot-applied change uses.
            actor
                ? {
                      ...actor,
                      via: { kind: 'revision_restore', revisionNumber: number }
                  }
                : actor,
            {
                ...options,
                // Put back whatever the bound extensions held when this version was
                // captured — segments' audiences, today. Without it "go back to
                // Tuesday" would restore Tuesday's words in front of today's
                // readers, which is the half of a restore nobody would think to
                // check. A version captured before any extension existed carries no
                // bag, and an absent bag changes nothing (an omitted key is left
                // alone) — which is the right reading: that version knows nothing
                // about audiences, it does not assert the entry had none.
                extensions: detail.snapshot.extra
            }
        );
    }
}
