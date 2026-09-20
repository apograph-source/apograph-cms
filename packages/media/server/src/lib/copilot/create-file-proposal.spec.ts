import { Test } from '@nestjs/testing';
import type { ProposalActor, ProposalDraft } from '@orthacms/copilot-domain';
import type { ToolContext, ToolDefinition } from '@orthacms/tools-server';
import { UploadAssetUseCase } from '../application/use-cases/upload-asset.use-case';
import type { ListFoldersQuery } from '../infrastructure/queries/list-folders.query';
import { CreateFileProposalApplier } from './create-file-proposal.applier';
import {
    CreateFileProposalToolProvider,
    MAX_AUTHORED_BYTES
} from './create-file-proposal.provider';

const ctx: ToolContext = {
    actor: {
        kind: 'user',
        id: 'user-1',
        displayName: 'Ada',
        grantedPermissions: new Set<string>(),
        userId: 'user-1'
    },
    workspaceId: 'ws-1',
    surface: 'copilot',
    can: () => true
};

/**
 * The two ends of `media_propose_file` that the end-to-end suite does not
 * reach: the ceiling on what the model may author, and the applier's one job.
 *
 * `copilot-media-files.spec.ts` drives a real run through the tool and pins the
 * path rejection and the closed format enumeration. What it does not exercise
 * is a megabyte of tool argument — an e2e that shipped one through a live model
 * fixture would cost the whole suite a megabyte per run — nor the applier,
 * which it can only observe through the asset that comes out the far end.
 */
describe('media_propose_file', () => {
    const proposeFile = (): ToolDefinition => {
        const folders = {
            execute: jest.fn().mockResolvedValue({ folders: [] })
        } as unknown as ListFoldersQuery;
        const tool = new CreateFileProposalToolProvider(folders)
            .tools()
            .find((one) => one.name === 'media_propose_file');
        if (!tool) throw new Error('media_propose_file is not registered');
        return tool;
    };

    const draft = (content: string) =>
        proposeFile().handler(
            {
                fileName: 'Q3 audit',
                format: 'md',
                content,
                summary: 'Q3 content audit as Markdown'
            },
            ctx
        ) as Promise<ProposalDraft>;

    /**
     * The ceiling is far below `maxUploadBytes` (50 MB by default) on purpose:
     * this content arrived as a tool argument, generated token by token, so a
     * megabyte of it is a model that has stopped terminating rather than a big
     * report.
     */
    // covers: media:I-32
    it('refuses a file over the authoring ceiling, and says how far over', async () => {
        await expect(draft('a'.repeat(MAX_AUTHORED_BYTES + 1))).rejects.toThrow(
            /1024KB limit/
        );
    });

    // covers: media:I-32
    it('accepts a file of exactly the ceiling', async () => {
        // The bound is inclusive, and this is the case that says which side of
        // it `MAX_AUTHORED_BYTES` sits on — a `>=` here would reject the
        // documented maximum.
        const proposal = await draft('a'.repeat(MAX_AUTHORED_BYTES));

        expect(proposal.kind).toBe('media.asset.create');
    });

    // covers: media:I-32
    it('measures the content in bytes, not characters', async () => {
        // An emoji is four UTF-8 bytes and a `length` of two. Half the cap's
        // worth of them is two megabytes of file whose `content.length` is
        // exactly the cap — so a ceiling read off the string length would
        // accept it, and this is the fixture that tells the two apart.
        await expect(
            draft('🙂'.repeat(MAX_AUTHORED_BYTES / 2))
        ).rejects.toThrow(/limit for a generated file/);
    });

    /**
     * The applier writes nothing itself. Everything a generated file gets for
     * free — the row and its `media.asset.uploaded` event in one transaction,
     * the `FOR SHARE` lock on the destination folder, blob reclamation on
     * rollback, the provider's name recorded for later downloads — comes from
     * going through the use case the upload route goes through. A second write
     * path would have its own bugs and nobody reviewing the result.
     */
    describe('the applier', () => {
        // covers: media:I-32
        it('creates the file through the same use case the upload route calls', async () => {
            const upload = { execute: jest.fn().mockResolvedValue('asset-9') };

            // Through the container, so the dependency asserted is the DI
            // token `UploadAssetUseCase` and not a hand-passed stub.
            const moduleRef = await Test.createTestingModule({
                providers: [
                    CreateFileProposalApplier,
                    { provide: UploadAssetUseCase, useValue: upload }
                ]
            }).compile();

            const actor: ProposalActor = {
                userId: 'user-1',
                actorEmail: 'ada@example.test',
                workspaceId: 'ws-1',
                runId: 'run-1',
                proposalId: 'proposal-1'
            };

            const result = await moduleRef.get(CreateFileProposalApplier).apply(
                {
                    target: { fileName: 'Q3 audit.md', folderId: null },
                    patch: { format: 'md', content: '# Q3', alt: 'audit' }
                },
                actor
            );

            expect(upload.execute).toHaveBeenCalledTimes(1);
            const [command, eventActor] = upload.execute.mock.calls[0];
            expect(command).toMatchObject({
                workspaceId: 'ws-1',
                folderId: null,
                fileName: 'Q3 audit.md',
                contentType: 'text/markdown',
                alt: 'audit'
            });
            // The write runs under the accepting human's authority, never the
            // copilot's, with the run recorded as provenance.
            expect(eventActor).toMatchObject({
                id: 'user-1',
                email: 'ada@example.test',
                via: { kind: 'copilot', runId: 'run-1' }
            });
            // The id the caller gets back is the one the use case minted, so
            // the download path in the receipt points at a real asset.
            expect(result.entityId).toBe('asset-9');

            await moduleRef.close();
        });
    });
});
