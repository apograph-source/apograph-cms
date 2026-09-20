import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { users } from '@orthacms/identity-server';

/** A directory user resolved for a membership operation. */
export interface LookedUpUser {
    /** The user's id. */
    id: string;
    /** The user's email — the snapshot recorded on the membership audit event. */
    email: string;
}

/**
 * Looks up directory users for the membership use cases: the add flow needs to
 * reject an unknown user (404) and snapshot their email for the audit record;
 * the remove flow reads the email of the just-removed member. Reads through
 * {@link UnitOfWork.current}, so it joins the operation's transaction.
 */
@Injectable()
export class MemberLookupQuery {
    constructor(private readonly uow: UnitOfWork) {}

    /** The user with `userId`, or `null` when no such user exists. */
    async findById(userId: string): Promise<LookedUpUser | null> {
        const [row] = await this.uow
            .current()
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
        return row ?? null;
    }
}
