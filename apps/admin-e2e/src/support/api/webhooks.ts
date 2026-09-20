import { type Page, type Route } from '@playwright/test';

/** An endpoint as `GET /api/webhooks` returns it (the server's view shape). */
export interface WebhookEndpointSeed {
    id: string;
    name: string;
    url: string;
    secretHint: string;
    enabled: boolean;
    eventKinds: string[];
    contentTypes: string[];
    allWorkspaces: boolean;
    workspaceIds: string[];
    headers: Record<string, string>;
    disabledReason: string | null;
    consecutiveFailures: number;
    createdAt: string;
    updatedAt: string;
    lastDelivery: {
        id: string;
        status: string;
        eventKind: string;
        statusCode: number | null;
        createdAt: string;
    } | null;
}

const CREATED_AT = '2026-01-01T00:00:00.000Z';

/**
 * The plaintext secret `POST /api/webhooks` hands back once.
 *
 * Deliberately a fixed, obviously-fake string in the real `whsec_…` shape, so a
 * spec can assert on it without a live signing key ever entering the repo.
 */
export const REVEALED_SECRET =
    'whsec_e2eFAKEe2eFAKEe2eFAKEe2eFAKEe2eFAKEe2eFAKE00';

/**
 * The fixed endpoint list the suites assert against — one row of every state
 * the table has to distinguish: active with a delivered last attempt, paused by
 * hand, and switched off automatically after repeated failures. The last one
 * matters most: "paused" and "stopped after failures" look identical if the
 * table renders them the same way, and they mean opposite things about whether
 * anyone needs to do something.
 *
 * Workspace ids line up with `WORKSPACES_SEED` in `./workspaces`.
 */
export const WEBHOOKS_SEED: WebhookEndpointSeed[] = [
    {
        id: 'wh_active',
        name: 'Rebuild the storefront',
        url: 'https://storefront.example.com/hooks/ortha',
        secretHint: 'a1b2',
        enabled: true,
        // Empty filters — the table must read these as "All events" and "All
        // workspaces" rather than as "0 events".
        eventKinds: [],
        contentTypes: [],
        allWorkspaces: true,
        workspaceIds: [],
        headers: {},
        disabledReason: null,
        consecutiveFailures: 0,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        lastDelivery: {
            id: 'del_ok',
            status: 'succeeded',
            eventKind: 'entry.published',
            statusCode: 200,
            createdAt: CREATED_AT
        }
    },
    {
        id: 'wh_paused',
        name: 'Search re-index',
        url: 'https://search.example.com/hooks',
        secretHint: 'c3d4',
        enabled: false,
        eventKinds: ['entry.published', 'entry.unpublished'],
        contentTypes: ['article'],
        allWorkspaces: false,
        workspaceIds: ['ws_marketing'],
        headers: {},
        // Paused by hand: no reason, so the table must not call it a failure.
        disabledReason: null,
        consecutiveFailures: 0,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        lastDelivery: null
    },
    {
        id: 'wh_broken',
        name: 'Old staging preview',
        url: 'https://staging.example.com/hooks',
        secretHint: 'e5f6',
        enabled: false,
        eventKinds: [],
        contentTypes: [],
        allWorkspaces: true,
        workspaceIds: [],
        headers: {},
        disabledReason:
            'Disabled automatically after 20 consecutive failed deliveries.',
        consecutiveFailures: 20,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        lastDelivery: {
            id: 'del_dead',
            status: 'dead',
            eventKind: 'entry.updated',
            statusCode: 404,
            createdAt: CREATED_AT
        }
    }
];

/** The catalogue `GET /api/webhook-events` serves the editor's picker. */
export const WEBHOOK_EVENTS_SEED = [
    {
        kind: 'entry.created',
        group: 'content',
        label: 'Entry created',
        scopedByContentType: true,
        carriesWorkspace: true
    },
    {
        kind: 'entry.published',
        group: 'content',
        label: 'Entry published',
        scopedByContentType: true,
        carriesWorkspace: true
    },
    {
        kind: 'entry.deleted',
        group: 'content',
        label: 'Entry deleted',
        scopedByContentType: true,
        carriesWorkspace: true
    },
    {
        // Present in the catalogue and deliberately absent from the picker: it
        // is what the Send-test button produces, not something to subscribe to.
        kind: 'ping',
        group: 'system',
        label: 'Test ping',
        scopedByContentType: false,
        carriesWorkspace: false
    }
];

/** One delivery row as the log returns it. */
export interface DeliverySeed {
    id: string;
    endpointId: string;
    eventId: string;
    eventKind: string;
    workspaceId: string | null;
    contentType: string | null;
    status: string;
    attempts: number;
    nextAttemptAt: string | null;
    statusCode: number | null;
    error: string | null;
    durationMs: number | null;
    createdAt: string;
    completedAt: string | null;
}

/**
 * One page of a delivery log, with **every row terminal**.
 *
 * That is load-bearing rather than incidental: the log polls itself while any
 * row is still in flight, so a seed containing a `pending` row would have the
 * page refetching for the whole test.
 */
export const DELIVERIES_SEED: DeliverySeed[] = [
    {
        id: 'del_ok',
        endpointId: 'wh_active',
        eventId: 'evt_1',
        eventKind: 'entry.published',
        workspaceId: 'ws_marketing',
        contentType: 'article',
        status: 'succeeded',
        attempts: 1,
        nextAttemptAt: null,
        statusCode: 200,
        error: null,
        durationMs: 42,
        createdAt: CREATED_AT,
        completedAt: CREATED_AT
    },
    {
        id: 'del_dead',
        endpointId: 'wh_active',
        eventId: 'evt_2',
        eventKind: 'entry.updated',
        workspaceId: 'ws_marketing',
        contentType: 'article',
        status: 'dead',
        attempts: 1,
        nextAttemptAt: null,
        statusCode: 404,
        error: 'Receiver rejected the delivery with HTTP 404.',
        durationMs: 18,
        createdAt: CREATED_AT,
        completedAt: CREATED_AT
    }
];

/** How the create route should answer. */
interface WebhooksApiOptions {
    /** Rows for the list; defaults to {@link WEBHOOKS_SEED}. */
    endpoints?: WebhookEndpointSeed[];
    /** Fail the list with a 500, to reach the error state. */
    listFails?: boolean;
    /** Refuse a create with a 422 carrying this message (the URL policy). */
    createRejects?: string;
    /** Deliveries for the detail page's log. */
    deliveries?: DeliverySeed[];
}

/**
 * Stubs the whole webhooks API surface.
 *
 * **Route order is the opposite of the server's.** Playwright matches routes in
 * **reverse** registration order — the last one registered wins — so the broad
 * `**\/api/webhooks` pattern is registered first and the specific ones after
 * it. Registering them the other way round is the documented trap in this
 * harness: the wildcard answers the deliveries request with an endpoint list,
 * and the page renders off that rather than failing.
 */
export async function mockWebhooksApi(
    page: Page,
    {
        endpoints = WEBHOOKS_SEED,
        listFails = false,
        createRejects,
        deliveries = DELIVERIES_SEED
    }: WebhooksApiOptions = {}
): Promise<void> {
    const json = (route: Route, body: unknown, status = 200) =>
        route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(body)
        });

    // Broadest first — the last registration wins.
    await page.route('**/api/webhooks', (route) => {
        if (route.request().method() === 'POST') {
            if (createRejects) {
                return json(route, { message: createRejects }, 422);
            }
            return json(
                route,
                { endpoint: endpoints[0], secret: REVEALED_SECRET },
                201
            );
        }
        if (listFails) {
            return json(route, { message: 'boom' }, 500);
        }
        return json(route, endpoints);
    });

    await page.route('**/api/webhook-events', (route) =>
        json(route, WEBHOOK_EVENTS_SEED)
    );

    await page.route('**/api/webhooks/*', (route) => {
        const id = route.request().url().split('/').pop() ?? '';
        const found = endpoints.find((endpoint) => endpoint.id === id);
        if (!found) return json(route, { message: 'Not found' }, 404);
        if (route.request().method() === 'DELETE') {
            return route.fulfill({ status: 204, body: '' });
        }
        return json(route, found);
    });

    await page.route('**/api/webhooks/*/test', (route) =>
        json(route, {
            ok: true,
            statusCode: 200,
            error: null,
            durationMs: 31,
            responseSnippet: 'ok'
        })
    );

    await page.route('**/api/webhooks/*/deliveries*', (route) =>
        json(route, {
            items: deliveries,
            total: deliveries.length,
            page: 1,
            pageSize: 25,
            pageCount: 1
        })
    );

    await page.route('**/api/webhooks/*/deliveries/*', (route) =>
        json(route, {
            ...deliveries[0],
            payload: { event: 'entry.published', eventId: 'evt_1' },
            responseSnippet: 'received'
        })
    );

    await page.route('**/api/webhooks/*/deliveries/*/redeliver', (route) =>
        json(route, { ...deliveries[0], id: 'del_repeat' }, 201)
    );
}
