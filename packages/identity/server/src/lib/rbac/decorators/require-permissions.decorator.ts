import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../system-roles';

/** Metadata key under which {@link RequirePermissions} stores its keys. */
export const PERMISSIONS_KEY = 'ortha:required-permissions';

/**
 * Marks a route (or controller) as requiring every listed permission. The
 * app-wide `AuthGuard` authenticates; `PermissionsGuard` reads this metadata and
 * checks the current user's role grants. With no decorator, no permission is
 * required (authentication still is).
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
    SetMetadata(PERMISSIONS_KEY, permissions);

/** Metadata key under which {@link RequireAnyPermission} stores its keys. */
export const ANY_PERMISSION_KEY = 'ortha:any-permission';

/**
 * Marks a route as requiring **at least one** of the listed permissions, where
 * {@link RequirePermissions} requires all of them.
 *
 * For a route that genuinely serves two audiences: the content-type catalogue
 * is read both by the create wizard (`workspaces:create`) and by the settings
 * content tab (`workspaces:update`), so demanding either alone would 403 a role
 * that legitimately holds only the other. Reach for this only when that is
 * really the case — an all-of requirement is the safer default, and two
 * genuinely different operations usually want two routes.
 *
 * Combines with `@RequirePermissions`: every all-of permission must be held
 * **and** at least one any-of permission.
 */
export const RequireAnyPermission = (...permissions: PermissionKey[]) =>
    SetMetadata(ANY_PERMISSION_KEY, permissions);
