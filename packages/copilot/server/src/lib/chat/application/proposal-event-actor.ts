import type { EventActor } from '@orthacms/database';
import type { ProposalActor } from '@orthacms/copilot-domain';

/**
 * The {@link EventActor} an applier stamps on the domain events its write
 * raises.
 *
 * The **actor is the human** who accepted — there is no copilot identity and
 * there must not be one, since the write runs on their authority and their
 * permissions. `via` is what stops the resulting audit row being
 * indistinguishable from one they typed: under
 * [ADR-0009](../../../../../../docs/adr/0009-copilot-applies-directly.md) a
 * proposal applies as it is drafted, so without it "Ada updated three articles"
 * could equally mean Ada edited three articles or that Ada accepted one agent
 * turn that rewrote them.
 *
 * Shared rather than restated in each applier because there are nine of them
 * across four packages, and an applier that quietly omitted `via` would produce
 * exactly the row this exists to prevent — with nothing failing anywhere.
 *
 * **It lives here, not in `copilot-domain`, because that package imports
 * nothing** — not even `@orthacms/database` — and `EventActor` would be an
 * import. Every package that binds an applier already depends on this one for
 * `copilotAppliersRegistrar`, so there is nothing new in the graph.
 */
export function proposalEventActor(actor: ProposalActor): EventActor {
    return {
        id: actor.userId,
        email: actor.actorEmail,
        via: {
            kind: 'copilot',
            runId: actor.runId,
            proposalId: actor.proposalId ?? null
        }
    };
}
