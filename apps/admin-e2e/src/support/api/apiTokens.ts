import { type Page, type Route } from '@playwright/test';

/** A token as `GET /api/api-tokens` returns it (the server's `ApiTokenView`). */
export interface ApiTokenSeed {
    id: string;
    name: string;
    workspaceIds: string[];
    scope: 'read' | 'full';
    lookupPrefix: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
}

const CREATED_AT = '2026-01-01T00:00:00.000Z';
const PAST = '2025-06-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

/**
 * The plaintext `POST /api/api-tokens` hands back once. Deliberately a fixed,
 * obviously-fake 52-character string in the real `orthacms_…` shape, so a spec
 * can assert on it without a live credential ever entering the repo.
 */
export const REVEALED_SECRET =
    'orthacms_e2eFAKEe2eFAKEe2eFAKEe2eFAKEe2eFAKEe2eFAKE00';

/**
 * The fixed token list the suites assert against — one row of every state the
 * table has to distinguish: active, expired, revoked, revoked **and** expired
 * (revocation must win), a bucket spanning two workspaces, and a bucket naming
 * a workspace the selector never heard of (so the raw-id fallback is exercised).
 *
 * Workspace ids line up with `WORKSPACES_SEED` in `./workspaces`, because the
 * table resolves ids to names through that same `GET /api/workspaces`.
 */
export const API_TOKENS_SEED: ApiTokenSeed[] = [
    {
        id: 'tok_active',
        name: 'Production website',
        workspaceIds: ['ws_marketing'],
        scope: 'read',
        lookupPrefix: 'orthacms_aa11bb',
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: CREATED_AT
    },
    {
        id: 'tok_full',
        name: 'Build pipeline',
        workspaceIds: ['ws_marketing', 'ws_docs'],
        scope: 'full',
        lookupPrefix: 'orthacms_cc22dd',
        expiresAt: FUTURE,
        lastUsedAt: CREATED_AT,
        revokedAt: null,
        createdAt: CREATED_AT
    },
    {
        id: 'tok_expired',
        name: 'Old preview build',
        workspaceIds: ['ws_docs'],
        scope: 'read',
        lookupPrefix: 'orthacms_ee33ff',
        expiresAt: PAST,
        lastUsedAt: PAST,
        revokedAt: null,
        createdAt: CREATED_AT
    },
    {
        id: 'tok_revoked',
        name: 'Leaked laptop token',
        workspaceIds: ['ws_support'],
        scope: 'full',
        lookupPrefix: 'orthacms_gg44hh',
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: CREATED_AT,
        createdAt: CREATED_AT
    },
    {
        // Revoked *and* past its expiry: the status the mapper derives has to
        // read Revoked, not Expired.
        id: 'tok_revoked_expired',
        name: 'Retired importer',
        workspaceIds: ['ws_internal'],
        scope: 'read',
        lookupPrefix: 'orthacms_ii55jj',
        expiresAt: PAST,
        lastUsedAt: PAST,
        revokedAt: CREATED_AT,
        createdAt: CREATED_AT
    },
    {
        // Its workspace is not in the selector's list, so the cell falls back to
        // the raw id rather than rendering an empty bucket.
        id: 'tok_orphan',
        name: 'Orphaned bucket',
        workspaceIds: ['ws_deleted'],
        scope: 'read',
        lookupPrefix: 'orthacms_kk66ll',
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: CREATED_AT
    }
];

/** Builds `count` filler tokens, for the pagination cases (page size is 25). */
export function manyApiTokens(count: number): ApiTokenSeed[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `tok_bulk_${index}`,
        name: `Bulk token ${String(index).padStart(2, '0')}`,
        workspaceIds: ['ws_marketing'],
        scope: 'read' as const,
        lookupPrefix: `orthacms_b${String(index).padStart(5, '0')}`,
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: CREATED_AT
    }));
}

/** Counts the calls a suite wants to assert were (or weren't) made. */
export interface ApiTokensSpy {
    readonly listCalls: number;
    readonly createCalls: number;
    readonly revokeCalls: number;
    /** The body of the most recent `POST /api/api-tokens`. */
    readonly lastCreateBody: Record<string, unknown> | null;
}

/** Knobs for {@link mockApiTokensApi}. */
export interface ApiTokensApiOptions {
    /** Seed rows the list serves (and the mutations act on). */
    tokens?: ApiTokenSeed[];
    /** Force the list `GET` to fail with this status. */
    listStatus?: number;
    /** Force the create `POST` to fail with this status. */
    createStatus?: number;
    /** Force the revoke `DELETE` to fail with this status. */
    revokeStatus?: number;
    /** Hold the list response open, to observe the skeleton. */
    delayMs?: number;
    /** Hold the create response open, to observe the submit's busy state. */
    createDelayMs?: number;
    /** Hold the revoke response open, to observe the confirm's busy state. */
    revokeDelayMs?: number;
}

const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
});

const jsonError = (status: number, message: string) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ statusCode: status, message })
});

/**
 * Stub the API-tokens management API with a **stateful** in-memory store: the
 * list reflects whatever `POST` created and `DELETE` revoked, so a spec can
 * assert the row that arrives after the refetch rather than an optimistic
 * guess. Paging is honoured, so the pager cases are real.
 *
 * The create response carries {@link REVEALED_SECRET} — the one-time plaintext
 * the reveal dialog is built around.
 *
 * Routes are scoped to the test's `page`, so they reset with the browser
 * context — the FE analog of `resetDb()`.
 */
export async function mockApiTokensApi(
    page: Page,
    {
        tokens = API_TOKENS_SEED,
        listStatus,
        createStatus,
        revokeStatus,
        delayMs,
        createDelayMs,
        revokeDelayMs
    }: ApiTokensApiOptions = {}
): Promise<ApiTokensSpy> {
    const store = tokens.map((token) => ({ ...token }));
    let listCalls = 0;
    let createCalls = 0;
    let revokeCalls = 0;
    let lastCreateBody: Record<string, unknown> | null = null;
    let created = 0;

    const hold = async (ms: number | undefined) => {
        if (ms) {
            await new Promise((resolve) => setTimeout(resolve, ms));
        }
    };

    await page.route('**/api/api-tokens**', async (route: Route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();

        if (method === 'GET') {
            listCalls += 1;
            await hold(delayMs);
            if (listStatus) {
                await route.fulfill(jsonError(listStatus, 'Boom'));
                return;
            }
            const pageNumber = Number(url.searchParams.get('page') ?? '1');
            const pageSize = Number(url.searchParams.get('pageSize') ?? '25');
            const start = (pageNumber - 1) * pageSize;
            await route.fulfill(
                json({
                    items: store.slice(start, start + pageSize),
                    total: store.length,
                    page: pageNumber,
                    pageSize
                })
            );
            return;
        }

        if (method === 'POST') {
            createCalls += 1;
            lastCreateBody = request.postDataJSON() ?? null;
            await hold(createDelayMs);
            if (createStatus) {
                await route.fulfill(jsonError(createStatus, 'Boom'));
                return;
            }
            created += 1;
            const body = (lastCreateBody ?? {}) as {
                name?: string;
                workspaceIds?: string[];
                scope?: 'read' | 'full';
                expiresAt?: string;
            };
            const token: ApiTokenSeed = {
                id: `tok_new_${created}`,
                name: body.name ?? 'Untitled',
                workspaceIds: body.workspaceIds ?? [],
                scope: body.scope ?? 'read',
                lookupPrefix: `orthacms_n${String(created).padStart(5, '0')}`,
                expiresAt: body.expiresAt ?? null,
                lastUsedAt: null,
                revokedAt: null,
                createdAt: CREATED_AT
            };
            // Newest first, exactly as the server orders by `desc(createdAt)`.
            store.unshift(token);
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({ ...token, secret: REVEALED_SECRET })
            });
            return;
        }

        if (method === 'DELETE') {
            revokeCalls += 1;
            await hold(revokeDelayMs);
            if (revokeStatus) {
                await route.fulfill(jsonError(revokeStatus, 'Boom'));
                return;
            }
            const id = url.pathname.split('/').pop();
            const target = store.find((token) => token.id === id);
            if (target) {
                target.revokedAt = CREATED_AT;
            }
            await route.fulfill({ status: 204, body: '' });
            return;
        }

        await route.fallback();
    });

    return {
        get listCalls() {
            return listCalls;
        },
        get createCalls() {
            return createCalls;
        },
        get revokeCalls() {
            return revokeCalls;
        },
        get lastCreateBody() {
            return lastCreateBody;
        }
    };
}
