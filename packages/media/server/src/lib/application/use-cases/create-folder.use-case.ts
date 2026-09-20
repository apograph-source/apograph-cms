import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { Folder } from '../../domain/folder';
import { FolderId } from '../../domain/value-objects/folder-id';
import { FolderNotFoundError } from '../../domain/errors/folder-not-found.error';
import {
    FOLDER_REPOSITORY,
    type FolderRepository
} from '../../domain/folder.repository';

/** Inputs to create a folder. `parentId` absent means a top-level folder. */
export interface CreateFolderCommand {
    workspaceId: string;
    name: string;
    parentId?: string;
}

/** Creates a folder, validating the parent exists when one is given. */
@Injectable()
export class CreateFolderUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(FOLDER_REPOSITORY) private readonly folders: FolderRepository
    ) {}

    /** Runs the create. Returns the new folder id. */
    async execute(
        command: CreateFolderCommand,
        actor: PublicUser
    ): Promise<string> {
        return this.uow.run(async () => {
            let parentId: FolderId | null = null;
            if (command.parentId) {
                parentId = FolderId.create(command.parentId);
                // FOR SHARE on the parent: serializes against a concurrent
                // delete of that parent so this child can't be orphaned.
                if (
                    !(await this.folders.existsForShare(
                        parentId,
                        command.workspaceId
                    ))
                ) {
                    throw new FolderNotFoundError(command.parentId);
                }
            }

            const folder = Folder.create({
                id: FolderId.generate(),
                workspaceId: command.workspaceId,
                parentId,
                name: command.name
            });
            await this.folders.save(folder);
            await this.outbox.append(attachActor(folder.pullEvents(), actor));
            return folder.id.value;
        });
    }
}
