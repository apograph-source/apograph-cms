import { type Page, type Route } from '@playwright/test';

/** An audit event as `GET /api/activity` returns it (server `ActivityEventView`). */
export interface ActivitySeed {
    id: string;
    kind: string;
    subjectType: string;
    subjectId: string;
    actorId: string | null;
    actorEmail: string | null;
    meta: Record<string, unknown> | null;
    at: string;
}

/**
 * The fixed event log `GET /api/activity` returns — the front-end analog of the
 * server suite's seed. One of several kinds and actors, including a
 * system-initiated event (null actor) so the "System" rendering is covered.
 */
export const DEFAULT_ACTIVITY: ActivitySeed[] = [
    {
        id: 'ev_1',
        kind: 'user.signed_in',
        subjectType: 'user',
        subjectId: 'u_ada',
        actorId: 'u_ada',
        actorEmail: 'ada@apograph.dev',
        meta: null,
        at: '2026-06-10T09:00:00.000Z'
    },
    {
        id: 'ev_2',
        kind: 'user.role_changed',
        subjectType: 'user',
        subjectId: 'u_grace',
        actorId: 'u_ada',
        actorEmail: 'ada@apograph.dev',
        meta: { from: 'viewer', to: 'contributor' },
        at: '2026-06-10T10:00:00.000Z'
    },
    {
        id: 'ev_3',
        kind: 'user.suspended',
        subjectType: 'user',
        subjectId: 'u_katherine',
        actorId: 'u_grace',
        actorEmail: 'grace@apograph.dev',
        meta: null,
        at: '2026-06-11T08:30:00.000Z'
    },
    {
        id: 'ev_4',
        kind: 'user.invited',
        subjectType: 'user',
        subjectId: 'u_alan',
        actorId: null,
        actorEmail: null,
        meta: { email: 'alan@apograph.dev' },
        at: '2026-06-11T12:00:00.000Z'
    }
];

/**
 * **Every audit kind the server can write**, paired with the `subjectType` and
 * the `meta` shape it carries — a black-box mirror of `FACET_MAPPERS` in
 * `packages/activity/server/src/lib/activity/infrastructure/audit-event-mapping.ts`
 * (its *output* kinds, not its input event kinds).
 *
 * This list is the front-end half of a pin the two sides badly need. An audit
 * kind the admin does not know is **not a type error and not a runtime error**:
 * `toActivityEvent` casts `dto.kind as ActivityKind`, `formatActivityAction`
 * finds no descriptor, and the Action column quietly prints the raw dotted wire
 * token, untranslated. That is how `media.asset.uploaded` and six `workspace.*`
 * kinds ended up rendering literally in a shipped UI. Nothing failed; a reader
 * just saw machine strings.
 *
 * So when a new kind is added server-side, add it here — the specs below then
 * fail until the admin has a label for it.
 *
 * **This list alone cannot catch the server moving ahead**, and that is worth
 * being clear about: it is written by hand from the admin's own catalogue, so
 * a kind neither side knows about is invisible to it. Three `user.sso_*` kinds
 * shipped rendering as raw tokens with this suite green. The check that closes
 * that hole is `audit-event-mapping.spec.ts`'s "the admin catalogue" block,
 * which compares the two lists directly. What this suite still uniquely proves
 * is that each kind actually **renders** — a label present in the map but
 * broken in the cell is a different failure.
 */
export const ALL_KINDS_ACTIVITY: ActivitySeed[] = [
    ['user.invited', 'user', { email: 'alan@apograph.dev' }],
    ['user.invite_resent', 'user', { email: 'alan@apograph.dev' }],
    ['user.invite_revoked', 'user', { email: 'alan@apograph.dev' }],
    ['user.password_reset_issued', 'user', { email: 'alan@apograph.dev' }],
    ['user.activated', 'user', null],
    ['user.profile_updated', 'user', { name: { from: 'Ada L', to: 'Ada B' } }],
    ['user.role_changed', 'user', { from: 'viewer', to: 'contributor' }],
    ['user.suspended', 'user', null],
    ['user.reactivated', 'user', null],
    ['user.password_changed', 'user', { sessionsRevoked: 2 }],
    [
        'user.signed_in',
        'user',
        { ipAddress: '203.0.113.7', userAgent: 'Firefox' }
    ],
    ['user.signed_out', 'user', null],
    [
        'user.sign_in_failed',
        'login_attempt',
        { reason: 'bad_password', ipAddress: '203.0.113.7' }
    ],
    ['user.session_revoked', 'user', { sessionId: 's_1' }],
    ['user.sso_linked', 'user', { provider: 'google' }],
    ['user.sso_provisioned', 'user', { provider: 'google', role: 'editor' }],
    ['user.sso_role_mapped', 'user', { provider: 'google', role: 'editor' }],
    [
        'workspace.created',
        'workspace',
        { name: 'Marketing', slug: 'marketing' }
    ],
    ['workspace.updated', 'workspace', { fields: ['name'] }],
    ['workspace.archived', 'workspace', {}],
    ['workspace.unarchived', 'workspace', {}],
    ['workspace.deleted', 'workspace', { name: 'Old', slug: 'old' }],
    ['workspace.member_added', 'user', { workspaceId: 'w_1', email: 'a@b.c' }],
    [
        'workspace.member_removed',
        'user',
        { workspaceId: 'w_1', email: 'a@b.c' }
    ],
    [
        'workspace.content_granted',
        'workspace',
        { slug: 'author', kind: 'collection' }
    ],
    ['workspace.content_revoked', 'workspace', { slug: 'author' }],
    ['entry.created', 'content_entry', { contentType: 'article' }],
    [
        'entry.updated',
        'content_entry',
        { contentType: 'article', fields: ['title', 'body'] }
    ],
    ['entry.published', 'content_entry', { contentType: 'article' }],
    ['entry.unpublished', 'content_entry', { contentType: 'article' }],
    ['entry.deleted', 'content_entry', { contentType: 'article', soft: true }],
    ['entry.restored', 'content_entry', { contentType: 'article' }],
    ['entry.purged', 'content_entry', { contentType: 'article' }],
    ['token.created', 'api_token', { name: 'CI', scope: 'full' }],
    ['token.revoked', 'api_token', { name: 'CI', scope: 'full' }],
    [
        'media.asset.uploaded',
        'media_asset',
        { name: 'hero.png', kind: 'image' }
    ],
    ['media.asset.updated', 'media_asset', { alt: 'A hero' }],
    ['media.asset.moved', 'media_asset', { folderId: 'f_1' }],
    ['media.asset.deleted', 'media_asset', { storageKey: 'w/a/hero.png' }],
    ['media.folder.created', 'media_folder', { name: 'Brand', parentId: null }],
    ['media.folder.renamed', 'media_folder', { name: 'Brand assets' }],
    ['media.folder.deleted', 'media_folder', {}],
    ['token.used', 'api_token', { name: 'CI', lookupPrefix: 'apograph_abc' }],
    [
        'transfer.content.exported',
        'content_type',
        { format: 'json', selected: 12 }
    ],
    ['transfer.content.imported', 'content_type', { created: 12, updated: 0 }],
    ['segment.created', 'segment', { key: 'members', label: 'Members' }],
    ['segment.updated', 'segment', { tags: { from: ['a'], to: ['a', 'b'] } }],
    ['segment.deleted', 'segment', { key: 'members' }],
    [
        'segment.entry_access_changed',
        'content_entry',
        { allow: ['seg_1'], deny: [] }
    ],
    ['alarm.rule.created', 'alarm_rule', { name: 'Missing alt text' }],
    [
        'alarm.rule.updated',
        'alarm_rule',
        { enabled: { from: true, to: false } }
    ],
    ['alarm.rule.deleted', 'alarm_rule', { name: 'Missing alt text' }],
    ['alarm.rule.rescanned', 'alarm_rule', { scanned: 312, open: 14 }],
    ['saved_view.created', 'saved_view', { name: 'Needs review' }],
    [
        'saved_view.updated',
        'saved_view',
        { visibility: { from: 'private', to: 'workspace' } }
    ],
    ['saved_view.deleted', 'saved_view', { name: 'Needs review' }],
    ['copilot.skill.created', 'copilot_skill', { name: 'house-style' }],
    [
        'copilot.skill.updated',
        'copilot_skill',
        { mode: { from: 'manual', to: 'auto' } }
    ],
    ['copilot.skill.deleted', 'copilot_skill', { name: 'house-style' }],
    [
        'copilot.tool_permission.decided',
        'copilot_run',
        { callId: 'call_1', decision: 'allow' }
    ]
].map(([kind, subjectType, meta], index) => ({
    id: `ev_kind_${index}`,
    kind: kind as string,
    subjectType: subjectType as string,
    subjectId: `subj_${index}`,
    actorId: 'u_ada',
    actorEmail: 'ada@apograph.dev',
    meta: meta as Record<string, unknown> | null,
    // Descending, so the log reads newest-first like the server's default.
    at: new Date(Date.UTC(2026, 5, 1, 12, 0, 0) - index * 60_000).toISOString()
}));

/**
 * The largest `pageSize` `GET /api/activity` accepts — `MAX_PAGE_SIZE` on
 * `ListActivityQueryDto`, enforced by the host's global `ValidationPipe`
 * (`@Max`), which answers **400** above it before the controller runs.
 *
 * This mock has to enforce it, and that is not decoration. It used to echo
 * whatever `pageSize` it was handed back with a 200, which made the page's
 * clamp unfalsifiable: an unclamped `?pageSize=1000` rendered a table exactly
 * like a clamped one, so "an over-large `?pageSize` is clamped instead of
 * 400ing into a dead end" passed whether or not the clamp existed.
 */
const MAX_PAGE_SIZE = 100;

/** Reads the filter/paging params the page sends from the intercepted URL. */
function paramsOf(route: Route): {
    kinds: string[];
    actorEmail: string;
    filter: string;
    page: number;
    pageSize: number;
} {
    const url = new URL(route.request().url());
    const kind = url.searchParams.get('kind') ?? '';
    return {
        kinds: kind ? kind.split(',').map((part) => part.trim()) : [],
        actorEmail: (url.searchParams.get('actorEmail') ?? '')
            .trim()
            .toLowerCase(),
        filter: url.searchParams.get('filter') ?? '',
        page: Number(url.searchParams.get('page') ?? '1'),
        pageSize: Number(url.searchParams.get('pageSize') ?? '25')
    };
}

/** The leaf/group wire shapes the query builder emits under `?filter=`. */
type FilterNode =
    | { and: FilterNode[] }
    | { or: FilterNode[] }
    | { field: string; op: string; value: unknown };

/** Resolve an event's value for a whitelisted wire field name. */
function eventValue(event: ActivitySeed, field: string): string {
    switch (field) {
        case 'kind':
            return event.kind;
        case 'subjectType':
            return event.subjectType;
        case 'subjectId':
            return event.subjectId;
        case 'actorId':
            return event.actorId ?? '';
        case 'actorEmail':
            return event.actorEmail ?? '';
        case 'at':
            return event.at;
        default:
            return '';
    }
}

/**
 * A minimal evaluator for the query-builder wire tree — enough to make the
 * Activity filter drawer behave for real in a browser test (mirrors the members
 * mock). Supports `eq`/`ne`/`in`/`ilike`/`null`/`gte`/`lte` plus `and`/`or`; an
 * unknown shape matches everything (fail-open, so unrelated tests are
 * unaffected). The wire grammar can't be imported (specs stay black-box), so
 * the shape is re-declared here.
 */
function matchesNode(event: ActivitySeed, node: FilterNode): boolean {
    if ('and' in node) return node.and.every((c) => matchesNode(event, c));
    if ('or' in node) return node.or.some((c) => matchesNode(event, c));
    const actual = eventValue(event, node.field);
    switch (node.op) {
        case 'eq':
            return actual === node.value;
        case 'ne':
            return actual !== node.value;
        case 'in':
            return Array.isArray(node.value) && node.value.includes(actual);
        case 'ilike': {
            const needle = String(node.value)
                .replace(/^%|%$/g, '')
                .toLowerCase();
            return actual.toLowerCase().includes(needle);
        }
        case 'null':
            return actual.length === 0;
        case 'gte':
            return actual >= String(node.value);
        case 'lte':
            return actual <= String(node.value);
        default:
            return true;
    }
}

/** Apply a raw `?filter=` JSON string to the log; no filter → unchanged. */
function applyFilter(events: ActivitySeed[], filter: string): ActivitySeed[] {
    if (!filter) return events;
    let node: FilterNode;
    try {
        node = JSON.parse(filter) as FilterNode;
    } catch {
        return events;
    }
    return events.filter((e) => matchesNode(e, node));
}

/**
 * Stub `GET /api/activity` with a deterministic log, applying the same
 * filtering + pagination the server does (kind IN, actor-email substring,
 * offset paging) so the page's controls behave for real — **including the
 * refusals**: a `pageSize` outside `1…`{@link MAX_PAGE_SIZE} comes back 400,
 * exactly as the DTO's `@Max` makes the real API answer. The page sits behind
 * the shell's gate, so a test also needs `mockSignedIn`. Pass `delayMs` to hold
 * the response open and observe the loading skeleton.
 *
 * Registered per-`page`, so it resets between tests with the browser context.
 */
export async function mockActivity(
    page: Page,
    events: ActivitySeed[] = DEFAULT_ACTIVITY,
    { delayMs }: { delayMs?: number } = {}
): Promise<void> {
    await page.route('**/api/activity?*', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.fallback();
            return;
        }
        if (delayMs) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const {
            kinds,
            actorEmail,
            filter,
            page: pageNum,
            pageSize
        } = paramsOf(route);

        // The `ValidationPipe`'s answer, not the controller's: a page size
        // outside `1…MAX_PAGE_SIZE` never reaches the handler. Shaped like
        // Nest's own error body so the admin's error branch sees what it would
        // live. A 4xx skips TanStack Query's retry, so the failure is immediate.
        if (
            !Number.isInteger(pageSize) ||
            pageSize < 1 ||
            pageSize > MAX_PAGE_SIZE
        ) {
            await route.fulfill({
                status: 400,
                contentType: 'application/json',
                body: JSON.stringify({
                    statusCode: 400,
                    error: 'Bad Request',
                    message: [
                        `pageSize must not be greater than ${MAX_PAGE_SIZE}`
                    ]
                })
            });
            return;
        }

        const searched = events.filter((event) => {
            if (kinds.length > 0 && !kinds.includes(event.kind)) {
                return false;
            }
            if (
                actorEmail &&
                !(event.actorEmail ?? '').toLowerCase().includes(actorEmail)
            ) {
                return false;
            }
            return true;
        });
        // The query-builder `?filter=` intersects with the structured params,
        // mirroring the server's AND composition.
        const matched = applyFilter(searched, filter);

        const start = (pageNum - 1) * pageSize;
        const items = matched.slice(start, start + pageSize);

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                items,
                total: matched.length,
                page: pageNum,
                pageSize
            })
        });
    });
}

/**
 * The trail of **one entry**, as `GET /api/activity/entries/:entryId` returns
 * it. Three events, oldest last, covering the two renderings the tab has: a
 * named actor and a system-initiated event with no actor at all.
 */
export const ENTRY_ACTIVITY: ActivitySeed[] = [
    {
        id: 'ev_entry_3',
        kind: 'entry.published',
        subjectType: 'content_entry',
        subjectId: 'blog_post-01',
        actorId: 'u_ada',
        actorEmail: 'ada@apograph.dev',
        meta: null,
        at: '2026-06-12T11:30:00.000Z'
    },
    {
        id: 'ev_entry_2',
        kind: 'entry.updated',
        subjectType: 'content_entry',
        subjectId: 'blog_post-01',
        actorId: 'u_grace',
        actorEmail: 'grace@apograph.dev',
        meta: null,
        at: '2026-06-11T15:05:00.000Z'
    },
    {
        id: 'ev_entry_1',
        kind: 'entry.created',
        subjectType: 'content_entry',
        subjectId: 'blog_post-01',
        actorId: null,
        actorEmail: null,
        meta: null,
        at: '2026-06-10T08:00:00.000Z'
    }
];

/**
 * Stub `GET /api/activity/entries/:entryId` — the entry editor's Activity tab.
 *
 * A **different route with a different permission** from `GET /activity`
 * (`content:read` rather than the admin-only `activity:read`), which is why it
 * gets a mock of its own rather than a branch inside {@link mockActivity}.
 *
 * `**\/api/activity/entries/*` cannot collide with that one's
 * `**\/api/activity?*` — a `*` segment does not cross `/` — so registration
 * order does not matter between the two.
 */
export async function mockEntryActivity(
    page: Page,
    events: ActivitySeed[] = ENTRY_ACTIVITY,
    { status = 200 }: { status?: number } = {}
): Promise<void> {
    await page.route('**/api/activity/entries/*', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.fallback();
            return;
        }
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(
                status >= 400
                    ? { message: 'Server error' }
                    : {
                          items: events,
                          total: events.length,
                          page: 1,
                          pageSize: 25
                      }
            )
        });
    });
}
