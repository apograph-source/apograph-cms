import { Test } from '@nestjs/testing';
import { UnitOfWork } from '@orthacms/database';
import { ToolRegistry } from '@orthacms/tools-server';
import { WorkspacePurgeRegistry } from '@orthacms/workspaces-server';
import { STORAGE_PROVIDER } from '@orthacms/media-domain';
import { AltTextProposalToolProvider } from './copilot/alt-text-proposal.provider';
import { CreateFileProposalToolProvider } from './copilot/create-file-proposal.provider';
import { MediaCopilotToolProvider } from './copilot/media-tool.provider';
import { MediaWorkspacePurger } from './infrastructure/purge/media-workspace.purger';
import { AssetViewQuery } from './infrastructure/queries/asset-view.query';
import { DownloadAssetQuery } from './infrastructure/queries/download-asset.query';
import { ListAssetsQuery } from './infrastructure/queries/list-assets.query';
import { ListFoldersQuery } from './infrastructure/queries/list-folders.query';

/**
 * Media registers itself with two collaborators it does not depend on: the
 * shared tool registry (`@orthacms/tools-server`, present only when the copilot
 * or MCP is mounted) and the workspace purge registry
 * (`@orthacms/workspaces-server`). Both injections are `@Optional()`, so a
 * deployment that mounts neither still comes up with a working media library.
 *
 * **This has to go through Nest's container.** `@Optional()` is a decorator
 * read at resolution time; `new MediaCopilotToolProvider(a, b, c)` succeeds
 * with or without it, so a spec that constructs the class by hand — which is
 * what the existing `media-tool.provider.spec.ts` does, for its own reasons —
 * cannot tell the two apart. Dropping the decorator makes `compile()` below
 * throw "Nest can't resolve dependencies", which is the failure this exists to
 * produce.
 *
 * The second half is the *call*: `this.registry?.register(this)`. An
 * `@Optional()` dependency that is then dereferenced unconditionally moves the
 * crash from boot to `onModuleInit`, so the hooks are run explicitly here
 * rather than trusted.
 */
describe('media without the copilot, MCP or the workspaces plugin', () => {
    /**
     * The collaborators media genuinely requires. Stubs: nothing here is
     * called — what is under test is which dependencies the container has to
     * find, not what they do.
     */
    const REQUIRED = [
        { provide: ListAssetsQuery, useValue: {} },
        { provide: ListFoldersQuery, useValue: {} },
        { provide: DownloadAssetQuery, useValue: {} },
        { provide: AssetViewQuery, useValue: {} },
        { provide: UnitOfWork, useValue: {} },
        { provide: STORAGE_PROVIDER, useValue: { id: 'memory' } }
    ];

    /** The four classes that register themselves with something optional. */
    const REGISTRARS = [
        MediaCopilotToolProvider,
        AltTextProposalToolProvider,
        CreateFileProposalToolProvider,
        MediaWorkspacePurger
    ];

    // covers: media:I-29
    it('comes up with neither registry present', async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [...REQUIRED, ...REGISTRARS]
        }).compile();

        // Resolution succeeded, and the optional dependencies really are
        // absent — a module that happened to provide them would make the
        // `onModuleInit` calls below prove nothing.
        expect(() => moduleRef.get(ToolRegistry)).toThrow(
            /could not find ToolRegistry/
        );
        expect(() => moduleRef.get(WorkspacePurgeRegistry)).toThrow(
            /could not find WorkspacePurgeRegistry/
        );

        for (const registrar of REGISTRARS) {
            expect(() => moduleRef.get(registrar).onModuleInit()).not.toThrow();
        }

        await moduleRef.close();
    });

    // covers: media:I-29
    it('registers with both when they are there', async () => {
        // The positive control. Without it the case above would still pass
        // against a plugin that had quietly stopped registering at all.
        const moduleRef = await Test.createTestingModule({
            providers: [
                ...REQUIRED,
                ...REGISTRARS,
                ToolRegistry,
                WorkspacePurgeRegistry
            ]
        }).compile();

        for (const registrar of REGISTRARS) {
            moduleRef.get(registrar).onModuleInit();
        }

        expect(
            moduleRef
                .get(ToolRegistry)
                .all()
                .map((tool) => tool.name)
        ).toEqual(
            expect.arrayContaining([
                'media_assets_search',
                'media_folders_list',
                'media_asset_read',
                'media_propose_alt_text',
                'media_propose_file'
            ])
        );
        expect(moduleRef.get(WorkspacePurgeRegistry).registered).toContain(
            'media:assets-and-folders'
        );

        await moduleRef.close();
    });
});
