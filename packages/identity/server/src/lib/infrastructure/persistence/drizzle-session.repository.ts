import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { sessions } from '../../schema';
import { SessionPolicy } from '../../domain/session-policy';
import type { SessionContext } from '../../domain/session';
import type {
    CreatedSession,
    IssueSessionOptions,
    ResolvedSession,
    SessionRepository,
    UserSessionView
} from '../../domain/session.repository';
import { HashingService } from '../../auth/services/hashing.service';

/**
 * Drizzle-backed {@link SessionRepository} over identity's `sessions` table.
 * The session PK is the **SHA-256 of** an application-generated 256-bit token;
 * the raw token lives only in the client's cookie and is never stored, so a
 * read-only DB/backup leak yields no usable tokens. Validity is decided per
 * request by the row's `revokedAt`/`expiresAt`, so the cookie needs no signing.
 *
 * Every statement runs through {@link UnitOfWork.current}, so a write joins the
 * calling use case's transaction (login opens the session and records its audit
 * atomically); the read/refresh paths run outside a unit of work against the
 * base connection, exactly as before.
 */
@Injectable()
export class DrizzleSessionRepository implements SessionRepository {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly policy: SessionPolicy,
        private readonly hashing: HashingService
    ) {}

    /** {@inheritDoc SessionRepository.issue} */
    async issue(
        userId: string,
        context: SessionContext,
        options: IssueSessionOptions = {}
    ): Promise<CreatedSession> {
        const token = randomBytes(32).toString('base64url');
        const expiresAt = this.policy.expiresAt(new Date(), options.ttlSeconds);

        await this.uow
            .current()
            .insert(sessions)
            .values({
                id: this.hashing.hashToken(token),
                userId,
                expiresAt,
                userAgent: context.userAgent ?? null,
                ipAddress: context.ipAddress ?? null,
                ssoProvider: options.ssoProvider ?? null,
                ssoSessionId: options.ssoSessionId ?? null
            });

        return { token, expiresAt };
    }

    /** {@inheritDoc SessionRepository.revokeBySsoSession} */
    async revokeBySsoSession(
        provider: string,
        ssoSessionId: string
    ): Promise<number> {
        // `isNull(revokedAt)` keeps the count honest: without it, a provider
        // that retries its notification — which they do, because the endpoint
        // is expected to be idempotent — would report the same sessions revoked
        // again on every attempt.
        const revoked = await this.uow
            .current()
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(
                and(
                    eq(sessions.ssoProvider, provider),
                    eq(sessions.ssoSessionId, ssoSessionId),
                    isNull(sessions.revokedAt)
                )
            )
            .returning({ id: sessions.id });
        return revoked.length;
    }

    /** {@inheritDoc SessionRepository.resolveActive} */
    async resolveActive(token: string): Promise<ResolvedSession | null> {
        const id = this.hashing.hashToken(token);
        const [session] = await this.uow
            .current()
            .select({
                userId: sessions.userId,
                lastUsedAt: sessions.lastUsedAt
            })
            .from(sessions)
            .where(
                and(
                    eq(sessions.id, id),
                    isNull(sessions.revokedAt),
                    gt(sessions.expiresAt, new Date())
                )
            );
        return session ?? null;
    }

    /** {@inheritDoc SessionRepository.touchLastUsed} */
    async touchLastUsed(token: string, at: Date): Promise<void> {
        const id = this.hashing.hashToken(token);
        await this.uow
            .current()
            .update(sessions)
            .set({ lastUsedAt: at })
            .where(eq(sessions.id, id));
    }

    /** {@inheritDoc SessionRepository.revokeByToken} */
    async revokeByToken(token: string): Promise<{ userId: string } | null> {
        const id = this.hashing.hashToken(token);
        const [revoked] = await this.uow
            .current()
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
            .returning({ userId: sessions.userId });
        return revoked ?? null;
    }

    /** {@inheritDoc SessionRepository.listForUser} */
    async listForUser(userId: string): Promise<UserSessionView[]> {
        return this.uow
            .current()
            .select({
                id: sessions.id,
                userAgent: sessions.userAgent,
                ipAddress: sessions.ipAddress,
                createdAt: sessions.createdAt,
                lastUsedAt: sessions.lastUsedAt,
                expiresAt: sessions.expiresAt
            })
            .from(sessions)
            .where(
                and(
                    eq(sessions.userId, userId),
                    isNull(sessions.revokedAt),
                    gt(sessions.expiresAt, new Date())
                )
            )
            .orderBy(desc(sessions.lastUsedAt));
    }

    /** {@inheritDoc SessionRepository.revokeAllForUser} */
    async revokeAllForUser(
        userId: string,
        options: { exceptSessionId?: string } = {}
    ): Promise<number> {
        const revoked = await this.uow
            .current()
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(
                and(
                    eq(sessions.userId, userId),
                    isNull(sessions.revokedAt),
                    // Already-expired rows are dead anyway; skipping them keeps
                    // the returned count meaningful ("sessions actually
                    // evicted") rather than counting tombstones.
                    gt(sessions.expiresAt, new Date()),
                    ...(options.exceptSessionId
                        ? [ne(sessions.id, options.exceptSessionId)]
                        : [])
                )
            )
            .returning({ id: sessions.id });
        return revoked.length;
    }

    /** {@inheritDoc SessionRepository.revokeById} */
    async revokeById(userId: string, sessionId: string): Promise<boolean> {
        const [revoked] = await this.uow
            .current()
            .update(sessions)
            .set({ revokedAt: new Date() })
            .where(
                and(
                    eq(sessions.id, sessionId),
                    eq(sessions.userId, userId),
                    isNull(sessions.revokedAt)
                )
            )
            .returning({ id: sessions.id });
        return revoked != null;
    }
}
