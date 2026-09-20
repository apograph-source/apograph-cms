import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WEBHOOK_EVENT_KINDS } from '@orthacms/webhooks-domain';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    MinLength
} from 'class-validator';

/** Bounds on the free-text fields, restated in the OpenAPI schema below. */
const NAME_MAX = 120;
const URL_MAX = 2_048;
const LIST_MAX = 200;

/**
 * The body of a create or update.
 *
 * The three filter arrays are **optional, and an omitted or empty one means
 * "everything"** — including things that do not exist yet. That is the whole
 * subscription model, and it is why the shape is three plain lists rather than
 * an expression.
 *
 * The URL is only shape-checked here (`@IsString`); whether it is *reachable*
 * under this deployment's policy is decided in the service, which owns the
 * policy and can say why in a message worth showing.
 */
export class SaveWebhookEndpointDto {
    @ApiProperty({
        description: 'Human-readable name shown in the webhooks list.',
        maxLength: NAME_MAX,
        example: 'Rebuild the storefront'
    })
    @IsString()
    @MinLength(1)
    @MaxLength(NAME_MAX)
    name!: string;

    @ApiProperty({
        description:
            'Where deliveries are POSTed. Must be https:// and resolve to a public address unless the deployment allows otherwise.',
        maxLength: URL_MAX,
        example: 'https://example.com/hooks/ortha'
    })
    @IsString()
    @MinLength(1)
    @MaxLength(URL_MAX)
    url!: string;

    @ApiPropertyOptional({
        description: 'Whether the endpoint receives deliveries.',
        default: true
    })
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @ApiPropertyOptional({
        description:
            'Event kinds to subscribe to. Omit or leave empty to receive every kind, including ones added later.',
        type: [String],
        enum: WEBHOOK_EVENT_KINDS,
        maxItems: LIST_MAX
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(LIST_MAX)
    // Derived from the catalogue, so a new kind is subscribable the moment it
    // is added there and a removed one stops validating.
    @IsIn(WEBHOOK_EVENT_KINDS as string[], { each: true })
    eventKinds?: string[];

    @ApiPropertyOptional({
        description:
            'Content types to subscribe to. Omit or leave empty to receive every type.',
        type: [String],
        maxItems: LIST_MAX
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(LIST_MAX)
    @IsString({ each: true })
    @MaxLength(200, { each: true })
    contentTypes?: string[];

    @ApiPropertyOptional({
        description:
            'Receive events from every workspace, including workspaces created later. When true, workspaceIds is ignored.',
        default: false
    })
    @IsOptional()
    @IsBoolean()
    allWorkspaces?: boolean;

    @ApiPropertyOptional({
        description:
            'Workspaces to receive events from. Ignored when allWorkspaces is true; an empty list with allWorkspaces false receives nothing.',
        type: [String],
        format: 'uuid',
        maxItems: LIST_MAX
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(LIST_MAX)
    @IsUUID('4', { each: true })
    workspaceIds?: string[];

    @ApiPropertyOptional({
        description:
            'Extra static headers sent with every delivery. Delivery metadata headers (X-Ortha-*) and transport headers cannot be set.',
        type: 'object',
        additionalProperties: { type: 'string' },
        example: { Authorization: 'Bearer …' }
    })
    @IsOptional()
    @IsObject()
    headers?: Record<string, string>;
}
