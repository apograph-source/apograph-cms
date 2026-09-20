import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
    PERMISSIONS,
    PermissionsGuard,
    RequirePermissions
} from '@orthacms/identity-server';
import { SlugAvailabilityQuery } from '../../infrastructure/queries/slug-availability.query';
import { CheckSlugDto } from '../../application/dto/check-slug.dto';

/**
 * `GET /api/workspaces/slug-available?slug=` — reports whether a slug is free,
 * backing the create wizard's live availability check.
 *
 * Gated on `workspaces:create` to match the only thing the answer is good for.
 * Authentication alone was not enough: the probe answers "does this slug exist"
 * for any caller, which lets any signed-in account enumerate workspace slugs it
 * has no part in — a directory of the tenancy, one guess at a time.
 */
@UseGuards(PermissionsGuard)
@RequirePermissions(PERMISSIONS.WORKSPACES_CREATE)
@Controller('workspaces')
export class CheckSlugController {
    constructor(private readonly slugs: SlugAvailabilityQuery) {}

    @Get('slug-available')
    async check(@Query() query: CheckSlugDto): Promise<{ available: boolean }> {
        return { available: await this.slugs.isAvailable(query.slug) };
    }
}
