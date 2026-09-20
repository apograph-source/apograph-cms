import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { ssoIdentities } from '../../schema';
import type {
    LinkSsoIdentityInput,
    SsoIdentityLink,
    SsoIdentityRepository
} from '../../domain/sso-identity.repository';

/**
 * Drizzle-backed {@link SsoIdentityRepository} over identity's `sso_identities`
 * table. Every statement runs through {@link UnitOfWork.current}, so a link
 * created during a sign-in commits with the session it opened — a link that
 * survived a failed sign-in would silently grant the *next* attempt a path that
 * skips the verified-email check.
 */
@Injectable()
export class DrizzleSsoIdentityRepository implements SsoIdentityRepository {
    constructor(private readonly uow: UnitOfWork) {}

    /** {@inheritDoc SsoIdentityRepository.findBySubject} */
    async findBySubject(
        provider: string,
        subject: string
    ): Promise<SsoIdentityLink | null> {
        const [row] = await this.uow
            .current()
            .select({
                id: ssoIdentities.id,
                userId: ssoIdentities.userId,
                provider: ssoIdentities.provider,
                subject: ssoIdentities.subject
            })
            .from(ssoIdentities)
            .where(
                and(
                    eq(ssoIdentities.provider, provider),
                    eq(ssoIdentities.subject, subject)
                )
            )
            .limit(1);
        return row ?? null;
    }

    /** {@inheritDoc SsoIdentityRepository.link} */
    async link(input: LinkSsoIdentityInput): Promise<SsoIdentityLink> {
        // A plain insert, not check-then-insert: the `(provider, subject)` and
        // `(provider, user_id)` unique indexes decide the race between two
        // simultaneous first sign-ins, and the loser's transaction rolls back
        // rather than producing a second link.
        const [row] = await this.uow
            .current()
            .insert(ssoIdentities)
            .values({
                userId: input.userId,
                provider: input.provider,
                subject: input.subject,
                email: input.email,
                lastLoginAt: new Date()
            })
            .returning({
                id: ssoIdentities.id,
                userId: ssoIdentities.userId,
                provider: ssoIdentities.provider,
                subject: ssoIdentities.subject
            });
        return row;
    }

    /** {@inheritDoc SsoIdentityRepository.recordLogin} */
    async recordLogin(id: string, email: string, at: Date): Promise<void> {
        await this.uow
            .current()
            .update(ssoIdentities)
            .set({ lastLoginAt: at, email })
            .where(eq(ssoIdentities.id, id));
    }
}
