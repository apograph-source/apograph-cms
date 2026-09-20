import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { CurrentWorkspace, WorkspaceGuard } from '@orthacms/workspaces-server';
import {
    FindingsByEntryQueryDto,
    ListFindingsQueryDto
} from '../../application/dto/list-findings-query.dto';
import { AlarmFindingStore } from '../../infrastructure/alarm-finding.store';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../alarms.constants';
import type {
    AlarmFindingListView,
    AlarmFindingsByEntryView
} from '../../types/alarm-views';
import type { AlarmSeverity } from '../../domain/alarm-severity';

/** Counts behind the workspace's alarms badge and home panel. */
export interface AlarmSummaryView {
    /** Open findings per severity. */
    open: Record<AlarmSeverity, number>;
    /** Total open findings, at any severity. */
    openTotal: number;
}

/**
 * The finding surface: `/api/alarms/findings`.
 *
 * Everything here is workspace-scoped and gated on `alarms:read`. It is
 * read-only: an alarm is changed by editing or disabling the alarm, never by
 * silencing one of its findings.
 */
@ApiTags('alarms')
@UseGuards(PermissionsGuard, WorkspaceGuard)
@Controller('alarms/findings')
export class AlarmFindingsController {
    constructor(private readonly findings: AlarmFindingStore) {}

    /**
     * Live findings for a batch of entries, keyed by entry id.
     *
     * Declared **before** the paged list so the literal `by-entry` segment is
     * never eaten by a wildcard, and existing as a batch at all because its
     * callers are the records table and the entry editor — one request per page
     * of rows, never one per row.
     */
    @ApiOperation({
        summary: 'Findings for specific entries',
        description:
            'Live (non-resolved) findings for up to one records page of ' +
            'entries, keyed by entry id.'
    })
    @RequirePermissions(PERMISSIONS.ALARMS_READ)
    @Get('by-entry')
    async byEntry(
        @CurrentWorkspace() workspaceId: string,
        @Query() query: FindingsByEntryQueryDto
    ): Promise<AlarmFindingsByEntryView> {
        const byEntry = await this.findings.byEntryIds(
            workspaceId,
            query.entryIds ?? []
        );
        return { byEntry };
    }

    /** Open counts, for the sidebar badge and the home panel. */
    @ApiOperation({
        summary: 'Alarm counts',
        description:
            'Open findings per severity — the numbers the nav badge and the ' +
            'dashboard panel render.'
    })
    @RequirePermissions(PERMISSIONS.ALARMS_READ)
    @Get('summary')
    async summary(
        @CurrentWorkspace() workspaceId: string
    ): Promise<AlarmSummaryView> {
        const open = await this.findings.openCountsBySeverity(workspaceId);
        const openTotal = Object.values(open).reduce(
            (sum, count) => sum + count,
            0
        );
        return { open, openTotal };
    }

    /** One page of the workspace's findings. */
    @ApiOperation({
        summary: 'List findings',
        description:
            'Findings in the open workspace, newest activity first. Without ' +
            'an explicit `state`, resolved findings are excluded.'
    })
    @RequirePermissions(PERMISSIONS.ALARMS_READ)
    @Get()
    list(
        @CurrentWorkspace() workspaceId: string,
        @Query() query: ListFindingsQueryDto
    ): Promise<AlarmFindingListView> {
        return this.findings.list(workspaceId, {
            state: query.state,
            ruleId: query.ruleId,
            severity: query.severity,
            page: Math.max(1, query.page ?? 1),
            // The DTO already bounds `pageSize`; this is the defence-in-depth
            // clamp, so a future caller that bypasses the pipe still cannot ask
            // for an unbounded page.
            pageSize: Math.min(
                MAX_PAGE_SIZE,
                Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE)
            )
        });
    }
}
