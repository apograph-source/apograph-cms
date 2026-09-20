import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { roles, users } from '@orthacms/identity-server';
import type {
    MemberInput,
    MemberProvisioner
} from '../../application/ports/member-provisioner.port';

/**
 * Drizzle-backed {@link MemberProvisioner} over identity's `users` table.
 * Resolves each member to a real user id — provisioning a `pending` account for
 * an invited email — and drops ids that don't resolve to a real user, so a stale
 * directory id can't abort the create on an FK violation. Runs through
 * {@link UnitOfWork.current}, so provisioned users commit with the workspace.
 *
 * Resolution is **set-based**, not per member: one lookup for every invited
 * address, one role lookup, one multi-row insert. It previously walked the array
 * serially at up to three round-trips each, all inside the create transaction —
 * so a caller-sized array set how long that write transaction stayed open. The
 * DTO now caps the array as well; this removes the per-member cost that made the
 * cap load-bearing.
 */
@Injectable()
export class DrizzleMemberProvisioner implements MemberProvisioner {
    constructor(private readonly uow: UnitOfWork) {}

    /** {@inheritDoc MemberProvisioner.resolve} */
    async resolve(members: MemberInput[]): Promise<string[]> {
        const executor = this.uow.current();

        // Invited members are keyed by their normalized address; the same
        // address listed twice must resolve to one account, not two.
        const invitedEmails = [
            ...new Set(
                members
                    .filter((member) => member.invited)
                    .map((member) => member.email.trim().toLowerCase())
            )
        ];
        const idByEmail = await this.resolveInvited(invitedEmails);

        const memberIds = members.map((member) =>
            member.invited
                ? (idByEmail.get(member.email.trim().toLowerCase()) as string)
                : member.id
        );

        const unique = [...new Set(memberIds)];
        if (unique.length === 0) {
            return [];
        }
        const existing = await executor
            .select({ id: users.id })
            .from(users)
            .where(inArray(users.id, unique));
        const valid = new Set(existing.map((row) => row.id));
        return unique.filter((id) => valid.has(id));
    }

    /**
     * Maps every normalized invited address to a user id, provisioning the ones
     * that don't exist yet in a single insert. Matching is case-insensitive, so
     * `Grace@…` and `GRACE@…` reuse one account.
     */
    private async resolveInvited(
        normalizedEmails: string[]
    ): Promise<Map<string, string>> {
        const found = new Map<string, string>();
        if (normalizedEmails.length === 0) {
            return found;
        }

        const executor = this.uow.current();
        const existing = await executor
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(inArray(sql`lower(${users.email})`, normalizedEmails));
        for (const row of existing) {
            found.set(row.email.trim().toLowerCase(), row.id);
        }

        const missing = normalizedEmails.filter((email) => !found.has(email));
        if (missing.length === 0) {
            return found;
        }

        // Invited users get the least-privileged global role until they accept.
        // Looked up once for the whole batch — it is a constant, and it used to
        // be re-read for every single invited member.
        // TODO(invites): issue an invite token + email (tokens table) — for now
        // we only provision the account so it can be linked as a member.
        const [viewer] = await executor
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, 'viewer'))
            .limit(1);

        const created = await executor
            .insert(users)
            .values(
                missing.map((email) => ({
                    email,
                    status: 'pending' as const,
                    roleId: viewer.id
                }))
            )
            .returning({ id: users.id, email: users.email });
        for (const row of created) {
            found.set(row.email.trim().toLowerCase(), row.id);
        }

        return found;
    }
}
