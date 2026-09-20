import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import {
    mockWorkspaceSettingsApi,
    mockWorkspaces,
    mockWorkspacesApi,
    WORKSPACES_SEED
} from '../support/api/workspaces';

/**
 * Keyboard operability of the Workspaces page and its create wizard — the part
 * axe can't check. Avoids asserting the exact global tab order (it runs through
 * the shell nav and varies); instead it pins the properties that matter: each
 * control is focusable and activates by keyboard, and the filter chips move
 * with the arrow keys.
 */
test.describe('Workspaces keyboard accessibility', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
    });

    test('search is reachable and filters by keyboard', async ({
        workspacesPage
    }) => {
        await workspacesPage.goto();

        await workspacesPage.search.focus();
        await expect(workspacesPage.search).toBeFocused();
        await workspacesPage.search.pressSequentially('Marketing');

        await expect(workspacesPage.card('Marketing site')).toBeVisible();
        await expect(workspacesPage.card('Support hub')).toBeHidden();
    });

    test('a row opens on Enter', async ({ page, workspacesPage }) => {
        await workspacesPage.goto();

        await workspacesPage.openButton('Marketing site').focus();
        await expect(workspacesPage.openButton('Marketing site')).toBeFocused();
        await page.keyboard.press('Enter');

        // Opening a workspace lands on its first section (Content Library).
        await expect(page).toHaveURL('/workspaces/ws_marketing/content');
    });

    test('the status filter chips move with arrow keys', async ({
        page,
        workspacesPage
    }) => {
        await workspacesPage.goto();

        // Roving tabindex: the selected chip (Active, the default) is the
        // group's single tab stop. ArrowRight moves focus along the horizontal
        // segmented control; Enter activates the focused chip.
        const active = workspacesPage.statusOption('Active');
        await active.focus();
        await expect(active).toBeFocused();

        await page.keyboard.press('ArrowRight');
        const archived = workspacesPage.statusOption('Archived');
        await expect(archived).toBeFocused();
        await page.keyboard.press('Enter');

        await expect(archived).toHaveAttribute('aria-checked', 'true');
        await expect(workspacesPage.card('Research archive')).toBeVisible();
    });

    test('the sidebar Workspaces group folds and unfolds from the keyboard', async ({
        page,
        workspacesPage
    }) => {
        await workspacesPage.goto();

        const toggle = workspacesPage.sidebarWorkspacesToggle;
        await toggle.focus();
        await expect(toggle).toBeFocused();

        // A real <button> (the label is a div until `asChild` hands the trigger
        // its element), so both Enter and Space act on it.
        await page.keyboard.press('Enter');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(
            workspacesPage.sidebarWorkspaceLink('Marketing site')
        ).toBeHidden();

        await page.keyboard.press('Space');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(
            workspacesPage.sidebarWorkspaceLink('Marketing site')
        ).toBeVisible();
        // Toggling must not steal focus from the control the user pressed.
        await expect(toggle).toBeFocused();
    });

    test('the group "+" is its own tab stop after the collapse trigger', async ({
        page,
        workspacesPage
    }) => {
        await workspacesPage.goto();

        // The "+" is painted *over* the heading row, so a full-width trigger
        // would have made it unreachable-looking; it stays a separate control,
        // the next stop after the trigger, and opens the wizard on Enter.
        await workspacesPage.sidebarWorkspacesToggle.focus();
        await page.keyboard.press('Tab');
        await expect(workspacesPage.sidebarNewWorkspaceAction).toBeFocused();

        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/workspaces\/new$/);
    });

    /**
     * The settings page had no keyboard coverage at all, and it is where the
     * destructive actions live: a tab bar that is a run of links rather than a
     * roving tablist, and dialogs that must hold focus while they are up and
     * hand it back when they close.
     */
    test.describe('workspace settings', () => {
        const WORKSPACE_ID = 'ws_marketing';

        test.beforeEach(async ({ page }) => {
            // Registered after the outer list mock, so the settings page reads
            // the stateful store.
            await mockWorkspaceSettingsApi(page, WORKSPACES_SEED);
        });

        test('the tab bar is walked with Tab and opens on Enter', async ({
            page,
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);

            // A `<nav>` of links, not a Radix tablist: every tab is its own tab
            // stop and Enter follows it. Asserting the run in order is what
            // would catch a stray focusable slipped between two tabs.
            //
            // **Protection is a plugin's tab**, contributed through
            // `WORKSPACE_SETTINGS_TAB_SLOT`, and it is in this list because
            // contributed tabs land between Content and Danger zone — Danger
            // zone stays last, because it is where a workspace is destroyed.
            // A second contributor would extend this run rather than reorder
            // it.
            await workspaceSettingsPage.navItem('General').focus();
            await expect(
                workspaceSettingsPage.navItem('General')
            ).toBeFocused();

            for (const next of [
                'Members',
                'Content',
                'Protection',
                'Danger zone'
            ]) {
                await page.keyboard.press('Tab');
                await expect(workspaceSettingsPage.navItem(next)).toBeFocused();
            }

            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(
                `/workspaces/${WORKSPACE_ID}/settings/danger`
            );
            await expect(workspaceSettingsPage.deleteButton).toBeVisible();
        });

        test('a confirm dialog holds focus and hands it back on Escape', async ({
            page,
            workspaceSettingsPage
        }) => {
            await workspaceSettingsPage.goto(WORKSPACE_ID);
            await workspaceSettingsPage.openSection('Members');

            const remove =
                workspaceSettingsPage.memberRemoveButton('Grace Hopper');
            await remove.focus();
            await page.keyboard.press('Enter');
            await workspaceSettingsPage.dialog.waitFor();

            // Focus moved *into* the dialog rather than being left on the page
            // behind it — where a keyboard user would be tabbing through
            // controls the modal has covered.
            const focusedInDialog = workspaceSettingsPage.focusInsideDialog();
            await expect(focusedInDialog).toHaveCount(1);

            // And it stays: Tab cycles the dialog's own three controls (close,
            // Cancel, Remove) instead of escaping into the page.
            for (let step = 0; step < 5; step += 1) {
                await page.keyboard.press('Tab');
                await expect(focusedInDialog).toHaveCount(1);
            }

            await page.keyboard.press('Escape');
            await expect(workspaceSettingsPage.dialog).toHaveCount(0);
            // Dismissing removes nobody, so the control that opened the dialog
            // is still there to take focus back.
            await expect(remove).toBeFocused();
            await expect(page.locator('body:focus')).toHaveCount(0);
        });
    });

    test.describe('create wizard', () => {
        test.beforeEach(async ({ page }) => {
            await mockWorkspacesApi(page);
        });

        test('opens the wizard from the list on Enter', async ({
            page,
            workspacesPage,
            createWorkspacePage
        }) => {
            await workspacesPage.goto();

            await workspacesPage.newWorkspaceButton.focus();
            await expect(workspacesPage.newWorkspaceButton).toBeFocused();
            await page.keyboard.press('Enter');

            await expect(page).toHaveURL(/\/workspaces\/new$/);
            await expect(createWorkspacePage.heading).toBeVisible();
        });

        test('a color swatch is selectable by keyboard', async ({
            page,
            createWorkspacePage
        }) => {
            await createWorkspacePage.goto();

            // slate is the default selection; focus another swatch and activate
            // it from the keyboard.
            const green = createWorkspacePage.colorSwatch('green');
            await green.focus();
            await expect(green).toBeFocused();

            await page.keyboard.press('Space');

            await expect(green).toHaveAttribute('aria-checked', 'true');
            await expect(
                createWorkspacePage.colorSwatch('slate')
            ).toHaveAttribute('aria-checked', 'false');
        });

        test('the color swatches are one tab stop and move with arrow keys', async ({
            page,
            createWorkspacePage
        }) => {
            await createWorkspacePage.goto();

            // `role="radiogroup"` promises a roving tabindex: the group is a
            // single stop and arrows move within it. It used to be seven stops
            // with inert arrows — a role the widget didn't honour.
            const slate = createWorkspacePage.colorSwatch('slate');
            await slate.focus();
            await page.keyboard.press('ArrowRight');

            const green = createWorkspacePage.colorSwatch('green');
            await expect(green).toBeFocused();
            await expect(green).toHaveAttribute('aria-checked', 'true');

            await page.keyboard.press('ArrowLeft');
            await expect(slate).toBeFocused();
            await expect(slate).toHaveAttribute('aria-checked', 'true');

            // Only the checked swatch is tabbable, so Tab leaves the group
            // rather than walking the remaining six.
            await page.keyboard.press('Tab');
            await expect(slate).not.toBeFocused();
            await expect(green).not.toBeFocused();
        });

        test('the members typeahead is driven from the input by arrow keys', async ({
            page,
            createWorkspacePage
        }) => {
            await createWorkspacePage.goto();
            await createWorkspacePage.nameInput.fill('Keyboard workspace');
            await createWorkspacePage.continueToMembers.click();

            const search = createWorkspacePage.memberSearch;
            await search.fill('bar');
            await createWorkspacePage.memberOption('Barbara Liskov').waitFor();

            // The ARIA combobox contract: focus stays in the input while
            // `aria-activedescendant` points at the active option, so typing is
            // never interrupted. Previously the only route to a result was
            // Tabbing out of the input into the popover.
            await expect(search).toBeFocused();
            await expect(search).toHaveAttribute('aria-expanded', 'true');
            await page.keyboard.press('ArrowDown');
            await expect(search).toBeFocused();
            await expect(search).toHaveAttribute('aria-activedescendant', /.+/);

            await page.keyboard.press('Enter');
            await expect(page.getByText('barbara@ortha.dev')).toBeVisible();
        });

        test('a step change moves focus to the new step heading', async ({
            createWorkspacePage
        }) => {
            await createWorkspacePage.goto();
            await createWorkspacePage.nameInput.fill('Keyboard workspace');
            await createWorkspacePage.continueToMembers.click();

            // The card is keyed on the step, so the button the user pressed is
            // unmounted; without an explicit move, focus fell to <body> and the
            // next Tab restarted at the top of the document.
            await expect(
                createWorkspacePage.stepHeading('Members')
            ).toBeFocused();
        });
    });
});
