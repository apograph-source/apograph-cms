import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
    IsArray,
    IsIn,
    IsInt,
    IsISO8601,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min
} from 'class-validator';
import {
    DEFAULT_PAGE_SIZE,
    FILTER_MAX_LENGTH,
    MAX_PAGE_SIZE,
    SORTABLE_FIELDS,
    SORT_ORDERS,
    type SortableField,
    type SortOrder
} from '../activity.constants';

/**
 * Query parameters for `GET /api/activity`. All filters are optional and
 * intersected (AND). Pagination is 1-based; the service applies the defaults
 * (page 1, {@link DEFAULT_PAGE_SIZE}) so the contract has one source of truth.
 * `@Type`/`@Transform` coerce the raw query strings — the host's global
 * `ValidationPipe` transforms but does not implicitly convert.
 */
export class ListActivityQueryDto {
    /** Restrict to one subject kind (e.g. `'user'`). */
    @ApiPropertyOptional({
        type: String,
        maxLength: 255,
        example: 'user',
        description: "Restrict to one subject kind (e.g. `'user'`)."
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    subjectType?: string;

    /** Restrict to one subject id (a specific entity's history). */
    @ApiPropertyOptional({
        type: String,
        maxLength: 255,
        description:
            "Restrict to one subject id (a specific entity's history). Text, not always a uuid — the audit outlives its subjects."
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    subjectId?: string;

    /** Restrict to one actor. */
    @ApiPropertyOptional({
        type: String,
        format: 'uuid',
        description: 'Restrict to the events recorded for one actor.'
    })
    @IsOptional()
    @IsUUID()
    actorId?: string;

    /**
     * Restrict to actions performed by one kind of principal — `user` or
     * `api_token`. Free text rather than an enum for the same reason `kind` is:
     * the values are owned by `@orthacms/database`'s `EVENT_ACTOR_TYPE`, and a
     * copy here would be a second catalogue to keep in step.
     */
    @ApiPropertyOptional({
        type: String,
        maxLength: 255,
        example: 'api_token',
        description:
            'Restrict to actions performed by one kind of principal (`user` / `api_token`).'
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    actorType?: string;

    /**
     * Restrict to one workspace's history.
     *
     * Narrows, never widens: the log is deployment-wide and `activity:read`
     * is what bounds it, so this is a question a reader may ask rather than a
     * boundary imposed on them. Rows belonging to no workspace (invites, role
     * changes, workspace creation) are excluded by it, which is the point.
     */
    @ApiPropertyOptional({
        type: String,
        format: 'uuid',
        description:
            "Restrict to one workspace's history. Rows that belong to no workspace are excluded."
    })
    @IsOptional()
    @IsUUID()
    workspaceId?: string;

    /**
     * Restrict to one or more event kinds. Accepts a comma-separated list
     * (`?kind=user.invited,user.suspended`) → matched with `IN`. Kinds are
     * owned by the emitting plugins, so this is validated as free text, not
     * against a central catalogue.
     */
    @ApiPropertyOptional({
        type: String,
        example: 'user.invited,user.suspended',
        description:
            'Comma-separated event kinds, matched with `IN`. Kinds are owned by the emitting plugins, so this is free text rather than a central catalogue.'
    })
    @IsOptional()
    @Transform(({ value }) =>
        typeof value === 'string'
            ? value
                  .split(',')
                  .map((part) => part.trim())
                  .filter(Boolean)
            : value
    )
    @IsArray()
    @IsString({ each: true })
    @MaxLength(255, { each: true })
    kind?: string[];

    /** Case-insensitive substring search over the actor email snapshot. */
    @ApiPropertyOptional({
        type: String,
        maxLength: 255,
        description:
            'Case-insensitive substring search over the frozen actor-email snapshot.'
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    actorEmail?: string;

    /**
     * Structured filter tree as a JSON string (`?filter=<json>`), produced by
     * the admin query builder and validated against the activity filter schema
     * by `parseFilterTree`. Length-capped here as a first line of defence; the
     * engine's node/depth caps bound the parsed shape. AND-ed with the other
     * params.
     */
    @ApiPropertyOptional({
        type: String,
        maxLength: FILTER_MAX_LENGTH,
        example:
            '{"op":"and","rules":[{"field":"kind","op":"eq","value":"user.invited"}]}',
        description:
            'Structured filter tree as a JSON string, produced by the admin query builder and validated against the activity filter schema. AND-ed with the other params.'
    })
    @IsOptional()
    @IsString()
    @MaxLength(FILTER_MAX_LENGTH)
    filter?: string;

    /** Inclusive lower bound on the event time (ISO 8601). */
    @ApiPropertyOptional({
        type: String,
        format: 'date-time',
        example: '2026-01-01T00:00:00.000Z',
        description: 'Inclusive lower bound on the event time (ISO 8601).'
    })
    @IsOptional()
    @IsISO8601()
    from?: string;

    /** Inclusive upper bound on the event time (ISO 8601). */
    @ApiPropertyOptional({
        type: String,
        format: 'date-time',
        example: '2026-02-01T00:00:00.000Z',
        description: 'Inclusive upper bound on the event time (ISO 8601).'
    })
    @IsOptional()
    @IsISO8601()
    to?: string;

    /** 1-based page number. */
    @ApiPropertyOptional({
        type: 'integer',
        minimum: 1,
        default: 1,
        description: '1-based page number.'
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    /** Rows per page, capped at {@link MAX_PAGE_SIZE}. */
    @ApiPropertyOptional({
        type: 'integer',
        minimum: 1,
        maximum: MAX_PAGE_SIZE,
        default: DEFAULT_PAGE_SIZE,
        description: `Rows per page, capped at ${MAX_PAGE_SIZE}.`
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(MAX_PAGE_SIZE)
    pageSize?: number;

    /** Column to sort by (whitelisted). Defaults to `at`. */
    @ApiPropertyOptional({
        enum: [...SORTABLE_FIELDS],
        default: 'at',
        description: 'Column to sort by (whitelisted).'
    })
    @IsOptional()
    @IsIn(SORTABLE_FIELDS)
    sort?: SortableField;

    /** Sort direction. Defaults to `desc`. */
    @ApiPropertyOptional({
        enum: [...SORT_ORDERS],
        default: 'desc',
        description: 'Sort direction.'
    })
    @IsOptional()
    @IsIn(SORT_ORDERS)
    order?: SortOrder;
}
