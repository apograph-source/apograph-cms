import { type Page } from '@playwright/test';
import { type WorkspaceView } from './workspaces';

/**
 * Mock layer for the i18n feature (`@orthacms/i18n-admin` + the content
 * library's slots). Self-contained: it stubs the content-schema, records-list,
 * and the four `/api/i18n/**` endpoints for one localized collection
 * (`localized_post`), so a spec only needs `mockSignedIn`, `mockWorkspaces`,
 * and `mockI18n`.
 *
 * The seed models two translation groups:
 * - **G1** — an `en` row (`lp-en-1`) and its `de` sibling (`lp-de-1`).
 * - **G2** — an `en`-only row (`lp-en-2`), missing `de`/`fr`.
 */

/** A workspace granted the localized collection. */
export const I18N_WORKSPACE: WorkspaceView = {
    id: 'ws_i18n',
    name: 'Localization demo',
    slug: 'localization-demo',
    description: 'Workspace used by the i18n e2e suite.',
    color: 'violet',
    status: 'active',
    members: [{ id: 'u_ada', name: 'Ada Lovelace', email: 'ada@orthacms.dev' }],
    content: ['localized_post']
};

/**
 * The configured locales (`en` default / `de` / `fr` / `ar`).
 *
 * `dir` is sent on every item, as the server does — it resolves direction from
 * the tag so no client has to guess. Arabic is in the set precisely because it
 * is the one that is **not** `ltr`: without an RTL locale nothing here would
 * ever catch a surface that hardcodes direction, and an RTL locale is
 * configurable with no extra setup.
 */
const LOCALES = [
    { slug: 'en', name: 'English', isDefault: true, dir: 'ltr' },
    { slug: 'de', name: 'Deutsch', isDefault: false, dir: 'ltr' },
    { slug: 'fr', name: 'Français', isDefault: false, dir: 'ltr' },
    { slug: 'ar', name: 'العربية', isDefault: false, dir: 'rtl' }
];

/** The localized collection's full field schema (i18n + a localized title). */
const LOCALIZED_SCHEMA = {
    name: 'localized_post',
    kind: 'collection' as const,
    label: 'Localized posts',
    publishable: true,
    i18n: true,
    fields: [
        {
            name: 'title',
            type: 'text',
            required: true,
            localized: true,
            validation: {},
            admin: { label: 'Title' }
        },
        {
            name: 'category',
            type: 'select',
            required: false,
            validation: {},
            options: ['news', 'guide'],
            admin: { label: 'Category' }
        },
        {
            // A single relation to an i18n target (self) — **mirrored**: the
            // stored id differs per locale (so the server serializes it
            // `localized` and the picker is scoped to the active locale, even
            // on a create form via the slot `params`), and picking a record
            // here links that record's own translation in every other locale.
            name: 'related',
            type: 'relation',
            required: false,
            localized: true,
            validation: {},
            relation: {
                to: 'localized_post',
                many: false,
                localeSync: 'mirrored' as const
            },
            admin: { label: 'Related post' }
        }
    ]
};

/** One seed row of the localized collection. */
interface LocalizedRow {
    id: string;
    status: 'draft' | 'published';
    /**
     * When the row last went live, `null` if never. Stamped on publish and
     * cleared only by unpublish — a `draft` that has one is the admin's
     * **Modified** state (live content with unpublished edits on top), which is
     * a different badge from a plain draft and so has to be modelled here.
     */
    publishedAt: string | null;
    locale: string;
    localeGroupId: string;
    createdAt: string;
    updatedAt: string;
    values: Record<string, unknown>;
}

const ISO = '2026-02-01T00:00:00.000Z';

/** What a publish stamps as `publishedAt` — later than {@link ISO}, so a row
 * that went live during a test is distinguishable from the seeded state. */
const PUBLISHED_AT = '2026-03-01T00:00:00.000Z';

/** The seed rows across the two translation groups. */
const ROWS: LocalizedRow[] = [
    {
        id: 'lp-en-1',
        status: 'published',
        publishedAt: ISO,
        locale: 'en',
        localeGroupId: 'G1',
        createdAt: ISO,
        updatedAt: ISO,
        values: { title: 'Winter boots', category: 'guide' }
    },
    {
        // Published once and edited since — `draft` **with** a `publishedAt`, so
        // this row reads **Modified**. That is the state the all-locales publish
        // is normally reached from: you save, then publish every language.
        id: 'lp-de-1',
        status: 'draft',
        publishedAt: ISO,
        locale: 'de',
        localeGroupId: 'G1',
        createdAt: ISO,
        updatedAt: ISO,
        values: { title: 'Winterstiefel', category: 'guide' }
    },
    {
        id: 'lp-en-2',
        status: 'draft',
        publishedAt: null,
        locale: 'en',
        localeGroupId: 'G2',
        createdAt: ISO,
        updatedAt: ISO,
        values: { title: 'Rain jacket', category: 'news' }
    }
];

/** One recorded content write (create/update/publish) for spy assertions. */
export interface EntryWrite {
    method: string;
    /** The request path (no origin/query), e.g. `/api/content/localized_post`. */
    path: string;
    /** Whether the path is a bare-collection create (`POST /api/content/:type`). */
    isCreate: boolean;
    body: { locale?: string; localeGroupId?: string; values?: unknown } | null;
}

/**
 * Record every content write the editor issues, so a spec can assert **which**
 * request a save produced — in particular that a create-after-locale-switch is a
 * POST to the collection (a new sibling), never a PATCH re-using the previously
 * created row's id. Registered on `page` before navigation; returns the growing
 * list. Reads/relations/schema GETs are ignored.
 */
export function spyEntryWrites(page: Page): EntryWrite[] {
    const writes: EntryWrite[] = [];
    page.on('request', (request) => {
        const method = request.method();
        if (method !== 'POST' && method !== 'PATCH' && method !== 'PUT') return;
        const path = new URL(request.url()).pathname;
        if (!/^\/api\/content\/[^/]+/.test(path)) return;
        let body: EntryWrite['body'] = null;
        try {
            body = request.postDataJSON();
        } catch {
            body = null;
        }
        writes.push({
            method,
            path,
            isCreate: method === 'POST' && /^\/api\/content\/[^/]+$/.test(path),
            body
        });
    });
    return writes;
}

/**
 * What {@link mockI18n} hands back — the hooks that need its **per-call** row
 * state, which is a closure and deliberately not module-level (see `seeded`).
 * Every existing caller ignores it.
 */
export type I18nMock = {
    /**
     * Re-register `GET /api/i18n/content/:type/:id/locales` so it is **held
     * open** until `release()`, then answers exactly as the healthy route
     * would — same rows, including any the test has created since.
     *
     * Playwright matches routes newest-first, so this wins over the healthy
     * stub installed by {@link mockI18n}. See {@link holdLocales} for why a
     * gate and not a `delayMs`.
     */
    holdEntryLocales: () => Promise<HeldRequest>;
};

/**
 * Register every route the i18n suite needs on `page`: the schema list + detail,
 * the locale-scoped records list, and the four `/api/i18n/**` endpoints.
 */
export async function mockI18n(page: Page): Promise<I18nMock> {
    // Rows created during the test (via POST). Kept in-memory so that after a
    // create the editor's canonical read (`/:type/:id`) and the locale panel
    // resolve the brand-new row — letting a spec exercise the full
    // create → switch locale → create-sibling flow, not just URL round-trips.
    const created: LocalizedRow[] = [];
    // A **per-call copy** of the seed. Routes mutate `status` (publish,
    // unpublish, publish-all), and `ROWS` is module-level — without the copy one
    // test's publish would be the next test's starting state, which is exactly
    // the cross-test bleed `page.route`'s per-page lifetime is supposed to
    // prevent.
    const seeded: LocalizedRow[] = ROWS.map((row) => ({ ...row }));
    const allRows = (): LocalizedRow[] => [...seeded, ...created];
    const liveGroupRows = (groupId: string): LocalizedRow[] =>
        allRows().filter((row) => row.localeGroupId === groupId);

    // GET /api/content-schema — the type catalogue (anchored off the detail route).
    await page.route(/\/api\/content-schema(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    name: LOCALIZED_SCHEMA.name,
                    kind: LOCALIZED_SCHEMA.kind,
                    label: LOCALIZED_SCHEMA.label,
                    publishable: true,
                    i18n: true
                }
            ])
        });
    });

    // GET /api/content-schema/:name — the full field schema.
    await page.route(/\/api\/content-schema\/([^/?]+)/, async (route) => {
        const name = decodeURIComponent(
            new URL(route.request().url()).pathname.split('/').pop() ?? ''
        );
        await route.fulfill({
            status: name === LOCALIZED_SCHEMA.name ? 200 : 404,
            contentType: 'application/json',
            body: JSON.stringify(
                name === LOCALIZED_SCHEMA.name
                    ? LOCALIZED_SCHEMA
                    : { message: 'Not found' }
            )
        });
    });

    // /api/content/:name — GET is the strict locale-scoped list (default `en`);
    // POST creates a record. A create with a `localeGroupId` is a **sibling**
    // translation (the consolidated endpoint that replaced /translations); the
    // new row echoes the sent values in the target locale as a fresh draft.
    await page.route(/\/api\/content\/([^/?]+)(\?.*)?$/, async (route) => {
        if (route.request().method() === 'POST') {
            const body = route.request().postDataJSON() as {
                values: Record<string, unknown>;
                locale?: string;
                localeGroupId?: string;
            };
            const locale = body.locale ?? 'en';
            const row: LocalizedRow = {
                id: `lp-${locale}-new`,
                status: 'draft',
                publishedAt: null,
                locale,
                // A create without a group id starts a fresh translation group;
                // a sibling create carries the source row's group forward.
                localeGroupId: body.localeGroupId ?? 'G-new',
                createdAt: ISO,
                updatedAt: ISO,
                values: body.values
            };
            created.push(row);
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify(row)
            });
            return;
        }
        const url = new URL(route.request().url());
        const locale = url.searchParams.get('locale') ?? 'en';
        const items = seeded.filter((row) => row.locale === locale);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                items,
                total: items.length,
                page: 1,
                pageSize: 10
            })
        });
    });

    // GET /api/content/:name/:id — read one entry (the editor's canonical read).
    // Registered after the list route so this two-segment pattern is matched
    // first for a `/:type/:id` URL (Playwright tries the newest route first).
    await page.route(
        /\/api\/content\/[^/]+\/([^/?]+)(\?.*)?$/,
        async (route) => {
            const method = route.request().method();
            const segments = new URL(route.request().url()).pathname
                .split('?')[0]
                .split('/');
            const id = segments[segments.length - 1];
            const row = allRows().find((candidate) => candidate.id === id);
            if (method === 'GET') {
                await route.fulfill({
                    status: row ? 200 : 404,
                    contentType: 'application/json',
                    body: JSON.stringify(row ?? { message: 'Not found' })
                });
                return;
            }
            // PATCH updates an existing row **in its own locale** — it never
            // re-homes the row to another locale (the server's update endpoint
            // ignores locale/localeGroupId). Modelled so a regressed create (a
            // stale id turning a sibling-create into a same-row PATCH) resolves
            // instead of hitting the network, and the spec's method assertion is
            // what fails.
            if (method === 'PATCH') {
                const body = route.request().postDataJSON() as {
                    values?: Record<string, unknown>;
                };
                if (row) row.values = { ...row.values, ...(body.values ?? {}) };
                await route.fulfill({
                    status: row ? 200 : 404,
                    contentType: 'application/json',
                    body: JSON.stringify(row ?? { message: 'Not found' })
                });
                return;
            }
            await route.fallback();
        }
    );

    // POST /api/content/:name/:id/publish — marks the row published (the
    // publish step chained after a save when the intent is publish).
    await page.route(
        /\/api\/content\/[^/]+\/([^/?]+)\/publish$/,
        async (route) => {
            const segments = new URL(route.request().url()).pathname.split('/');
            const id = segments[segments.length - 2];
            const row = allRows().find((candidate) => candidate.id === id);
            if (row) {
                row.status = 'published';
                row.publishedAt = PUBLISHED_AT;
            }
            await route.fulfill({
                status: row ? 200 : 404,
                contentType: 'application/json',
                body: JSON.stringify(row ?? { message: 'Not found' })
            });
        }
    );

    // POST /api/content/:name/bulk/... — the endpoints the editor's "all
    // locales" actions drive. Verdicts are derived from the seeded rows, so a
    // spec can assert that an already-live locale reads *already published*
    // while its draft sibling reads *will publish*. Registered before the
    // narrower two-segment routes below, which can't match a bulk path anyway.
    await page.route(
        /\/api\/content\/[^/]+\/bulk\/([^/]+)(\/preview)?$/,
        async (route) => {
            const parts = new URL(route.request().url()).pathname.split('/');
            const preview = parts[parts.length - 1] === 'preview';
            const action = preview
                ? parts[parts.length - 2]
                : parts[parts.length - 1];
            const { ids = [] } = (route.request().postDataJSON() ?? {}) as {
                ids?: string[];
            };
            const rows = ids
                .map((id) => allRows().find((row) => row.id === id))
                .filter((row): row is LocalizedRow => !!row);

            if (action === 'publish' && preview) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        items: rows.map((row) => ({
                            id: row.id,
                            title: String(row.values.title ?? row.id),
                            status: row.status,
                            verdict:
                                row.status === 'published'
                                    ? 'already-published'
                                    : 'publishable',
                            issues: [],
                            // The per-field publish-gate checklist each row
                            // expands to. Required by the verdict contract —
                            // omitting it is what the dialog reads `.length` of.
                            checks: [
                                { field: 'title', label: 'Title', ok: true }
                            ]
                        }))
                    })
                });
            }
            if (action === 'publish') {
                const published = rows.filter(
                    (row) => row.status !== 'published'
                );
                for (const row of published) {
                    row.status = 'published';
                    row.publishedAt = PUBLISHED_AT;
                }
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        published: published.map((row) => row.id),
                        skipped: []
                    })
                });
            }
            // unpublish — the one thing that clears `publishedAt`, so the row
            // goes back to a plain **Draft** rather than **Modified**.
            for (const row of rows) {
                row.status = 'draft';
                row.publishedAt = null;
            }
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ count: rows.length })
            });
        }
    );

    // GET /api/content/:name/:id/relations — the editor's relations read (this
    // type has none, but the editor still fires it when the tab opens).
    await page.route(
        /\/api\/content\/[^/]+\/[^/]+\/relations$/,
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ relations: {} })
            });
        }
    );

    // GET /api/content/:name/:id/{revisions,media} — the editor's other
    // per-entry reads. This suite asserts nothing about either, but they must
    // still be **answered**: every entry write refreshes them along with the
    // record (`refreshEntryCaches`) and awaits the refetch, so leaving them to
    // fall through to a dead dev-server proxy makes a save or a publish wait out
    // TanStack Query's retry backoff before it reports done.
    await page.route(
        /\/api\/content\/[^/]+\/[^/]+\/revisions(\?.*)?$/,
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ items: [], total: 0 })
            });
        }
    );
    await page.route(
        /\/api\/content\/[^/]+\/[^/]+\/media(\?.*)?$/,
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ media: {} })
            });
        }
    );

    // GET /api/i18n/locales — the configured locales.
    await page.route(/\/api\/i18n\/locales$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: LOCALES })
        });
    });

    // POST /api/i18n/content/:type/locale-summary — batched group members.
    await page.route(
        /\/api\/i18n\/content\/[^/]+\/locale-summary$/,
        async (route) => {
            const body = route.request().postDataJSON() as {
                groupIds: string[];
            };
            const groups: Record<
                string,
                {
                    locale: string;
                    entryId: string;
                    status: string;
                    publishedAt: string | null;
                }[]
            > = {};
            for (const groupId of body.groupIds) {
                groups[groupId] = liveGroupRows(groupId).map((row) => ({
                    locale: row.locale,
                    entryId: row.id,
                    status: row.status,
                    publishedAt: row.publishedAt
                }));
            }
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({ groups })
            });
        }
    );

    // One item per **configured** locale, each carrying the group's row in it
    // or `null`. Shared by the healthy route and the held one, so a test that
    // proves the pending state still lands on the response the real route
    // would have given.
    const entryLocalesBody = (url: string): string => {
        const segments = new URL(url).pathname.split('/');
        const id = segments[segments.length - 2];
        const row = allRows().find((candidate) => candidate.id === id);
        const groupId = row?.localeGroupId ?? 'G1';
        const members = liveGroupRows(groupId);
        return JSON.stringify({
            localeGroupId: groupId,
            items: LOCALES.map((locale) => {
                const member = members.find(
                    (candidate) => candidate.locale === locale.slug
                );
                return {
                    locale: locale.slug,
                    dir: locale.dir,
                    isDefault: locale.isDefault,
                    entry: member
                        ? {
                              id: member.id,
                              status: member.status,
                              publishedAt: member.publishedAt,
                              updatedAt: member.updatedAt
                          }
                        : null
                };
            })
        });
    };

    // GET /api/i18n/content/:type/:id/locales — one entry's locale panel.
    await page.route(
        /\/api\/i18n\/content\/[^/]+\/([^/]+)\/locales$/,
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: entryLocalesBody(route.request().url())
            });
        }
    );
    // Sibling creation is handled by the POST branch of the /api/content/:name
    // route above (POST + localeGroupId), so there is no i18n write route.

    return {
        holdEntryLocales: async () => {
            let open!: () => void;
            const gate = new Promise<void>((resolve) => {
                open = resolve;
            });
            await page.route(
                /\/api\/i18n\/content\/[^/]+\/[^/]+\/locales$/,
                async (route) => {
                    await gate;
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: entryLocalesBody(route.request().url())
                    });
                }
            );
            return { release: () => open() };
        }
    };
}

/** A held route, and the way to let it answer. */
export type HeldRequest = {
    /** Let the held request complete with its normal, healthy response. */
    release: () => void;
};

/**
 * Hold `GET /api/i18n/locales` open until the returned `release()` is called,
 * then answer it normally. Register **after** {@link mockI18n}.
 *
 * **Pending is a third state**, and the only way to assert how a surface
 * renders it is to stop the request settling. A `delayMs` cannot do that
 * reliably — the assertion races the timer — so the test holds the door and
 * opens it itself, which also lets the same case prove the surface *recovers*
 * rather than only that it waits.
 */
export async function holdLocales(page: Page): Promise<HeldRequest> {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
        open = resolve;
    });
    await page.route(/\/api\/i18n\/locales$/, async (route) => {
        await gate;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: LOCALES })
        });
    });
    return { release: () => open() };
}

/**
 * Fail `GET /api/i18n/locales`.
 *
 * Register **after** {@link mockI18n} — Playwright matches routes newest-first,
 * so this wins over the healthy stub. Every localization affordance is gated on
 * the locale list, so this is the mock that answers "what does the plugin look
 * like when its one piece of configuration can't be read".
 */
export async function failLocales(page: Page): Promise<void> {
    await page.route(/\/api\/i18n\/locales$/, async (route) => {
        await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Locale registry unavailable' })
        });
    });
}

/**
 * Fail `GET /api/i18n/content/:type/:id/locales` — the entry editor's locale
 * panel. Register after {@link mockI18n}.
 */
export async function failEntryLocales(page: Page): Promise<void> {
    await page.route(
        /\/api\/i18n\/content\/[^/]+\/[^/]+\/locales$/,
        async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Group read failed' })
            });
        }
    );
}

/**
 * Fail `POST …/locale-summary` — the Locales column's per-page batch.
 * Register after {@link mockI18n}.
 */
export async function failLocaleSummaries(page: Page): Promise<void> {
    await page.route(
        /\/api\/i18n\/content\/[^/]+\/locale-summary$/,
        async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Summary batch failed' })
            });
        }
    );
}

/**
 * Count `POST …/locale-summary` calls.
 *
 * The Locales column is off by default, so "how many batches did this page
 * issue" is the only way to see whether a hidden column is still fetching —
 * nothing renders either way, which is exactly why it went unnoticed.
 */
export function spyLocaleSummaries(page: Page): { count: number } {
    const spy = { count: 0 };
    page.on('request', (request) => {
        if (
            request.method() === 'POST' &&
            /\/api\/i18n\/content\/[^/]+\/locale-summary$/.test(
                new URL(request.url()).pathname
            )
        ) {
            spy.count += 1;
        }
    });
    return spy;
}
