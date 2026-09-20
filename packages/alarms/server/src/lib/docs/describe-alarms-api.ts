/**
 * The alarms plugin's pass over the host's OpenAPI document.
 *
 * The controllers are ordinary decorated classes, so the scanner already has
 * the paths, the parameters and the request bodies. What it cannot have is the
 * response shapes — they are `interface`s, erased at compile time — so every
 * operation arrives with a bare 2xx and no content. This pass fills those in,
 * plus the failures a caller has to handle, and touches nothing else.
 *
 * Pure: it takes the document and mutates only this plugin's paths.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import { buildAlarmSchemas, ref, type OpenApiSchema } from './alarm-schemas';

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** What one operation answers with, and which failures it can produce. */
interface OperationSpec {
    /** The component schema the success response carries. */
    schema: string;
    /** Whether the response is a list of that component rather than one of it. */
    list?: boolean;
    /** The success response's description. */
    description: string;
    /**
     * The operation parses a filter tree, so a malformed one — an unknown
     * field, an operator the field's type does not accept — is a **400**
     * carrying the engine's own message. The caller is the rule editor, and
     * "unknown field author.statuss" is the whole answer.
     */
    parsesFilter?: boolean;
    /** The operation resolves a rule id, so an unknown one is a 404. */
    resolvesRule?: boolean;
    /** The operation writes a name, which is unique per workspace. */
    namesRule?: boolean;
}

/** The alarms routes, keyed by what follows `/alarms`. */
const ROUTES: Record<string, Record<string, OperationSpec>> = {
    '/rules': {
        get: {
            schema: 'AlarmRule',
            list: true,
            description: 'Every rule in the workspace, with its open counts.'
        },
        post: {
            schema: 'AlarmRuleCreated',
            description: 'The stored rule and the scan run on creation.',
            parsesFilter: true,
            namesRule: true
        }
    },
    '/rules/preview': {
        post: {
            schema: 'AlarmRulePreview',
            description: 'What the candidate filter matches right now.',
            parsesFilter: true
        }
    },
    '/rules/{id}': {
        patch: {
            schema: 'AlarmRule',
            description:
                'The rule as it now stands. A changed filter is re-validated and rescanned before this answers, so the findings never describe the previous condition.',
            parsesFilter: true,
            resolvesRule: true,
            namesRule: true
        }
    },
    '/rules/{id}/rescan': {
        post: {
            schema: 'AlarmScanResult',
            description: 'What the rescan found.',
            resolvesRule: true
        }
    },
    '/findings': {
        get: {
            schema: 'AlarmFindingPage',
            description:
                'One page of findings, newest activity first. Without an explicit `state`, resolved findings are excluded.'
        }
    },
    '/findings/by-entry': {
        get: {
            schema: 'AlarmFindingsByEntry',
            description:
                'Open findings for the requested entries, keyed by entry id.'
        }
    },
    '/findings/summary': {
        get: {
            schema: 'AlarmSummary',
            description: 'Open findings per severity, and the total.'
        }
    }
};

/**
 * Matches `<prefix>/alarms<rest>`.
 *
 * The prefix is matched as segments containing no `{`, so a nested route that
 * merely ends in the same segment — `/api/workspaces/{id}/alarms` — is not
 * silently described with these shapes. A global prefix never holds a path
 * parameter; a nested resource route almost always does.
 */
const ALARMS_ROUTE_RE = /^(?:\/[^/{}]+)*\/alarms(\/.*)?$/;

/**
 * Writes a success response's schema onto whichever 2xx key the scanner already
 * emitted — Nest's default is 201 for `@Post`, 200 elsewhere, and the two
 * `@HttpCode(200)` posts here move it — so this never invents a status code the
 * API does not return. A `204` keeps its empty body: the delete route has none.
 */
function setSuccessResponse(
    operation: Operation,
    schema: OpenApiSchema,
    description: string
): void {
    const responses = operation.responses ?? {};
    const key = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
    if (!key || key === '204') {
        return;
    }
    responses[key] = {
        description,
        content: { 'application/json': { schema } }
    };
    operation.responses = responses;
}

/** Adds a documented failure response, leaving any existing one alone. */
function addErrorResponse(
    operation: Operation,
    code: string,
    description: string
): void {
    const responses = operation.responses ?? {};
    if (responses[code]) {
        return;
    }
    responses[code] = { description };
    operation.responses = responses;
}

/** Adds this plugin's schemas and describes its own operations' responses. */
export function describeAlarmsApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, buildAlarmSchemas());

    for (const [route, item] of Object.entries(document.paths)) {
        const match = ALARMS_ROUTE_RE.exec(route);
        if (!match) {
            continue;
        }
        const byMethod = ROUTES[match[1] ?? ''];
        if (!byMethod) {
            continue;
        }

        for (const [method, operation] of Object.entries(
            item as Record<string, Operation>
        )) {
            const spec = byMethod[method];
            if (!spec || !operation || typeof operation !== 'object') {
                continue;
            }
            setSuccessResponse(
                operation,
                spec.list
                    ? { type: 'array', items: ref(spec.schema) }
                    : ref(spec.schema),
                spec.description
            );
            if (spec.parsesFilter) {
                addErrorResponse(
                    operation,
                    '400',
                    'The filter tree does not parse against the content type — an unknown field, or an operator that field’s type does not accept. The message names it.'
                );
                addErrorResponse(
                    operation,
                    '404',
                    'Unknown content type, or one this workspace was not granted — the two are deliberately indistinguishable.'
                );
            }
            if (spec.resolvesRule) {
                addErrorResponse(
                    operation,
                    '404',
                    'No rule with this id in the open workspace.'
                );
            }
            if (spec.namesRule) {
                addErrorResponse(
                    operation,
                    '409',
                    'Another rule in this workspace already has that name.'
                );
            }
        }
    }
}
