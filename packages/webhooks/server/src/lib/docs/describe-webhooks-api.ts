/**
 * The webhooks plugin's pass over the host's OpenAPI document.
 *
 * The routes here are ordinary decorated controllers, so `@nestjs/swagger`
 * already knows their paths, parameters and request bodies. What it cannot
 * know is what comes **back**: every response view is a TypeScript
 * `interface`, erased before the scanner runs, which is why each operation
 * arrives carrying a bare `200`/`201` with no content. This pass writes the
 * response schemas onto the operations the plugin owns and nothing else.
 *
 * Pure: it takes the document and mutates only its own paths.
 */

import type { OpenApiDocument } from '@orthacms/bootstrap-server';
import {
    buildWebhookSchemas,
    ref,
    type OpenApiSchema
} from './webhook-schemas';

/** An operation object, as far as this pass needs to see one. */
interface Operation {
    responses?: Record<string, { description?: string; content?: unknown }>;
}

/** What one operation answers with, and how to describe it. */
interface OperationSpec {
    /** The component schema the success response carries. */
    schema: string;
    /** Whether the schema is a list of that component rather than one of it. */
    list?: boolean;
    /** The success response's description. */
    description: string;
    /**
     * The operation writes a URL or a header set, so the URL policy can refuse
     * it — a **422**, not a 400: the request was well-formed and the value was
     * refused, and the message is written to be shown in the form that produced
     * it.
     */
    validatesUrl?: boolean;
}

/** The endpoint routes, keyed by what follows `/webhooks`. */
const ENDPOINT_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '': {
        get: {
            schema: 'WebhookEndpoint',
            list: true,
            description: 'Every endpoint, newest first. No signing secrets.'
        },
        post: {
            schema: 'WebhookEndpointWithSecret',
            description:
                'The created endpoint and its signing secret — the secret’s only appearance.',
            validatesUrl: true
        }
    },
    '/{id}': {
        get: { schema: 'WebhookEndpoint', description: 'The endpoint.' },
        patch: {
            schema: 'WebhookEndpoint',
            description: 'The endpoint as it now stands.',
            validatesUrl: true
        }
    },
    '/{id}/secret': {
        post: {
            schema: 'WebhookEndpointWithSecret',
            description:
                'The endpoint and the new signing secret, returned once. The previous secret stops verifying immediately, including for deliveries already queued.'
        }
    },
    '/{id}/test': {
        post: {
            schema: 'WebhookTestResult',
            description: 'What the receiver answered.'
        }
    },
    '/{id}/deliveries': {
        get: {
            schema: 'WebhookDeliveryPage',
            description:
                'One page of the endpoint’s delivery log, newest first.'
        }
    },
    '/{id}/deliveries/{deliveryId}': {
        get: {
            schema: 'WebhookDeliveryDetail',
            description: 'The delivery, with its frozen body and the response.'
        }
    },
    // Declared as the detail shape, and that is not a copy-paste of the route
    // above: `redeliver` is *typed* `WebhookDeliveryView` but returns
    // `findDetail(...)`, so the queued row comes back with `payload` and
    // `responseSnippet` (null, since nothing has been sent yet) on it. The
    // document describes what the route answers with.
    '/{id}/deliveries/{deliveryId}/redeliver': {
        post: {
            schema: 'WebhookDeliveryDetail',
            description:
                'The newly queued delivery. It carries a new delivery `id` and the original `eventId`, so a receiver that deduplicates still recognises the repeat.'
        }
    }
};

/** The event catalogue, keyed by what follows `/webhook-events`. */
const EVENT_ROUTES: Record<string, Record<string, OperationSpec>> = {
    '': {
        get: {
            schema: 'WebhookEventDescriptor',
            list: true,
            description: 'Every kind an endpoint may subscribe to.'
        }
    }
};

/**
 * Matches `<prefix>/webhooks<rest>` and `<prefix>/webhook-events<rest>`.
 *
 * The prefix is whatever the host configured (`/api` here), so it is matched
 * rather than assumed — but it is matched as segments **containing no `{`**,
 * which is what keeps a hypothetical `/api/workspaces/{id}/webhooks` from being
 * described with the global endpoint's shapes. A global prefix never holds a
 * path parameter; a nested resource route almost always does. The content
 * plugin learned this the expensive way, where a laxer pattern put the admin's
 * schemas onto thirteen published operations.
 */
const ENDPOINT_ROUTE_RE = /^(?:\/[^/{}]+)*\/webhooks(\/.*)?$/;
/** Matches `<prefix>/webhook-events<rest>`, under the same rule. */
const EVENT_ROUTE_RE = /^(?:\/[^/{}]+)*\/webhook-events(\/.*)?$/;

/**
 * Writes a success response's schema onto whichever 2xx key the scanner already
 * emitted (Nest's default is 201 for `@Post`, 200 elsewhere, and a `@HttpCode`
 * moves it), so this never invents a status code the API does not return. A
 * `204` is left exactly as it is: it has no body, and describing one would be
 * a lie about the delete route.
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
export function describeWebhooksApi(document: OpenApiDocument): void {
    document.components ??= {};
    document.components.schemas ??= {};
    Object.assign(document.components.schemas, buildWebhookSchemas());

    const surfaces: [RegExp, Record<string, Record<string, OperationSpec>>][] =
        [
            [EVENT_ROUTE_RE, EVENT_ROUTES],
            [ENDPOINT_ROUTE_RE, ENDPOINT_ROUTES]
        ];

    for (const [route, item] of Object.entries(document.paths)) {
        let rest: string | undefined;
        let routes: Record<string, Record<string, OperationSpec>> | undefined;
        for (const [pattern, candidate] of surfaces) {
            const match = pattern.exec(route);
            if (match) {
                rest = match[1] ?? '';
                routes = candidate;
                break;
            }
        }
        if (rest === undefined || !routes) {
            continue;
        }
        const byMethod = routes[rest];
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
            if (rest !== '') {
                addErrorResponse(
                    operation,
                    '404',
                    'No endpoint with this id — or, on a delivery route, no delivery with this id belonging to it.'
                );
            }
            if (spec.validatesUrl) {
                addErrorResponse(
                    operation,
                    '422',
                    'The URL was refused by policy (scheme, or a private/loopback address), or a header name is reserved for the delivery’s own metadata.'
                );
            }
        }
    }
}
