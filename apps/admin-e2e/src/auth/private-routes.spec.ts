import { type Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import {
    mockAuthProbeOffline,
    mockAuthProbeUnavailable,
    mockLogin,
    mockSignedIn,
    mockSignedOut,
    mockUnauthorized
} from '../support/api/auth';
import { mockMembers } from '../support/api/members';

const EMAIL = 'admin@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * The auth gate (`RequireAuth` from `identity-admin`, composed into the shell's
 * layout). Every non-public
 * route lives behind it: a signed-out user is redirected to the sign-in page —
 * including via the catch-all, which now sits inside the guarded group — and
 * after signing in they land back on the private area. Signed-in rendering of
 * specific pages is covered in `routing.spec.ts`.
 */
test.describe('Private route gating', () => {
    test('redirects a signed-out user from / to the sign-in page [bootstrap:I-25] [shell:I-02]', async ({
        page,
        loginPage
    }) => {
        await mockSignedOut(page);
        await page.goto('/');

        await expect(page).toHaveURL(/\/identity\/signin$/);
        await expect(loginPage.heading).toBeVisible();
    });

    test('redirects a signed-out user from an unknown path to the sign-in page', async ({
        page,
        loginPage
    }) => {
        await mockSignedOut(page);
        await page.goto('/this-route-does-not-exist');

        await expect(page).toHaveURL(/\/identity\/signin$/);
        await expect(loginPage.heading).toBeVisible();
    });

    test('returns to the home page after a gated user signs in', async ({
        page,
        loginPage,
        homePage
    }) => {
        await mockSignedOut(page);
        await page.goto('/');
        await expect(page).toHaveURL(/\/identity\/signin$/);

        // The session is now valid; signing in should send the user back in.
        await mockLogin(page, { status: 201 });
        await mockSignedIn(page);
        await loginPage.login(EMAIL, PASSWORD);

        await expect(page).toHaveURL('/');
        await expect(homePage.heading).toBeVisible();
        await expect(homePage.nav).toBeVisible();
    });
});

/**
 * The gate's third answer. `GET /api/auth/me` failing is not the same as it
 * saying "nobody": the session cookie can be perfectly valid and the endpoint
 * simply down. Redirecting on that reports an outage as a sign-out, and sends
 * the user to a form that posts to the same dead API.
 */
test.describe('Auth probe unavailable', () => {
    test('says the server is unreachable instead of signing the user out [identity:I-28]', async ({
        page,
        homePage,
        loginPage
    }) => {
        await mockAuthProbeUnavailable(page);
        await homePage.goto();

        await expect(homePage.authUnavailableHeading()).toBeVisible();
        await expect(page).toHaveURL('/');
        await expect(loginPage.heading).toHaveCount(0);
    });

    test('recovers when the API comes back', async ({ page, homePage }) => {
        await mockAuthProbeUnavailable(page);
        await homePage.goto();
        await expect(homePage.authUnavailableHeading()).toBeVisible();

        // The API recovers (later routes win) and the same session resolves.
        await mockSignedIn(page);
        await homePage.retryAuthProbe().click();

        await expect(homePage.nav).toBeVisible();
        await expect(homePage.heading).toBeVisible();
    });
});

/**
 * The same answer, reached the other way. A `500` is a response; a dropped
 * connection is not, and it arrives with **no status at all** — which is the
 * shape that gets mishandled, because a check written as `status === 401` and a
 * check written as `status !== 200` disagree about `undefined`. Guessing either
 * way is wrong: a request that never arrived says nothing about whether the
 * session behind it is still valid.
 */
test.describe('Auth probe unreachable', () => {
    test('reports an outage rather than signing the visitor out', async ({
        page,
        homePage,
        loginPage
    }) => {
        await mockAuthProbeOffline(page);
        await homePage.goto();

        await expect(homePage.authUnavailableHeading()).toBeVisible();
        await expect(page).toHaveURL('/');
        await expect(loginPage.heading).toHaveCount(0);
    });

    test('recovers when the connection comes back', async ({
        page,
        homePage
    }) => {
        await mockAuthProbeOffline(page);
        await homePage.goto();
        await expect(homePage.authUnavailableHeading()).toBeVisible();

        await mockSignedIn(page);
        await homePage.retryAuthProbe().click();

        await expect(homePage.nav).toBeVisible();
        await expect(homePage.heading).toBeVisible();
    });

    test('holds the loader while the request hangs, then reports the outage', async ({
        page,
        homePage,
        loginPage
    }) => {
        // What a timeout actually looks like: nothing for a while, then a
        // failure with no response. The gate has to stay in `loading` for the
        // whole wait — showing the outage screen early would be a guess — and
        // must never resolve the wait into a sign-out.
        await mockAuthProbeOffline(page, { delayMs: 1_500 });
        await homePage.goto();

        await expect(homePage.rootLoader()).toBeVisible();
        await expect(loginPage.heading).toHaveCount(0);

        await expect(homePage.authUnavailableHeading()).toBeVisible({
            timeout: 15_000
        });
        await expect(page).toHaveURL('/');
        await expect(loginPage.heading).toHaveCount(0);
    });
});

/**
 * A tab left open over lunch.
 *
 * The session behind it can be revoked from another device, expire, or have its
 * account suspended, and nothing tells the tab: it holds a cached user and will
 * keep rendering the app until it asks again. `useCurrentUser` therefore
 * re-checks **on window focus** — coming back to the tab is exactly the moment
 * the answer matters and the moment a stale one becomes visible.
 *
 * The two tests below are the two halves of getting that right, and they pull
 * in opposite directions: the check has to happen without being asked, and it
 * has to be invisible while it runs. A probe that flashed the boot loader on
 * every tab switch would be worse than not re-checking at all.
 *
 * **Why the clock is moved.** `staleTime` is 60 s, so a query that resolved
 * moments ago is fresh and a focus event is deliberately ignored — that bound
 * is what stops a probe per alt-tab. `setFixedTime` moves the page's clock past
 * it (and, unlike `install`, leaves timers running), which is what a tab that
 * really has been idle looks like.
 */
test.describe('Session lost while the tab sat idle', () => {
    /**
     * Return to the tab, on a clock that says the query has gone stale.
     *
     * The event is `visibilitychange` on `window` because that is the only one
     * TanStack Query's focus manager listens to — it dropped the `focus`
     * listener in v5, so dispatching that instead would silently do nothing and
     * the test would pass by never having probed.
     */
    async function returnToTab(page: Page): Promise<void> {
        const loadedAt = await page.evaluate(() => Date.now());
        await page.clock.setFixedTime(loadedAt + 5 * 60_000);
        await page.evaluate(() => {
            // Typed inline through `globalThis`: this project's tsconfig ships
            // no DOM lib, the same reason `reflow.spec.ts` casts for
            // `documentElement`.
            const browser = globalThis as unknown as {
                window: { dispatchEvent(event: unknown): void };
                Event: new (type: string) => unknown;
            };
            browser.window.dispatchEvent(new browser.Event('visibilitychange'));
        });
    }

    test('re-checks on its own and lands on sign-in when the session is gone', async ({
        page,
        homePage,
        loginPage
    }) => {
        await mockSignedIn(page);
        await homePage.goto();
        await expect(homePage.nav).toBeVisible();

        // The session dies somewhere else. Nothing on this page has been
        // touched, and no request of its own is pending.
        await mockSignedOut(page);
        await returnToTab(page);

        await expect(page).toHaveURL(/\/identity\/signin$/);
        await expect(loginPage.heading).toBeVisible();
        await expect(homePage.nav).toBeHidden();
    });

    test('explains itself, even though the probe handles its own 401', async ({
        page,
        homePage,
        hostPage,
        loginPage
    }) => {
        // This path very nearly went unannounced. The transport exempts
        // `/auth/me` from the shared `401` handler — the sign-in page polls
        // that endpoint, where a `401` is the ordinary answer — so an
        // announcement wired to that handler would fire for a session lost on
        // any *other* request and stay silent here, on the one path that has no
        // user action behind it at all. Someone who alt-tabbed back to a tab
        // they left signed in would be dropped onto a sign-in form with nothing
        // anywhere saying why.
        await mockSignedIn(page);
        await homePage.goto();
        await expect(homePage.nav).toBeVisible();

        await mockSignedOut(page);
        await returnToTab(page);

        // Announced in the host's live region, which sits outside the router
        // and so survives the view being replaced…
        await expect(
            hostPage.toastHost.getByText(/Your session has ended/)
        ).toBeVisible();
        // …and repeated on the page, so it is still readable once the toast
        // has expired.
        await expect(loginPage.sessionEndedNotice).toBeVisible();
    });

    test('never flashes the loader while the background re-check is in flight', async ({
        page,
        homePage,
        loginPage
    }) => {
        await mockSignedIn(page);
        await homePage.goto();
        await expect(homePage.nav).toBeVisible();

        // Held open, so the in-flight window is long enough to observe. The
        // gate reports the **cached** user throughout — a refetch that dropped
        // back to `loading` would replace the whole app with the boot screen
        // every time somebody alt-tabbed into it.
        await mockSignedOut(page, { delayMs: 3_000 });
        await returnToTab(page);

        await expect(homePage.rootLoader()).toHaveCount(0);
        await expect(homePage.nav).toBeVisible();
        await expect(loginPage.heading).toHaveCount(0);

        // …and it still resolves into the sign-out once the answer lands, so
        // the silence above is a smooth transition rather than a probe that
        // never ran.
        await expect(page).toHaveURL(/\/identity\/signin$/, {
            timeout: 15_000
        });
    });

    test('stays put when the re-check says the session is still good', async ({
        page,
        homePage
    }) => {
        // The common case, and the one a fail-open bug hides in: returning to
        // the tab must not disturb anything.
        await mockSignedIn(page);
        await homePage.goto();
        await expect(homePage.nav).toBeVisible();

        await returnToTab(page);

        await expect(page).toHaveURL('/');
        await expect(homePage.nav).toBeVisible();
        await expect(homePage.rootLoader()).toHaveCount(0);
    });
});

/**
 * A session can die while a tab is open — an admin suspends the account (which
 * revokes its sessions server-side), it expires, or another device kills it.
 * The next request comes back `401`, and the shared client's global handler
 * turns that into a real sign-out instead of a page that keeps failing in place.
 *
 * `GET /api/auth/me` stays mocked as **signed in** throughout, so the redirect
 * can only come from the `401` on the data request.
 */
test.describe('Session lost mid-visit', () => {
    test('redirects to the sign-in page when a request comes back 401', async ({
        page,
        loginPage,
        membersPage
    }) => {
        await mockSignedIn(page);
        await mockMembers(page);
        await membersPage.goto();
        await expect(membersPage.heading).toBeVisible();

        // The session dies; the next list request is refused.
        await mockUnauthorized(page, '**/api/users?*');
        await membersPage.search.fill('ada');

        await expect(page).toHaveURL(/\/identity\/signin$/);
        await expect(loginPage.heading).toBeVisible();
        // The private shell is gone with it — no nav left over a dead session.
        await expect(membersPage.nav).toBeHidden();
    });

    test('announces the sign-out and explains it on the page it lands on', async ({
        page,
        hostPage,
        loginPage,
        membersPage
    }) => {
        // The whole view is replaced under the visitor: focus was on a control
        // that no longer exists, so the browser resets it to `<body>`, a screen
        // reader keeps reading the unmounted page, and anything typed is gone.
        // Silence there is WCAG 4.1.3 / 2.4.3 — there has to be a message.
        await mockSignedIn(page);
        await mockMembers(page);
        await membersPage.goto();
        await expect(membersPage.heading).toBeVisible();

        await mockUnauthorized(page, '**/api/users?*');
        await membersPage.search.fill('ada');

        // Announced as it happens, in the host's live region — which lives
        // outside the router, so it survives the view being replaced.
        await expect(
            hostPage.toastHost.getByText(/Your session has ended/)
        ).toBeVisible();
        // …and repeated on the page, so it is still readable once the toast has
        // expired. Not the destructive submission banner: nothing they did
        // failed.
        await expect(loginPage.sessionEndedNotice).toBeVisible();
        await expect(loginPage.errorBanner).toBeHidden();

        // Focus lands on the sign-in heading, next to that explanation, rather
        // than being dropped to `<body>` at the top of a page nobody was told
        // they had reached.
        await expect(loginPage.heading).toBeFocused();
    });

    test('says nothing about a lost session when nobody was signed in', async ({
        page,
        loginPage
    }) => {
        // A `401` on a tab that never had a session is the ordinary signed-out
        // state — telling that visitor something of theirs was taken away would
        // be a lie.
        await mockSignedOut(page);
        await page.goto('/');

        await expect(loginPage.heading).toBeVisible();
        await expect(loginPage.sessionEndedNotice).toBeHidden();
    });

    test('drops the explanation once the visitor comes back to sign-in', async ({
        page,
        loginPage,
        membersPage
    }) => {
        await mockSignedIn(page);
        await mockMembers(page);
        await membersPage.goto();
        await expect(membersPage.heading).toBeVisible();

        await mockUnauthorized(page, '**/api/users?*');
        await membersPage.search.fill('ada');
        await expect(loginPage.sessionEndedNotice).toBeVisible();

        // The signal is one-shot: a later visit to the same page is an ordinary
        // arrival, not a second sign-out.
        await mockSignedOut(page);
        await page.goto('/identity/signin');
        await expect(loginPage.heading).toBeVisible();
        await expect(loginPage.sessionEndedNotice).toBeHidden();
    });

    test('redirects when the session dies under a mutation, without an unhandled error', async ({
        page,
        loginPage,
        membersPage
    }) => {
        const crashes: string[] = [];
        page.on('pageerror', (error) => crashes.push(error.message));

        await mockSignedIn(page);
        await mockMembers(page);
        await membersPage.goto();
        await expect(membersPage.heading).toBeVisible();

        // A write, not a read: the mutation rejects mid-flight while the tree
        // that fired it is being unmounted by the redirect.
        await mockUnauthorized(page, '**/api/users/*/invites/resend');
        await membersPage.openActions('alan@ortha.dev');
        await membersPage.menuItem('Resend invite').click();

        await expect(page).toHaveURL(/\/identity\/signin$/);
        await expect(loginPage.heading).toBeVisible();
        expect(crashes).toEqual([]);
    });
});

/**
 * The gate's three settled answers are covered above and in the outage suite;
 * this pins the fourth state — still resolving — because it is the one a user
 * sees on every cold load, and getting it wrong means flashing the sign-in page
 * at somebody who is signed in.
 */
test.describe('Auth still resolving', () => {
    test('holds the branded loader and never flashes the sign-in page', async ({
        page,
        homePage,
        loginPage
    }) => {
        // The probe is held open, so the gate cannot know yet.
        await mockSignedIn(page, {}, { delayMs: 3_000 });
        await homePage.goto();

        await expect(homePage.rootLoader()).toBeVisible();
        await expect(loginPage.heading).toHaveCount(0);
        await expect(page).toHaveURL('/');

        // …and it resolves into the app, not through the sign-in page.
        await expect(homePage.nav).toBeVisible({ timeout: 15_000 });
        await expect(loginPage.heading).toHaveCount(0);
    });

    test('gates every affordance while it resolves — fail-closed', async ({
        page,
        homePage,
        membersPage
    }) => {
        await mockSignedIn(page, {}, { delayMs: 3_000 });
        await homePage.goto();

        // `useHasPermission` answers `false` for every status but
        // `Authenticated`, so nothing permission-gated can render early: while
        // the loader is up there is no shell at all to hold it.
        await expect(homePage.rootLoader()).toBeVisible();
        await expect(membersPage.inviteButton).toHaveCount(0);
        await expect(homePage.nav).toHaveCount(0);
    });
});
