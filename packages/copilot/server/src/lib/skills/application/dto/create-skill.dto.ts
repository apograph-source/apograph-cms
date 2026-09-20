import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    MinLength
} from 'class-validator';
import {
    MAX_SKILL_DESCRIPTION_LENGTH,
    MAX_SKILL_INSTRUCTIONS_LENGTH,
    MAX_SKILL_NAME_LENGTH,
    MAX_SKILL_TITLE_LENGTH,
    SKILL_NAME_PATTERN,
    type SkillMode
} from '@orthacms/copilot-domain';

/** The two modes, as a value the strict pipe can check against. */
export const SKILL_MODES: readonly SkillMode[] = ['manual', 'always'];

/** Trims a string value during transformation, before the validators run. */
const trimmed = () =>
    Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value
    );

/**
 * Body of `POST /api/copilot/skills`.
 *
 * The bounds come from `@orthacms/copilot-domain` rather than being repeated
 * here, because the same numbers govern the host's boot-time validation of
 * code-defined skills — one set of limits, whichever way a skill was written.
 */
export class CreateSkillDto {
    /**
     * Machine name. Refused if the workspace, or a code-defined skill, already
     * holds it — a name resolves to exactly one body or the model's
     * instructions become a matter of row order.
     */
    @ApiProperty({
        type: String,
        maxLength: MAX_SKILL_NAME_LENGTH,
        pattern: SKILL_NAME_PATTERN.source,
        example: 'house-style'
    })
    @trimmed()
    @IsString()
    @MaxLength(MAX_SKILL_NAME_LENGTH)
    @Matches(SKILL_NAME_PATTERN, {
        message:
            'name must be lowercase letters, digits and hyphens, e.g. "house-style"'
    })
    name!: string;

    /** What a person reads in the picker and on a chip. */
    @ApiProperty({
        type: String,
        maxLength: MAX_SKILL_TITLE_LENGTH,
        example: 'House style'
    })
    @trimmed()
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_SKILL_TITLE_LENGTH)
    title!: string;

    /**
     * When to use it, written for the model — and **required**. It is the only
     * thing in the prompt for a skill nobody has attached, so a skill without
     * one exists but can never be found.
     */
    @ApiProperty({
        type: String,
        maxLength: MAX_SKILL_DESCRIPTION_LENGTH,
        example: 'How we write product copy: sentence case, second person.'
    })
    @trimmed()
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_SKILL_DESCRIPTION_LENGTH)
    description!: string;

    /**
     * The body — prompt text, not content. Bounded because it is spent from the
     * same context window the conversation and the tool results come out of.
     */
    @ApiProperty({
        type: String,
        maxLength: MAX_SKILL_INSTRUCTIONS_LENGTH
    })
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_SKILL_INSTRUCTIONS_LENGTH)
    instructions!: string;

    /** `always` puts it in force on every run in the workspace. */
    @ApiPropertyOptional({ enum: SKILL_MODES, default: 'manual' })
    @IsOptional()
    @IsIn(SKILL_MODES)
    mode?: SkillMode;

    /** Defaults to on. */
    @ApiPropertyOptional({ type: Boolean, default: true })
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;
}
