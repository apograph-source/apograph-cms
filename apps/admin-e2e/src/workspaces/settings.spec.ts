import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import {
    mockWorkspaceSettingsApi,
    type WorkspaceView
} from '../support/api/workspaces';
import { expectNoA11yViolations } from '../support/a11y';

const WORKSPACE_ID = 'ws_settings';

/**
 * A `5xx` is not the query's final answer: the shared client retries it three
 * times with exponential backoff (~7s) before the hook reports `isError`. The
 * status is the honest one for an outage, so the wait is budgeted rather than
 * traded for a fast-failing `4xx`.
 */
const AFTER_RETRIES = { timeout: 15_000 };

/** The single workspace under test, seeded into the stateful settings mock. */
function seed(): WorkspaceView {
    return {
        id: WORKSPACE_ID,
        name: 'Marketing site',
        slug: 'marketing-site',
        description: 'Landing pages and the blog.',
        color: 'violet',
        status: 'active',
        members: [
            { id: 'u_ada', name: 'Ada Lovelace', email: 'ada@ortha.dev' },
            { id: 'u_grace', name: 'Grace Hopper', email: 'grace@ortha.dev' }
        ],
        // blog_post + product granted; home + about are addable. product is
        // "locked" (still has entries) in the not-empty test below.
        content: ['blog_post', 'product']
    };
}

/**
 * The workspace settings page (`@orthacms/workspaces-admin`), mounted in the
 * shell at `/workspaces/:id/settings`. Drives the four left-rail sections —
 * General, Members, Content, Danger zone — against the stateful
 * `mockWorkspaceSettingsApi`, plus the read-only (viewer) variant and an
 * accessibility scan.
 */
test.describe('Workspace settings page', () => {
    test.describe('as an admin', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockWorkspaceSettingsApi(page, [seed()], {
                lockedContent: { [WORKSPACE_ID]: ['product'] }
            });
        });

        test('renders the section nav and the current general values', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);

            await expect(
                workspaceSettingsPage.navItem('General')
            ).toBeVisible();
            await expect(
                workspaceSettingsPage.navItem('Members')
            ).toBeVisible();
            await expect(
                workspaceSettingsPage.navItem('Content')
            ).toBeVisible();
            await expect(
                workspaceSettingsPage.navItem('Danger zone')
            ).toBeVisible();

            await expect(workspaceSettingsPage.nameInput).toHaveValue(
                'Marketing site'
            );
            await expect(workspaceSettingsPage.slugInput).toHaveValue(
                'marketing-site'
            );
            // Active workspace — no archived badge.
            await expect(workspaceSettingsPage.archivedBadge()).toBeHidden();
        });

        test('copies the workspace id from the general tab', async ({
            workspaceSettingsPage,
            context,
            page
        }) => {
            // The copy button writes to the real clipboard, which Chromium
            // gates behind a permission even on localhost.
            await context.grantPermissions([
                'clipboard-read',
                'clipboard-write'
            ]);
            await workspaceSettingsPage.goto(WORKSPACE_ID);

            const field = workspaceSettingsPage.workspaceIdInput;
            await expect(field).toHaveValue(WORKSPACE_ID);
            // Read-only but NOT disabled — a disabled input can't be focused,
            // so the id could be neither selected nor copied by keyboard.
            await expect(field).toHaveAttribute('readonly', '');
            await expect(field).toBeEnabled();

            await workspaceSettingsPage.copyWorkspaceIdButton.click();
            await expect(
                workspaceSettingsPage.toast(/Workspace ID copied/)
            ).toBeVisible();

            // Typed inline: this project's tsconfig ships no DOM lib, so the
            // global `navigator` isn't declared (same reason as the computed
            // -style read in `relation-cells.spec.ts`).
            const clipboard = await page.evaluate(() =>
                (
                    globalThis as unknown as {
                        navigator: {
                            clipboard: { readText: () => Promise<string> };
                        };
                    }
                ).navigator.clipboard.readText()
            );
            expect(clipboard).toBe(WORKSPACE_ID);
        });

        test('saves an edited name (save enables only when dirty)', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);

            // Clean form → save disabled.
            await expect(workspaceSettingsPage.saveButton).toBeDisabled();

            await workspaceSettingsPage.nameInput.fill('Marketing hub');
            await expect(workspaceSettingsPage.saveButton).toBeEnabled();
            await workspaceSettingsPage.saveButton.click();

            await expect(
                workspaceSettingsPage.toast(/Workspace details saved/)
            ).toBeVisible();
        });

        test('assigns an unassigned member and removes an existing one', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Members');

            // Assign an unassigned directory user.
            await workspaceSettingsPage.memberSearch.fill('Barbara');
            await workspaceSettingsPage.memberOption('Barbara Liskov').click();
            await expect(
                workspaceSettingsPage.toast(/was added to the workspace/)
            ).toBeVisible();
            await expect(
                workspaceSettingsPage.memberRow('barbara@ortha.dev')
            ).toBeVisible();

            // Remove a member through the confirm dialog.
            await workspaceSettingsPage
                .memberRemoveButton('Grace Hopper')
                .click();
            await workspaceSettingsPage.dialogConfirm('Remove').click();
            await expect(
                workspaceSettingsPage.toast(/was removed from the workspace/)
            ).toBeVisible();
            await expect(
                workspaceSettingsPage.memberRow('grace@ortha.dev')
            ).toBeHidden();
        });

        test('grants a content type and revokes an empty one', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Content');

            // Grant an ungranted page through the pages search + multi-select
            // dialog (About is a standalone page).
            await workspaceSettingsPage.addPagesButton.click();
            await workspaceSettingsPage.addContentSearch.fill('About');
            await workspaceSettingsPage.contentCheckbox('About').click();
            await workspaceSettingsPage.addContentSave.click();
            await expect(
                workspaceSettingsPage.toast(/Content type added/)
            ).toBeVisible();

            // Revoke an empty type (blog_post is not locked): once the entry
            // count resolves to zero, Remove enables.
            await workspaceSettingsPage
                .contentRemoveButton('Blog posts')
                .click();
            await expect(
                workspaceSettingsPage.removeContentConfirm
            ).toBeEnabled();
            await workspaceSettingsPage.removeContentConfirm.click();
            await expect(
                workspaceSettingsPage.toast(/Content type removed/)
            ).toBeVisible();
        });

        test('blocks revoking a content type that still has entries', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Content');

            // product is locked (reports entries) → the dialog blocks Remove
            // with a warning instead of letting the request 409.
            await workspaceSettingsPage.contentRemoveButton('Products').click();

            await expect(
                workspaceSettingsPage.removeBlockedAlert
            ).toContainText(/still has/);
            await expect(
                workspaceSettingsPage.removeContentConfirm
            ).toBeDisabled();
        });

        test('archives the workspace from the danger zone', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Danger zone');

            await workspaceSettingsPage.archiveButton.click();
            await workspaceSettingsPage.dialogConfirm('Archive').click();

            await expect(
                workspaceSettingsPage.toast(/Workspace archived/)
            ).toBeVisible();
            // The header now badges the archived state.
            await expect(workspaceSettingsPage.archivedBadge()).toBeVisible();
        });

        test('deletes the workspace and returns to the grid', async ({
            page,
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Danger zone');

            await workspaceSettingsPage.deleteButton.click();
            // The dialog pre-checks the workspace is empty before enabling
            // Delete (the seed reports zero total entries).
            await expect(workspaceSettingsPage.deleteConfirm).toBeEnabled();
            await workspaceSettingsPage.deleteConfirm.click();

            await expect(page).toHaveURL('/workspaces');
        });
    });

    test.describe('delete guard (workspace still has content)', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockWorkspaceSettingsApi(page, [seed()], {
                // The workspace reports content entries → delete is blocked.
                workspaceEntryCount: { [WORKSPACE_ID]: 2 }
            });
        });

        test('blocks deleting until all content is removed', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Danger zone');

            await workspaceSettingsPage.deleteButton.click();

            await expect(
                workspaceSettingsPage.deleteBlockedAlert
            ).toContainText(/still has/);
            await expect(workspaceSettingsPage.deleteConfirm).toBeDisabled();
        });
    });

    /**
     * workspaces:I-32. The gate on both destructive buttons is
     * `open && !isError && !isChecking && count === 0` — enabled only on a
     * count that is *known* to be zero. The two known-non-zero cases are
     * covered above; these are the two halves where the count is unknown, and
     * they are the ones that decay into "enabled while we do not actually
     * know": a dialog that treats "still counting" or "the count failed" as
     * zero deletes a workspace that is not empty.
     */
    test.describe('the destructive gate while the count is unknown', () => {
        test.describe('still checking', () => {
            test.beforeEach(async ({ page }) => {
                await mockSignedIn(page);
                await mockWorkspaceSettingsApi(page, [seed()], {
                    // Hold both entry-count reads open, so the dialogs stay in
                    // the window where nobody knows the count yet.
                    entryCountDelayMs: 30_000
                });
            });

            test('keeps Delete disabled and says the check is running', async ({
                workspaceSettingsPage
            }) => {
                await workspaceSettingsPage.goto(WORKSPACE_ID);
                await workspaceSettingsPage.openSection('Danger zone');

                await workspaceSettingsPage.deleteButton.click();

                await expect(
                    workspaceSettingsPage.countCheckingNotice
                ).toBeVisible();
                await expect(
                    workspaceSettingsPage.deleteConfirm
                ).toBeDisabled();
            });

            test('keeps Remove disabled and says the check is running', async ({
                workspaceSettingsPage
            }) => {
                await workspaceSettingsPage.goto(WORKSPACE_ID);
                await workspaceSettingsPage.openSection('Content');

                // Blog posts is the *empty* type — so this is genuinely the
                // pending state, not the blocked one wearing its clothes.
                await workspaceSettingsPage
                    .contentRemoveButton('Blog posts')
                    .click();

                await expect(
                    workspaceSettingsPage.countCheckingNotice
                ).toBeVisible();
                await expect(
                    workspaceSettingsPage.removeContentConfirm
                ).toBeDisabled();
            });
        });

        test.describe('the check failed', () => {
            test.beforeEach(async ({ page }) => {
                await mockSignedIn(page);
                await mockWorkspaceSettingsApi(page, [seed()], {
                    // Both counts are unreadable. An unanswerable pre-check has
                    // to block: falling through to "no entries" is how a
                    // non-empty workspace gets deleted.
                    entryCountStatus: 500
                });
            });

            test('blocks Delete when the content check cannot be read [workspaces:I-32]', async ({
                workspaceSettingsPage
            }) => {
                await workspaceSettingsPage.goto(WORKSPACE_ID);
                await workspaceSettingsPage.openSection('Danger zone');

                await workspaceSettingsPage.deleteButton.click();

                await expect(
                    workspaceSettingsPage.deleteBlockedAlert,
                    'the dialog must say the check failed, not fall silent'
                ).toContainText(/so deletion is blocked/, AFTER_RETRIES);
                await expect(
                    workspaceSettingsPage.deleteConfirm
                ).toBeDisabled();
            });

            test('blocks Remove when the entry check cannot be read', async ({
                workspaceSettingsPage
            }) => {
                await workspaceSettingsPage.goto(WORKSPACE_ID);
                await workspaceSettingsPage.openSection('Content');

                await workspaceSettingsPage
                    .contentRemoveButton('Blog posts')
                    .click();

                await expect(
                    workspaceSettingsPage.removeBlockedAlert
                ).toContainText(/so removal is blocked/, AFTER_RETRIES);
                await expect(
                    workspaceSettingsPage.removeContentConfirm
                ).toBeDisabled();
            });
        });
    });

    /**
     * Removing the last member is the one removal that can never succeed: the
     * server answers `409 LastMemberError`, because a workspace with nobody in
     * it is unreachable. The client used to catch every failure into "Please
     * try again" — advice that cannot work, offered for a rule the user has no
     * way to learn from the UI.
     */
    test.describe('the last member cannot be removed', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockWorkspaceSettingsApi(
                page,
                // A roster of exactly one — the state the server refuses.
                [{ ...seed(), members: seed().members.slice(0, 1) }],
                { memberRemoveStatus: 409 }
            );
        });

        test('names the remedy instead of inviting a retry', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Members');

            await workspaceSettingsPage
                .memberRemoveButton('Ada Lovelace')
                .click();
            await workspaceSettingsPage.dialogConfirm('Remove').click();

            // The two things the user can actually do about it.
            await expect(
                workspaceSettingsPage.toast(
                    /Add someone else first, or delete the workspace/
                )
            ).toBeVisible();
            // And not the one that never will: repeating this request returns
            // the same 409 for as long as the roster has one name on it.
            await expect(
                workspaceSettingsPage.toast(
                    'Couldn’t remove that member. Please try again.'
                )
            ).toBeHidden();

            // The refusal left the roster alone.
            await expect(
                workspaceSettingsPage.memberRow('ada@ortha.dev')
            ).toBeVisible();
        });
    });

    test.describe('as a viewer (read-only)', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page, {
                permissions: ['workspaces:read', 'users:read', 'content:read']
            });
            await mockWorkspaceSettingsApi(page, [seed()]);
        });

        test('hides edit controls and the danger tab [workspaces:I-34]', async ({
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);

            // General is read-only: no save action.
            await expect(workspaceSettingsPage.saveButton).toBeHidden();
            // Danger zone requires update or delete — hidden for a viewer.
            await expect(
                workspaceSettingsPage.navItem('Danger zone')
            ).toBeHidden();

            // Members tab offers no directory search.
            await workspaceSettingsPage.openSection('Members');
            await expect(workspaceSettingsPage.memberSearch).toBeHidden();

            // Content tab offers no add controls.
            await workspaceSettingsPage.openSection('Content');
            await expect(
                workspaceSettingsPage.addCollectionsButton
            ).toBeHidden();
            await expect(workspaceSettingsPage.addPagesButton).toBeHidden();
        });

        // workspaces:I-34 — hiding a tab is not a gate. A bookmark, a shared link or the
        // back button all walk straight past the tab bar, so the route itself
        // has to refuse; and since the page then swaps under the user, the
        // refusal has to be said out loud and focus has to go somewhere.
        test('refuses a deep link to the Danger zone at the route [workspaces:I-34]', async ({
            page,
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.gotoSection(WORKSPACE_ID, 'danger');

            await expect(page).toHaveURL(
                `/workspaces/${WORKSPACE_ID}/settings/general`
            );
            // Not one danger control rendered on the way through.
            await expect(workspaceSettingsPage.deleteButton).toBeHidden();
            await expect(workspaceSettingsPage.archiveButton).toBeHidden();

            // The reason, in the live region the redirect writes to — a silent
            // swap leaves a screen-reader user to work out where they landed.
            await expect(workspaceSettingsPage.redirectNotice()).toHaveText(
                'You don’t have permission to open the Danger zone, so we brought you to General settings.'
            );

            // And focus follows the page, rather than falling to <body> and
            // restarting the next Tab at the top of the document.
            await expect(workspaceSettingsPage.mainContent()).toBeFocused();
            await expect(page.locator('body:focus')).toHaveCount(0);
        });
    });

    /**
     * Axe scans of the settings page. The scan used to stop at the General tab
     * — three of the four sections and every dialog on the page were never
     * looked at, which is the same hole the create wizard's scan had (an
     * unlabelled search input shipped on a step nobody scanned). Each dialog is
     * scanned in the state it is actually reached in, blocked variants
     * included: the alert, the disabled button and the destructive palette are
     * markup no other state renders.
     */
    test.describe('accessibility', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockWorkspaceSettingsApi(page, [seed()], {
                // Both blocking states, seeded up front: `product` still holds
                // entries and the workspace as a whole is not empty.
                lockedContent: { [WORKSPACE_ID]: ['product'] },
                workspaceEntryCount: { [WORKSPACE_ID]: 2 }
            });
        });

        test('the settings page has no automatically-detectable a11y violations', async ({
            workspaceSettingsPage,
            makeAxe
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await expectNoA11yViolations(makeAxe());
        });

        test('members tab', async ({ workspaceSettingsPage, makeAxe }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Members');
            await workspaceSettingsPage.memberSearch.waitFor();
            await expectNoA11yViolations(makeAxe());
        });

        test('content tab', async ({ workspaceSettingsPage, makeAxe }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Content');
            await workspaceSettingsPage.addPagesButton.waitFor();
            await expectNoA11yViolations(makeAxe());
        });

        test('danger tab', async ({ workspaceSettingsPage, makeAxe }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Danger zone');
            await workspaceSettingsPage.deleteButton.waitFor();
            await expectNoA11yViolations(makeAxe());
        });

        test('add-content dialog — search and multi-select', async ({
            workspaceSettingsPage,
            makeAxe
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Content');
            await workspaceSettingsPage.addPagesButton.click();
            await workspaceSettingsPage.addContentSearch.waitFor();
            await expectNoA11yViolations(makeAxe());
        });

        test('remove-content dialog — blocked', async ({
            workspaceSettingsPage,
            makeAxe
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Content');
            await workspaceSettingsPage.contentRemoveButton('Products').click();
            await workspaceSettingsPage.removeBlockedAlert.waitFor();
            await expectNoA11yViolations(makeAxe());
        });

        test('delete dialog — blocked', async ({
            workspaceSettingsPage,
            makeAxe
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Danger zone');
            await workspaceSettingsPage.deleteButton.click();
            await workspaceSettingsPage.deleteBlockedAlert.waitFor();
            await expectNoA11yViolations(makeAxe());
        });

        test('remove-member confirm dialog', async ({
            workspaceSettingsPage,
            makeAxe
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Members');
            await workspaceSettingsPage
                .memberRemoveButton('Grace Hopper')
                .click();
            await workspaceSettingsPage.dialogConfirm('Remove').waitFor();
            await expectNoA11yViolations(makeAxe());
        });
    });
});
