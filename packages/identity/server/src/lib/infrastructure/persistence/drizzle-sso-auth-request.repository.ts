import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { UnitOfWork } from '@orthacms/database';
import { ssoAuthRequests } from '../../schema';
import type {
    OpenSsoAuthRequestInput,
    PendingSsoAuthRequest,
    SsoAuthRequestRepository,
    StartedSsoAuthRequest
} from '../../domain/sso-auth-request.repository';
import { HashingService } from '../../auth/services/hashing.service';

/**
 * Drizzle-backed {@link SsoAuthRequestRepository} over identity's
 * `sso_auth_requests` table.
 *
 * Mints all four secrets here rather than in the use case, mirroring
 * {@link DrizzleSessionRepository.issue}: 256 bits of CSPRNG output and the
 * decision to store only a digest are one concern, and splitting them across
 * layers is how one of the two ends up weaker than the other.
 *
 * The PKCE verifier is 32 random bytes in base64url — 43 characters, inside
 * RFC 7636's 43–128 range, and unreserved throughout so no adapter has to
 * decide how to encode it.
 */
@Injectable()
export class DrizzleSsoAuthRequestRepository
    implements SsoAuthRequestRepository
{
    constructor(
        private readonly uow: UnitOfWork,
        private readonly hashing: HashingService
    ) {}

    /** {@inheritDoc SsoAuthRequestRepository.open} */
    async open(input: OpenSsoAuthRequestInput): Promise<StartedSsoAuthRequest> {
        const token = randomBytes(32).toString('base64url');
        const state = randomBytes(32).toString('base64url');
        const nonce = randomBytes(32).toString('base64url');
        const codeVerifier = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);

        await this.uow
            .current()
            .insert(ssoAuthRequests)
            .values({
                id: this.hashing.hashToken(token),
                provider: input.provider,
                state,
                nonce,
                codeVerifier,
                redirectTo: input.redirectTo,
                inviteTokenHash: input.inviteTokenHash ?? null,
                expiresAt
            });

        return { token, state, nonce, codeVerifier, expiresAt };
    }

    /** {@inheritDoc SsoAuthRequestRepository.findPendingByToken} */
    async findPendingByToken(
        token: string
    ): Promise<PendingSsoAuthRequest | null> {
        const [row] = await this.uow
            .current()
            .select({
                id: ssoAuthRequests.id,
                provider: ssoAuthRequests.provider,
                state: ssoAuthRequests.state,
                nonce: ssoAuthRequests.nonce,
                codeVerifier: ssoAuthRequests.codeVerifier,
                redirectTo: ssoAuthRequests.redirectTo,
                inviteTokenHash: ssoAuthRequests.inviteTokenHash
            })
            .from(ssoAuthRequests)
            .where(
                and(
                    eq(ssoAuthRequests.id, this.hashing.hashToken(token)),
                    // Unspent and still inside its window — an attempt is good
                    // exactly once, and only for the minute or two it takes to
                    // click through a provider's consent screen.
                    isNull(ssoAuthRequests.consumedAt),
                    gt(ssoAuthRequests.expiresAt, new Date())
                )
            )
            .limit(1);
        return row ?? null;
    }

    /** {@inheritDoc SsoAuthRequestRepository.consume} */
    async consume(id: string): Promise<boolean> {
        const burned = await this.uow
            .current()
            .update(ssoAuthRequests)
            .set({ consumedAt: new Date() })
            .where(
                and(
                    eq(ssoAuthRequests.id, id),
                    isNull(ssoAuthRequests.consumedAt)
                )
            )
            .returning({ id: ssoAuthRequests.id });
        return burned.length > 0;
    }
}
