import { type Page, type Route } from '@playwright/test';

/** A member as the server's workspace endpoints return it. */
interface WorkspaceMemberView {
    id: string;
    name: string | null;
    email: string;
}

/** A workspace as the server's workspace endpoints return it. */
export interface WorkspaceView {
    id: string;
    name: string;
    slug: string;
    description: string;
    color: string;
    status: 'active' | 'archived';
    members: WorkspaceMemberView[];
    /** Granted content-type slugs; the Content Library scopes itself to these. */
    content?: string[];
}

const member = (
    id: string,
    name: string,
    email: string
): WorkspaceMemberView => ({ id, name, email });

/**
 * The default seed the suites assert against: four Active workspaces (Marketing
 * site, Product docs, Support hub, Internal wiki) and two Archived (Research
 * archive, Events 2023); Product docs has five members. Mirrors the shape the
 * real `GET /api/workspaces` returns.
 */
export const WORKSPACES_SEED: WorkspaceView[] = [
    {
        id: 'ws_marketing',
        name: 'Marketing site',
        slug: 'marketing-site',
        description:
            'Landing pages, the blog, and campaign content for the public website.',
        color: 'violet',
        status: 'active',
        members: [
            member('u_ada', 'Ada Lovelace', 'ada@orthacms.dev'),
            member('u_grace', 'Grace Hopper', 'grace@orthacms.dev'),
            member('u_alan', 'Alan Turing', 'alan@orthacms.dev')
        ],
        // Granted content types (slugs line up with the content support mock's
        // CONTENT_SCHEMA_SEED) so opening this workspace renders the Content
        // Library rather than the "no content types" empty state.
        content: ['blog_post', 'product', 'home', 'about']
    },
    {
        id: 'ws_docs',
        name: 'Product docs',
        slug: 'product-docs',
        description:
            'Guides, API references, and release notes for the developer portal.',
        color: 'teal',
        status: 'active',
        members: [
            member('u_grace', 'Grace Hopper', 'grace@orthacms.dev'),
            member('u_linus', 'Linus Torvalds', 'linus@orthacms.dev'),
            member('u_margaret', 'Margaret Hamilton', 'margaret@orthacms.dev'),
            member('u_dennis', 'Dennis Ritchie', 'dennis@orthacms.dev'),
            member('u_katherine', 'Katherine Johnson', 'katherine@orthacms.dev')
        ]
    },
    {
        id: 'ws_support',
        name: 'Support hub',
        slug: 'support-hub',
        description:
            'Help-center articles and canned responses shared across the support team.',
        color: 'green',
        status: 'active',
        members: [
            member('u_margaret', 'Margaret Hamilton', 'margaret@orthacms.dev'),
            member('u_alan', 'Alan Turing', 'alan@orthacms.dev')
        ]
    },
    {
        id: 'ws_internal',
        name: 'Internal wiki',
        slug: 'internal-wiki',
        description:
            'Team handbook, onboarding, and process docs for employees only.',
        color: 'amber',
        status: 'active',
        members: [
            member('u_ada', 'Ada Lovelace', 'ada@orthacms.dev'),
            member('u_dennis', 'Dennis Ritchie', 'dennis@orthacms.dev'),
            member('u_grace', 'Grace Hopper', 'grace@orthacms.dev'),
            member('u_katherine', 'Katherine Johnson', 'katherine@orthacms.dev')
        ]
    },
    {
        id: 'ws_research',
        name: 'Research archive',
        slug: 'research-archive',
        description:
            'Retired experiments and old design explorations kept for reference.',
        color: 'slate',
        status: 'archived',
        members: [member('u_alan', 'Alan Turing', 'alan@orthacms.dev')]
    },
    {
        id: 'ws_events',
        name: 'Events 2023',
        slug: 'events-2023',
        description:
            'Last year’s conference microsites and event landing pages, now archived.',
        color: 'rose',
        status: 'archived',
        members: [
            member(
                'u_katherine',
                'Katherine Johnson',
                'katherine@orthacms.dev'
            ),
            member('u_linus', 'Linus Torvalds', 'linus@orthacms.dev')
        ]
    }
];

/**
 * Build a **local** list of `count` active workspaces, for the suites that need
 * a membership long enough to overflow a picker (the sidebar switcher's popover
 * is unfiltered — it has no search box — so its scroll behaviour only shows up
 * past a couple of dozen). Pass `longNames` to make every name far wider than
 * the sidebar, which is what the truncation assertions need.
 *
 * Returns a fresh array each call: `WORKSPACES_SEED` is imported by several
 * suites, so a spec must never grow or reorder that one.
 */
export function manyWorkspaces(
    count: number,
    { longNames = false }: { longNames?: boolean } = {}
): WorkspaceView[] {
    const colors = ['violet', 'teal', 'green', 'amber', 'slate', 'rose'];
    // Real words rather than one unbroken token: a single long run has no wrap
    // opportunity, so it could satisfy a truncation assertion for the wrong
    // reason (nothing to wrap on) instead of because the CSS clipped it.
    const padding = longNames
        ? ' with a deliberately overlong name that no sidebar column can fit'
        : '';
    return Array.from({ length: count }, (_, index) => {
        const label = `Workspace ${index + 1}`;
        return {
            id: `ws_many_${index + 1}`,
            name: `${label}${padding}`,
            slug: `workspace-${index + 1}`,
            description: `Seeded workspace number ${index + 1}.`,
            color: colors[index % colors.length],
            status: 'active',
            members: [member('u_ada', 'Ada Lovelace', 'ada@orthacms.dev')],
            content: []
        } satisfies WorkspaceView;
    });
}

/** The owner the mocked session attributes a created workspace to. */
const OWNER = member(
    '00000000-0000-0000-0000-000000000001',
    'Admin User',
    'admin@example.com'
);

const CONTENT_TYPES = [
    { name: 'blog_post', kind: 'collection', label: 'Blog posts' },
    { name: 'product', kind: 'collection', label: 'Products' },
    { name: 'home', kind: 'single', label: 'Home', path: '/' },
    { name: 'about', kind: 'single', label: 'About', path: '/about' }
];

const DIRECTORY: WorkspaceMemberView[] = [
    member('u_barbara', 'Barbara Liskov', 'barbara@orthacms.dev'),
    member('u_edsger', 'Edsger Dijkstra', 'edsger@orthacms.dev'),
    member('u_donald', 'Donald Knuth', 'donald@orthacms.dev')
];

const json = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
});

/**
 * Stub `GET /api/workspaces` (the list the grid reads via `useWorkspaces`). The
 * admin client maps this view to its `Workspace` shape, deriving member
 * initials/colors on the client. Scoped to the test's `page`, so it resets with
 * the browser context — the FE analog of `resetDb()`. Only the list `GET` is
 * fulfilled; other methods fall through.
 *
 * Pass `delayMs` to hold the response open, so a test can observe the grid's
 * loading skeleton before the data lands.
 */
export async function mockWorkspaces(
    page: Page,
    workspaces: WorkspaceView[] = WORKSPACES_SEED,
    { delayMs }: { delayMs?: number } = {}
): Promise<void> {
    await page.route('**/api/workspaces', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.fallback();
            return;
        }
        if (delayMs) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        await route.fulfill(json(workspaces));
    });
}

/** JSON error response with an arbitrary status. */
const jsonError = (status: number, message: string) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ statusCode: status, message })
});

/**
 * Stub `GET /api/workspaces` as **broken**. Distinct from an empty list on
 * purpose: every workspace *selector* in the admin degrades to "no workspaces"
 * when this fails, and a picker that says "none" when it means "couldn't ask"
 * lets an operator draw exactly the wrong conclusion. Register it after the
 * normal mock — later routes win — so a suite can browse with real data and
 * then break this one endpoint.
 */
export async function mockWorkspacesUnavailable(
    page: Page,
    status = 500
): Promise<void> {
    await page.route('**/api/workspaces', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.fallback();
            return;
        }
        await route.fulfill(jsonError(status, 'Internal Server Error'));
    });
}

/**
 * Stub the full create-workspace flow with a **stateful** in-memory store: the
 * list `GET` reflects whatever `POST /api/workspaces` has created, so a created
 * card survives the post-create refetch (not just the optimistic insert). Also
 * stubs the wizard's supporting reads — slug availability, the member directory,
 * and the content-type catalogue. The owner is attributed from the mocked
 * session, mirroring the server deriving it from the cookie.
 */
export async function mockWorkspacesApi(
    page: Page,
    initial: WorkspaceView[] = WORKSPACES_SEED,
    {
        slugAvailabilityStatus,
        createStatus
    }: {
        /**
         * Force `GET /slug-available` to fail with this status, so a suite can
         * assert the wizard treats an unanswerable uniqueness check as
         * *unknown* (blocking) rather than *available*.
         */
        slugAvailabilityStatus?: number;
        /**
         * Force `POST /api/workspaces` to fail with this status instead of
         * creating — `409` is the duplicate-slug conflict the create flow has
         * to report as such rather than as a retryable error.
         */
        createStatus?: number;
    } = {}
): Promise<void> {
    const store = initial.map((w) => ({ ...w }));

    await page.route(/\/api\/workspaces(\?.*)?$/, async (route) => {
        const request = route.request();
        if (request.method() === 'GET') {
            await route.fulfill(json(store));
            return;
        }
        if (request.method() === 'POST') {
            if (createStatus) {
                await route.fulfill(
                    jsonError(createStatus, 'Workspace slug already exists')
                );
                return;
            }
            const body = request.postDataJSON() as {
                name: string;
                slug: string;
                description: string;
                color: string;
                members: { id: string; name: string; email: string }[];
            };
            const created: WorkspaceView = {
                id: `ws_${body.slug}`,
                name: body.name,
                slug: body.slug,
                description: body.description,
                color: body.color,
                status: 'active',
                members: [
                    OWNER,
                    ...body.members.map((m) => member(m.id, m.name, m.email))
                ]
            };
            store.unshift(created);
            await route.fulfill({ ...json(created), status: 201 });
            return;
        }
        await route.fallback();
    });

    // Anchored RegExps (not globs): a glob like `**/api/users**` also matches
    // the Vite source module `.../lib/api/usersClient/index.ts`, breaking the
    // wizard's lazy import. These match only the real endpoint paths.
    await page.route(
        /\/api\/workspaces\/slug-available(\?.*)?$/,
        async (route) => {
            if (slugAvailabilityStatus) {
                await route.fulfill(
                    jsonError(
                        slugAvailabilityStatus,
                        'Availability check failed'
                    )
                );
                return;
            }
            const slug = new URL(route.request().url()).searchParams.get(
                'slug'
            );
            const available = !store.some((w) => w.slug === slug);
            await route.fulfill(json({ available }));
        }
    );

    await page.route(/\/api\/users(\?.*)?$/, async (route) => {
        // The typeahead uses the users plugin's `GET /api/users?search=`, which
        // returns a paginated envelope of members.
        const search = (
            new URL(route.request().url()).searchParams.get('search') ?? ''
        ).toLowerCase();
        const items = search
            ? DIRECTORY.filter(
                  (u) =>
                      u.name?.toLowerCase().includes(search) ||
                      u.email.toLowerCase().includes(search)
              )
            : DIRECTORY;
        await route.fulfill(
            json({
                items,
                page: 1,
                pageSize: items.length,
                total: items.length
            })
        );
    });

    await page.route(/\/api\/content-types(\?.*)?$/, async (route) => {
        await route.fulfill(json(CONTENT_TYPES));
    });
}

/** The path segments of a routed request (`['', 'api', 'workspaces', …]`). */
const segments = (url: string): string[] => new URL(url).pathname.split('/');

/**
 * Answer a per-workspace `GET /api/workspaces/:id` **differently** for each id
 * in `answers` (`{ ws_ghost: 404, ws_private: 403 }`) and count the calls.
 *
 * Nothing in the admin asks: the shell resolves `:id` against the
 * membership-scoped list it already holds, so "no such workspace" and "not
 * yours" are the same unresolved id and get the same screen. This route exists
 * so a future existence probe would have something to leak — the id that
 * exists answering differently from the one that doesn't — which is what makes
 * "both screens say the same thing" a test with teeth rather than a tautology.
 * Any other id falls through to the surrounding mocks.
 */
export async function spyWorkspaceProbe(
    page: Page,
    answers: Record<string, number>
): Promise<{ count: number }> {
    const probe = { count: 0 };
    await page.route(/\/api\/workspaces\/([^/?]+)$/, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const status = answers[segments(route.request().url())[3]];
        if (status === undefined) return route.fallback();
        probe.count += 1;
        return route.fulfill(jsonError(status, 'No answer for you'));
    });
    return probe;
}

/** Options for {@link mockWorkspaceSettingsApi}. */
export interface WorkspaceSettingsApiOptions {
    /**
     * Per-workspace content slugs that a revoke must refuse with `409`
     * (`{ [workspaceId]: ['product', …] }`) — the FE analog of a content type
     * that still holds entries in the workspace. Also drives the per-slug
     * entry-count endpoint (a locked slug reports a non-zero count).
     */
    lockedContent?: Record<string, string[]>;
    /**
     * Per-workspace **total** content-entry count (`{ [workspaceId]: 2 }`),
     * returned by `GET /:id/entry-count` — the delete pre-check reads it and
     * blocks deletion while it's non-zero. Defaults to `0`.
     */
    workspaceEntryCount?: Record<string, number>;
    /**
     * Hold **both** entry-count reads open this long, so a test can observe the
     * "still checking" state of a destructive dialog — the window in which the
     * count is genuinely unknown and the destructive button must stay disabled.
     * Mirrors `mockWorkspaces`' `delayMs`.
     */
    entryCountDelayMs?: number;
    /**
     * Fail **both** entry-count reads with this status instead of answering.
     * The other half of "we do not actually know": a pre-check that cannot be
     * read has to block the action rather than fall through to a zero. Note a
     * `5xx` costs the query's full retry ladder (~7s) before `isError`, so a
     * `4xx` is the faster way to reach the state (see the AGENTS.md gotcha).
     */
    entryCountStatus?: number;
    /**
     * Force `DELETE /:id/members/:userId` to answer with this status instead of
     * `204` — `409` is the server's `LastMemberError`, the one removal that can
     * never succeed, so the client has to say why rather than invite a retry.
     */
    memberRemoveStatus?: number;
}

/**
 * Stub the **workspace settings** mutation surface with a stateful in-memory
 * store, so a settings spec can drive the full page against a deterministic
 * backend. Covers, over the seeded `store`:
 *
 * - `GET /api/workspaces` → the store; `PATCH /:id` (profile), `DELETE /:id`;
 * - `POST /:id/members` + `DELETE /:id/members/:userId`;
 * - `POST /:id/content` (400 for an unknown slug) + `DELETE /:id/content/:slug`
 *   (409 when `lockedContent` marks the slug non-empty);
 * - `POST /:id/archive` + `/unarchive`;
 * - the supporting reads `GET /api/content-types` and `GET /api/users?search=`.
 *
 * Each mutation returns the updated `WorkspaceView` (or 204), mirroring the real
 * endpoints, so the list refetch the admin fires on success reflects the change.
 */
export async function mockWorkspaceSettingsApi(
    page: Page,
    initial: WorkspaceView[],
    {
        lockedContent = {},
        workspaceEntryCount = {},
        entryCountDelayMs,
        entryCountStatus,
        memberRemoveStatus
    }: WorkspaceSettingsApiOptions = {}
): Promise<void> {
    const store = initial.map((w) => ({
        ...w,
        members: [...w.members],
        content: [...(w.content ?? [])]
    }));
    const find = (id: string) => store.find((w) => w.id === id);
    const view = (route: Route, w: WorkspaceView, status = 200) =>
        route.fulfill({ ...json(w), status });

    /**
     * The delay and the failure both entry-count reads share — the two ways a
     * pre-check ends up not knowing the count. Answers the route and returns
     * `true` when the read is meant to fail, so the caller stops.
     */
    const entryCountUnanswerable = async (route: Route): Promise<boolean> => {
        if (entryCountDelayMs) {
            await new Promise((resolve) =>
                setTimeout(resolve, entryCountDelayMs)
            );
        }
        if (entryCountStatus) {
            await route.fulfill(
                jsonError(entryCountStatus, 'Entry count unavailable')
            );
            return true;
        }
        return false;
    };

    // Add a member: POST /api/workspaces/:id/members
    await page.route(/\/api\/workspaces\/([^/?]+)\/members$/, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const id = segments(route.request().url())[3];
        const workspace = find(id);
        if (!workspace) return route.fulfill(jsonError(404, 'Not found'));
        const { userId } = route.request().postDataJSON() as { userId: string };
        const user = DIRECTORY.find((u) => u.id === userId);
        if (user && !workspace.members.some((m) => m.id === user.id)) {
            workspace.members.push(user);
        }
        return view(route, workspace, 201);
    });

    // Remove a member: DELETE /api/workspaces/:id/members/:userId
    await page.route(
        /\/api\/workspaces\/([^/?]+)\/members\/([^/?]+)$/,
        async (route) => {
            if (route.request().method() !== 'DELETE') return route.fallback();
            const [, , , id, , userId] = segments(route.request().url());
            if (memberRemoveStatus) {
                // The roster is left untouched: a refused removal must leave
                // the member exactly where they were.
                return route.fulfill(
                    jsonError(
                        memberRemoveStatus,
                        'A workspace must keep at least one member'
                    )
                );
            }
            const workspace = find(id);
            if (workspace) {
                workspace.members = workspace.members.filter(
                    (m) => m.id !== userId
                );
            }
            return route.fulfill({ status: 204, body: '' });
        }
    );

    // Grant a content type: POST /api/workspaces/:id/content
    await page.route(/\/api\/workspaces\/([^/?]+)\/content$/, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const id = segments(route.request().url())[3];
        const workspace = find(id);
        if (!workspace) return route.fulfill(jsonError(404, 'Not found'));
        const { slug } = route.request().postDataJSON() as { slug: string };
        if (!CONTENT_TYPES.some((t) => t.name === slug)) {
            return route.fulfill(jsonError(400, 'Unknown content type'));
        }
        if (!workspace.content?.includes(slug)) workspace.content?.push(slug);
        return view(route, workspace, 201);
    });

    // Entry count for the revoke pre-check:
    // GET /api/workspaces/:id/content/:slug/entry-count
    await page.route(
        /\/api\/workspaces\/([^/?]+)\/content\/([^/?]+)\/entry-count$/,
        async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            const [, , , id, , slug] = segments(route.request().url());
            if (await entryCountUnanswerable(route)) return;
            // A "locked" slug reports a non-zero count, so the dialog blocks it.
            const count = (lockedContent[id] ?? []).includes(slug) ? 3 : 0;
            await route.fulfill(json({ count }));
        }
    );

    // Revoke a content type: DELETE /api/workspaces/:id/content/:slug
    await page.route(
        /\/api\/workspaces\/([^/?]+)\/content\/([^/?]+)$/,
        async (route) => {
            if (route.request().method() !== 'DELETE') return route.fallback();
            const [, , , id, , slug] = segments(route.request().url());
            const workspace = find(id);
            if (!workspace) return route.fulfill(jsonError(404, 'Not found'));
            if ((lockedContent[id] ?? []).includes(slug)) {
                return route.fulfill(
                    jsonError(409, 'Content type still has entries')
                );
            }
            workspace.content = workspace.content?.filter((s) => s !== slug);
            return view(route, workspace, 200);
        }
    );

    // Archive / unarchive: POST /api/workspaces/:id/archive|unarchive
    await page.route(
        /\/api\/workspaces\/([^/?]+)\/(archive|unarchive)$/,
        async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            const [, , , id, action] = segments(route.request().url());
            const workspace = find(id);
            if (!workspace) return route.fulfill(jsonError(404, 'Not found'));
            workspace.status = action === 'archive' ? 'archived' : 'active';
            return view(route, workspace, 201);
        }
    );

    // Total entry count for the delete pre-check:
    // GET /api/workspaces/:id/entry-count
    await page.route(
        /\/api\/workspaces\/([^/?]+)\/entry-count$/,
        async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            const id = segments(route.request().url())[3];
            if (await entryCountUnanswerable(route)) return;
            await route.fulfill(json({ count: workspaceEntryCount[id] ?? 0 }));
        }
    );

    // Update / delete a single workspace: PATCH|DELETE /api/workspaces/:id
    await page.route(/\/api\/workspaces\/([^/?]+)$/, async (route) => {
        const request = route.request();
        const id = segments(request.url())[3];
        if (request.method() === 'PATCH') {
            const workspace = find(id);
            if (!workspace) return route.fulfill(jsonError(404, 'Not found'));
            Object.assign(
                workspace,
                request.postDataJSON() as Partial<WorkspaceView>
            );
            return view(route, workspace, 200);
        }
        if (request.method() === 'DELETE') {
            const index = store.findIndex((w) => w.id === id);
            if (index >= 0) store.splice(index, 1);
            return route.fulfill({ status: 204, body: '' });
        }
        return route.fallback();
    });

    // The list read the shell + grid refetch after every mutation.
    await page.route(/\/api\/workspaces(\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill(json(store));
    });

    // Supporting reads: the content-type catalogue and the member directory.
    await page.route(/\/api\/content-types(\?.*)?$/, async (route) => {
        await route.fulfill(json(CONTENT_TYPES));
    });
    await page.route(/\/api\/users(\?.*)?$/, async (route) => {
        const search = (
            new URL(route.request().url()).searchParams.get('search') ?? ''
        ).toLowerCase();
        const items = search
            ? DIRECTORY.filter(
                  (u) =>
                      u.name?.toLowerCase().includes(search) ||
                      u.email.toLowerCase().includes(search)
              )
            : DIRECTORY;
        await route.fulfill(
            json({
                items,
                page: 1,
                pageSize: items.length,
                total: items.length
            })
        );
    });
}
