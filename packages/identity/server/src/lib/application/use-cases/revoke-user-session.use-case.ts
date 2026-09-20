import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import {
    IDENTITY_EVENT_KINDS,
    identityEvent
} from '../../domain/events/identity-events';
import {
    SESSION_REPOSITORY,
    type SessionRepository
} from '../../domain/session.repository';
import type { PublicUser } from '../../auth/services/auth.service';

/**
 * Revokes **another member's** session on an administrator's behalf.
 *
 * The revocation itself is one `UPDATE` and was performed straight from the
 * controller. What was missing is that it left no trace: signing a colleague
 * out of their device is an administrative act on someone else's account —
 * exactly the class of thing the rest of `/users/:id` records — and it was the
 * one such route that wrote nothing. An operator reviewing "who did what to
 * this account" saw the role changes and the suspensions and never the session
 * an admin ended.
 *
 * Wrapped in a unit of work so the revocation and its event commit together,
 * and emitted **only when a live session was actually revoked** — the route is
 * idempotent and answers 204 for an unknown, already-revoked, or
 * wrongly-owned session, and a row for each of those would make the log report
 * work that never happened. Same rule as {@link LogoutUseCase}.
 *
 * The subject is the member who was signed out; the actor is the administrator
 * who did it. That asymmetry is the whole point of the row — a logout the
 * person performs themselves is already `user.signed_out`, actored by them.
 */
@Injectable()
export class RevokeUserSessionUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(SESSION_REPOSITORY)
        private readonly sessions: SessionRepository
    ) {}

    /**
     * Revokes `sessionId` if it is a live session belonging to `userId`.
     *
     * `actor` is the signed-in administrator. It is optional only because the
     * decorator that supplies it is, and a revocation performed with no
     * identifiable caller still records the fact with no actor rather than
     * skipping the row.
     */
    async execute(
        userId: string,
        sessionId: string,
        actor?: PublicUser
    ): Promise<void> {
        await this.uow.run(async () => {
            const revoked = await this.sessions.revokeById(userId, sessionId);
            if (!revoked) {
                return;
            }

            const event = identityEvent(
                IDENTITY_EVENT_KINDS.SESSION_REVOKED,
                userId,
                { sessionId }
            );
            await this.outbox.append(
                actor
                    ? attachActor([event], {
                          id: actor.id,
                          email: actor.email ?? null
                      })
                    : [event]
            );
        });
    }
}
