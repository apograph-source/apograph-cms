import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { WorkspaceId } from '../../domain/value-objects/workspace-id';
import {
    MemberNotFoundError,
    WorkspaceNotFoundError
} from '../../domain/errors';
import { WORKSPACE_EVENT_KINDS } from '../../domain/events/workspace-events';
import {
    WORKSPACE_REPOSITORY,
    type WorkspaceRepository
} from '../../domain/workspace.repository';
import { MemberLookupQuery } from '../../infrastructure/queries/member-lookup.query';

/**
 * Links an existing user to a workspace. Idempotent — re-adding a member is a
 * no-op that records nothing. Drains `workspace.member_added` (carrying the
 * added user's id + email snapshot and the actor) on a real change, where the
 * activity subscriber audits it against **the added user** (so it surfaces in
 * that member's activity log). 404s an unknown workspace or user.
 */
@Injectable()
export class AddMemberUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly members: MemberLookupQuery,
        @Inject(WORKSPACE_REPOSITORY)
        private readonly workspaces: WorkspaceRepository
    ) {}

    /**
     * Runs the add. Throws {@link WorkspaceNotFoundError} or
     * {@link MemberNotFoundError} (both → 404).
     */
    async execute(
        actor: PublicUser,
        workspaceId: string,
        userId: string
    ): Promise<void> {
        const id = WorkspaceId.create(workspaceId);

        await this.uow.run(async () => {
            const workspace = await this.workspaces.findById(id);
            if (!workspace) {
                throw new WorkspaceNotFoundError(workspaceId);
            }
            const user = await this.members.findById(userId);
            if (!user) {
                throw new MemberNotFoundError(userId);
            }
            if (!workspace.addMember(userId)) {
                return;
            }
            await this.workspaces.save(workspace);
            // The added user's email isn't a workspace concern, so the aggregate
            // doesn't carry it — snapshot it onto the event here for the audit.
            const events = workspace.pullEvents().map((event) =>
                event.kind === WORKSPACE_EVENT_KINDS.MEMBER_ADDED
                    ? {
                          ...event,
                          payload: { ...event.payload, email: user.email }
                      }
                    : event
            );
            await this.outbox.append(attachActor(events, actor));
        });
    }
}
