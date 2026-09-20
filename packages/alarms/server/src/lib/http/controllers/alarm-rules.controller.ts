import {
    BadRequestException,
    Body,
    ConflictException,
    Controller,
    Delete,
    Get,
    HttpCode,
    NotFoundException,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    UseGuards
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { EventActor } from '@orthacms/database';
import {
    CurrentUser,
    OriginGuard,
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions,
    type PublicUser
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import { FilterException } from '@orthacms/utils-server';
import { AlarmRulesService } from '../../application/alarm-rules.service';
import {
    CreateAlarmRuleDto,
    PreviewAlarmRuleDto,
    UpdateAlarmRuleDto
} from '../../application/dto/save-alarm-rule.dto';
import {
    AlarmRuleNotFoundError,
    UnknownAlarmContentTypeError
} from '../../domain/errors';
import { DuplicateAlarmRuleNameError } from '../../infrastructure/alarm-rule.repository';
import type {
    AlarmRulePreviewView,
    AlarmRuleView,
    AlarmScanResultView
} from '../../types/alarm-views';

/**
 * The rule surface: `/api/alarms/rules`.
 *
 * Reads are gated on `alarms:read`, every write on `alarms:manage` — the split
 * that keeps "who may see a finding" separate from "who decides what the
 * workspace considers wrong". Both sit behind `WorkspaceGuard`, so a rule
 * belongs to a workspace the caller is a member of and nothing else is
 * reachable. `OriginGuard` is applied per write route rather than to the
 * class, matching content's controllers: these routes are cookie-authenticated
 * and therefore CSRF-able, the reads are not state-changing.
 */
@ApiTags('alarms')
@UseGuards(PermissionsGuard, WorkspaceGuard)
@Controller('alarms/rules')
export class AlarmRulesController {
    constructor(private readonly rules: AlarmRulesService) {}

    /** Every rule in the open workspace, with its live finding counts. */
    @ApiOperation({
        summary: 'List alarm rules',
        description:
            'Every rule the workspace has, with how many findings each ' +
            'currently has open.'
    })
    @RequirePermissions(PERMISSIONS.ALARMS_READ)
    @Get()
    list(@CurrentWorkspace() workspaceId: string): Promise<AlarmRuleView[]> {
        return this.rules.list(workspaceId);
    }

    /** Creates a rule and scans the collection with it straight away. */
    @ApiOperation({
        summary: 'Create an alarm rule',
        description:
            'Validates the filter against the content type, stores the rule, ' +
            'and runs a full scan so the rule reports on the content that ' +
            'already exists rather than only on what is edited afterwards.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.ALARMS_MANAGE)
    @Post()
    async create(
        @CurrentWorkspace() workspaceId: string,
        @CurrentUser() user: PublicUser | undefined,
        @Body() dto: CreateAlarmRuleDto
    ): Promise<{ rule: AlarmRuleView; scan: AlarmScanResultView }> {
        return mapErrors(() =>
            this.rules.create(workspaceId, user?.id ?? null, dto, toActor(user))
        );
    }

    /**
     * How many entries a candidate filter matches right now — the rule
     * editor's readout, run before anything is stored.
     */
    @ApiOperation({
        summary: 'Preview an alarm rule',
        description:
            'Runs a candidate filter without saving it and reports how many ' +
            'entries it matches out of how many the workspace holds.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.ALARMS_MANAGE)
    @HttpCode(200)
    @Post('preview')
    preview(
        @CurrentWorkspace() workspaceId: string,
        @Body() dto: PreviewAlarmRuleDto
    ): Promise<AlarmRulePreviewView> {
        return mapErrors(() => this.rules.preview(workspaceId, dto));
    }

    /** Partial update. A changed filter is re-validated and rescanned. */
    @ApiOperation({
        summary: 'Update an alarm rule',
        description:
            'Absent keys are left alone. Changing the filter triggers a full ' +
            'rescan before the response, so the findings never describe the ' +
            'previous condition.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.ALARMS_MANAGE)
    @Patch(':id')
    update(
        @CurrentWorkspace() workspaceId: string,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateAlarmRuleDto,
        @CurrentUser() user?: PublicUser
    ): Promise<AlarmRuleView> {
        return mapErrors(() =>
            this.rules.update(workspaceId, id, dto, toActor(user))
        );
    }

    /** Deletes a rule; its findings cascade away with it. */
    @ApiOperation({
        summary: 'Delete an alarm rule',
        description:
            'Removes the rule and every finding it produced — with the rule ' +
            'gone there is nothing left to interpret them by.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.ALARMS_MANAGE)
    @HttpCode(204)
    @Delete(':id')
    remove(
        @CurrentWorkspace() workspaceId: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user?: PublicUser
    ): Promise<void> {
        return mapErrors(() =>
            this.rules.remove(workspaceId, id, toActor(user))
        );
    }

    /** Re-runs one rule over its whole collection. */
    @ApiOperation({
        summary: 'Rescan an alarm rule',
        description:
            'Runs the rule across the collection now. This is the manual ' +
            'recovery path when an event was missed or a rule was edited ' +
            'outside the UI.'
    })
    @UseGuards(OriginGuard)
    @RequirePermissions(PERMISSIONS.ALARMS_MANAGE)
    @HttpCode(200)
    @Post(':id/rescan')
    rescan(
        @CurrentWorkspace() workspaceId: string,
        @Param('id', ParseUUIDPipe) id: string,
        @CurrentUser() user?: PublicUser
    ): Promise<AlarmScanResultView> {
        return mapErrors(() =>
            this.rules.rescan(workspaceId, id, toActor(user))
        );
    }
}

/**
 * Maps the domain and filter-engine errors to HTTP.
 *
 * A `FilterException` becomes a 400 carrying the engine's own message: the
 * caller is the rule editor, and "unknown field author.statuss" is the whole
 * answer. `UnknownAlarmContentTypeError` is a 404 for both of its causes, so
 * the editor cannot be used to find out which content types exist outside the
 * workspace's grants.
 */
async function mapErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        if (error instanceof FilterException) {
            throw new BadRequestException(error.message);
        }
        if (error instanceof UnknownAlarmContentTypeError) {
            throw new NotFoundException(error.message);
        }
        if (error instanceof AlarmRuleNotFoundError) {
            throw new NotFoundException(error.message);
        }
        if (error instanceof DuplicateAlarmRuleNameError) {
            throw new ConflictException(error.message);
        }
        throw error;
    }
}

/**
 * The signed-in administrator as the {@link EventActor} an alarm-rule write
 * stamps onto its domain event, or `undefined` when there is nobody to name.
 */
function toActor(user?: PublicUser): EventActor | undefined {
    return user ? { id: user.id, email: user.email ?? null } : undefined;
}
