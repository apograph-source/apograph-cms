import {
    Injectable,
    Logger,
    type OnApplicationBootstrap
} from '@nestjs/common';
import {
    OutboxDispatcher,
    type DomainEvent,
    type DomainEventSubscriber
} from '@orthacms/database';
import { ReviewRequestRepository } from './review-request.repository';

/** The one lifecycle event that answers an open review request. */
const PUBLISHED = 'entry.published';

/**
 * Closes an entry's open review request once the entry actually goes out.
 *
 * A request is a standing ask — "somebody please look at this" — and the two
 * things that end it are the asker withdrawing (which the route already
 * handles) and the entry being published, which is the ask being satisfied.
 * Without this, a workspace's review queue fills with rows for records that
 * shipped weeks ago, and a queue nobody can trust is a queue nobody opens.
 *
 * **Why a subscriber rather than a call in the publish path.** Protection
 * cannot reach into content's use-case, and content must not learn what a
 * review request is; the outbox is the seam that already exists for exactly
 * this. It also means the request closes however the entry was published —
 * the admin button, the public API, a bulk publish, a bypass — with no list of
 * publish routes to keep in step.
 *
 * Delivery is **at-least-once**, so this must be idempotent: `resolve` is a
 * conditional update that reports whether it changed anything, and a second
 * delivery simply finds nothing open and does nothing.
 *
 * A failure here must not fail the publish: the entry is already published and
 * the dispatcher runs after that commit. So it is logged, not thrown — a stale
 * queue row is a nuisance, and a retry loop over a committed publish is worse.
 */
@Injectable()
export class EntryPublishedSubscriber
    implements DomainEventSubscriber, OnApplicationBootstrap
{
    private readonly logger = new Logger(EntryPublishedSubscriber.name);

    readonly kinds = [PUBLISHED] as const;

    constructor(
        private readonly requests: ReviewRequestRepository,
        private readonly dispatcher: OutboxDispatcher
    ) {}

    onApplicationBootstrap(): void {
        this.dispatcher.register(this);
    }

    async handle(event: DomainEvent): Promise<void> {
        if (event.kind !== PUBLISHED) return;
        const entryId = event.aggregateId;
        if (!entryId) return;

        try {
            const open = await this.requests.findOpenByEntry(entryId);
            if (!open) return;
            await this.requests.resolve(open.id);
        } catch (error) {
            this.logger.warn(
                `Could not close the review request for entry ${entryId}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }
}
