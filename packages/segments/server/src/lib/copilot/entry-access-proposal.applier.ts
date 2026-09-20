import { proposalEventActor } from '@orthacms/copilot-server';
import { Injectable } from '@nestjs/common';
import {
    InjectContentRegistry,
    WorkspaceGrantsQuery,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import type {
    ProposalActor,
    ProposalApplier,
    ProposalApplyResult,
    ProposalTarget
} from '@orthacms/copilot-domain';
import { EntryAccessService } from '../application/entry-access.service';
import { SEGMENTS_PROPOSAL_KINDS } from './entry-access-proposal.provider';

/**
 * Carries out an accepted `segments.setEntryAccess` proposal.
 *
 * It writes through **`EntryAccessService.setForGroup`**, the same method the
 * entry save's extension and the `PUT` route use, so an accepted proposal cannot
 * mean anything the other two do not: both lists replaced wholesale, two empty
 * ones deleting the row, the workspace-scope check applied, and every language of
 * the record written together.
 *
 * **It appends no revision, and that is the honest reading.** A save carries
 * access because the record is being written; this changes only who may read
 * what is already there, exactly as the `PUT` route does. The entry's own
 * timeline is a history of its content — the proposal row is where "the copilot
 * restricted this, and who accepted it" is recorded.
 *
 * The workspace grant is re-checked here rather than trusted from the proposal:
 * a proposal can sit between being drafted and being accepted, and a type
 * ungranted in that window must not be written through an old card.
 */
@Injectable()
export class EntryAccessProposalApplier implements ProposalApplier {
    readonly kind = SEGMENTS_PROPOSAL_KINDS.setEntryAccess;

    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly grants: WorkspaceGrantsQuery,
        private readonly access: EntryAccessService
    ) {}

    async apply(
        input: { target: ProposalTarget; patch: Record<string, unknown> },
        actor: ProposalActor
    ): Promise<ProposalApplyResult> {
        const typeName = input.target['typeName'];
        const entryId = input.target['entryId'];
        if (typeof typeName !== 'string' || typeof entryId !== 'string') {
            throw new Error('This proposal is missing its entry.');
        }

        const type = this.registry.get(typeName);
        const granted = await this.grants.grantedSlugs(actor.workspaceId);
        if (!type || !granted.has(type.name)) {
            throw new Error(
                `Unknown content type "${typeName}" in this workspace.`
            );
        }

        const written = await this.access.setForGroup({
            workspaceId: actor.workspaceId,
            type,
            entryId,
            allow: idList(input.patch['allow']),
            deny: idList(input.patch['deny']),
            // The acting human, never the copilot: a proposal applies under the
            // authority of the person whose run produced it, and the audit row
            // has to name them.
            actor: proposalEventActor(actor)
        });

        return {
            entityId: entryId,
            detail: {
                allow: written.access.allow,
                deny: written.access.deny,
                // How many rows it reached, so a run's receipt can say "and its
                // three translations" rather than leaving that to be discovered.
                entries: written.entryIds.length
            }
        };
    }
}

/** One side of a stored proposal's patch, read defensively. */
function idList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === 'string');
}
