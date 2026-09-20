import { ApiPropertyOptional } from '@nestjs/swagger';
import {
    DELIVERY_STATUSES,
    WEBHOOK_EVENT_KINDS
} from '@orthacms/webhooks-domain';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** The largest page the delivery log will return. */
const MAX_PAGE_SIZE = 100;

/** Filters and paging for `GET /api/webhooks/:id/deliveries`. */
export class ListDeliveriesQueryDto {
    @ApiPropertyOptional({
        description: 'Only deliveries in this state.',
        enum: DELIVERY_STATUSES
    })
    @IsOptional()
    @IsIn(DELIVERY_STATUSES as readonly string[])
    status?: string;

    @ApiPropertyOptional({
        description: 'Only deliveries of this event kind.',
        enum: WEBHOOK_EVENT_KINDS
    })
    @IsOptional()
    @IsIn(WEBHOOK_EVENT_KINDS as string[])
    eventKind?: string;

    @ApiPropertyOptional({
        description: '1-based page number.',
        type: 'integer',
        minimum: 1,
        default: 1
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @ApiPropertyOptional({
        description: 'Rows per page.',
        type: 'integer',
        minimum: 1,
        maximum: MAX_PAGE_SIZE,
        default: 25
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_PAGE_SIZE)
    pageSize?: number;
}
