import { BadRequestException } from '@nestjs/common';
import {
    PublicSaveEntryDto,
    toTokenActor,
    type EntryLocator,
    type RelationDelta
} from '@orthacms/content-server';
import { PERMISSIONS } from '@orthacms/identity-server';
import { validateSync } from 'class-validator';
import type { GraphQLFieldResolver } from 'graphql';
import type { GraphqlContext } from './context';
import { resolveType } from './entry-resolvers';

/**
 * The write resolvers — one per REST write route, each delegating to
 * `PublicEntryWritesService`.
 *
 * Nothing about *what a write means* lives here. Value validation, relation
 * deltas, media-target checks, revision numbering under a per-entry advisory
 * lock, the outbox, and i18n's sibling sync are all downstream, in the pipeline
 * the admin and the REST API already go through. A second implementation of any
 * of it is how you get duplicate version numbers and translations that drift.
 *
 * The token is stamped as the write's **actor**, the same as on the REST
 * routes: one `toTokenActor` for both protocols, so a GraphQL mutation and the
 * `POST` it mirrors produce audit rows naming the same credential rather than
 * one of them reading "System".
 *
 * Two things *are* this layer's job:
 *
 * - **Permission.** One endpoint serves reads and writes, so a route-level
 *   `@RequirePermissions(...)` cannot decide for it. Each resolver asserts its
 *   own permission against the token's scope — the same `AccessPolicy`
 *   decision the REST route's metadata provokes, moved to where it can see
 *   which operation was actually asked for.
 * - **Shape.** GraphQL arguments become a `PublicSaveEntryDto`, which is then
 *   run through `class-validator` here. The REST body gets that from the host's
 *   global `ValidationPipe`; a GraphQL argument never passes through it, so
 *   skipping this would quietly drop the delta caps (`MAX_DELTA_FIELDS`,
 *   `MAX_DELTA_IDS`) that bound a single write.
 */

/** `createArticle(input: …)` — create a draft. */
export function createResolver(
    typeName: string
): GraphQLFieldResolver<unknown, GraphqlContext> {
    return async (_source, args, context) => {
        context.assert(PERMISSIONS.CONTENT_CREATE);
        const { type, granted } = await resolveType(context, typeName);
        const body = saveDtoFrom(args);
        if (typeof args['locale'] === 'string') {
            body.locale = args['locale'];
        }
        if (typeof args['localeGroupId'] === 'string') {
            body.localeGroupId = args['localeGroupId'];
        }
        assertValid(body);
        return context.writes.create(
            type,
            body,
            context.workspaceId,
            granted,
            toTokenActor(context.token)
        );
    };
}

/** `updateArticle(id: …, input: …)` — a **partial** update. */
export function updateResolver(
    typeName: string
): GraphQLFieldResolver<unknown, GraphqlContext> {
    return async (_source, args, context) => {
        context.assert(PERMISSIONS.CONTENT_UPDATE);
        const { type, granted } = await resolveType(context, typeName);
        const body = saveDtoFrom(args);
        assertValid(body);
        return context.writes.update(
            type,
            locatorFrom(args),
            body,
            context.workspaceId,
            granted,
            addressingLocale(args),
            toTokenActor(context.token)
        );
    };
}

/** `publishArticle(id: …)` / `unpublishArticle(id: …)`. */
export function publishResolver(
    typeName: string,
    live: boolean
): GraphQLFieldResolver<unknown, GraphqlContext> {
    return async (_source, args, context) => {
        context.assert(PERMISSIONS.CONTENT_PUBLISH);
        const { type, granted } = await resolveType(context, typeName);
        const locator = locatorFrom(args);
        const locale = addressingLocale(args);
        const actor = toTokenActor(context.token);
        return live
            ? context.writes.publish(
                  type,
                  locator,
                  context.workspaceId,
                  granted,
                  locale,
                  actor
              )
            : context.writes.unpublish(
                  type,
                  locator,
                  context.workspaceId,
                  granted,
                  locale,
                  actor
              );
    };
}

/**
 * `deleteArticle(id: …)` — soft delete on a `paranoid` type, hard delete
 * otherwise.
 *
 * Returns `true` rather than the removed entry, because REST answers `204`.
 * Inventing a payload would be the two protocols disagreeing about what a
 * delete *is*, and the entry is gone either way.
 */
export function deleteResolver(
    typeName: string
): GraphQLFieldResolver<unknown, GraphqlContext> {
    return async (_source, args, context) => {
        context.assert(PERMISSIONS.CONTENT_DELETE);
        const { type } = await resolveType(context, typeName);
        await context.writes.remove(
            type,
            locatorFrom(args),
            context.workspaceId,
            addressingLocale(args),
            toTokenActor(context.token)
        );
        return true;
    };
}

/**
 * Assembles the write body from the mutation's arguments.
 *
 * **The `values` bag is copied by key presence and nothing else.** That is the
 * whole contract of the REST `PATCH`: a key you send is applied, a key you omit
 * is left alone, and an explicit `null` clears the field. graphql-js preserves
 * exactly that distinction — an input-object field the caller did not mention is
 * absent from the coerced object, not present as `undefined` — which is why the
 * generated input types must never declare a default value. A default would
 * materialise the key and turn every omitted field into an overwrite.
 */
function saveDtoFrom(args: Record<string, unknown>): PublicSaveEntryDto {
    const body = new PublicSaveEntryDto();
    const input = args['input'];
    body.values =
        input && typeof input === 'object'
            ? { ...(input as Record<string, unknown>) }
            : {};
    const relations = args['relations'];
    if (relations && typeof relations === 'object') {
        body.relations = relations as Record<string, RelationDelta>;
    }
    return body;
}

/**
 * Runs the DTO's own validators — the ones the host's `ValidationPipe` applies
 * to the REST body and that a GraphQL argument never meets. A failure is a 400
 * naming the offending property, matching what the REST route returns for the
 * same body.
 */
function assertValid(body: PublicSaveEntryDto): void {
    const errors = validateSync(body, {
        whitelist: true,
        forbidNonWhitelisted: true
    });
    if (errors.length > 0) {
        throw new BadRequestException(
            errors.flatMap((error) =>
                Object.values(error.constraints ?? { error: error.toString() })
            )
        );
    }
}

/**
 * The row a write targets: an entry id, or a translation group plus the locale
 * that picks the row out of it.
 */
function locatorFrom(args: Record<string, unknown>): EntryLocator {
    const id = args['id'];
    const localeGroupId = args['localeGroupId'];
    if (typeof id === 'string' && typeof localeGroupId === 'string') {
        throw new BadRequestException(
            'Pass either `id` or `localeGroupId`, not both.'
        );
    }
    if (typeof id === 'string') {
        return { id };
    }
    if (typeof localeGroupId === 'string') {
        return { localeGroupId };
    }
    throw new BadRequestException(
        'Pass `id`, or `localeGroupId` with an optional `locale`.'
    );
}

/**
 * The **addressing** locale — which row of a translation group a write targets.
 *
 * Only meaningful with a group locator, and deliberately separate from the
 * create-only `locale` that stamps a new row: conflating the two is how a
 * German update ends up rewriting the English article, which is a bug the REST
 * side already had and fixed. An id locator names one row outright, so the
 * locale is dropped rather than AND-ed onto it.
 */
function addressingLocale(args: Record<string, unknown>): string | undefined {
    if (typeof args['id'] === 'string') {
        return undefined;
    }
    return typeof args['locale'] === 'string' ? args['locale'] : undefined;
}
