import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable
} from '@nestjs/common';
import {
    AccessPolicy,
    Permission,
    PERMISSIONS,
    tokenActor
} from '@orthacms/identity-server';
import type { ApiTokenRequest } from '../api-token-request';
import { ENTRY_VISIBILITY } from '../dto/public-list-entries-query.dto';

/** The default — and the only visibility a read-only token may ask for. */
const PUBLISHED = 'published';

/**
 * Gates `?status=draft|any` on **write** scope.
 *
 * Every public read defaults to published-only, which is the API's headline
 * rule. A write-scoped token needs to widen it — otherwise creating a draft
 * returns a record that is then invisible forever, and the creator cannot poll
 * its own work. Widening is safe for exactly that caller and no other: a token
 * that may read drafts is one that could have published them anyway.
 *
 * A **guard** rather than a check inside the query service, so the rule has one
 * home and applies to every route the moment it is added to the controller —
 * including ones that reach the drafts indirectly (a translations preview, a
 * relation expansion) and would otherwise each need to remember.
 *
 * `content:update` is the probe rather than `content:read`, because read is
 * exactly what both scopes hold; update is what separates them.
 */
@Injectable()
export class DraftVisibilityGuard implements CanActivate {
    constructor(private readonly policy: AccessPolicy) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<ApiTokenRequest>();
        const requested = request.query?.['status'];
        // Absent, or the default: nothing to authorize. An unrecognised value
        // is left alone deliberately — the DTO's `@IsIn` turns it into a 400,
        // and a guard that 403'd first would report the wrong problem.
        if (
            typeof requested !== 'string' ||
            requested === PUBLISHED ||
            !ENTRY_VISIBILITY.includes(requested as never)
        ) {
            return true;
        }

        const token = request.apiToken;
        const allowed =
            !!token &&
            this.policy.can(
                tokenActor(token),
                Permission.create(PERMISSIONS.CONTENT_UPDATE)
            );
        if (!allowed) {
            throw new ForbiddenException(
                `status=${requested} requires a token with write scope.`
            );
        }
        return true;
    }
}
