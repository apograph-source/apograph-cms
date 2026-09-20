import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { WorkspaceId } from '../../domain/value-objects/workspace-id';
import {
    UnknownContentTypeError,
    WorkspaceNotFoundError
} from '../../domain/errors';
import {
    WORKSPACE_REPOSITORY,
    type WorkspaceRepository
} from '../../domain/workspace.repository';
import { ContentCatalogReader } from '../content/content-catalog.reader';

/**
 * Grants a workspace access to one content type (by slug). Idempotent —
 * re-granting records nothing. The kind is derived from the catalogue; an
 * unknown slug throws {@link UnknownContentTypeError} (→ 400). Drains
 * `workspace.content_granted` (carrying the actor) on a real change, where the
 * activity subscriber turns it into the audit row. 404s an unknown workspace.
 */
@Injectable()
export class GrantContentUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly catalog: ContentCatalogReader,
        @Inject(WORKSPACE_REPOSITORY)
        private readonly workspaces: WorkspaceRepository
    ) {}

    /**
     * Runs the grant. Throws {@link UnknownContentTypeError} (→ 400) for an
     * unknown slug and {@link WorkspaceNotFoundError} (→ 404).
     */
    async execute(
        actor: PublicUser,
        workspaceId: string,
        slug: string
    ): Promise<void> {
        const id = WorkspaceId.create(workspaceId);
        const kind = this.catalog.resolveKind(slug);
        if (!kind) {
            throw new UnknownContentTypeError(slug);
        }

        await this.uow.run(async () => {
            const workspace = await this.workspaces.findById(id);
            if (!workspace) {
                throw new WorkspaceNotFoundError(workspaceId);
            }
            if (!workspace.grantContent(kind, slug)) {
                return;
            }
            await this.workspaces.save(workspace);
            await this.outbox.append(
                attachActor(workspace.pullEvents(), actor)
            );
        });
    }
}
