import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength
} from 'class-validator';

import {
    SEGMENT_KEY_MAX as KEY_MAX,
    SEGMENT_KEY_PATTERN as KEY_PATTERN,
    SEGMENT_LABEL_MAX as LABEL_MAX,
    SEGMENT_TAG_MAX as TAG_MAX,
    SEGMENT_TAGS_MAX as TAGS_MAX
} from '@orthacms/segments-domain';

/**
 * Segments one entry may name on either side.
 *
 * Exported because the routes are not the only write path: the entry save's
 * `extensions.access` bag reaches `EntryAccessWriteExtension` without passing a
 * DTO at all, and it is the path the admin actually uses. A cap only the routes
 * applied would be a cap an entry could exceed and then never be rewritten
 * through — and `MATCHED_IDS_CAP` in the directory service is set to this number
 * on the stated grounds that it is what an entry can store.
 */
export const ENTRY_ACCESS_IDS_MAX = 200;

/** Shorthand, so the decorators below read as they did. */
const IDS_MAX = ENTRY_ACCESS_IDS_MAX;

/** Workspaces one segment may be scoped to. Empty means every one. */
const WORKSPACES_MAX = 100;

/** Most rows one page of the directory may carry. */
const PAGE_SIZE_MAX = 100;

/** Narrow and page the segment list. */
export class ListSegmentsQueryDto {
    @ApiPropertyOptional({
        description:
            'Case-insensitive substring matched against the segment’s label and key.',
        maxLength: LABEL_MAX
    })
    @IsOptional()
    @IsString()
    @MaxLength(LABEL_MAX)
    q?: string;

    @ApiPropertyOptional({
        format: 'uuid',
        description:
            'Only audiences offered in this workspace — those naming it, plus those naming no workspace at all, which are offered everywhere. Omit to list the installation’s whole vocabulary (what the directory shows).'
    })
    @IsOptional()
    @IsUUID()
    workspace?: string;

    @ApiPropertyOptional({ minimum: 1, default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @ApiPropertyOptional({ minimum: 1, maximum: PAGE_SIZE_MAX, default: 25 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(PAGE_SIZE_MAX)
    pageSize?: number;
}

/** Resolve named segments, whatever page they would fall on. */
export class LookupSegmentsQueryDto {
    @ApiProperty({
        type: [String],
        maxItems: IDS_MAX,
        description:
            'Segment ids to resolve. Unknown ids are skipped rather than refused — a segment a revision captured really can have been deleted since.'
    })
    // `?ids=a,b` and `?ids=a&ids=b` are both what a client naturally sends, and
    // Express parses the first as a string and the second as an array — so a
    // one-id lookup would fail `@IsArray()` while a two-id one passed.
    @Transform(({ value }) =>
        (Array.isArray(value) ? value : [value])
            .flatMap((entry: unknown) => String(entry ?? '').split(','))
            .map((entry) => entry.trim())
            .filter(Boolean)
    )
    @IsArray()
    @ArrayMaxSize(IDS_MAX)
    @IsUUID('4', { each: true })
    ids!: string[];
}

/** Create a segment. */
export class CreateSegmentDto {
    @ApiProperty({ maxLength: KEY_MAX, example: 'acme' })
    @IsString()
    @MinLength(1)
    @MaxLength(KEY_MAX)
    @Matches(KEY_PATTERN, { message: 'key must be lowercase and url-safe' })
    key!: string;

    @ApiProperty({ maxLength: LABEL_MAX, example: 'Acme Corp' })
    @IsString()
    @MinLength(1)
    @MaxLength(LABEL_MAX)
    label!: string;

    @ApiPropertyOptional({
        type: [String],
        maxItems: TAGS_MAX,
        description:
            'The reader tags this segment answers to — any one is enough. Defaults to the key.'
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(TAGS_MAX)
    @IsString({ each: true })
    @MaxLength(TAG_MAX, { each: true })
    tags?: string[];

    @ApiPropertyOptional({
        type: [String],
        maxItems: WORKSPACES_MAX,
        description:
            'The workspaces this audience is offered in. **An empty list means every one**, not none — the same reading as an entry’s empty allow list, and the state every segment starts in.'
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(WORKSPACES_MAX)
    @IsUUID('4', { each: true })
    workspaceIds?: string[];
}

/** Rename a segment, change its tags, or change where it is offered. */
export class UpdateSegmentDto {
    @ApiPropertyOptional({ maxLength: LABEL_MAX })
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(LABEL_MAX)
    label?: string;

    @ApiPropertyOptional({ type: [String], maxItems: TAGS_MAX })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(TAGS_MAX)
    @IsString({ each: true })
    @MaxLength(TAG_MAX, { each: true })
    tags?: string[];

    @ApiPropertyOptional({
        type: [String],
        maxItems: WORKSPACES_MAX,
        description:
            'The workspaces this audience is offered in; an empty list means every one. Narrowing it stops the audience being offered on new decisions — it does **not** retract it from entries that already name it.'
    })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(WORKSPACES_MAX)
    @IsUUID('4', { each: true })
    workspaceIds?: string[];
}

/**
 * Replace one entry's two lists.
 *
 * Both are sent whole on every write, because that is the only shape that can
 * express a removal — a merge has no spelling for "this segment is no longer
 * mentioned".
 */
export class SetEntryAccessDto {
    @ApiProperty({
        maxLength: 120,
        description: 'The entry’s content type slug.',
        example: 'article'
    })
    @IsString()
    @MaxLength(120)
    typeSlug!: string;

    @ApiProperty({
        type: [String],
        maxItems: IDS_MAX,
        description:
            'Segments that may read the entry. **An empty list means everyone**, not nobody.'
    })
    @IsArray()
    @ArrayMaxSize(IDS_MAX)
    @IsUUID('4', { each: true })
    allow!: string[];

    @ApiProperty({
        type: [String],
        maxItems: IDS_MAX,
        description:
            'Segments that may not, whatever `allow` says. A deny always wins.'
    })
    @IsArray()
    @ArrayMaxSize(IDS_MAX)
    @IsUUID('4', { each: true })
    deny!: string[];
}

/**
 * Replace one entry's two lists over the **public** API.
 *
 * The type is in the path there (`/v1/content/:typeName/:id/access`), which is
 * the shape every other public content route already has — so this is
 * {@link SetEntryAccessDto} without the `typeSlug` the body would otherwise be
 * repeating back at the URL.
 */
export class PublicEntryAccessDto {
    @ApiProperty({
        type: [String],
        maxItems: IDS_MAX,
        description:
            'Segments that may read the entry. **An empty list means everyone**, not nobody.'
    })
    @IsArray()
    @ArrayMaxSize(IDS_MAX)
    @IsUUID('4', { each: true })
    allow!: string[];

    @ApiProperty({
        type: [String],
        maxItems: IDS_MAX,
        description:
            'Segments that may not, whatever `allow` says. A deny always wins.'
    })
    @IsArray()
    @ArrayMaxSize(IDS_MAX)
    @IsUUID('4', { each: true })
    deny!: string[];
}
