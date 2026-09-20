/**
 * The protection plugin's pass over the host's OpenAPI document.
 *
 * The controller is an ordinary decorated class, so the scanner already has the
 * paths, the parameters and the request body — `SaveProtectionRuleDto` carries
 * `@ApiPropertyOptional` on every field. What it cannot have is the response
 * shape: `ProtectionRuleView` is an `interface`, erased at compile time, so the
 * two reads arrive with a bare `200` and no content.
 *
 * Pure: takes the document and mutates only the paths this plugin serves.
 *
 * A local `openapi-writer` copy rather than an import from `segments` or
 * `alarms`, for the reason segments' own copy gives: it is a dozen lines, and
 * sharing it would turn one plugin's documentation helper into public API
 * another plugin's release has to keep compatible.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import {
    addErrorResponse,
    ref,
    setSuccessResponse,
    type Operation
} from './openapi-writer';
import {
    ENTRY_REVIEW_SCHEMA,
    NEW_ENTRY_PROTECTION_SCHEMA,
    PROTECTION_INSIGHTS_SCHEMA,
    PROTECTION_RULE_SCHEMA,
    REVIEWER_CANDIDATES_SCHEMA,
    REVIEW_QUEUE_SCHEMA,
    REVIEW_STATUS_MAP_SCHEMA,
    buildProtectionSchemas
} from './protection-schemas';

/**
 * The routes whose success body is one of this plugin's views.
 *
 * Keyed by what follows `/protection`. A route answering `204` is absent —
 * there is no body to describe — and gets its surprising half documented
 * separately below.
 */
const ROUTES = {
    '/rules': {
        get: {
            list: true,
            description:
                'Every rule the workspace holds, including any addressed at a content type it is no longer granted.'
        }
    },
    '/rules/{kind}/{slug}': {
        put: {
            list: false,
            description:
                'The stored rule. A replacement, not a patch: an omitted field took its default rather than its previous value.',
            notFound:
                'The workspace was not granted this content type — which is also the answer for a type that does not exist, so this tab cannot be used to enumerate the content model.'
        }
    },
    '/entries/{type}/{id}': {
        get: {
            list: false,
            schema: ENTRY_REVIEW_SCHEMA,
            description:
                'The entry’s review state: the requirement, every vote with its staleness, and the open request. Readable with `content:read` — the editor has to render “0 of 2” for a contributor, who cannot read the workspace’s rule table.',
            notFound:
                'The entry is not reachable from this workspace under this content type. One answer for all its causes — an ungranted type, a missing entry, another workspace’s entry — so one workspace cannot probe another’s ids.'
        }
    },
    '/entries/{type}/{id}/reviewers': {
        get: {
            list: false,
            schema: REVIEWER_CANDIDATES_SCHEMA,
            description:
                'Who the caller may ask to review: the workspace’s members holding `content:approve`, other than the caller. The request route accepts exactly these people.',
            notFound:
                'The entry is not reachable from this workspace under this content type.'
        }
    },
    '/types/{type}': {
        get: {
            list: false,
            schema: NEW_ENTRY_PROTECTION_SCHEMA,
            description:
                'What publishing a brand-new entry of this content type would meet for the caller — the create form’s answer, where there is no entry to read a review of.',
            notFound:
                'The workspace was not granted this content type — which is also the answer for a type that does not exist.'
        }
    },
    '/entries/{typeName}/status': {
        get: {
            list: false,
            schema: REVIEW_STATUS_MAP_SCHEMA,
            description:
                'Where each named entry stands, keyed by entry id — the batched read behind the records list’s Review column. One request per page, never one per row: the server answers it in three queries whatever the page holds.'
        }
    },
    '/queue': {
        get: {
            list: false,
            schema: REVIEW_QUEUE_SCHEMA,
            description:
                'Open review requests across every content type in the workspace, newest first. `?mine=1` narrows to the caller’s own.'
        }
    }
} as const;

/** Writes this plugin's response shapes onto `document`. */
export function describeProtectionApi(document: OpenApiDocument): void {
    const components = (document.components ??= {});
    const schemas = (components.schemas ??= {});
    Object.assign(schemas, buildProtectionSchemas());

    for (const [suffix, methods] of Object.entries(ROUTES)) {
        const path = document.paths[`/api/protection${suffix}`];
        if (!path) continue;

        for (const [method, spec] of Object.entries(methods)) {
            const operation = path[method] as Operation | undefined;
            if (!operation) continue;

            const schema =
                'schema' in spec ? spec.schema : PROTECTION_RULE_SCHEMA;
            setSuccessResponse(
                operation,
                spec.list ? { type: 'array', items: ref(schema) } : ref(schema),
                spec.description
            );
            if ('notFound' in spec && spec.notFound) {
                addErrorResponse(operation, '404', spec.notFound);
            }
        }
    }

    // The Insights card's aggregate is mounted under `insights/` rather than
    // `protection/`, because that is where the dashboard's other aggregates
    // live — so it cannot ride the suffix-keyed table above and is written
    // here instead. The plugin still owns the route and the numbers.
    const insights = (
        document.paths['/api/insights/protection/reviews'] as
            | Record<string, Operation>
            | undefined
    )?.get;
    if (insights) {
        setSuccessResponse(
            insights,
            ref(PROTECTION_INSIGHTS_SCHEMA),
            'Open review requests in this workspace, and how many have waited longer than the reported threshold. No time window: a request waiting a fortnight is waiting whether it was asked this morning or last spring.'
        );
    }

    // The `204`s get no body — the writer would refuse one anyway — but each has
    // a surprising half worth stating, and a bare "204" in the reference states
    // none of it.
    describeNoContent(
        document,
        '/api/protection/rules/{kind}/{slug}',
        'delete',
        'The type is unprotected. Answered whether or not a rule was there, and without requiring the type to still be granted.'
    );
    describeNoContent(
        document,
        '/api/protection/entries/{type}/{id}/request',
        'delete',
        'The request is withdrawn. The row is resolved rather than deleted, so the trail keeps that it was asked for. Only the requester or a holder of `protection:manage` may do this.'
    );
    describeNoContent(
        document,
        '/api/protection/entries/{type}/{id}/approve',
        'delete',
        'Your approval of the current revision is gone. Idempotent, and it reaches no further back: an approval of an earlier version is already not counting, and removing it would erase the struck-through line that explains why the number moved.'
    );

    // The one refusal a client has to branch on: it is a 409, not a 403,
    // because the caller does hold `content:approve` — what refuses them is the
    // state of this entry.
    const request = (
        document.paths['/api/protection/entries/{type}/{id}/request'] as
            | Record<string, Operation>
            | undefined
    )?.post;
    if (request) {
        addErrorResponse(
            request,
            '422',
            '`protection.reviewer_not_eligible` — a requested reviewer is not another member of this workspace who can approve content.'
        );
    }

    for (const suffix of ['/entries/{type}/{id}/approve']) {
        const operation = (
            document.paths[`/api/protection${suffix}`] as
                | Record<string, Operation>
                | undefined
        )?.post;
        if (operation) {
            addErrorResponse(
                operation,
                '409',
                '`protection.self_approval_refused` — you wrote the current revision and the rule requires somebody else. Administrators included: that is the review the rule exists to force.'
            );
        }
    }
}

/**
 * Documents a `204` answer's meaning, which the scanner leaves blank.
 *
 * It **fills** an empty description rather than adding a missing response, and
 * that difference is the whole point: `addErrorResponse` returns early when the
 * code already exists, and the scanner always emits `'204': { description: '' }`
 * for a `@HttpCode(204)` route. Every 204 description this pass wrote before
 * this therefore went nowhere — the reference showed a bare "204" with no text —
 * and nothing failed, because the spec only asserted the response existed.
 *
 * A description the scanner has already filled is left alone: a decorator on the
 * route is a more local statement than this pass's table.
 */
function describeNoContent(
    document: OpenApiDocument,
    path: string,
    method: 'delete',
    description: string
): void {
    const operation = (
        document.paths[path] as Record<string, Operation> | undefined
    )?.[method];
    if (!operation) return;
    const responses = (operation.responses ??= {});
    const existing = responses['204'];
    if (!existing) {
        responses['204'] = { description };
        return;
    }
    if (!existing['description']) existing['description'] = description;
}
