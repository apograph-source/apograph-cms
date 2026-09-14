import {
    Controller,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Post,
    UseGuards
} from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@apograph/identity-server';
import {
    MailNotConfiguredError,
    MemberNotFoundError,
    NoRevealableLinkError
} from '../../domain/errors';
import { conflict } from '../conflict';
import { RevealLinkUseCase } from '../../application/use-cases/reveal-link.use-case';

/** The response of `POST /api/users/:id/reveal-link`. */
export class RevealedLinkResponse {
    @ApiProperty({
        description:
            'Which message the link belongs to — `invite`, `invite_resent` or `password_reset`.',
        example: 'invite'
    })
    kind!: string;

    @ApiProperty({
        description:
            'The link itself. A secret: anyone holding it can take over the account.',
        example:
            'https://cms.example.com/identity/accept-invite?token=8f14e45fceea167a'
    })
    link!: string;

    @ApiProperty({
        description: 'When the message was queued.',
        format: 'date-time'
    })
    queuedAt!: Date;

    @ApiProperty({
        description: 'How many hand-off attempts have failed so far.',
        type: 'integer',
        example: 3
    })
    attempts!: number;

    @ApiProperty({
        description: 'What the mail provider said last, when it said anything.',
        nullable: true,
        example: 'ECONNECTION: connect ETIMEDOUT'
    })
    lastError!: string | null;
}

/**
 * `POST /api/users/:id/reveal-link` — hands back the link of a message that has
 * not been delivered; requires `users:manage`.
 *
 * It exists because of what configuring a mailer takes away: the invite and
 * reset routes stop returning the raw token, so an administrator whose
 * invitation bounced would otherwise have no way to help the person in front of
 * them except to resend and hope. This is that way, made deliberate — one entry
 * point, the strongest user permission, and an audit row on every use.
 *
 * A `POST` rather than a `GET` because it is not idempotent in the sense that
 * matters: each call records that somebody looked at a secret.
 *
 * 409s (`MAIL_NOT_CONFIGURED`) on a deployment that sends no mail — nothing is
 * being withheld there — and 409s (`NO_REVEALABLE_LINK`) when the message was
 * delivered, since the row and its only readable copy of the token were deleted
 * when it went out.
 */
@UseGuards(OriginGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.USERS_MANAGE)
@Controller('users')
export class RevealLinkController {
    constructor(private readonly revealLink: RevealLinkUseCase) {}

    @Post(':id/reveal-link')
    async reveal(
        @CurrentUser() actor: PublicUser,
        @Param('id', ParseUUIDPipe) id: string
    ): Promise<RevealedLinkResponse> {
        try {
            return await this.revealLink.execute(actor, id);
        } catch (error) {
            if (error instanceof MemberNotFoundError) {
                throw new NotFoundException();
            }
            if (
                error instanceof MailNotConfiguredError ||
                error instanceof NoRevealableLinkError
            ) {
                throw conflict(error.code, error.message);
            }
            throw error;
        }
    }
}
