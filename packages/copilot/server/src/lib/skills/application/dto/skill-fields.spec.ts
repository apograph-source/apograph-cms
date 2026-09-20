import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validateSync } from 'class-validator';
import { getTableColumns } from 'drizzle-orm';
import type { Skill, SkillDefinition } from '@orthacms/copilot-domain';
import { copilotSkills } from '../../infrastructure/schema/skills';
import { CreateSkillDto } from './create-skill.dto';
import { UpdateSkillDto } from './update-skill.dto';

/**
 * A skill changes **how** the copilot works, never **what it is allowed to
 * do** ([ADR-0010](../../../../../../../docs/adr/0010-copilot-skills.md)).
 *
 * That is not a style preference: `copilot:skills:manage` is admin-only, and
 * the argument for letting an admin write prompt text at all is that prompt
 * text cannot grant authority. The day a skill carries an `allowedTools` — or a
 * `tools`, or a `permissions` — that argument is gone, and the tool set stops
 * being a function of the caller's own grants.
 *
 * So the field must not exist anywhere a skill is defined, and it must not be
 * *acceptable* anywhere a skill is written. Every surface is enumerated here
 * rather than spot-checked, because "no field like that" is a claim about the
 * whole shape and a new one is exactly what would be added quietly.
 */

/** The properties a skill has, on either side of the wire. */
const SKILL_PROPERTIES = [
    'name',
    'title',
    'description',
    'instructions',
    'mode',
    'enabled'
];

/** The property names `class-validator` will validate on a DTO. */
function validatedProperties(target: new () => object): string[] {
    const metadata = getMetadataStorage().getTargetValidationMetadatas(
        target,
        '',
        false,
        false
    );
    return [...new Set(metadata.map((entry) => entry.propertyName))].sort();
}

describe('the shape of a skill', () => {
    /**
     * Compile-time halves: a field added to either domain type breaks this
     * mapping, and a developer who "fixes" that by adding the key here then
     * fails the assertion underneath it.
     */
    const SKILL_KEYS: Record<keyof Skill, true> = {
        name: true,
        title: true,
        description: true,
        instructions: true,
        mode: true,
        source: true
    };
    const DEFINITION_KEYS: Record<keyof SkillDefinition, true> = {
        name: true,
        title: true,
        description: true,
        instructions: true,
        mode: true
    };

    it('carries no field naming a tool, in code or in the CMS [copilot:I-28]', () => {
        expect(Object.keys(SKILL_KEYS).sort()).toEqual(
            [
                'name',
                'title',
                'description',
                'instructions',
                'mode',
                'source'
            ].sort()
        );
        expect(Object.keys(DEFINITION_KEYS).sort()).toEqual(
            ['name', 'title', 'description', 'instructions', 'mode'].sort()
        );
        // The row an admin authors, too: a column is the other way a skill
        // could come to carry a tool set, and it would outlive any DTO.
        expect(Object.keys(getTableColumns(copilotSkills)).sort()).toEqual(
            [
                'id',
                'workspaceId',
                'name',
                'title',
                'description',
                'instructions',
                'mode',
                'enabled',
                'createdBy',
                'createdAt',
                'updatedAt'
            ].sort()
        );
    });

    it.each([
        ['CreateSkillDto', CreateSkillDto],
        ['UpdateSkillDto', UpdateSkillDto]
    ])(
        'validates exactly the six writable fields on %s [copilot:I-28]',
        (_name, dto) => {
            expect(validatedProperties(dto)).toEqual(
                [...SKILL_PROPERTIES].sort()
            );
        }
    );

    /**
     * And the write routes refuse one on the wire. This is the strict global
     * `ValidationPipe`'s own mechanism — `whitelist` + `forbidNonWhitelisted`,
     * the same pair `copilot-skills.spec.ts` shows 400ing an `instructions`
     * field on a run request — so a tool-set-shaped property is refused by
     * name rather than silently stripped and forgotten.
     */
    it.each(['allowedTools', 'tools', 'permissions'])(
        'refuses a "%s" field on the way in [copilot:I-28]',
        (field) => {
            const errors = validateSync(
                plainToInstance(CreateSkillDto, {
                    name: 'house-style',
                    title: 'House style',
                    description: 'How we write.',
                    instructions: 'Write in sentence case.',
                    [field]: ['content_publish']
                }),
                { whitelist: true, forbidNonWhitelisted: true }
            );

            expect(errors.map((error) => error.property)).toEqual([field]);
        }
    );
});
