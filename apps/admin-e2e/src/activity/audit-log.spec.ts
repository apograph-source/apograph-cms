import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    ALL_KINDS_ACTIVITY,
    DEFAULT_ACTIVITY,
    mockActivity
} from '../support/api/activity';
import { expectNoA11yViolations } from '../support/a11y';

/**
 * The Activity Log page (`/activity`, `@orthacms/activity-admin`): rendering
 * the audit trail, expandable rows revealing details, the filter toolbar
 * driving the `/api/activity` mock, the "System" actor rendering, and the
 * `activity:read` gate (no nav entry, a no-access state for users who lack it).
 * The backend is the `GET /api/activity` mock; `mockSignedIn` satisfies the
 * shell's auth probe.
 */
test.describe('Activity Log page', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockActivity(page);
    });

    test('renders the audit trail with actors and actions', async ({
        activityLogPage
    }) => {
        await activityLogPage.goto();
        await expect(activityLogPage.heading).toBeVisible();
        // The gated shell wrapped the page.
        await expect(activityLogPage.nav).toBeVisible();
        await expect(activityLogPage.table).toBeVisible();

        await expect(activityLogPage.row('Changed role')).toBeVisible();
        // An actor email shows in its row.
        await expect(
            activityLogPage.row('ada@ortha.dev').first()
        ).toBeVisible();
    });

    test('renders a system-initiated event with a "System" actor', async ({
        activityLogPage
    }) => {
        await activityLogPage.goto();
        await expect(
            activityLogPage.row('Invited member').filter({ hasText: 'System' })
        ).toBeVisible();
    });

    test('expands a row to reveal its details, then collapses it', async ({
        activityLogPage,
        page
    }) => {
        await activityLogPage.goto();
        const detail = page.getByText('viewer → contributor');

        // Collapsed by default — the detail panel isn't visible.
        await expect(detail).toBeHidden();

        await activityLogPage.expandRow('Changed role');
        await expect(detail).toBeVisible();
        await expect(
            activityLogPage.expandToggle('Changed role')
        ).toHaveAttribute('aria-expanded', 'true');

        // Toggling again collapses it: the disclosure reports collapsed and the
        // panel is marked inert. (The detail text keeps a clipped layout box
        // after the grid-rows close animation, so assert the semantic collapsed
        // state rather than the text node's geometric visibility.)
        await activityLogPage.expandRow('Changed role');
        await expect(
            activityLogPage.expandToggle('Changed role')
        ).toHaveAttribute('aria-expanded', 'false');
    });

    test('expands a row by clicking anywhere on the row body', async ({
        activityLogPage,
        page
    }) => {
        await activityLogPage.goto();
        const detail = page.getByText('viewer → contributor');
        await expect(detail).toBeHidden();

        await activityLogPage.clickRowBody('Changed role');
        await expect(detail).toBeVisible();
    });

    test('the actor-email search drives the request', async ({
        activityLogPage
    }) => {
        await activityLogPage.goto();
        await activityLogPage.emailSearch.fill('grace');

        // Only Grace's suspension event matches the actor-email filter.
        await expect(
            activityLogPage.row('grace@ortha.dev').first()
        ).toBeVisible();
        await expect(activityLogPage.row('ada@ortha.dev')).toHaveCount(0);
    });

    test('deep-links the active search into the URL [activity:I-30]', async ({
        activityLogPage,
        page
    }) => {
        await activityLogPage.goto();
        await activityLogPage.emailSearch.fill('grace');

        await expect(page).toHaveURL(/actorEmail=grace/);
    });

    test('shows an empty state when filters match nothing', async ({
        activityLogPage
    }) => {
        await activityLogPage.goto();
        await activityLogPage.emailSearch.fill('nobody-xyz');

        await expect(
            activityLogPage.emptyText('No activity matches')
        ).toBeVisible();
    });

    /**
     * The gate, asserted where it is actually made rather than where it shows.
     *
     * The DOM half of this — a no-access screen, no nav entry — was already
     * here, and it is the half that cannot fail for the right reason: the page
     * returns `ActivityNoAccess` from an early `return`, so the screen looks
     * identical whether or not the query underneath it was enabled. An
     * unconditional `useActivityLog(params, true)` would still render exactly
     * this, having asked the server for an audit log the caller may not read
     * and taken whatever it answered. What separates the two is the request,
     * so the request is what this counts.
     */
    test('makes no request at all without activity:read [activity:I-28]', async ({
        activityLogPage,
        page
    }) => {
        await mockSignedIn(page, {
            permissions: ['workspaces:read', 'users:read']
        });

        const asked: string[] = [];
        page.on('request', (request) => {
            if (new URL(request.url()).pathname.startsWith('/api/activity')) {
                asked.push(request.url());
            }
        });

        await activityLogPage.goto();

        await expect(activityLogPage.noAccessText()).toBeVisible();
        // The permission-gated nav entry is hidden.
        await expect(activityLogPage.navButton).toHaveCount(0);

        // A wall-clock settle, because the assertion is an **absence**: there
        // is no event to wait for when the correct behaviour is that nothing
        // happens. React Query fires an enabled query during the mount commit,
        // so half a second after the no-access screen is on the page is long
        // past the moment a leak would have shown. `no-wait-for-timeout` is a
        // warning here rather than an error for exactly this shape.
        await page.waitForTimeout(500);
        expect(asked).toEqual([]);
    });
});

/**
 * The home dashboard's half of the same gate: `RecentActivityPanel` returns
 * `null` for a caller without `activity:read`, and — the part that needs a
 * browser to see — asks for nothing on the way there.
 *
 * Separate from the page above because the failure is different in kind. The
 * page has somewhere to put a refusal; the panel does not. A panel that
 * rendered an empty card, or a spinner that never resolves, on every viewer's
 * dashboard is the visible symptom; a panel that quietly requests an audit log
 * the viewer cannot read is the one nobody would notice.
 */
test.describe('Recent activity panel — without activity:read', () => {
    test('renders nothing and asks for nothing [activity:I-28]', async ({
        homePage,
        page
    }) => {
        await mockSignedIn(page, {
            permissions: ['workspaces:read', 'users:read']
        });
        await mockWorkspaces(page);
        await mockActivity(page);

        const asked: string[] = [];
        page.on('request', (request) => {
            if (new URL(request.url()).pathname.startsWith('/api/activity')) {
                asked.push(request.url());
            }
        });

        await homePage.goto();

        // The dashboard itself rendered — the sibling panel from
        // `workspaces-admin` is there — so the activity panel's absence is a
        // decision it made and not a page that failed to draw.
        await expect(homePage.workspacesPanel).toBeVisible();
        await expect(homePage.activityPanel).toHaveCount(0);

        // Same settle, same reason as the page above.
        await page.waitForTimeout(500);
        expect(asked).toEqual([]);
    });
});

/**
 * The Activity Log's resilience to values it does not control: a hand-edited
 * URL param the server would reject, and a timestamp the API should never send.
 * Both are read-only surfaces, so neither can be reached by using the app —
 * which is exactly why neither was covered.
 */
test.describe('Activity Log resilience', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
    });

    /**
     * Where the page number is allowed to be, and it is a two-sided rule.
     *
     * Narrowing a filter must not strand somebody on an empty page past the
     * end — but the same correction, run a moment too early, would throw away
     * a deep-linked `?page=N` before the first response has said how many
     * pages there are. The guard is that the clamp runs only once real data
     * has arrived; both halves are asserted here because a fix for either one
     * alone reintroduces the other.
     */
    test.describe('the page number after the result set changes', () => {
        /** Enough events that a page size of 25 leaves more than one page. */
        const MANY = Array.from({ length: 60 }, (_, index) => ({
            id: `ev_many_${index}`,
            kind: 'user.signed_in',
            subjectType: 'user',
            subjectId: 'u_ada',
            actorId: 'u_ada',
            // One event in the set belongs to somebody else, so a search for
            // them narrows sixty results down to a single page.
            actorEmail: index === 0 ? 'grace@ortha.dev' : 'ada@ortha.dev',
            meta: null,
            at: '2026-06-10T09:00:00.000Z'
        }));

        test('comes back to the last page when a filter leaves fewer [activity:I-29]', async ({
            page,
            activityLogPage
        }) => {
            await mockActivity(page, MANY);
            await activityLogPage.gotoWith('page=3');
            await expect(activityLogPage.table).toBeVisible();

            // Sixty events narrow to one. Page three no longer exists.
            await activityLogPage.emailSearch.fill('grace');

            await expect(
                activityLogPage.row('grace@ortha.dev').first()
            ).toBeVisible();
            // The address is corrected too — a URL that says page three while
            // showing page one is a link that reopens wrong.
            await expect(page).toHaveURL(
                (url) => !url.searchParams.has('page')
            );
        });

        test('keeps a deep-linked page instead of resetting it on arrival [activity:I-29]', async ({
            page,
            activityLogPage
        }) => {
            // The other half: before the first response `total` is 0 and the
            // page count reads as 1, so an unguarded correction would send a
            // shared link to page one every time.
            await mockActivity(page, MANY, { delayMs: 150 });
            await activityLogPage.gotoWith('page=3');

            await expect(activityLogPage.table).toBeVisible();
            await expect(page).toHaveURL(/page=3/);
        });
    });

    test('an over-large ?pageSize is clamped instead of 400ing into a dead end [activity:I-18]', async ({
        activityLogPage,
        page
    }) => {
        // `mockActivity` refuses a `pageSize` above 100 with a 400, the way the
        // DTO's `@Max` makes the real API refuse it. That refusal is the whole
        // test: while the mock echoed any page size back with a 200, an
        // unclamped request rendered a table identical to a clamped one and this
        // case passed with the clamp deleted.
        //
        // More than 100 events, so the clamped page is a full one — that is what
        // separates a ceiling at the largest size the server serves from a
        // retreat to the default 25, which would also dodge the 400.
        const OVER_A_PAGE = Array.from({ length: 120 }, (_, index) => ({
            id: `ev_over_${index}`,
            kind: 'user.signed_in',
            subjectType: 'user',
            subjectId: 'u_ada',
            actorId: 'u_ada',
            actorEmail: 'ada@ortha.dev',
            meta: null,
            at: '2026-06-10T09:00:00.000Z'
        }));
        await mockActivity(page, OVER_A_PAGE);
        await activityLogPage.gotoWith('pageSize=1000');

        // A 400 here is unrecoverable: the rows-per-page Select is the only
        // control that could fix it, and it lives inside the data branch that a
        // failed query never renders — so Retry re-issued the same doomed
        // request forever and the only way out was hand-editing the URL again.
        // (A 4xx skips the query client's retry, so the error state, if it came,
        // would be on screen at once rather than seven seconds later.)
        await expect(activityLogPage.table).toBeVisible();
        await expect(activityLogPage.errorAlert()).toHaveCount(0);
        await expect(page.getByText('Rows per page')).toBeVisible();

        // And the clamp is a ceiling, not a reset to the default: the request
        // that succeeded asked for the largest page the server will serve. The
        // URL is left alone — the clamp happens on the way out, not by rewriting
        // what the reader typed.
        await expect(page).toHaveURL(/pageSize=1000/);
        await expect(activityLogPage.resultsStatus()).toContainText(
            'Showing 1–100'
        );
    });

    test('a malformed timestamp does not take the whole app down', async ({
        homePage,
        page
    }) => {
        await mockWorkspaces(page);
        await mockActivity(page, [
            { ...DEFAULT_ACTIVITY[0], id: 'ev_bad', at: 'not-a-date' }
        ]);
        await homePage.goto();

        // `new Date('not-a-date')` is an Invalid Date, and `toISOString()`
        // *throws* on one. The home panel called it unguarded to fill its
        // `<time datetime>`, so a single bad row threw inside render and — with
        // no error boundary above the home slots — React unmounted the entire
        // tree to a blank page. The rest of the dashboard must survive it.
        await expect(homePage.heading).toBeVisible();
        await expect(homePage.activityPanel).toBeVisible();
        await expect(homePage.workspacesPanel).toBeVisible();
    });
});

/**
 * Accessibility scans (axe, WCAG 2.1 A/AA) of the Activity Log and its states.
 * A regression guard, not a conformance claim.
 */
test.describe('Activity Log accessibility (axe, WCAG 2.1 A/AA)', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockActivity(page);
    });

    test('table — initial', async ({ activityLogPage, makeAxe }) => {
        await activityLogPage.goto();
        await activityLogPage.heading.waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('table — expanded row', async ({ activityLogPage, makeAxe, page }) => {
        await activityLogPage.goto();
        await activityLogPage.expandRow('Changed role');
        await page.getByText('viewer → contributor').waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('table — loading skeleton', async ({
        activityLogPage,
        page,
        makeAxe
    }) => {
        await mockActivity(page, undefined, { delayMs: 30_000 });
        await activityLogPage.goto();
        await activityLogPage.tableSkeleton().waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('empty state — no matches', async ({ activityLogPage, makeAxe }) => {
        await activityLogPage.goto();
        await activityLogPage.emailSearch.fill('nobody-xyz');
        await activityLogPage.emptyText('No activity matches').waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('no-access state', async ({ activityLogPage, makeAxe, page }) => {
        await mockSignedIn(page, { permissions: [] });
        await activityLogPage.goto();
        await activityLogPage.noAccessText().waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    // The theme defaults to `system`, so emulating the OS preference flips the
    // whole page without touching app internals. Every other axe scan in the
    // repo runs in whatever theme the browser happens to default to, which
    // leaves the dark palette — muted-on-muted at 11–12 px, plus a 30%-alpha
    // fill under the detail panel — completely unscanned.
    test('table — dark theme', async ({ activityLogPage, makeAxe, page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await activityLogPage.goto();
        await activityLogPage.heading.waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('table — dark theme, expanded row', async ({
        activityLogPage,
        makeAxe,
        page
    }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await activityLogPage.goto();
        await activityLogPage.expandRow('Changed role');
        await page.getByText('viewer → contributor').waitFor();
        await expectNoA11yViolations(makeAxe());
    });
});

/**
 * The Activity Log's assistive-technology semantics — the parts axe cannot see
 * because they are about what changes, and what a table's shape *means*.
 */
test.describe('Activity Log assistive-technology semantics', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
    });

    test('a collapsed row contributes one table row, not two [activity:I-27]', async ({
        activityLogPage,
        page
    }) => {
        await mockActivity(page);
        await activityLogPage.goto();
        await expect(activityLogPage.table).toBeVisible();

        // Every event renders a data row *and* a detail row so the disclosure
        // can animate. `inert` used to sit on the inner <dl> only, leaving the
        // empty <tr> a structural row: a 25-event page announced as 50 rows,
        // with a blank row between every pair of events. The detail <tr> is now
        // aria-hidden while collapsed, and `getByRole('row')` reads the same
        // accessibility tree a screen reader does.
        const header = 1;
        await expect(activityLogPage.table.getByRole('row')).toHaveCount(
            DEFAULT_ACTIVITY.length + header
        );

        // Expanding one adds exactly one row back.
        await activityLogPage.expandRow('Changed role');
        await expect(activityLogPage.table.getByRole('row')).toHaveCount(
            DEFAULT_ACTIVITY.length + header + 1
        );
    });

    test('the When cell carries a machine-readable instant', async ({
        activityLogPage,
        page
    }) => {
        await mockActivity(page);
        await activityLogPage.goto();

        // The home panel always did this; the table's When cell was a bare
        // formatted string, so the exact instant was unavailable to AT,
        // translation tools and user scripts.
        const when = activityLogPage
            .row('Changed role')
            .locator('time')
            .first();
        await expect(when).toHaveAttribute('datetime', DEFAULT_ACTIVITY[1].at);
        await expect(when).toContainText('Jun');
    });

    test('paging changes the live region, so the turnover is announced', async ({
        activityLogPage,
        page
    }) => {
        // The whole kind catalogue over a 25-row page: two pages, and every
        // row changes. The last row's index is derived from the fixture rather
        // than written out — the catalogue grows every time the server learns a
        // new audit kind, and this assertion is about the *announcement*, not
        // about how many kinds there happen to be today.
        await mockActivity(page, ALL_KINDS_ACTIVITY);
        await activityLogPage.goto();

        const status = activityLogPage.resultsStatus();
        // Both the page *count* and the last row's index come from the fixture.
        // The count used to be written out as "2" and went stale the moment the
        // catalogue grew past 50 kinds — which is the very thing the fixture is
        // derived from, so a literal here contradicts the reason it is derived.
        const PAGE_SIZE = 25;
        const pages = Math.ceil(ALL_KINDS_ACTIVITY.length / PAGE_SIZE);
        expect(pages).toBeGreaterThan(1);

        // The region used to carry only the total — which is invariant across
        // pages — so Next page replaced all 25 rows and the announced text did
        // not change at all. The "page N of M" span carries no live region, so a
        // screen-reader user got silence.
        await expect(status).toContainText(`page 1 of ${pages}`);
        await expect(status).toContainText(`1–${PAGE_SIZE}`);

        for (let step = 1; step < pages; step += 1) {
            await activityLogPage.pageButton('Next page').click();
            await expect(status).toContainText(`page ${step + 1} of ${pages}`);
        }
        await expect(status).toContainText(
            `${(pages - 1) * PAGE_SIZE + 1}–${ALL_KINDS_ACTIVITY.length}`
        );
    });
});

/**
 * Keyboard operability for the Activity Log — what axe can't assert: the
 * filters take focus and filter as you type, and a row expands from the
 * keyboard.
 */
test.describe('Activity Log keyboard operability', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockActivity(page);
    });

    test('the actor-email search filters as you type', async ({
        activityLogPage
    }) => {
        await activityLogPage.goto();
        await activityLogPage.emailSearch.focus();
        await activityLogPage.emailSearch.pressSequentially('grace');

        await expect(
            activityLogPage.row('grace@ortha.dev').first()
        ).toBeVisible();
        await expect(activityLogPage.row('ada@ortha.dev')).toHaveCount(0);
    });

    test('a row expands from the keyboard', async ({
        activityLogPage,
        page
    }) => {
        await activityLogPage.goto();
        await activityLogPage.expandToggle('Changed role').focus();
        await page.keyboard.press('Enter');
        await expect(page.getByText('viewer → contributor')).toBeVisible();
    });

    test('"Clear filters" hands focus back instead of dropping it on the body', async ({
        activityLogPage
    }) => {
        await activityLogPage.goto();
        await activityLogPage.emailSearch.fill('nobody-xyz');
        await activityLogPage.emptyText('No activity matches').waitFor();

        // Clearing makes the query return rows, so the empty state — and with
        // it the button just activated — unmounts. React does not move focus
        // when that happens: it fell to <body> and the next Tab restarted from
        // the top of the document, stranding a keyboard user with no idea where
        // they were. The page already restores focus correctly when the filter
        // panel closes; this is the same concept, twelve lines away.
        await activityLogPage.clearFilters().focus();
        await activityLogPage.clearFilters().press('Enter');

        await expect(activityLogPage.table).toBeVisible();
        await expect(activityLogPage.emailSearch).toBeFocused();
    });
});
