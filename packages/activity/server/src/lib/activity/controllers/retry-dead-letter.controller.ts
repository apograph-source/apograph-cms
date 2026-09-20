import {
    ConflictException,
    Controller,
    HttpCode,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    attachActor,
    createDomainEvent,
    MAX_DELIVERY_ATTEMPTS,
    OutboxDispatcher,
    OutboxWriter,
    UnitOfWork,
    type RetriedDeadLetter
} from '@ortha/database';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@ortha/identity-server';
import { OUTBOX_RETRY_AUDIT } from '../activity.constants';

/**
 * One parked event, as `POST /api/activity/dead-letters/:id/retry` hands it
 * back — every field of the dead-letter list's row plus `nextAttemptAt`.
 *
 * The extra field is the one the caller could not otherwise check, and the one
 * that decides whether the button did anything: a row with `attempts = 0` and a
 * `next_attempt_at` still minutes in the future is refused by the claim
 * predicate exactly as before.
 */
export type DeadLetterRetryView = RetriedDeadLetter;

/**
 * `POST /api/activity/dead-letters/:id/retry` — put one parked event back in
 * the queue.
 *
 * **The first writing route this plugin hosts, and it writes no row of its
 * own.** The `activity_events` table remains strictly append-only; what this
 * touches is `outbox_events`, another package's table, through that package's
 * own API (`OutboxDispatcher.retryDeadLetter`). The split matches the read
 * side: the dead-letter *list* is the dispatcher's query and this is the
 * dispatcher's mechanism — only the route is Activity's, because the operator
 * who notices the gap is looking at the audit log when they notice it.
 *
 * Gated on `activity:manage`, **not** `activity:read`. Seeing that something is
 * stuck and re-running somebody else's side effect — a webhook POST, a mail
 * send — are different authorities, and no API-token scope carries the second
 * one, so a bearer token cannot reach this route at all.
 */
@ApiTags('Activity')
@UseGuards(PermissionsGuard)
@Controller('activity')
export class RetryDeadLetterController {
    constructor(
        private readonly dispatcher: OutboxDispatcher,
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter
    ) {}

    @Post('dead-letters/:id/retry')
    // 200, not `@Post`'s default 201: nothing was created. The row that comes
    // back is the one that was already there, reset in place.
    @HttpCode(200)
    @RequirePermissions(PERMISSIONS.ACTIVITY_MANAGE)
    @UseGuards(OriginGuard)
    @ApiOperation({
        summary: 'Retry a parked event',
        description:
            'Resets a dead letter’s attempt count and delivery schedule so the dispatcher claims it again. The row is reset **in place** — the event keeps its id, because that id is what every subscriber deduplicates on. `lastError` is preserved: it is the only remaining record of why the event parked. An unknown id and an already-delivered one both answer 404.'
    })
    async retry(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user?: PublicUser
    ): Promise<DeadLetterRetryView> {
        const retried = await this.uow.run(async () => {
            const result = await this.dispatcher.retryDeadLetter(
                id,
                // Join this request's transaction, so the reset and the audit
                // event below commit together or not at all. An audit row for
                // a reset that rolled back is worse than no audit row.
                this.uow.current()
            );

            if (result.outcome === 'not-found') {
                // Unknown and already-delivered are deliberately the same
                // answer: a caller must not be able to learn that an event id
                // exists from the difference between the two.
                throw new NotFoundException('Dead letter not found');
            }
            if (result.outcome === 'not-parked') {
                throw new ConflictException(
                    `Event ${id} has not given up yet (${result.attempts} of ${MAX_DELIVERY_ATTEMPTS} attempts spent); it is still being retried on its own schedule.`
                );
            }

            // The recursion, stated because a cold reader will read it as a
            // bug: this audit event goes through the very outbox that just
            // failed to deliver something. If the broken thing *is* the audit
            // subscriber, the audit of the retry parks too. That is acceptable
            // — the dispatcher still logs it, and the new parked row appears in
            // the same dead-letter list the operator is already looking at — and
            // the alternative (writing the audit row out of band) would break
            // the rule that the trail commits iff the action does.
            const event = createDomainEvent({
                kind: OUTBOX_RETRY_AUDIT.KIND,
                aggregateType: OUTBOX_RETRY_AUDIT.SUBJECT_TYPE,
                aggregateId: result.event.id,
                payload: {
                    // What was stuck, frozen here: the outbox row itself is
                    // prunable once it finally delivers, and this row is then
                    // the only record that it ever needed rescuing.
                    eventKind: result.event.kind,
                    eventAggregateType: result.event.aggregateType,
                    eventAggregateId: result.event.aggregateId,
                    attempts: MAX_DELIVERY_ATTEMPTS,
                    lastError: result.event.lastError
                }
            });
            await this.outbox.append(
                user
                    ? attachActor([event], { id: user.id, email: user.email })
                    : [event]
            );

            return result.event;
        });

        // The retry has already been attempted by the time this line runs, and
        // that is `UnitOfWork.run`'s doing rather than an accident: it awaits a
        // post-commit `drain()` before it resolves, and `drain()` guarantees
        // that a caller's own rows are drained before its await returns — it
        // either starts a drain or joins one queued behind the active one,
        // which by construction begins after this transaction committed. So the
        // operator who has just fixed the cause sees the result now rather than
        // at the next five-second poll tick, which is the whole reason the
        // contract asked for an immediate drain here.
        //
        // A second explicit `drain()` was therefore draining nothing: it ran
        // after the first had already claimed and delivered this event.
        return retried;
    }
}
