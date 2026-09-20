import {
    BadRequestException,
    Body,
    ConflictException,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { attachActor, OutboxWriter, UnitOfWork } from '@ortha/database';
import {
    COPILOT_EVENT_KINDS,
    copilotSkillEvent
} from '../../../copilot.events';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@ortha/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@ortha/workspaces-server';
import {
    SkillCatalogService,
    type SkillSummary
} from '../../application/skill-catalog.service';
import {
    SkillRepository,
    type SkillRecord
} from '../../infrastructure/persistence/skill.repository';
import { CreateSkillDto } from '../../application/dto/create-skill.dto';
import { UpdateSkillDto } from '../../application/dto/update-skill.dto';

/**
 * Authoring skills — `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id` under
 * `/api/copilot/skills`.
 *
 * **Every route here requires `copilot:skills:manage`, and that is the whole
 * security posture of the feature.** A skill's `instructions` are prompt text
 * that runs for every member of the workspace, so writing one is authoring part
 * of the system prompt rather than authoring content
 * ([ADR-0010](../../../../../../../docs/adr/0010-copilot-skills.md)). The key is
 * admin-only in `SYSTEM_ROLES`; a contributor can use every skill and write
 * none.
 *
 * `GET /:id` is here rather than beside the list route because it is the only
 * read that carries the body, and the manage page is the only thing that needs
 * one. `OriginGuard` on the three writes, as everywhere else that changes
 * state.
 *
 * A skill that is not this workspace's is a **404, not a 403** — the repository
 * filters on the workspace and reports "not found" either way, so an id cannot
 * be probed for existence.
 */
@UseGuards(PermissionsGuard, WorkspaceGuard)
@RequirePermissions(PERMISSIONS.COPILOT_SKILLS_MANAGE)
@Controller('copilot')
export class ManageSkillsController {
    constructor(
        private readonly skills: SkillRepository,
        private readonly catalog: SkillCatalogService,
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter
    ) {}

    /**
     * Appends one `copilot.skill.*` event from inside the active unit of work,
     * stamped with the administrator who made the change.
     */
    private async emit(
        kind: string,
        skillId: string,
        payload: Record<string, unknown>,
        user: PublicUser
    ): Promise<void> {
        await this.outbox.append(
            attachActor([copilotSkillEvent(kind, skillId, payload)], {
                id: user.id,
                email: user.email ?? null
            })
        );
    }

    /**
     * Every skill the manage page lists — code skills (read-only) and all of
     * the workspace's rows, disabled ones included.
     *
     * A second listing route rather than a flag on the public one, because the
     * two answer different questions and have different permissions: "what may
     * I attach?" is `copilot:use`, "what exists here?" is an admin's view.
     */
    @Get('skills/manage')
    @ApiOperation({ summary: 'List every skill, for the management page' })
    async manageList(
        @CurrentWorkspace() workspaceId: string
    ): Promise<SkillSummary[]> {
        return this.catalog.manageList(workspaceId);
    }

    @Get('skills/:id')
    @ApiOperation({ summary: 'Read one skill, including its instructions' })
    @ApiResponse({ status: 404, description: 'No such skill here.' })
    async read(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentWorkspace() workspaceId: string
    ): Promise<SkillRecord> {
        const skill = await this.skills.find(id, workspaceId);
        if (!skill) {
            throw new NotFoundException('Skill not found.');
        }
        return skill;
    }

    @Post('skills')
    @UseGuards(OriginGuard)
    @ApiOperation({ summary: 'Create a skill in this workspace' })
    @ApiResponse({ status: 409, description: 'The name is already taken.' })
    async create(
        @Body() body: CreateSkillDto,
        @CurrentUser() user: PublicUser,
        @CurrentWorkspace() workspaceId: string
    ): Promise<SkillRecord> {
        await this.assertNameFree(body.name, workspaceId);

        return this.uow.run(async () => {
            const created = await this.skills.create({
                workspaceId,
                name: body.name,
                title: body.title,
                description: body.description,
                instructions: body.instructions,
                mode: body.mode ?? 'manual',
                enabled: body.enabled ?? true,
                createdBy: user.id
            });
            await this.emit(
                COPILOT_EVENT_KINDS.SKILL_CREATED,
                created.id,
                {
                    workspaceId,
                    name: created.name,
                    title: created.title,
                    // `auto` means it runs without anybody asking for it, which
                    // is the fact that makes a skill worth an audit row.
                    mode: created.mode,
                    enabled: created.enabled
                },
                user
            );
            return created;
        });
    }

    @Patch('skills/:id')
    @UseGuards(OriginGuard)
    @ApiOperation({ summary: 'Edit a skill' })
    @ApiResponse({ status: 409, description: 'The new name is already taken.' })
    async update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateSkillDto,
        @CurrentUser() user: PublicUser,
        @CurrentWorkspace() workspaceId: string
    ): Promise<SkillRecord> {
        // An empty patch cannot mean anything, and answering 200 to it would
        // report success for a write that never happened. The pipe cannot catch
        // this: every property is legitimately optional on its own.
        if (Object.keys(body).length === 0) {
            throw new BadRequestException(
                'Provide at least one field to change.'
            );
        }
        if (body.name !== undefined) {
            await this.assertNameFree(body.name, workspaceId, id);
        }

        const existing = await this.skills.find(id, workspaceId);
        return this.uow.run(async () => {
            const updated = await this.skills.update(id, workspaceId, body);
            if (!updated) {
                throw new NotFoundException('Skill not found.');
            }
            await this.emit(
                COPILOT_EVENT_KINDS.SKILL_UPDATED,
                id,
                {
                    workspaceId,
                    name: updated.name,
                    // The keys the caller sent — a patch, so "what changed" is
                    // the request rather than the row.
                    fields: Object.keys(body),
                    mode: { from: existing?.mode ?? null, to: updated.mode },
                    enabled: {
                        from: existing?.enabled ?? null,
                        to: updated.enabled
                    }
                },
                user
            );
            return updated;
        });
    }

    /**
     * Deletes a skill.
     *
     * A real delete, unlike a conversation's — a skill is configuration rather
     * than the receipt for a change somebody's content already took, and every
     * turn that ran with it holds its own name/title snapshot, so the
     * transcript survives.
     */
    @Delete('skills/:id')
    @UseGuards(OriginGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a skill' })
    async remove(
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user: PublicUser,
        @CurrentWorkspace() workspaceId: string
    ): Promise<void> {
        const existing = await this.skills.find(id, workspaceId);
        await this.uow.run(async () => {
            const removed = await this.skills.remove(id, workspaceId);
            if (!removed) {
                throw new NotFoundException('Skill not found.');
            }
            // The skill's own details, because after this commits there is
            // nowhere left to look them up.
            await this.emit(
                COPILOT_EVENT_KINDS.SKILL_DELETED,
                id,
                {
                    workspaceId,
                    name: existing?.name ?? null,
                    title: existing?.title ?? null,
                    mode: existing?.mode ?? null
                },
                user
            );
        });
    }

    /**
     * Refuses a name a code skill or another row already holds.
     *
     * A code skill's name is refused **here**, at the write, rather than left
     * to `mergeSkills` at read time: the merge drops the shadowed row silently,
     * which is the right thing to do when a deploy takes a name over but a
     * terrible thing to do to someone who has just typed one — they would see a
     * saved skill that never runs. The unique index behind this covers the
     * concurrent case; this covers the legible one.
     */
    private async assertNameFree(
        name: string,
        workspaceId: string,
        exceptId?: string
    ): Promise<void> {
        const taken = await this.catalog.nameTaken(name, workspaceId, exceptId);
        if (taken === 'code') {
            throw new ConflictException(
                `"${name}" is the name of a skill defined in this deployment's configuration. Choose another name.`
            );
        }
        if (taken === 'cms') {
            throw new ConflictException(
                `This workspace already has a skill named "${name}".`
            );
        }
    }
}
