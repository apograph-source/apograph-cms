import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockMembers } from '../support/api/members';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    mockActivity,
    mockEmptyActivity,
    mockUserDetail,
    mockUserSessions,
    spyUpdateMember
} from '../support/api/userDetail';

/**
 * The user detail page (`/users/:id`, `@orthacms/users-admin`): the hero +
 * stats + side-rail shell, tab navigation, the General name edit, session
 * revocation, and permission-gated tabs. Backed by the `mockUserDetail` /
 * `mockUserSessions` / activity mocks; `mockSignedIn` satisfies the shell's
 * auth probe and decides which tabs the rail shows.
 */
test.describe('User detail page', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockMembers(page);
        await mockWorkspaces(page);
        await mockEmptyActivity(page);
        await mockUserSessions(page);
        await mockUserDetail(page);
    });

    test('renders the member hero and the General tab by default', async ({
        userDetailPage
    }) => {
        await userDetailPage.goto('u_grace');
        await expect(userDetailPage.nav).toBeVisible();
        await expect(userDetailPage.heading('Grace Hopper')).toBeVisible();
        // The index redirects to General, whose form shows the email read-only.
        await expect(userDetailPage.nameInput()).toHaveValue('Grace Hopper');
    });

    test('opens when the member row is clicked', async ({
        membersPage,
        userDetailPage,
        page
    }) => {
        await membersPage.goto();
        await membersPage.openMember('Grace Hopper');
        await expect(page).toHaveURL(/\/users\/u_grace/);
        await expect(userDetailPage.heading('Grace Hopper')).toBeVisible();
    });

    test('opens a specific tab from the row menu', async ({
        membersPage,
        userDetailPage,
        page
    }) => {
        await membersPage.goto();
        await page
            .getByRole('button', { name: 'Actions for Grace Hopper' })
            .click();
        await page.getByRole('menuitem', { name: 'Sessions' }).click();
        await expect(page).toHaveURL(/\/users\/u_grace\/sessions/);
        await expect(userDetailPage.heading('Grace Hopper')).toBeVisible();
    });

    test('navigates between tabs via the side rail', async ({
        userDetailPage,
        page
    }) => {
        await userDetailPage.goto('u_grace');
        await userDetailPage.openTab('Role');
        await expect(page).toHaveURL(/\/users\/u_grace\/roles/);
        await userDetailPage.openTab('Workspaces');
        await expect(page).toHaveURL(/\/users\/u_grace\/workspaces/);
        await userDetailPage.openTab('Sessions');
        await expect(page).toHaveURL(/\/users\/u_grace\/sessions/);
    });

    test('edits the display name (PATCH /api/users/:id)', async ({
        userDetailPage,
        page
    }) => {
        const spy = await spyUpdateMember(page);
        await userDetailPage.goto('u_grace');

        await userDetailPage.nameInput().fill('Grace B. Hopper');
        await userDetailPage.saveButton().click();

        await expect.poll(() => spy.bodies.length).toBe(1);
        expect(spy.bodies[0]).toMatchObject({ name: 'Grace B. Hopper' });
    });

    test('revokes a session from the Sessions tab', async ({
        userDetailPage,
        page
    }) => {
        const sessions = await mockUserSessions(page);
        await userDetailPage.goto('u_grace');
        await userDetailPage.openTab('Sessions');

        await expect(page.getByText('Chrome on macOS')).toBeVisible();
        // The accessible name carries the device, so each card's Revoke is
        // distinguishable — see the a11y assertion below.
        await page
            .getByRole('button', {
                name: /Revoke the session on Chrome on macOS/
            })
            .click();
        await userDetailPage.confirmButton('Revoke').click();

        await expect.poll(() => sessions.revoked.length).toBe(1);
    });

    test('names the device in each session control and in its confirm dialog', async ({
        userDetailPage,
        page
    }) => {
        await mockUserSessions(page);
        await userDetailPage.goto('u_grace');
        await userDetailPage.openTab('Sessions');

        // Two cards, two distinct accessible names: an unnamed "Revoke this
        // session" on both would leave a screen-reader user unable to tell
        // which device they are about to sign out (WCAG 2.4.6 / 4.1.2).
        await expect(
            page.getByRole('button', {
                name: /Revoke the session on Chrome on macOS/
            })
        ).toBeVisible();
        await expect(
            page.getByRole('button', {
                name: /Revoke the session on Firefox on Linux/
            })
        ).toBeVisible();

        await page
            .getByRole('button', {
                name: /Revoke the session on Firefox on Linux/
            })
            .click();

        // The dialog's accessible name is its title, so the device has to be
        // in the title — not only in the card behind the overlay.
        await expect(
            page.getByRole('heading', {
                name: 'Revoke the session on Firefox on Linux?'
            })
        ).toBeVisible();
    });

    test('renders the activity timeline with per-action entries', async ({
        page,
        userDetailPage
    }) => {
        await mockActivity(page, [
            {
                id: 'ev_role',
                kind: 'user.role_changed',
                subjectType: 'user',
                subjectId: 'u_grace',
                actorId: 'u_ada',
                actorEmail: 'ada@ortha.dev',
                meta: { from: 'viewer', to: 'contributor' },
                at: '2026-06-10T10:00:00.000Z'
            }
        ]);
        await userDetailPage.goto('u_grace');
        await userDetailPage.openTab('Activity');

        // The label comes from `activity-admin`'s one kind->label catalogue,
        // shared with the global Activity Log — this tab used to keep its own
        // twelve-kind map and print the raw wire kind for everything else.
        await expect(page.getByText('Changed role')).toBeVisible();
        await expect(page.getByText('by ada@ortha.dev')).toBeVisible();
    });

    test('names every kind the member touched, not just the user.* ones', async ({
        page,
        userDetailPage
    }) => {
        // The tab's query is "about **or by** this member", so an admin's own
        // timeline surfaces whatever they did — media, tokens, content grants.
        // Its private label map knew twelve kinds, so 14 of 25 rows on a real
        // admin's page rendered as raw dotted wire tokens.
        await mockActivity(
            page,
            [
                'media.asset.uploaded',
                'token.created',
                'workspace.content_granted',
                'user.activated'
            ].map((kind, index) => ({
                id: `ev_${index}`,
                kind,
                subjectType: 'user',
                subjectId: 'u_grace',
                actorId: 'u_grace',
                actorEmail: 'grace@ortha.dev',
                meta: null,
                at: `2026-06-1${index}T09:00:00.000Z`
            }))
        );
        await userDetailPage.goto('u_grace');
        await userDetailPage.openTab('Activity');

        await expect(page.getByText('Uploaded asset')).toBeVisible();
        await expect(page.getByText('Created API token')).toBeVisible();
        await expect(page.getByText('Granted content access')).toBeVisible();
        await expect(page.getByText('Activated account')).toBeVisible();
        await expect(page.getByText('media.asset.uploaded')).toHaveCount(0);
    });

    test('shows workspace membership events in the personal log', async ({
        page,
        userDetailPage
    }) => {
        // The member was removed from a workspace — recorded against them
        // (subjectType=user), so it appears in their own activity timeline.
        await mockActivity(page, [
            {
                id: 'ev_ws',
                kind: 'workspace.member_removed',
                subjectType: 'user',
                subjectId: 'u_grace',
                actorId: 'u_ada',
                actorEmail: 'ada@ortha.dev',
                meta: { workspaceId: 'ws_docs', email: 'grace@ortha.dev' },
                at: '2026-06-11T09:00:00.000Z'
            }
        ]);
        await userDetailPage.goto('u_grace');
        await userDetailPage.openTab('Activity');

        await expect(page.getByText('Removed workspace member')).toBeVisible();
    });

    test('hides audit and access tabs without users:update', async ({
        page,
        userDetailPage
    }) => {
        // A viewer holds users:read (can see the page) but not users:update.
        await mockSignedIn(page, { permissions: ['users:read'] });
        await userDetailPage.goto('u_grace');

        await expect(userDetailPage.tab('General')).toBeVisible();
        await expect(userDetailPage.tab('Sessions')).toHaveCount(0);
        await expect(userDetailPage.tab('Sign-in access')).toHaveCount(0);
    });
});
