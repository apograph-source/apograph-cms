import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import {
    mockWorkspaceSettingsApi,
    mockWorkspacesApi,
    type WorkspaceView
} from '../support/api/workspaces';

/**
 * Regression suite for the defects the ORT-60 QA pass confirmed against a live
 * stack. Each case fails on the pre-fix build, so it pins the behaviour rather
 * than merely describing it. They are grouped here, instead of scattered across
 * the feature suites, because they share one property: every one is a *failure*
 * path the happy-path suites never reach.
 */

const WORKSPACE_ID = 'ws_settings';

/** A name that is legal server-side (≤120) but exceeded the old client cap of 100. */
const LONG_NAME = 'L'.repeat(110);

/** A workspace name led by an astral-plane character (outside the BMP). */
const EMOJI_NAME = '🚀 Launch team';

/** A high surrogate not followed by its low half — half a character, rendered as tofu. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

function seed(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
    return {
        id: WORKSPACE_ID,
        name: 'Marketing site',
        slug: 'marketing-site',
        description: 'Landing pages and the blog.',
        color: 'violet',
        status: 'active',
        members: [
            { id: 'u_ada', name: 'Ada Lovelace', email: 'ada@ortha.dev' }
        ],
        content: ['blog_post'],
        ...overrides
    };
}

test.describe('workspaces-admin regressions', () => {
    test.describe('a failed slug check must not read as available', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            // The availability endpoint is down; everything else works.
            await mockWorkspacesApi(page, undefined, {
                slugAvailabilityStatus: 500
            });
        });

        test('reports the check failed and keeps Continue disabled [workspaces:I-33]', async ({
            createWorkspacePage
        }) => {
            await createWorkspacePage.goto();
            await createWorkspacePage.nameInput.fill('Marketing site');

            // TanStack retries before settling, so the status line only reaches
            // its terminal state after the retry ladder (~7s) — which is exactly
            // the window in which the old code flipped to "Available".
            await expect(createWorkspacePage.slugCheckFailed()).toBeVisible({
                timeout: 20_000
            });
            await expect(
                createWorkspacePage.slugStatus('Available')
            ).toBeHidden();
            await expect(createWorkspacePage.continueToMembers).toBeDisabled();
        });
    });

    test.describe('the basics gate holds on state, not just on transitions', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockWorkspacesApi(page);
        });

        test('deep-linking ?step=3 falls back to Basics instead of offering Create', async ({
            page,
            createWorkspacePage
        }) => {
            await page.goto('/workspaces/new?step=3');
            await createWorkspacePage.heading.waitFor();

            // Step 1 renders, and step 3's create action is nowhere near the
            // user — it used to be live, and pressing it produced a generic
            // "the server refused" toast without sending a request at all.
            await expect(createWorkspacePage.nameInput).toBeVisible();
            await expect(createWorkspacePage.createButton).toBeHidden();
            await expect(createWorkspacePage.continueToMembers).toBeVisible();
        });

        test('reloading mid-wizard returns to Basics rather than a dead end', async ({
            page,
            createWorkspacePage
        }) => {
            await createWorkspacePage.goto();
            // A name whose derived slug is free in the seed — a colliding one
            // would leave Continue disabled for the right reason and mask this.
            await createWorkspacePage.nameInput.fill('Half filled space');
            await createWorkspacePage.continueToMembers.click();
            await expect(createWorkspacePage.continueToContent).toBeVisible();

            // All wizard state is in-memory; only `?step=` survives a reload.
            await page.reload();
            await createWorkspacePage.heading.waitFor();

            await expect(createWorkspacePage.nameInput).toHaveValue('');
            await expect(createWorkspacePage.createButton).toBeHidden();
        });
    });

    test.describe('a duplicate slug reports as a conflict, not a retryable error', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockWorkspacesApi(page, undefined, { createStatus: 409 });
        });

        test('names the slug as the problem instead of "please try again"', async ({
            createWorkspacePage
        }) => {
            await createWorkspacePage.goto();
            await createWorkspacePage.create('Brand new space');

            await expect(
                createWorkspacePage.toast(/That slug is already taken/)
            ).toBeVisible();
            await expect(
                createWorkspacePage.toast(
                    'Could not create workspace. Please try again.'
                )
            ).toBeHidden();
        });
    });

    test.describe('a name the server accepts stays editable', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockWorkspaceSettingsApi(page, [seed({ name: LONG_NAME })]);
        });

        test('a 110-character name does not lock the General tab', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);

            // The whole form used to become permanently invalid: Save disabled
            // after the first press, and `maxLength` stopped the user even
            // retyping the original value.
            await expect(workspaceSettingsPage.nameInput).toHaveValue(
                LONG_NAME
            );
            await expect(workspaceSettingsPage.nameInput).toHaveAttribute(
                'maxlength',
                '120'
            );

            // Change only the accent colour, then save.
            await workspaceSettingsPage.colorSwatch('green').click();
            await expect(workspaceSettingsPage.saveButton).toBeEnabled();
            await workspaceSettingsPage.saveButton.click();

            await expect(
                workspaceSettingsPage.toast(/Workspace details saved/)
            ).toBeVisible();
            await expect(
                workspaceSettingsPage.toast(/Name must be at most/)
            ).toBeHidden();
        });
    });

    test.describe('the sidebar reflects a rename immediately', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockWorkspaceSettingsApi(page, [seed()]);
        });

        test('the workspace switcher picks up the new name without navigating away', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);

            await expect(
                workspaceSettingsPage.workspaceSwitcher
            ).toHaveAccessibleName(/current: Marketing site/);

            await workspaceSettingsPage.nameInput.fill('Renamed workspace');
            await workspaceSettingsPage.saveButton.click();
            await expect(
                workspaceSettingsPage.toast(/Workspace details saved/)
            ).toBeVisible();

            // `useSidebarContent` stores the rendered element, so a too-narrow
            // dep array left this showing the old name — in its accessible name
            // too, not just visually — for the rest of the session.
            await expect(
                workspaceSettingsPage.workspaceSwitcher
            ).toHaveAccessibleName(/current: Renamed workspace/);
        });
    });

    test.describe('monogram initials are code-point safe', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockWorkspacesApi(page, [
                seed({ id: 'ws_emoji', name: EMOJI_NAME, slug: 'launch' })
            ]);
        });

        test('an emoji-led name renders a whole character, not half a surrogate pair', async ({
            workspacesPage
        }) => {
            await workspacesPage.goto();

            // `part[0]` sliced the astral character in half and rendered a lone
            // high surrogate (U+D83D) — a tofu box. Assert on code points so a
            // regression reads as text, not as a pixel difference.
            const monogram =
                (await workspacesPage.monogram(EMOJI_NAME).textContent()) ?? '';

            expect([...monogram][0]).toBe('🚀');
            expect(LONE_SURROGATE.test(monogram)).toBe(false);

            // Nothing anywhere in the row may carry an unpaired half, which is
            // the user-visible symptom regardless of which element renders it.
            const row =
                (await workspacesPage.card(EMOJI_NAME).textContent()) ?? '';
            expect(LONE_SURROGATE.test(row)).toBe(false);
        });
    });
});
