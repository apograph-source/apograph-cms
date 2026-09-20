import { ApiPropertyOptional } from '@nestjs/swagger';
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
import { SKILL_MODES } from './create-skill.dto';

const trimmed = () =>
    Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value
    );

/**
 * Body of `PATCH /api/copilot/skills/:id`.
 *
 * A **patch**: every property is optional and only the ones present are
 * written. The controller rejects an empty body — answering 200 to it would
 * report success for a write that never happened.
 *
 * Not `PartialType(CreateSkillDto)`: the generated class would inherit whatever
 * `CreateSkillDto` grows later, and this endpoint deliberately does not accept
 * everything a create does (there is no `workspaceId` to move a skill between
 * workspaces with, and there never should be).
 */
export class UpdateSkillDto {
    /** Rename. Refused if the new name is taken, by either source. */
    @ApiPropertyOptional({
        type: String,
        maxLength: MAX_SKILL_NAME_LENGTH,
        pattern: SKILL_NAME_PATTERN.source
    })
    @IsOptional()
    @trimmed()
    @IsString()
    @MaxLength(MAX_SKILL_NAME_LENGTH)
    @Matches(SKILL_NAME_PATTERN, {
        message:
            'name must be lowercase letters, digits and hyphens, e.g. "house-style"'
    })
    name?: string;

    /** New display title. */
    @ApiPropertyOptional({ type: String, maxLength: MAX_SKILL_TITLE_LENGTH })
    @IsOptional()
    @trimmed()
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_SKILL_TITLE_LENGTH)
    title?: string;

    /** New description. */
    @ApiPropertyOptional({
        type: String,
        maxLength: MAX_SKILL_DESCRIPTION_LENGTH
    })
    @IsOptional()
    @trimmed()
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_SKILL_DESCRIPTION_LENGTH)
    description?: string;

    /** New body. */
    @ApiPropertyOptional({
        type: String,
        maxLength: MAX_SKILL_INSTRUCTIONS_LENGTH
    })
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_SKILL_INSTRUCTIONS_LENGTH)
    instructions?: string;

    /** Switch between always-on and attach-to-use. */
    @ApiPropertyOptional({ enum: SKILL_MODES })
    @IsOptional()
    @IsIn(SKILL_MODES)
    mode?: SkillMode;

    /** Turn the skill off without deleting it. */
    @ApiPropertyOptional({ type: Boolean })
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;
}
