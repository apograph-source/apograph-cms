import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OutboxDispatcher, type DeadLetter } from '@orthacms/database';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { DeadLettersQueryDto } from '../dto/dead-letters-query.dto';

/** The parked events, as `GET /api/activity/dead-letters` returns them. */
export interface DeadLetterListView {
    /** How many events have given up in total, ignoring `limit`. */
    total: number;
    /** The most recent of them. */
    items: DeadLetter[];
}

/**
 * `GET /api/activity/dead-letters` — the events that should have been recorded
 * and could not be.
 *
 * **This is the gap-in-the-trail route, and it belongs here rather than
 * anywhere else.** A parked outbox row is an event no subscriber accepted after
 * {@link MAX_DELIVERY_ATTEMPTS} tries, and the subscriber it was most often
 * bound for is this plugin's: an audit row. The dispatcher already logs the
 * moment one parks — but a log line is loud only to somebody tailing logs right
 * then, and afterwards "is anything stuck, and why" had no answer short of a
 * `psql` session. A hole in an audit trail that is only visible to a person who
 * thinks to go looking is barely a hole that has been noticed.
 *
 * Gated on `activity:read`, the same key as the log itself: the question "what
 * is missing from the trail" is the same question as "what is in it", and the
 * answer names event kinds and aggregate ids.
 *
 * It reports; `POST /api/activity/dead-letters/:id/retry` is what repairs, and
 * the split is deliberate in two directions. Reading the list takes
 * `activity:read`; putting a row back takes `activity:manage`, because
 * re-running somebody else's side effect is a different authority from seeing
 * that it is stuck. And the repair is **one row at a time**: a reset row goes
 * back to the head of an `ORDER BY occurred_at` claim, so a bulk retry over an
 * unbounded `total` is a way to stall the queue — and the operator is meant to
 * read `lastError` and fix the cause first, rather than press a button that
 * re-runs whatever failed fifteen times.
 */
@ApiTags('Activity')
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.ACTIVITY_READ)
@Controller('activity')
export class DeadLettersController {
    constructor(private readonly dispatcher: OutboxDispatcher) {}

    @Get('dead-letters')
    @ApiOperation({
        summary: 'Events that could not be recorded',
        description:
            'Outbox events that exhausted their delivery attempts and are no longer retried. Most often an audit row that was never written, so a non-zero `total` means the activity log is incomplete. Read-only: putting one back is `POST /activity/dead-letters/{id}/retry`, one row at a time, under `activity:manage`.'
    })
    async list(
        @Query() query: DeadLettersQueryDto
    ): Promise<DeadLetterListView> {
        return this.dispatcher.deadLetters({
            limit: query.limit,
            newerThan: query.since ? new Date(query.since) : undefined
        });
    }
}
