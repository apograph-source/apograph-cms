import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@orthacms/database';
import {
    IDENTITY_EVENT_KINDS,
    identityEvent,
    SIGN_IN_FAILURE_REASON,
    signInAttemptEvent,
    type SignInFailureReason
} from '../../domain/events/identity-events';
import type { SessionContext } from '../../domain/session';
import {
    SESSION_REPOSITORY,
    type CreatedSession,
    type SessionRepository
} from '../../domain/session.repository';
import { InvalidCredentialsError } from '../../auth/errors';
import { HashingService } from '../../auth/services/hashing.service';
import { UserLookupQuery } from '../../infrastructure/queries/user-lookup.query';
import type { IdentityPluginConfig } from '../../types';
import { InjectIdentityConfig } from '../../identity.tokens';

/**
 * Email/password sign-in. Verifies credentials, then opens a server-side
 * session in one unit of work and emits `auth.signed_in` (carrying the actor)
 * to the transactional outbox — the event commits iff the session does — where
 * the activity subscriber turns it into the `user.signed_in` audit row.
 * Transport-agnostic: returns the {@link CreatedSession} or throws; the
 * controller maps to HTTP + cookie.
 *
 * **A refusal is recorded too**, as `auth.sign_in_failed` keyed to the address
 * that was tried. Every refusal still returns the same
 * {@link InvalidCredentialsError} after the same one bcrypt comparison — what
 * the caller can observe is unchanged, in body and in timing — but the reason
 * is written to the `activity:read` log, where an operator can tell address
 * guessing from a person mistyping their password.
 *
 * Two things bound the volume this adds. The route carries `ThrottlerGuard`,
 * so a rejected attempt is already rate-limited before it reaches here; and the
 * event is appended in a unit of work of its own, which commits alone — a
 * failed sign-in writes nothing else, so there is no other work for it to hold
 * open or to roll back.
 */
@Injectable()
export class LoginUseCase {
    /**
     * A throwaway bcrypt hash, computed once, used to equalize verify timing
     * when the user (or their hash) is absent — so a missing account can't be
     * told from a wrong password by response time.
     */
    private dummyHash: Promise<string> | null = null;

    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly users: UserLookupQuery,
        private readonly hashing: HashingService,
        @Inject(SESSION_REPOSITORY)
        private readonly sessions: SessionRepository,
        @InjectIdentityConfig() private readonly config: IdentityPluginConfig
    ) {}

    /**
     * Verifies `email`/`password` and opens a session on success. Every failure
     * — unknown email, invite-pending (null hash), non-active status, or wrong
     * password — throws the same {@link InvalidCredentialsError} and performs one
     * bcrypt comparison, so neither the response body nor its timing leaks which
     * accounts exist (no user enumeration).
     */
    async execute(
        email: string,
        password: string,
        context: SessionContext = {}
    ): Promise<CreatedSession> {
        if (this.passwordLoginRefused(email)) {
            // One bcrypt comparison anyway, for the same reason the ordinary
            // path always runs one: without it this refusal would return
            // instantly while the root administrator's took ~250ms, and an
            // anonymous caller could find the break-glass address by timing a
            // handful of guesses.
            await this.hashing.verifyPassword(
                await this.getDummyHash(),
                password
            );
            await this.recordFailure(
                email,
                SIGN_IN_FAILURE_REASON.PasswordLoginDisabled,
                context
            );
            throw new InvalidCredentialsError();
        }

        const user = await this.users.credentialsByEmail(email);

        // Always run a comparison, even with no user/hash, to hold timing flat.
        const hashed = user?.passwordHash ?? (await this.getDummyHash());
        const passwordOk = await this.hashing.verifyPassword(hashed, password);

        if (
            !user ||
            !user.passwordHash ||
            user.status !== 'active' ||
            !passwordOk
        ) {
            // The branch order is the reporting order, and it is the order the
            // checks are written in: no account at all, then an account that is
            // not a way in (pending invite or disabled), then a real account
            // with the wrong password. Only the last of those is worth warning
            // a person about.
            await this.recordFailure(
                email,
                !user
                    ? SIGN_IN_FAILURE_REASON.UnknownAccount
                    : !user.passwordHash || user.status !== 'active'
                      ? SIGN_IN_FAILURE_REASON.NotActive
                      : SIGN_IN_FAILURE_REASON.BadPassword,
                context,
                user?.userId
            );
            throw new InvalidCredentialsError();
        }

        return this.uow.run(async () => {
            const session = await this.sessions.issue(user.userId, context);
            // The signer is their own actor; the subscriber reads it back off
            // the event to write the audit row.
            await this.outbox.append(
                attachActor(
                    [
                        identityEvent(
                            IDENTITY_EVENT_KINDS.SIGNED_IN,
                            user.userId,
                            {
                                // Where the session was opened from. Both are
                                // already stored on the `sessions` row, and
                                // neither reached the audit log — so the trail
                                // could say a person signed in and never from
                                // where, which is the first thing asked after a
                                // credential is suspected. The row outlives the
                                // session, which is the point of copying them.
                                ipAddress: context.ipAddress ?? null,
                                userAgent: context.userAgent ?? null
                            }
                        )
                    ],
                    { id: user.userId, email: user.email }
                )
            );
            return session;
        });
    }

    /**
     * Appends `auth.sign_in_failed` for a refused attempt.
     *
     * It carries no **actor**: `attachActor` names who performed an action, and
     * a failed sign-in has not established who anybody is — writing the
     * attempted account there would attribute an action to a person who may
     * have had nothing to do with it. The subject is the address, and `userId`
     * rides in `meta` only when the address actually resolved, so the row says
     * "somebody tried this login" rather than "this user did something".
     *
     * `ipAddress` / `userAgent` come from the same {@link SessionContext} the
     * successful path stores on the session row, and they are the whole point
     * on this path: an attempt with no account behind it has nothing else to
     * identify it by.
     *
     * Failing to record must never turn a 401 into a 500 — the caller's answer
     * is the same either way and the sign-in is already refused — so a write
     * error is swallowed rather than propagated. The outbox row simply does not
     * exist; the alternative is an authentication endpoint whose availability
     * depends on the audit path.
     */
    private async recordFailure(
        email: string,
        reason: SignInFailureReason,
        context: SessionContext,
        userId?: string
    ): Promise<void> {
        if (!email?.trim()) return;
        try {
            await this.uow.run(() =>
                this.outbox.append([
                    signInAttemptEvent(email, {
                        reason,
                        userId: userId ?? null,
                        ipAddress: context.ipAddress ?? null,
                        userAgent: context.userAgent ?? null
                    })
                ])
            );
        } catch {
            // Deliberately swallowed — see the JSDoc above.
        }
    }

    /**
     * Whether this deployment has turned passwords off for this address.
     *
     * `allowPasswordLogin: false` is for a deployment where the identity
     * provider is the only way in. **The root administrator is always exempt**,
     * because the alternative has no recovery: an operator who mis-scopes their
     * provider and has no password left is locked out of their own CMS, and the
     * only way back involves a database client. That exemption is one address,
     * named in configuration, not a general escape hatch.
     */
    private passwordLoginRefused(email: string): boolean {
        if (this.config.sso?.allowPasswordLogin !== false) {
            return false;
        }
        const rootAdmin = this.config.rootAdmin?.email?.trim().toLowerCase();
        return !rootAdmin || email.trim().toLowerCase() !== rootAdmin;
    }

    private getDummyHash(): Promise<string> {
        if (!this.dummyHash) {
            this.dummyHash = this.hashing.hashPassword(
                randomBytes(32).toString('hex')
            );
        }
        return this.dummyHash;
    }
}
