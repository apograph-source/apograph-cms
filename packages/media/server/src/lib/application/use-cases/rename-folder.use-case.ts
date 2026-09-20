import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { FolderId } from '../../domain/value-objects/folder-id';
import { FolderNotFoundError } from '../../domain/errors/folder-not-found.error';
import {
    FOLDER_REPOSITORY,
    type FolderRepository
} from '../../domain/folder.repository';

/** Renames a folder. */
@Injectable()
export class RenameFolderUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(FOLDER_REPOSITORY) private readonly folders: FolderRepository
    ) {}

    /** Runs the rename. Throws when the folder is absent. */
    async execute(
        folderId: string,
        workspaceId: string,
        name: string,
        actor: PublicUser
    ): Promise<void> {
        const id = FolderId.create(folderId);

        return this.uow.run(async () => {
            const folder = await this.folders.findById(id, workspaceId);
            if (!folder) {
                throw new FolderNotFoundError(folderId);
            }
            folder.rename(name);
            await this.folders.save(folder);
            await this.outbox.append(attachActor(folder.pullEvents(), actor));
        });
    }
}
