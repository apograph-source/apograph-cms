import { proposalEventActor } from '@orthacms/copilot-server';
import { Injectable } from '@nestjs/common';
import type {
    ProposalActor,
    ProposalApplier,
    ProposalApplyResult,
    ProposalTarget
} from '@orthacms/copilot-domain';
import { UpdateAssetUseCase } from '../application/use-cases/update-asset.use-case';
import { MEDIA_PROPOSAL_KINDS } from './proposal-kinds';

/**
 * Applies `media.asset.setAlt` through {@link UpdateAssetUseCase} — the same
 * use-case the PATCH route calls, so the change runs in the same unit of work,
 * raises the same domain event, and lands in the audit trail with the accepting
 * human as actor ([ADR-0005](../../../../../../docs/adr/0005-copilot-authority-model.md) §5).
 *
 * The use-case is workspace-scoped and 404s a missing asset, so an asset
 * deleted between proposing and accepting fails with that reason rather than
 * writing anything.
 */
@Injectable()
export class AltTextProposalApplier implements ProposalApplier {
    readonly kind = MEDIA_PROPOSAL_KINDS.setAltText;

    constructor(private readonly updateAsset: UpdateAssetUseCase) {}

    async apply(
        input: { target: ProposalTarget; patch: Record<string, unknown> },
        actor: ProposalActor
    ): Promise<ProposalApplyResult> {
        const assetId = input.target['assetId'];
        const alt = input.patch['alt'];
        if (typeof assetId !== 'string' || typeof alt !== 'string') {
            throw new Error('This proposal is missing an asset or its text.');
        }

        await this.updateAsset.execute(
            assetId,
            actor.workspaceId,
            { alt },
            proposalEventActor(actor)
        );
        return { entityId: assetId, detail: { alt } };
    }
}
