import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    NotFoundException,
    Param,
    Put,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import type { EventActor } from '@orthacms/database';
import { ProtectionRulesService } from '../../application/protection-rules.service';
import { SaveProtectionRuleDto } from '../../application/dto/save-protection-rule.dto';
import { UnknownProtectedContentTypeError } from '../../domain/errors';
import type { ProtectionRuleView } from '../../types/protection-views';

/**
 * The rule surface: `/api/protection/rules`.
 *
 * **Not** mounted under `/api/content/...`, deliberately: a plugin that hangs
 * its routes off another plugin's prefix makes the prefix ambiguous both to
 * read and to guard, and protection is not a sub-resource of content — it is a
 * policy *about* content that content knows nothing of.
 *
 * Every route is `protection:manage`, which is administrator-only. There is no
 * read/manage split as `alarms` and `segments` have, and the reason is what the
 * two halves are for: a contributor needs to know that *this entry* needs two
 * approvals, and that answer comes from the entry route (`content:read`, in a
 * later PR) rather than from the workspace's rule table. Nobody but an
 * administrator needs the table itself, so nobody but an administrator gets it.
 *
 * `WorkspaceGuard` scopes every route to the workspace in `X-Workspace-Id`, so
 * a rule always belongs to a workspace the caller is a member of.
 * `OriginGuard` is applied per write route rather than to the class, matching
 * content's and alarms' controllers: these routes are cookie-authenticated and
 * therefore CSRF-able, the read is not state-changing.
 */
@ApiTags('protection')
@UseGuards(PermissionsGuard, WorkspaceGuard)
@Controller('protection/rules')
export class ProtectionRulesController {
    constructor(private readonly rules: ProtectionRulesService) {}

    /** Every rule in the open workspace. */
    @ApiOperation({
        summary: 'List protection rules',
        description:
            'Every rule the workspace holds, including any addressed at a ' +
            'content type it is no longer granted — those are the rows an ' +
            'administrator needs to see in order to remove them.'
    })
    @RequirePermissions(PERMISSIONS.PROTECTION_MANAGE)
    @Get()
    list(
        @CurrentWorkspace() workspaceId: string
    ): Promise<ProtectionRuleView[]> {
        return this.rules.list(workspaceId);
    }

    /**
     * Writes the rule for one content type.
     *
     * A replacement, not a patch: an omitted field takes its default rather
     * than keeping its previous value.
     */
    @ApiOperation({
        summary: 'Set a protection rule',
        description:
            'Creates or replaces the rule for one content type. Every field ' +
            'is optional and an omitted one takes its default — this is a ' +
            'replacement, not a patch. 404 when the workspace was not granted ' +
            'the type, which is also the answer for a type that does not ' +
            'exist: telling those apart would let one workspace enumerate the ' +
            'deployment’s content model.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.PROTECTION_MANAGE)
    @Put(':kind/:slug')
    save(
        @CurrentWorkspace() workspaceId: string,
        @Param('kind') kind: string,
        @Param('slug') slug: string,
        @Body() dto: SaveProtectionRuleDto,
        @CurrentUser() user?: PublicUser
    ): Promise<ProtectionRuleView> {
        return mapErrors(() =>
            this.rules.save(workspaceId, kind, slug, dto, toActor(user))
        );
    }

    /**
     * Removes the rule for one content type.
     *
     * `204` whether or not a row was there, and **without** checking the grant:
     * asking for a type to be unprotected succeeds when it already is, and a
     * rule stranded by a revoked grant has to stay removable.
     */
    @ApiOperation({
        summary: 'Remove a protection rule',
        description:
            'Leaves no row, which is not the same as `enabled: false` — that ' +
            'keeps the numbers the workspace had chosen. Idempotent, and it ' +
            'does not require the type to still be granted.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.PROTECTION_MANAGE)
    @HttpCode(204)
    @Delete(':kind/:slug')
    async remove(
        @CurrentWorkspace() workspaceId: string,
        @Param('kind') kind: string,
        @Param('slug') slug: string,
        @CurrentUser() user?: PublicUser
    ): Promise<void> {
        await this.rules.remove(workspaceId, kind, slug, toActor(user));
    }
}

/**
 * The signed-in administrator as the {@link EventActor} a rule write stamps on
 * its event, or `undefined` when there is nobody to name.
 */
function toActor(user?: PublicUser): EventActor | undefined {
    return user ? { id: user.id, email: user.email ?? null } : undefined;
}

/**
 * Maps the domain errors to HTTP.
 *
 * One entry so far, and the shape is kept because the review routes add more:
 * an unreachable content type is a 404 for all three of its causes.
 */
async function mapErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        if (error instanceof UnknownProtectedContentTypeError) {
            throw new NotFoundException(error.message);
        }
        throw error;
    }
}
