import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import type { ToolContext } from '@orthacms/tools-server';
import { PERMISSIONS } from '@orthacms/identity-server';
import type { EntryLocator } from '../public-api/infrastructure/public-entries.query';
import { ENTRY_VISIBILITY } from '../public-api/http/dto/public-list-entries-query.dto';

/**
 * Keys that address *which* record a tool acts on rather than *how*. Stripped
 * before DTO validation, because they are the tool's own parameters and the
 * query DTOs — which describe an HTTP query string — know nothing about them.
 */
const LOCATOR_KEYS = ['typeName', 'id', 'localeGroupId', 'field'] as const;

/**
 * Validate a tool's arguments through the **same DTO class the HTTP route
 * uses**.
 *
 * The alternative — hand-checking each tool's arguments — would fork the
 * accepted contract the first time a bound moved: `pageSize` would cap at 100
 * on `GET /v1/content/:typeName` and at whatever this file said on
 * `content_list`. Running the real DTO means a rule is written once, in the
 * place that documents it, and both callers get it.
 *
 * The options mirror the host's global `ValidationPipe` exactly
 * (`whitelist` + `forbidNonWhitelisted` + `transform`), so an unknown argument
 * is an error rather than being silently ignored. That matters more for a model
 * than for a developer: a typo'd argument that is quietly dropped produces a
 * plausible-looking wrong answer, which is the failure mode hardest to notice.
 */
export async function validateToolInput<T extends object>(
    dto: ClassConstructor<T>,
    raw: Record<string, unknown>
): Promise<T> {
    const instance = plainToInstance(dto, withoutLocatorKeys(raw), {
        enableImplicitConversion: false
    });
    const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true
    });
    if (errors.length > 0) {
        throw new BadRequestException({
            message: 'Invalid arguments.',
            issues: errors.map((error) => ({
                field: error.property,
                problems: Object.values(error.constraints ?? {})
            }))
        });
    }
    return instance;
}

/** The argument bag minus the addressing keys. */
function withoutLocatorKeys(
    raw: Record<string, unknown>
): Record<string, unknown> {
    const rest: Record<string, unknown> = { ...raw };
    for (const key of LOCATOR_KEYS) {
        delete rest[key];
    }
    return rest;
}

/** The required `typeName` argument. */
export function requireTypeName(raw: Record<string, unknown>): string {
    const typeName = raw['typeName'];
    if (typeof typeName !== 'string' || typeName.length === 0) {
        throw new BadRequestException(
            '`typeName` is required. Call `content_types_list` to see the readable types.'
        );
    }
    return typeName;
}

/**
 * The entry locator: **exactly one** of `id` or `localeGroupId`.
 *
 * Both spellings exist for the same reason they do on the HTTP routes — a
 * localized front-end holds one stable group id per story rather than one id
 * per language — and requiring exactly one keeps a call from silently
 * preferring whichever the implementation happened to check first.
 */
export function requireLocator(raw: Record<string, unknown>): EntryLocator {
    const id = raw['id'];
    const localeGroupId = raw['localeGroupId'];
    const hasId = typeof id === 'string' && id.length > 0;
    const hasGroup =
        typeof localeGroupId === 'string' && localeGroupId.length > 0;

    if (hasId && hasGroup) {
        throw new BadRequestException(
            'Pass either `id` or `localeGroupId`, not both — they are two ways of naming the same row.'
        );
    }
    if (hasId) {
        return { id: id as string };
    }
    if (hasGroup) {
        return { localeGroupId: localeGroupId as string };
    }
    throw new BadRequestException(
        'Pass either `id` (one entry) or `localeGroupId` (the entry’s translation group, with `locale`).'
    );
}

/**
 * Enforce the draft-visibility rule for a tool call — the job
 * `DraftVisibilityGuard` does for the HTTP routes.
 *
 * Restated here rather than reused because a guard gates a *route*, and every
 * tool arrives through one route. The rule is identical and deliberately so:
 * a read defaults to published-only, and only a caller that could have
 * published the row may widen it. `content:update` is the probe rather than
 * `content:read`, because read is exactly what both scopes hold.
 */
export function assertDraftVisibility(
    raw: Record<string, unknown>,
    context: ToolContext
): void {
    const requested = raw['status'];
    if (
        typeof requested !== 'string' ||
        requested === 'published' ||
        !ENTRY_VISIBILITY.includes(requested as never)
    ) {
        // Absent, the default, or unrecognised. The last is left alone on
        // purpose: the DTO's `@IsIn` turns it into a clear 400, and refusing
        // it here first would report the wrong problem.
        return;
    }
    if (!context.can(PERMISSIONS.CONTENT_UPDATE)) {
        throw new ForbiddenException(
            `status=${requested} requires a token with write scope; this one may only read published content.`
        );
    }
}
