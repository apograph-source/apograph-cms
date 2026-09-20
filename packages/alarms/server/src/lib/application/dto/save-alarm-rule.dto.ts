import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsBoolean,
    IsIn,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    MaxLength
} from 'class-validator';
import {
    ALARM_SEVERITIES,
    type AlarmSeverity
} from '../../domain/alarm-severity';
import { NAME_MAX_LENGTH, TEXT_MAX_LENGTH } from '../../alarms.constants';

/**
 * Body of `POST /api/alarms/rules`.
 *
 * `filter` is declared as a plain object rather than a validated shape: it is
 * the query builder's own tree, and the authority on whether it is well-formed
 * is `parseFilterTree` against the named content type — the same parser the
 * records list runs. Restating its grammar in decorators would create a second,
 * weaker copy that drifts the first time the engine gains an operator.
 *
 * **And no `@MaxLength`, deliberately.** This package used to declare a
 * `FILTER_MAX_LENGTH = 8192` next to the name and text caps, describing itself
 * as "the same layering `activity.constants.ts` uses" — which declared 4096.
 * Nothing imported it, and nothing could have: `@MaxLength` is a string
 * decorator and this field is an object. It was a number that had never bounded
 * anything, and reading it as a deliberately looser ceiling for a stored rule
 * was the wrong inference twice over.
 *
 * The size of this tree is bounded where every caller meets it instead — the
 * engine's own budgets in `@orthacms/utils-server`'s `filters/budgets.ts`,
 * which since they gained `maxValueLength` cap the tree's text as well as its
 * shape. That matters here more than on a `?filter=` route, because a rule is
 * **stored and replayed**: the sweep and the outbox subscriber hand this tree
 * straight back to the parser out of its `jsonb` column, where no serialised
 * string exists to measure.
 */
export class CreateAlarmRuleDto {
    @ApiProperty({
        type: String,
        maxLength: NAME_MAX_LENGTH,
        example: 'article',
        description: 'The content type this rule watches.'
    })
    @IsString()
    @IsNotEmpty()
    @MaxLength(NAME_MAX_LENGTH)
    contentType!: string;

    @ApiProperty({
        type: String,
        maxLength: NAME_MAX_LENGTH,
        example: 'Relations point at published records',
        description:
            'How the rule is named in the alarms list. Unique per workspace.'
    })
    @IsString()
    @IsNotEmpty()
    @MaxLength(NAME_MAX_LENGTH)
    name!: string;

    @ApiProperty({
        type: String,
        maxLength: NAME_MAX_LENGTH,
        example: 'Author is not published',
        description:
            'What a finding of this rule says in the entry editor. Separate ' +
            'from the rule name on purpose: the rule is named in the language ' +
            'of editorial policy, the finding speaks to whoever is looking at ' +
            'one record.'
    })
    @IsString()
    @IsNotEmpty()
    @MaxLength(NAME_MAX_LENGTH)
    findingTitle!: string;

    @ApiPropertyOptional({
        type: String,
        maxLength: TEXT_MAX_LENGTH,
        description: 'Longer explanation shown on the rule.'
    })
    @IsOptional()
    @IsString()
    @MaxLength(TEXT_MAX_LENGTH)
    description?: string;

    @ApiProperty({
        enum: [...ALARM_SEVERITIES],
        example: 'warn',
        description:
            'How loudly the rule speaks. Carries no authority — no severity ' +
            'blocks a save or a publish.'
    })
    @IsIn([...ALARM_SEVERITIES])
    severity!: AlarmSeverity;

    @ApiProperty({
        type: Object,
        description:
            'The query-builder filter tree, exactly as the records list ' +
            'serialises it into `?filter=`.',
        example: {
            and: [
                { field: 'status', op: 'eq', value: 'published' },
                { field: 'author.status', op: 'ne', value: 'published' }
            ]
        }
    })
    @IsObject()
    filter!: Record<string, unknown>;

    @ApiPropertyOptional({
        type: Boolean,
        default: true,
        description: 'Whether the rule evaluates. Disabled rules keep findings.'
    })
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;
}

/**
 * Body of `PATCH /api/alarms/rules/:id`. Every field optional; an absent key is
 * left alone. `contentType` is deliberately **not** here — changing which type
 * a rule watches makes every one of its findings meaningless, so that is a new
 * rule, not an edit.
 */
export class UpdateAlarmRuleDto {
    @ApiPropertyOptional({ type: String, maxLength: NAME_MAX_LENGTH })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(NAME_MAX_LENGTH)
    name?: string;

    @ApiPropertyOptional({ type: String, maxLength: NAME_MAX_LENGTH })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(NAME_MAX_LENGTH)
    findingTitle?: string;

    @ApiPropertyOptional({ type: String, maxLength: TEXT_MAX_LENGTH })
    @IsOptional()
    @IsString()
    @MaxLength(TEXT_MAX_LENGTH)
    description?: string;

    @ApiPropertyOptional({ enum: [...ALARM_SEVERITIES] })
    @IsOptional()
    @IsIn([...ALARM_SEVERITIES])
    severity?: AlarmSeverity;

    @ApiPropertyOptional({ type: Object })
    @IsOptional()
    @IsObject()
    filter?: Record<string, unknown>;

    @ApiPropertyOptional({ type: Boolean })
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;
}

/**
 * Body of `POST /api/alarms/rules/preview` — the rule editor's live
 * "matches N of M" readout, run before anything is saved.
 */
export class PreviewAlarmRuleDto {
    @ApiProperty({ type: String, maxLength: NAME_MAX_LENGTH })
    @IsString()
    @IsNotEmpty()
    @MaxLength(NAME_MAX_LENGTH)
    contentType!: string;

    @ApiProperty({ type: Object })
    @IsObject()
    filter!: Record<string, unknown>;
}
