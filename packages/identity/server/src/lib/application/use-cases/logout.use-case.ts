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
import { UserLookupQuery } from '../../infrastructure/queries/user-lookup.query';

/**
 * Ends the session identified by an opaque token (logout). Idempotent — an
 * unknown or already-revoked token simply does nothing, and the user's other
 * sessions are left untouched. Emits `auth.signed_out` (carrying the actor) to
 * the outbox — where the activity subscriber turns it into the `user.signed_out`
 * audit row — but only when a live session was actually revoked, so the trail
 * stays free of phantom logout events. Transport-agnostic: the controller owns
 * reading the cookie and clearing it.
 */
@Injectable()
export class LogoutUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly users: UserLookupQuery,
        @Inject(SESSION_REPOSITORY)
        private readonly sessions: SessionRepository
    ) {}

    /** Revokes the presented session, if any, recording the sign-out. */
    async execute(token: string): Promise<void> {
        await this.uow.run(async () => {
            const revoked = await this.sessions.revokeByToken(token);
            // Nothing revoked (unknown/already-revoked token) → no audit/event.
            if (!revoked) {
                return;
            }

            const actorEmail = await this.users.emailById(revoked.userId);
            // The signer is their own actor; the subscriber reads it back off
            // the event to write the audit row.
            await this.outbox.append(
                attachActor(
                    [
                        identityEvent(
                            IDENTITY_EVENT_KINDS.SIGNED_OUT,
                            revoked.userId
                        )
                    ],
                    { id: revoked.userId, email: actorEmail }
                )
            );
        });
    }
}
