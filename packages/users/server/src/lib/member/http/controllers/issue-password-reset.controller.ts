import {
    Controller,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards
} from '@nestjs/common';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@ortha/identity-server';
import { IssuePasswordResetUseCase } from '../../application/use-cases/issue-password-reset.use-case';
import {
    InvalidMemberStateError,
    MemberNotFoundError,
    PasswordResetRecentlySentError
} from '../../domain/errors';
import { conflict } from '../conflict';
import { MemberViewQuery } from '../../infrastructure/queries/member-view.query';
import type { PasswordResetMemberView } from '../../application/queries/member.view';

/**
 * `POST /api/users/:id/password-reset` — mints a one-time password-reset link
 * for an active member and returns it, so the admin can hand it over (no mailer
 * sends it yet).
 *
 * Gated on `users:update`, the permission that already covers changing what an
 * account *is*; only `admin` holds it. 409s when the member is not `active` —
 * a pending invite is resent, not reset, and a suspended account is reactivated
 * first.
 *
 * Returns the member row plus the raw `resetToken` when no mail provider is
 * configured to deliver it (ADR-0018 §4). Issuing rotates the token,
 * so whatever link was outstanding is already dead by the time this responds —
 * which is why the new one has to reach the caller in the same breath.
 */
@UseGuards(OriginGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.USERS_UPDATE)
@Controller('users')
export class IssuePasswordResetController {
    constructor(
        private readonly issueReset: IssuePasswordResetUseCase,
        private readonly views: MemberViewQuery
    ) {}

    @Post(':id/password-reset')
    async issue(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<PasswordResetMemberView> {
        try {
            const resetToken = await this.issueReset.execute(actor, id);
            const view = await this.views.byId(id);
            if (!view) {
                throw new NotFoundException();
            }
            return { ...view, ...(resetToken ? { resetToken } : {}) };
        } catch (error) {
            if (error instanceof MemberNotFoundError) {
                throw new NotFoundException();
            }
            if (error instanceof InvalidMemberStateError) {
                throw conflict(error.code, error.message);
            }
            if (error instanceof PasswordResetRecentlySentError) {
                // Carry the wait so a client can say "try again in 42s"
                // rather than only that something conflicted.
                throw conflict(error.code, error.message, {
                    retryAfterSeconds: error.retryAfterSeconds
                });
            }
            throw error;
        }
    }
}
