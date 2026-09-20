import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { users } from '../../schema';

/**
 * The authentication snapshot the login flow verifies against — never exposed
 * over the wire. Includes the stored hash (or `null` for a `pending` invite)
 * and status so the use case can equalize verify timing and reject non-active
 * accounts with the same generic error.
 */
export interface AuthCredentials {
    /** The account id. */
    userId: string;
    /** The stored (frozen) email, for the sign-in audit snapshot. */
    email: string;
    /** The stored bcrypt hash, or `null` for a `pending` (un-accepted) invite. */
    passwordHash: string | null;
    /** The account lifecycle status (`pending` / `active` / `disabled`). */
    status: string;
}

/**
 * Thin CQRS read side over the `users` table for the auth flows — the lookups
 * that bypass the {@link UserAccount} aggregate (a login verifies credentials
 * without mutating the account; logout snapshots the actor's email for the
 * audit row). Runs through {@link UnitOfWork.current} so a lookup inside a
 * use case's unit of work joins its transaction.
 */
@Injectable()
export class UserLookupQuery {
    constructor(private readonly uow: UnitOfWork) {}

    /**
     * The authentication snapshot for `email` (matched case-insensitively), or
     * `null` when no such account exists. The hash is selected here and only
     * here on the auth path; it never leaves the use case.
     */
    async credentialsByEmail(email: string): Promise<AuthCredentials | null> {
        const [row] = await this.uow
            .current()
            .select({
                userId: users.id,
                email: users.email,
                passwordHash: users.passwordHash,
                status: users.status
            })
            .from(users)
            .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
        return row ?? null;
    }

    /** The stored email for `userId`, or `null` when the account has vanished. */
    async emailById(userId: string): Promise<string | null> {
        const [row] = await this.uow
            .current()
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, userId));
        return row?.email ?? null;
    }
}
