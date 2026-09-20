import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import {
    WorkspacePurgeRegistry,
    type WorkspacePurger,
    type WorkspacePurgeOutcome
} from '@orthacms/workspaces-server';
import { webhookEndpointWorkspaces } from '../schema/webhook-endpoints';

/**
 * Removes a deleted workspace from every endpoint that subscribed to it.
 *
 * `webhook_endpoint_workspaces.workspace_id` is a plain uuid with no foreign
 * key — the `workspaces` table belongs to another plugin — and the only other
 * delete is the cascade from `webhook_endpoints`, which fires when the
 * *endpoint* goes, never when the workspace does. So a deleted workspace left
 * its subscription rows behind, and fan-out kept reading them on every content
 * write, matching an id that could never appear in an event again.
 *
 * ## Why pruning is safe here and not in `segments`
 *
 * The two look identical — a workspace id with no FK, in a set that decides who
 * receives something — and they get opposite treatment, so the difference is
 * worth stating. An audience's empty `workspace_ids` **means "every
 * workspace"**, so pruning the last id would widen who may read. An endpoint's
 * empty set means nothing at all: `all_workspaces` is a separate boolean, held
 * explicitly for this exact reason ("fan-out must never have to disambiguate
 * 'no rows' between 'all' and 'none'"). Pruning here can only narrow.
 *
 * ## The endpoint itself stays
 *
 * An endpoint that named only the deleted workspace is left enabled with an
 * empty set, which `matches` reads as "no workspace-carrying event" — it still
 * receives the kinds whose descriptor carries no workspace. Deleting the
 * endpoint instead would destroy a signing secret and a URL somebody
 * configured, on the strength of a workspace delete that says nothing about
 * either; and disabling it would be a state the admin cannot distinguish from
 * a human having switched it off.
 */
@Injectable()
export class WebhookWorkspacesPurger implements WorkspacePurger, OnModuleInit {
    readonly purgeName = 'webhooks:endpoint-workspaces';

    constructor(
        private readonly uow: UnitOfWork,
        @Optional() private readonly registry?: WorkspacePurgeRegistry
    ) {}

    onModuleInit(): void {
        this.registry?.register(this);
    }

    async purge(workspaceId: string): Promise<WorkspacePurgeOutcome> {
        const removed = await this.uow
            .current()
            .delete(webhookEndpointWorkspaces)
            .where(eq(webhookEndpointWorkspaces.workspaceId, workspaceId))
            .returning({ endpointId: webhookEndpointWorkspaces.endpointId });

        return { rows: removed.length };
    }
}
