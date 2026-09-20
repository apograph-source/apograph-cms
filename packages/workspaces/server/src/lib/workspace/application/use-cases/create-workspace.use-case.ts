import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { Workspace } from '../../domain/workspace';
import { Slug } from '../../domain/value-objects/slug';
import { WorkspaceColor } from '../../domain/value-objects/workspace-color';
import { SlugUniquenessService } from '../../domain/slug-uniqueness.service';
import {
    WORKSPACE_REPOSITORY,
    type WorkspaceRepository
} from '../../domain/workspace.repository';
import {
    MEMBER_PROVISIONER,
    type MemberProvisioner
} from '../ports/member-provisioner.port';
import { ContentCatalogReader } from '../content/content-catalog.reader';
import { resolveGrants } from '../content/content-selection';
import type { CreateWorkspaceDto } from '../dto/create-workspace.dto';

/**
 * Creates a workspace owned by the current user (linked as its first member),
 * plus the requested members and content grants — all in one unit of work. The
 * slug's format is enforced by the {@link Slug} value object and its uniqueness
 * by {@link SlugUniquenessService}; the `workspace.created` domain event is
 * drained to the outbox (carrying the actor), where the activity subscriber
 * turns it into the audit row.
 */
@Injectable()
export class CreateWorkspaceUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly slugUniqueness: SlugUniquenessService,
        private readonly catalog: ContentCatalogReader,
        @Inject(WORKSPACE_REPOSITORY)
        private readonly workspaces: WorkspaceRepository,
        @Inject(MEMBER_PROVISIONER)
        private readonly provisioner: MemberProvisioner
    ) {}

    /**
     * Runs the create. Throws `SlugTakenError` (→ 409) when the slug is in use
     * and `InvalidSlugError` / `InvalidWorkspaceColorError` (→ 400) for a
     * malformed slug or color. Returns the new workspace id.
     */
    async execute(dto: CreateWorkspaceDto, actor: PublicUser): Promise<string> {
        const slug = Slug.create(dto.slug);
        const color = WorkspaceColor.create(dto.color);

        return this.uow.run(async () => {
            await this.slugUniqueness.assertAvailable(slug);

            const memberUserIds = await this.provisioner.resolve(dto.members);
            const grants = resolveGrants(
                dto.content,
                this.catalog.knownSlugs()
            );

            const workspace = Workspace.create({
                name: dto.name,
                slug,
                description: dto.description,
                color,
                creatorUserId: actor.id,
                memberUserIds,
                grants
            });
            await this.workspaces.save(workspace);

            // Audit is derived downstream from the domain event by the activity
            // subscriber; the actor rides along on the event payload.
            await this.outbox.append(
                attachActor(workspace.pullEvents(), actor)
            );

            return workspace.id.value;
        });
    }
}
