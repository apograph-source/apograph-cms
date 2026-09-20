import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { users } from '../../schema';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';

/**
 * The current user as exposed by `GET /auth/me`. Derived from the schema row so
 * it can't drift; the password hash is never among the picked fields. (A `type`
 * rather than an `interface` because it is a derived `Pick`, not a hand-authored
 * contract — an empty `interface … extends` is also a lint error.)
 */
export type PublicUser = Pick<
    typeof users.$inferSelect,
    'id' | 'email' | 'name' | 'roleId' | 'status'
>;

/**
 * The read facade for "who is the current request?". A thin CQRS query service
 * over the aggregate: it resolves a session token to the {@link PublicUser} the
 * app-wide `AuthGuard` attaches. Credential and session **mutations** live in
 * the auth use-cases (`LoginUseCase` / `LogoutUseCase`); this side never writes
 * except for the throttled `lastUsedAt` touch the `RefreshSessionUseCase` owns.
 *
 * It also carries one half of the suspension lockout: login refuses to open a
 * session for a non-`active` account, and this resolve refuses to authenticate
 * one — so a session that outlives the suspension (see {@link currentUser})
 * still grants nothing.
 */
@Injectable()
export class AuthService {
    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly refreshSession: RefreshSessionUseCase
    ) {}

    /**
     * Resolves an opaque session token to the current {@link PublicUser}, or
     * `null` when the session is invalid, its user has vanished, or that user is
     * no longer `active`. Refreshes the session's `lastUsedAt` (throttled) as a
     * side effect. The hash is never selected, so it cannot leak through this
     * path.
     *
     * The status predicate is **defense in depth**, not the primary lockout:
     * suspending a member revokes their live sessions in the same transaction
     * (users-server's `SetMemberStatusUseCase`), so their cookie is normally
     * dead already. It closes the window where a session outlives the
     * suspension — a login that commits concurrently with the disable inserts
     * its row after that revoke's snapshot, and any future path that flips
     * `status` without revoking would leak access the same way. Both read as a
     * plain 401 to the caller, so a suspended account can't be told from an
     * expired one.
     */
    async currentUser(sessionId: string): Promise<PublicUser | null> {
        const resolved = await this.refreshSession.execute(sessionId);
        if (!resolved) {
            return null;
        }

        const [user] = await this.db
            .select({
                id: users.id,
                email: users.email,
                name: users.name,
                roleId: users.roleId,
                status: users.status
            })
            .from(users)
            .where(
                and(eq(users.id, resolved.userId), eq(users.status, 'active'))
            );

        return user ?? null;
    }
}
