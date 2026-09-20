import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import type { PublicUser } from '@orthacms/identity-server';
import { WorkspaceId } from '../../domain/value-objects/workspace-id';
import { WORKSPACE_EVENT_KINDS } from '../../domain/events/workspace-events';
import {
    WORKSPACE_REPOSITORY,
    type WorkspaceRepository
} from '../../domain/workspace.repository';
import { MemberLookupQuery } from '../../infrastructure/queries/member-lookup.query';

/**
 * Removes a user's membership. Removing a non-member — or targeting a workspace
 * that doesn't exist — is a no-op that records nothing (the endpoint still
 * returns 204, matching the prior behavior). Drains `workspace.member_removed`
 * (carrying the removed user's id + email snapshot and the actor) on a real
 * change, where the activity subscriber audits it against **the removed user**.
 */
@Injectable()
export class RemoveMemberUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly members: MemberLookupQuery,
        @Inject(WORKSPACE_REPOSITORY)
        private readonly workspaces: WorkspaceRepository
    ) {}

    /** Runs the removal. Never throws for a missing workspace/member (no-op). */
    async execute(
        actor: PublicUser,
        workspaceId: string,
        userId: string
    ): Promise<void> {
        const id = WorkspaceId.create(workspaceId);

        await this.uow.run(async () => {
            const workspace = await this.workspaces.findById(id);
            if (!workspace) {
                return; // no such workspace — nothing to remove, still 204
            }
            if (!workspace.removeMember(userId)) {
                return; // not a member — nothing changed, nothing recorded
            }
            await this.workspaces.save(workspace);
            const user = await this.members.findById(userId);
            // The removed user's email isn't a workspace concern, so the
            // aggregate doesn't carry it — snapshot it onto the event here.
            const events = workspace.pullEvents().map((event) =>
                event.kind === WORKSPACE_EVENT_KINDS.MEMBER_REMOVED
                    ? {
                          ...event,
                          payload: {
                              ...event.payload,
                              email: user?.email ?? null
                          }
                      }
                    : event
            );
            await this.outbox.append(attachActor(events, actor));
        });
    }
}
