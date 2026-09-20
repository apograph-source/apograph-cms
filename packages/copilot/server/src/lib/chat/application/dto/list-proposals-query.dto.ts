import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { ProposalStatus } from '@orthacms/copilot-domain';

/** The statuses a caller may filter the queue by. */
const STATUSES = ['pending', 'accepted', 'rejected'] as const;

/**
 * Query parameters for `GET /api/copilot/proposals`.
 *
 * Every property is declared because the host's `ValidationPipe` runs with
 * `forbidNonWhitelisted` — an undeclared key is a 400 naming it, and an
 * undeclared *nested* one would be silently stripped.
 */
export class ListProposalsQueryDto {
    /** Restrict to one status. Omitted, every proposal is returned. */
    @ApiPropertyOptional({
        enum: [...STATUSES],
        description:
            'Restrict to one status. Omit for the whole history; `pending` is the review queue.'
    })
    @IsOptional()
    @IsIn(STATUSES)
    status?: ProposalStatus;

    /** Restrict to the proposals made in one thread. */
    @ApiPropertyOptional({
        type: String,
        format: 'uuid',
        description:
            'Restrict to one conversation — what the chat panel asks for when re-opening a thread.'
    })
    @IsOptional()
    @IsUUID()
    conversationId?: string;
}
