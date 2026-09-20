import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { ActivityService } from '../services/activity.service';
import { ListActivityQueryDto } from '../dto/list-activity-query.dto';
import type { ActivityListView } from '../types/activity-view';

/**
 * `GET /api/activity` — the global audit log. Read-only; gated on
 * `activity:read` (admin-only by the v1 role matrix). All filtering,
 * pagination, and sorting is delegated to {@link ActivityService.list}.
 */
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.ACTIVITY_READ)
@Controller('activity')
export class ListActivityController {
    constructor(private readonly activity: ActivityService) {}

    @Get()
    list(@Query() query: ListActivityQueryDto): Promise<ActivityListView> {
        return this.activity.list(query);
    }
}
