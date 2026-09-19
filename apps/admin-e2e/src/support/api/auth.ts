import { type Page } from '@playwright/test';

interface LoginOutcome {
    /**
     * Response status: 201 = success (app navigates to `/`), 401 = bad creds,
     * 429 = the login throttle tripped.
     */
    status?: number;
    /** Hold the response open this long, to observe the pending/spinner state. */
    delayMs?: number;
    /**
     * Seconds to send back as `Retry-After`. `@nestjs/throttler` puts this on
     * every 429 and the sign-in page reads it, so a 429 stub without it and one
     * with it are two different screens.
     */
    retryAfterSeconds?: number;
}

/**
 * Stub `POST /api/auth/login`. This is the front-end analog of the server
 * suite's `seedActiveUser`: instead of a DB row, it fixes what the API would
 * answer, so the test is deterministic and needs no real backend.
 *
 * Routes are scoped to the test's `page`, so they reset between tests with the
 * browser context — the e2e equivalent of `resetDb()`.
 */
export async function mockLogin(
    page: Page,
    { status = 201, delayMs, retryAfterSeconds }: LoginOutcome = {}
): Promise<void> {
    await page.route('**/api/auth/login', async (route) => {
        if (delayMs) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        await route.fulfill({
            status,
            contentType: 'application/json',
            headers: retryAfterSeconds
                ? { 'retry-after': String(retryAfterSeconds) }
                : undefined,
            body: JSON.stringify(
                status === 201
                    ? { ok: true }
                    : { message: 'Invalid credentials' }
            )
        });
    });
}

/** The full v1 permission catalogue — what the admin role grants. */
const ALL_PERMISSIONS = [
    'workspaces:create',
    'workspaces:read',
    'workspaces:update',
    'workspaces:delete',
    'users:read',
    'users:create',
    'users:update',
    'users:delete',
    // Authority over a member's *credentials* rather than their record —
    // today, revealing an invitation or reset link that never arrived
    // (ADR-0018 §4). It landed on the server with the mail PR and was never
    // added here, which made `seed-drift` red for anyone who ran the whole
    // suite; nothing in the admin reads it yet, so this is the same "add the
    // key the moment the server declares it, not the moment a screen does"
    // rule the protection pair below follows.
    'users:manage',
    'activity:read',
    // Acting on the audit trail's plumbing rather than reading it: retrying an
    // outbox event that gave up. Admin-only on the server and in no API-token
    // scope. Without it the Activity page's dead-letter banner renders its
    // headline and nothing else — no trigger, no dialog — so the whole operator
    // surface is invisible to every suite. Narrow this away to assert exactly
    // that: the notice still renders for an `activity:read` reader, because the
    // information is true for them either way.
    'activity:manage',
    // The external-API bearer tokens (`api-tokens-admin`). Without these the
    // `/api-tokens` page and its sidebar entry are invisible to every suite,
    // which is exactly how it stayed untested.
    'tokens:read',
    'tokens:create',
    'tokens:delete',
    'content:read',
    'content:create',
    'content:update',
    'content:publish',
    'content:delete',
    // Publication protection's two keys, added by the server PRs below this one
    // in the ORT-226 stack (`protection-server`'s rule CRUD and the review
    // routes). Nothing in the admin reads them yet — `protection/admin` is a
    // later PR — but `seed-drift.spec.ts` compares this list against the whole
    // server catalogue, so they belong here the moment the server declares
    // them, not the moment a screen does.
    'content:approve',
    'protection:manage',
    // Export and import (`transfer-admin`). Separate keys on the server rather
    // than folded into read and create, because bulk egress is a capability an
    // operator withholds on its own — so they have to be listed here too, or
    // the three slot contributions that reach the transfer dialogs render for
    // nobody and the whole surface is invisible to every spec.
    'content:export',
    'content:import',
    'media:read',
    'media:create',
    'media:update',
    'media:delete',
    // Without this the copilot renders nothing at all — no sidebar switcher, no
    // dock, and the Agents view answers "No access". It was missing, so every
    // suite claiming "an admin holding every permission" was quietly blind to
    // that whole surface.
    'copilot:use',
    // Admin-only: authoring a skill writes prompt text that runs for everyone in
    // the workspace (ADR-0010). Narrow this away to assert the rail's skills
    // link is absent for a contributor.
    'copilot:skills:manage',
    // Content alarms. Missing these made the whole surface invisible to every
    // suite — the alarms page, the rule editor, the entry rail's checks block
    // and the records "Save as rule" action all render for nobody without
    // them, which is how a broken condition editor reached a user. `read` goes
    // to every role on the server; `manage` is admin-only, so narrow this away
    // to assert a contributor gets findings without the mute and rule
    // controls.
    'alarms:read',
    'alarms:manage',
    // Reader entitlements (`segments-admin`). Same failure as the alarms keys
    // above and the tokens ones before them: without these the audience
    // directory, its editor pages, the entry editor's Access tab and header
    // chip, the revision preview's access row and the records list's
    // Segmentation filter fields all render for nobody — an entire feature
    // invisible to a mock claiming to hold every permission. `read` goes to
    // every role on the server (an editor who cannot see that an entry is
    // restricted will publish one believing it is public); `manage` is
    // admin-only, so narrow this away to assert a contributor gets a read-only
    // Access tab.
    'segments:read',
    'segments:manage',
    // Outgoing webhooks (`webhooks-admin`). Both keys are admin-only on the
    // server — an endpoint is not scoped to a workspace and holds a signing
    // secret — so unlike the pairs above there is no contributor variant to
    // narrow to; withhold them to assert the no-access state instead.
    'webhooks:read',
    'webhooks:manage',
    // Saved list views. Only `share` is a permission — a private view needs
    // none — so without it the switcher's "share with the workspace" half is
    // invisible. Added here because `seed-drift.spec.ts` compares this list to
    // the server catalogue key for key, which is the check that found it.
    'views:share'
];

/**
 * The shape `GET /api/auth/me` answers with. `name` is **nullable** on the
 * wire — the seeded root admin has none — so suites can seed that case and
 * assert the display-name fallbacks.
 */
export interface CurrentUserSeed {
    id: string;
    email: string;
    name: string | null;
    roleId: string;
    status: string;
    permissions: string[];
}

/**
 * The authenticated user `GET /api/auth/me` returns (the server's `PublicUser`
 * plus the role's `permissions`). Defaults to an admin holding every permission,
 * so signed-in suites see all permission-gated UI; override `permissions` to
 * test a restricted role (e.g. a viewer without `workspaces:create`).
 */
const DEFAULT_USER: CurrentUserSeed = {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin@example.com',
    name: 'Admin User',
    roleId: '00000000-0000-0000-0000-0000000000a1',
    status: 'active',
    // Defaults to a full-access admin; a suite narrows this via `mockSignedIn`
    // to exercise permission-gated UI.
    permissions: ALL_PERMISSIONS
};

/**
 * Stub `GET /api/auth/me` as **signed in**. The host's `AuthProvider` calls this
 * on load to resolve the current user, so any test that lands on a private route
 * (the home page) must seed a session here — the FE analog of `seedActiveUser`.
 *
 * Registered per-`page`; later registrations win, so a test can start signed out
 * (e.g. in `beforeEach`) and flip to signed in before submitting the login form.
 *
 * Pass `delayMs` to hold the probe open — the gate stays in its `Loading` state,
 * so a test can observe the branded root loader (`AppLoader`) before the session
 * resolves.
 */
export async function mockSignedIn(
    page: Page,
    user: Partial<CurrentUserSeed> = {},
    { delayMs }: { delayMs?: number } = {}
): Promise<void> {
    await page.route('**/api/auth/me', async (route) => {
        if (delayMs) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...DEFAULT_USER, ...user })
        });
    });
}

/** One provider as `GET /api/auth/sso` returns it. */
export interface SsoProviderSeed {
    name: string;
    label: string;
    kind: 'oidc' | 'oauth2' | 'saml';
}

/**
 * Stub `GET /api/auth/sso` — the providers the sign-in page renders buttons
 * for.
 *
 * Defaults to **none**, which is the default install, and is what
 * {@link mockSignedOut} seeds so no suite reaches a real network for a list it
 * does not care about. A suite that does care registers its own afterwards:
 * Playwright matches the most recently added route first, so a later call wins.
 */
export async function mockSsoProviders(
    page: Page,
    providers: SsoProviderSeed[] = []
): Promise<void> {
    await page.route('**/api/auth/sso', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(providers)
        });
    });
}

/**
 * Stub `GET /api/auth/sso` as unreachable, to assert that the sign-in page
 * still works when the provider list does not.
 */
export async function mockSsoProvidersUnavailable(page: Page): Promise<void> {
    await page.route('**/api/auth/sso', async (route) => {
        await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Internal server error' })
        });
    });
}

/**
 * Stub `GET /api/auth/me` as **signed out** (`401`). With this, every private
 * route redirects to the sign-in page. Use it for the logged-out cases and to
 * keep the login-page suite deterministic (the auth probe never hits a real
 * backend).
 */
export async function mockSignedOut(
    page: Page,
    { delayMs }: { delayMs?: number } = {}
): Promise<void> {
    await page.route('**/api/auth/me', async (route) => {
        if (delayMs) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Unauthorized' })
        });
    });
    // The sign-in page asks for the SSO providers on every load. Seeded empty
    // here so no suite makes a real request for a list it does not care about;
    // a suite that does care registers its own route afterwards and wins.
    await mockSsoProviders(page);
}

/**
 * Like {@link mockSignedOut} but records each call, so a test can assert how
 * many times the session was probed — the `401` resolves to "no user" rather
 * than an error, and the query is `retry: false`, so a signed-out load must ask
 * exactly once.
 */
export async function spySignedOut(
    page: Page
): Promise<{ readonly count: number }> {
    let count = 0;
    await page.route('**/api/auth/me', async (route) => {
        count += 1;
        await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Unauthorized' })
        });
    });
    return {
        get count() {
            return count;
        }
    };
}

/**
 * Stub `GET /api/auth/me` as **unreachable at the transport layer** — the
 * request never gets an answer at all.
 *
 * Distinct from {@link mockAuthProbeUnavailable}, which answers `500`. A `500`
 * is a response; a dropped connection, a DNS failure or a timeout is not, so it
 * reaches the client as a rejected fetch with **no status** — the one shape
 * that is easy to mishandle, because code that branches on `status === 401`
 * against `undefined` can fall through to either answer. It must land on
 * `unavailable`, exactly as the `500` does: neither says anything about whether
 * the session is still valid.
 *
 * `delayMs` holds the request open first, which is what a real timeout looks
 * like — the gate must show its loader for that whole time and only then
 * report the outage.
 */
export async function mockAuthProbeOffline(
    page: Page,
    { delayMs }: { delayMs?: number } = {}
): Promise<void> {
    await page.route('**/api/auth/me', async (route) => {
        if (delayMs) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        await route.abort('failed');
    });
}

/**
 * Stub `GET /api/auth/me` as **broken** (`500`) — the session cookie is still
 * valid, the endpoint just cannot answer. Distinct from {@link mockSignedOut}
 * on purpose: an outage must not present itself as a sign-out, so the gate
 * holds the tab on its "can't reach the server" screen instead of redirecting.
 *
 * Register `mockSignedIn` after it to bring the API back mid-test.
 */
export async function mockAuthProbeUnavailable(page: Page): Promise<void> {
    await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Internal Server Error' })
        });
    });
}

/**
 * Answer `401` on any request matching `urlPattern` — the shape a live tab sees
 * the moment its session stops being valid (revoked elsewhere, expired, or the
 * account suspended by an admin). Register it **after** the endpoint's normal
 * mock: later routes win, so a test can browse with real data and then flip a
 * single endpoint to "session lost" mid-visit.
 */
export async function mockUnauthorized(
    page: Page,
    urlPattern: string
): Promise<void> {
    await page.route(urlPattern, async (route) => {
        await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Unauthorized' })
        });
    });
}

/**
 * Stub `POST /api/auth/logout` (always succeeds) and record each call, so a
 * test can assert the account menu's Logout triggered it.
 */
export async function spyLogout(
    page: Page
): Promise<{ readonly count: number }> {
    let count = 0;
    await page.route('**/api/auth/logout', async (route) => {
        count += 1;
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true })
        });
    });
    return {
        get count() {
            return count;
        }
    };
}

/** Tracks calls to the login endpoint — to assert it is (not) hit. */
export interface LoginSpy {
    readonly count: number;
}

/**
 * Like {@link mockLogin} (always 201) but records each call, so a test can
 * assert the request was suppressed — e.g. blocked by client-side validation.
 */
export async function spyLogin(page: Page): Promise<LoginSpy> {
    let count = 0;
    await page.route('**/api/auth/login', async (route) => {
        count += 1;
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true })
        });
    });
    return {
        get count() {
            return count;
        }
    };
}
