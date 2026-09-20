import { proposalEventActor } from '@orthacms/copilot-server';
import { Injectable } from '@nestjs/common';
import type {
    ProposalActor,
    ProposalApplier,
    ProposalApplyResult,
    ProposalTarget
} from '@orthacms/copilot-domain';
import { InjectContentRegistry } from '../content.tokens';
import type { ContentTypeRegistry } from '../registry/content-type-registry';
import { EntryWriterService } from '../entries/infrastructure/persistence/entry-writer.service';
import { WorkspaceGrantsQuery } from '../content-types/queries/workspace-grants.query';
import { CONTENT_PROPOSAL_KINDS } from './proposal-kinds';

/**
 * Refuses a create that names a translation group — the shape these tools no
 * longer offer.
 *
 * A create is a whole row: `coerceValues` stamps every declared field, so each
 * shared field the change did not name arrives as `null`, and the i18n
 * extension propagates a create's shared columns **outward** onto every sibling
 * — blanking the record in every other language, and silently so where the
 * siblings are all drafts. Doing it correctly means inheriting the source row's
 * shared values at apply time, which is knowledge the i18n plugin owns; hence
 * `i18n_propose_translation` / `i18n_propose_bulk_translation`.
 *
 * The schemas dropped `localeGroupId`, so nothing produces one any more. This
 * guards the one case that outlives a schema: a proposal drafted before the
 * change whose apply failed, left `pending`, and is carried out later.
 */
function assertStartsItsOwnGroup(localeGroupId: unknown): void {
    if (typeof localeGroupId === 'string' && localeGroupId.length > 0) {
        throw new Error(
            'This change would add a language to an existing record, which a content save ' +
                'cannot do without blanking the record’s shared fields in every other ' +
                'language. Translate with i18n_propose_translation or ' +
                'i18n_propose_bulk_translation instead.'
        );
    }
}

/** Resolves a granted, registered type or throws — shared by both appliers. */
async function grantedType(
    registry: ContentTypeRegistry,
    grants: WorkspaceGrantsQuery,
    typeName: unknown,
    workspaceId: string
) {
    const name = typeof typeName === 'string' ? typeName : '';
    const type = registry.get(name);
    const granted = await grants.grantedSlugs(workspaceId);
    if (!type || !granted.has(type.name)) {
        throw new Error(`Unknown content type "${name}" in this workspace.`);
    }
    return type;
}

/**
 * Applies `content.entry.create` — a new draft entry.
 *
 * **It calls `EntryWriterService.create`, the same method the POST route
 * calls.** Not "similar to": the same. That is what makes an accepted proposal
 * validated by `EntryValidationService`, wrapped in the workspace's shared
 * advisory lock, snapshotted as revision 1, and passed through the bound i18n
 * extension exactly as a hand-typed entry would be
 * ([ADR-0005](../../../../../../docs/adr/0005-copilot-authority-model.md) §5).
 * An applier that reimplemented the insert to "keep it simple" is the failure
 * the port exists to prevent.
 *
 * The grants are re-checked here, not trusted from the proposal. The row was
 * written when the proposal was made, and a workspace's content grants can be
 * revoked in between — a stored `typeName` is an argument like any other.
 */
@Injectable()
export class CreateEntryProposalApplier implements ProposalApplier {
    readonly kind = CONTENT_PROPOSAL_KINDS.createEntry;

    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService,
        private readonly grants: WorkspaceGrantsQuery
    ) {}

    async apply(
        input: { target: ProposalTarget; patch: Record<string, unknown> },
        actor: ProposalActor
    ): Promise<ProposalApplyResult> {
        const type = await grantedType(
            this.registry,
            this.grants,
            input.target['typeName'],
            actor.workspaceId
        );
        const values = (input.patch['values'] ?? {}) as Record<string, unknown>;
        const locale = input.target['locale'];
        assertStartsItsOwnGroup(input.target['localeGroupId']);

        const entry = await this.writer.create(
            type,
            values,
            actor.workspaceId,
            // No relation *deltas*. An owning many-relation still lands: it
            // travels as an array in `values`, which the writer turns into a
            // whole-set link write. Deltas are the editor's incremental path
            // and have no caller here.
            undefined,
            typeof locale === 'string' ? locale : undefined,
            // No group to join — a create here always starts its own.
            undefined,
            // The human who accepted is the actor on the write, on its revision
            // and on the domain event it raises — never a copilot identity,
            // which does not exist.
            proposalEventActor(actor)
        );
        return {
            entityId: entry.id,
            detail: { typeName: type.name, status: entry.status ?? 'draft' }
        };
    }
}

/**
 * Applies `content.entry.update` — a change to an existing entry's values.
 *
 * **Merges rather than replaces.** The admin's `PATCH` replaces the whole
 * values bag because the editor always submits the full document; a proposal
 * carries only the fields a reviewer approved, so replacing would silently null
 * everything they did not see. This is the same reasoning — and the same merge
 * semantics — as the public API's partial update.
 *
 * The merge reads the entry **now**, not when the proposal was made, so a
 * proposal accepted an hour later writes the approved fields onto whatever the
 * entry has become instead of resurrecting a stale document. A reviewer
 * approving "fix this typo" gets that typo fixed, not the rest of the entry
 * rewound.
 */
@Injectable()
export class UpdateEntryProposalApplier implements ProposalApplier {
    readonly kind = CONTENT_PROPOSAL_KINDS.updateEntry;

    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService,
        private readonly grants: WorkspaceGrantsQuery
    ) {}

    async apply(
        input: { target: ProposalTarget; patch: Record<string, unknown> },
        actor: ProposalActor
    ): Promise<ProposalApplyResult> {
        const type = await grantedType(
            this.registry,
            this.grants,
            input.target['typeName'],
            actor.workspaceId
        );
        const entryId = input.target['entryId'];
        if (typeof entryId !== 'string') {
            throw new Error('This proposal names no entry.');
        }

        // 404s a missing or soft-deleted entry, workspace-scoped — so a
        // proposal whose target was deleted before it was accepted fails with
        // that reason rather than creating something.
        const current = await this.writer.getOne(
            type,
            entryId,
            actor.workspaceId
        );
        const patch = (input.patch['values'] ?? {}) as Record<string, unknown>;
        const merged = { ...(current.values ?? {}), ...patch };

        const entry = await this.writer.update(
            type,
            entryId,
            merged,
            actor.workspaceId,
            undefined,
            proposalEventActor(actor)
        );
        return {
            entityId: entry.id,
            detail: {
                typeName: type.name,
                fields: Object.keys(patch),
                status: entry.status ?? 'draft'
            }
        };
    }
}

/**
 * Applies `content.entry.bulk-save` — a batch of creates and edits, carried out
 * as one change.
 *
 * **Item by item through the same `EntryWriterService` methods the other two
 * appliers call**, for the same reason they do: validation, the advisory lock,
 * the revision snapshot and the i18n sibling sync all have to happen per entry,
 * and a batch-shaped shortcut around any of them would be a second write path.
 * Sequentially, not concurrently — each write takes the workspace's shared
 * content lock, so a fan-out would mostly contend with itself.
 *
 * **It stops at the first failure and throws.** There is no per-item verdict to
 * show: a proposal is one row with one status, and its card says "Saved" or
 * "Not saved". Carrying on after a failure would grow the number of entries
 * written under a receipt that then reports failure — so the batch halts, and
 * the error names exactly how many landed, which is what the model reads back
 * to the user. (The public API's `bulkSave` does the opposite and keeps going,
 * because there the caller gets every item's verdict and can retry the ones it
 * can fix.)
 */
@Injectable()
export class BulkSaveEntriesProposalApplier implements ProposalApplier {
    readonly kind = CONTENT_PROPOSAL_KINDS.bulkSaveEntries;

    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService,
        private readonly grants: WorkspaceGrantsQuery
    ) {}

    async apply(
        input: { target: ProposalTarget; patch: Record<string, unknown> },
        actor: ProposalActor
    ): Promise<ProposalApplyResult> {
        const type = await grantedType(
            this.registry,
            this.grants,
            input.target['typeName'],
            actor.workspaceId
        );
        const items = input.patch['items'];
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('This change names no entries.');
        }

        const created: string[] = [];
        const updated: string[] = [];

        for (const [index, raw] of items.entries()) {
            const item = (raw ?? {}) as {
                id?: unknown;
                values?: unknown;
                locale?: unknown;
                localeGroupId?: unknown;
            };
            const values = (item.values ?? {}) as Record<string, unknown>;
            const id = typeof item.id === 'string' ? item.id : undefined;

            try {
                if (id) {
                    // Read now, not when the batch was proposed, so an item
                    // written minutes later lands on whatever the entry has
                    // become — the same merge rule the single-entry applier
                    // states at length.
                    const current = await this.writer.getOne(
                        type,
                        id,
                        actor.workspaceId
                    );
                    const entry = await this.writer.update(
                        type,
                        id,
                        { ...(current.values ?? {}), ...values },
                        actor.workspaceId,
                        undefined,
                        proposalEventActor(actor)
                    );
                    updated.push(entry.id);
                } else {
                    assertStartsItsOwnGroup(item.localeGroupId);
                    const entry = await this.writer.create(
                        type,
                        values,
                        actor.workspaceId,
                        undefined,
                        typeof item.locale === 'string'
                            ? item.locale
                            : undefined,
                        // No group to join — see `assertStartsItsOwnGroup`.
                        undefined,
                        proposalEventActor(actor)
                    );
                    created.push(entry.id);
                }
            } catch (error) {
                const done = created.length + updated.length;
                throw new Error(
                    `Entry ${index + 1} of ${items.length} failed: ` +
                        `${error instanceof Error ? error.message : String(error)}. ` +
                        (done === 0
                            ? 'Nothing was saved.'
                            : `The first ${done} were saved and the rest were not.`)
                );
            }
        }

        return {
            // No `entityId`: a batch has no single entity to link to, and
            // naming one of them would send the user to an arbitrary member of
            // the set. The ids are in `detail` instead.
            detail: {
                typeName: type.name,
                created,
                updated,
                count: created.length + updated.length
            }
        };
    }
}
