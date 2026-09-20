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
import {
    EntryMatchQuery,
    InjectContentRegistry,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import { AlarmEvaluator } from './alarm-evaluator.service';
import { AlarmFindingStore } from './alarm-finding.store';

/** The entry lifecycle events alarms reacts to. */
const ENTRY_KINDS = [
    'entry.created',
    'entry.updated',
    'entry.published',
    'entry.unpublished',
    'entry.deleted',
    'entry.restored',
    'entry.purged'
] as const;

/**
 * Events after which the records pointing **at** this entry may have changed
 * meaning. Publishing an author is the canonical case: nothing about the
 * articles changed, but "links to a draft author" stopped being true of them.
 */
const FANOUT_KINDS = new Set<string>([
    'entry.published',
    'entry.unpublished',
    'entry.deleted',
    'entry.restored',
    'entry.purged'
]);

/**
 * Turns entry lifecycle events into finding updates.
 *
 * Registered at runtime with the {@link OutboxDispatcher}, exactly like the
 * activity log's subscriber. Delivery is **at-least-once**, so everything this
 * does must be safe to repeat — and is: the finding upsert is keyed on
 * `(rule_id, entry_id)`, and the delete/resolve paths are set operations.
 *
 * A failure here is not a failure of the write that caused it. The event was
 * committed with the entry, so the outbox retries with backoff and the findings
 * simply lag; the "Check now" button is the manual recovery for a rule whose
 * event was eventually parked.
 */
@Injectable()
export class EntryEventSubscriber
    implements DomainEventSubscriber, OnApplicationBootstrap
{
    private readonly logger = new Logger(EntryEventSubscriber.name);

    /** The dispatcher's delivery allow-list. */
    readonly kinds = ENTRY_KINDS;

    constructor(
        private readonly dispatcher: OutboxDispatcher,
        private readonly evaluator: AlarmEvaluator,
        private readonly findings: AlarmFindingStore,
        private readonly matches: EntryMatchQuery,
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry
    ) {}

    /** Registers with the dispatcher once the app is up. */
    onApplicationBootstrap(): void {
        this.dispatcher.register(this);
    }

    /** Routes one delivered event to the right reconciliation. */
    async handle(event: DomainEvent): Promise<void> {
        const entryId = event.aggregateId;
        const contentType = readContentType(event);
        if (!contentType) return;

        // A purge leaves nothing behind: the row is gone from its content
        // table, so a finding pointing at it can never resolve or be opened
        // again. This is the one case where deleting the row is right.
        if (event.kind === 'entry.purged') {
            await this.findings.deleteForEntry(entryId);
            return;
        }

        // A soft delete keeps the row, a hard delete does not — but both mean
        // "nobody can act on this any more", so both close the findings rather
        // than dropping them. A restore then brings the history back with them.
        if (event.kind === 'entry.deleted') {
            await this.findings.resolveForEntry(entryId);
            await this.fanout(event, contentType, entryId);
            return;
        }

        const workspaceId =
            readWorkspaceId(event) ??
            (await this.workspaceOf(contentType, entryId));
        if (!workspaceId) {
            // The row vanished between the commit and this delivery. Nothing to
            // evaluate, and the delete/purge event for it is already queued.
            return;
        }

        await this.evaluator.evaluateEntries(workspaceId, contentType, [
            entryId
        ]);
        await this.fanout(event, contentType, entryId, workspaceId);
    }

    /** The reverse pass, for the events that change what other records mean. */
    private async fanout(
        event: DomainEvent,
        contentType: string,
        entryId: string,
        knownWorkspaceId?: string
    ): Promise<void> {
        if (!FANOUT_KINDS.has(event.kind)) return;
        const workspaceId =
            knownWorkspaceId ?? (await this.workspaceOf(contentType, entryId));
        if (!workspaceId) return;
        try {
            await this.evaluator.evaluateDependents(
                workspaceId,
                contentType,
                entryId
            );
        } catch (error) {
            // The primary reconciliation already succeeded; losing the reverse
            // pass costs a stale finding until the next sweep, and is not worth
            // making the dispatcher retry the whole event for.
            this.logger.warn(
                `Reverse pass for ${event.kind} on ${contentType}/${entryId} failed: ` +
                    `${(error as Error).message}`
            );
        }
    }

    /**
     * The entry's workspace, read from its own content table.
     *
     * The fallback, not the first choice: entry events now carry `workspaceId`
     * on their payload, which is both cheaper and — for `entry.purged` — the
     * only way to know it at all. This still exists for outbox rows written
     * before that field did.
     */
    private async workspaceOf(
        contentType: string,
        entryId: string
    ): Promise<string | null> {
        const type = this.registry.get(contentType);
        if (!type) return null;
        return this.matches.workspaceOf(type, entryId);
    }
}

/**
 * `workspaceId` off an entry event's payload, if it carries one.
 *
 * Events written before content started stamping it do not, hence the null and
 * the lookup behind it.
 */
function readWorkspaceId(event: DomainEvent): string | null {
    const workspaceId = (
        event.payload as Record<string, unknown> | undefined
    )?.['workspaceId'];
    return typeof workspaceId === 'string' && workspaceId.length > 0
        ? workspaceId
        : null;
}

/** `contentType` off an entry event's payload, if it carries one. */
function readContentType(event: DomainEvent): string | null {
    const payload = event.payload as Record<string, unknown> | undefined;
    const contentType = payload?.['contentType'];
    return typeof contentType === 'string' && contentType.length > 0
        ? contentType
        : null;
}
