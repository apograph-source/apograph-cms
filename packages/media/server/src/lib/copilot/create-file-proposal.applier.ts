import { proposalEventActor } from '@orthacms/copilot-server';
import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import type {
    ProposalActor,
    ProposalApplier,
    ProposalApplyResult,
    ProposalTarget
} from '@orthacms/copilot-domain';
import { UploadAssetUseCase } from '../application/use-cases/upload-asset.use-case';
import { FILE_FORMATS, isFileFormat } from './file-formats';
import { MEDIA_PROPOSAL_KINDS } from './proposal-kinds';

/**
 * Applies `media.asset.create` through {@link UploadAssetUseCase} — the same
 * use-case the upload route calls, which is the whole point of the port
 * ([ADR-0005](../../../../../../docs/adr/0005-copilot-authority-model.md) §5).
 * Going through it rather than writing a row directly is what gives a generated
 * file, for free:
 *
 * - the asset row and its `media.asset.uploaded` event committed in one
 *   transaction through the outbox, with the accepting human as actor;
 * - a `FOR SHARE` lock on the destination folder, so a file cannot be orphaned
 *   into a folder that is concurrently being deleted;
 * - the blob reclaimed if the transaction rolls back;
 * - routing through whichever `StorageProvider` the host's resolver picks, and
 *   that provider's name recorded for later downloads.
 *
 * None of that is reimplemented here, and an applier that did reimplement it
 * would be a second write path with its own bugs and nobody reviewing the
 * result.
 */
@Injectable()
export class CreateFileProposalApplier implements ProposalApplier {
    readonly kind = MEDIA_PROPOSAL_KINDS.createFile;

    constructor(private readonly upload: UploadAssetUseCase) {}

    async apply(
        input: { target: ProposalTarget; patch: Record<string, unknown> },
        actor: ProposalActor
    ): Promise<ProposalApplyResult> {
        const fileName = input.target['fileName'];
        const folderId = input.target['folderId'];
        const format = input.patch['format'];
        const content = input.patch['content'];
        const alt = input.patch['alt'];

        // `target` and `patch` are opaque jsonb by design, so nothing between
        // the tool and here type-checks them. Re-validating is cheap and turns
        // a malformed row into a legible failure that reopens the proposal,
        // rather than a stack trace from inside the use case.
        if (typeof fileName !== 'string' || fileName.length === 0) {
            throw new Error('This proposal is missing its file name.');
        }
        if (!isFileFormat(format)) {
            throw new Error('This proposal has no file format I can write.');
        }
        if (typeof content !== 'string') {
            throw new Error('This proposal is missing its file contents.');
        }

        const bytes = Buffer.from(content, 'utf8');
        const assetId = await this.upload.execute(
            {
                workspaceId: actor.workspaceId,
                folderId: typeof folderId === 'string' ? folderId : null,
                fileName,
                contentType: FILE_FORMATS[format].mimeType,
                // The description the model was asked for, when it gave one —
                // so a generated file has a real accessible name wherever it is
                // linked instead of a file name (`ORT-120`). Blank is
                // normalized to `null` by the aggregate, so it never counts as
                // covered in the alt-coverage figure.
                ...(typeof alt === 'string' && alt.trim() ? { alt } : {}),
                // Node special-cases a Buffer here rather than iterating it
                // byte by byte, so this is one chunk, not a stream of numbers.
                body: Readable.from(bytes)
            },
            proposalEventActor(actor)
        );

        return {
            entityId: assetId,
            detail: {
                fileName,
                format,
                size: bytes.byteLength,
                downloadPath: `/api/media/assets/${assetId}/raw`
            }
        };
    }
}
