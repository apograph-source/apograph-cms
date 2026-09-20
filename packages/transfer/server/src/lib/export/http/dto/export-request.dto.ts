import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsIn,
    IsOptional,
    IsUUID,
    ValidateNested
} from 'class-validator';
import {
    TRANSFER_FORMAT,
    TRANSFER_FORMATS,
    type TransferFormat
} from '@orthacms/transfer-domain';

/** Largest selection one export request may name. */
export const MAX_EXPORT_IDS = 1000;

/** How far the export should reach beyond the selected records. */
export class ExportDepthDto {
    @ApiPropertyOptional({
        default: true,
        description:
            'Pull related records in as full records. One hop only — their own relations stay as references.'
    })
    @IsOptional()
    @IsBoolean()
    relations?: boolean;

    @ApiPropertyOptional({
        default: true,
        description:
            'Carry the bytes of referenced files. Only the `zip` format can honour this; every other format carries metadata and a URL.'
    })
    @IsOptional()
    @IsBoolean()
    media?: boolean;

    @ApiPropertyOptional({
        default: true,
        description:
            'Include every locale of the selected records (their translation-group siblings).'
    })
    @IsOptional()
    @IsBoolean()
    locales?: boolean;

    @ApiPropertyOptional({
        default: false,
        description:
            'Also include the locales of related records. Off by default — it multiplies the payload by the locale count on top of the relation count.'
    })
    @IsOptional()
    @IsBoolean()
    relationLocales?: boolean;
}

/**
 * Body for `POST /content/:typeName/export` and its preview.
 *
 * `ids` is required rather than optional-meaning-everything. "Export the whole
 * collection" is a real request, but it should be made by selecting the whole
 * collection in the UI, where the count is visible — an empty body that quietly
 * means "all of it" is the shape that produces accidental full-library
 * downloads.
 */
export class ExportRequestDto {
    @ApiProperty({
        type: [String],
        format: 'uuid',
        minItems: 1,
        maxItems: MAX_EXPORT_IDS,
        description: `Entry ids to export — non-empty and capped at ${MAX_EXPORT_IDS}.`
    })
    @IsArray()
    @ArrayNotEmpty()
    @ArrayMaxSize(MAX_EXPORT_IDS)
    @IsUUID('4', { each: true })
    ids!: string[];

    @ApiProperty({
        enum: TRANSFER_FORMATS,
        default: TRANSFER_FORMAT.Json,
        description:
            'Output format. `zip` is the only one that carries file bytes; `csv` is flat and lossy.'
    })
    @IsIn(TRANSFER_FORMATS)
    format!: TransferFormat;

    @ApiPropertyOptional({ type: ExportDepthDto })
    @IsOptional()
    @ValidateNested()
    @Type(() => ExportDepthDto)
    depth?: ExportDepthDto;
}
