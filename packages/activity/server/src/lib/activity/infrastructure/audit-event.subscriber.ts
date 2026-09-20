import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
    InjectDatabase,
    OutboxDispatcher,
    type Database,
    type DomainEvent,
    type DomainEventSubscriber
} from '@orthacms/database';
import { activityEvents } from '../../schema';
import { AUDITED_EVENT_KINDS, toAuditRow } from './audit-event-mapping';

/**
 * The activity log's outbox subscriber — the audit trail's single live writer.
 * On bootstrap it registers itself with the {@link OutboxDispatcher}, which then
 * delivers every audited domain event (see {@link AUDITED_EVENT_KINDS}) here;
 * {@link handle} maps each to the same `activity_events` row the old in-band
 * `ACTIVITY_RECORDER` wrote.
 *
 * **Idempotent** (delivery is at-least-once): the row's primary key is the
 * source event's id and the insert is `ON CONFLICT DO NOTHING`, so a
 * re-delivered event never double-records.
 */
@Injectable()
export class AuditEventSubscriber
    implements DomainEventSubscriber, OnApplicationBootstrap
{
    /** The audited event kinds — the dispatcher's delivery allow-list. */
    readonly kinds = AUDITED_EVENT_KINDS;

    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly dispatcher: OutboxDispatcher
    ) {}

    /** Registers with the dispatcher once the app is up. */
    onApplicationBootstrap(): void {
        this.dispatcher.register(this);
    }

    /**
     * Maps one delivered event to its audit row and appends it. A kind with no
     * mapping is ignored (defensive — the dispatcher only delivers our
     * {@link kinds}); the `ON CONFLICT DO NOTHING` keeps redelivery a no-op.
     */
    async handle(event: DomainEvent): Promise<void> {
        const row = toAuditRow(event);
        if (!row) {
            return;
        }
        await this.db
            .insert(activityEvents)
            .values(row)
            .onConflictDoNothing({ target: activityEvents.id });
    }
}
