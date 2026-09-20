import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import { mockMembers } from '../support/api/members';
import { mockEmptyActivity } from '../support/api/userDetail';
import { mockContentSchema } from '../support/api/content';
import { type BrowserGlobals } from '../support/browserGlobals';

/**
 * The global command palette (`SidebarSearch`, from `@orthacms/shell-admin`):
 * the sidebar's search trigger opens a ⌘K `CommandDialog`. Its suggestions are
 * the primary-nav destinations (`SIDEBAR_NAV_SLOT`) plus plugin-contributed
 * groups via `COMMAND_SLOT` — active workspaces (`workspaces-admin`) and each
 * workspace's content types (`content-admin`). Choosing one navigates there.
 */
test.describe('Command palette', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page, {
            id: 'u_amara',
            name: 'Amara Okafor',
            email: 'amara@ortha.dev'
        });
        await mockWorkspaces(page);
        await mockMembers(page);
        await mockEmptyActivity(page);
        await mockContentSchema(page);
    });

    test('suggests nav destinations, workspaces, and content types', async ({
        homePage
    }) => {
        await homePage.goto();
        await homePage.openCommandPalette();

        // Nav destinations.
        await expect(homePage.commandItem('Members')).toBeVisible();
        // A workspace (Marketing site is active).
        await expect(homePage.commandItem('Marketing site')).toBeVisible();
        // A content type of that workspace (label + workspace name).
        await expect(
            homePage.commandItem('Blog posts Marketing site')
        ).toBeVisible();
    });

    test('navigates to a nav destination', async ({ homePage, page }) => {
        await homePage.goto();
        await homePage.openCommandPalette();

        await homePage.commandInput().fill('member');
        await homePage.commandItem('Members').click();

        await expect(page).toHaveURL(/\/users$/);
    });

    test('jumps straight to a workspace content type', async ({
        homePage,
        page
    }) => {
        await homePage.goto();
        await homePage.openCommandPalette();

        await homePage.commandInput().fill('blog');
        await homePage.commandItem('Blog posts Marketing site').click();

        await expect(page).toHaveURL(
            /\/workspaces\/ws_marketing\/content\/blog_post$/
        );
    });

    test('arrow keys move the announced selection, not just the highlight', async ({
        homePage,
        page
    }) => {
        await homePage.goto();
        await homePage.openCommandPalette();

        await page.keyboard.press('ArrowDown');

        // cmdk keeps DOM focus in the input and tracks the highlighted row with
        // `aria-activedescendant` — which is the *only* thing that makes arrow
        // navigation audible. The repo already knows this (the query builder's
        // `FieldPicker` documents it at length) and nothing asserted it here: the
        // suite above drives the palette entirely with the mouse, so a regression
        // that left the highlight purely visual would have stayed green.
        await expect(homePage.commandInput()).toHaveAttribute(
            'aria-activedescendant',
            /.+/
        );

        // And it has to point at the row that *looks* selected. Compared in the
        // page rather than by reading the id out and building a selector, because
        // the failure worth catching is the two **drifting apart** — the same class
        // of bug as ORT-128 in the design system's MultiSelect, where
        // `aria-selected` named the highlighted option rather than the chosen one.
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const { document } =
                        globalThis as unknown as BrowserGlobals;
                    const input = document.querySelector(
                        '[aria-activedescendant]'
                    );
                    const selected = document.querySelector(
                        '[role="option"][aria-selected="true"]'
                    );
                    const pointed = input?.getAttribute(
                        'aria-activedescendant'
                    );
                    return Boolean(
                        pointed && pointed === selected?.getAttribute('id')
                    );
                })
            )
            .toBe(true);
    });

    test('closing it with Escape gives focus back to the trigger [shell:I-27]', async ({
        homePage,
        page
    }) => {
        await homePage.goto();
        await homePage.searchTrigger().focus();
        await homePage.searchTrigger().press('Enter');
        await homePage.commandInput().waitFor();

        await page.keyboard.press('Escape');

        // Radix restores focus on close for every other overlay in the app — the
        // account menu, on this same page, does — but not here, and the palette
        // opened and closed leaving `document.activeElement` on `<body>`. A user
        // who reaches for ⌘K and changes their mind should not be sent back to the
        // top of the document for it (WCAG 2.4.3).
        await expect(homePage.searchTrigger()).toBeFocused();
    });

    test('choosing a result does not drag focus back to the sidebar [shell:I-27]', async ({
        homePage,
        page
    }) => {
        await homePage.goto();
        await homePage.openCommandPalette();

        await homePage.commandInput().fill('member');
        await homePage.commandItem('Members').click();
        await expect(page).toHaveURL(/\/users$/);

        // The other half of the restore: navigating away is not "changed my mind",
        // so putting focus back on the sidebar's search button would fight the page
        // the user just asked for. Only a close-without-navigating restores.
        await expect(homePage.searchTrigger()).not.toBeFocused();
    });
});

test.describe('the ⌘K binding', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page, {
            id: 'u_amara',
            name: 'Amara Okafor',
            email: 'amara@ortha.dev'
        });
        await mockWorkspaces(page);
        await mockMembers(page);
        await mockEmptyActivity(page);
        await mockContentSchema(page);
    });

    test('opens the palette from anywhere that is not a text field', async ({
        homePage,
        page
    }) => {
        await homePage.goto();
        await expect(homePage.nav).toBeVisible();

        await homePage.nav.getByRole('link', { name: 'Home' }).focus();
        await page.keyboard.press('ControlOrMeta+k');

        await expect(homePage.commandInput()).toBeFocused();
    });

    test('leaves the caret alone when a page search field has it [shell:I-26]', async ({
        membersPage,
        page
    }) => {
        await membersPage.goto();
        await membersPage.search.fill('amara');
        await expect(membersPage.search).toBeFocused();

        await page.keyboard.press('ControlOrMeta+k');

        // The listener is on `window`, so it fired wherever the caret was: the
        // palette opened over the page and took the focus, and `preventDefault()`
        // destroyed the keystroke the user meant — a change of context in response
        // to input into a *different* control (WCAG 3.2.2). Both halves matter, so
        // both are asserted: nothing opened, and the field kept caret and value.
        await expect(membersPage.commandInput()).toBeHidden();
        await expect(membersPage.search).toBeFocused();
        await expect(membersPage.search).toHaveValue('amara');
    });

    test('still toggles the palette closed from inside the palette', async ({
        homePage,
        page
    }) => {
        await homePage.goto();
        await homePage.openCommandPalette();
        await expect(homePage.commandInput()).toBeFocused();

        // The guard above must not swallow this: the palette's own search box is a
        // text field too, and ⌘K is documented as a toggle. Gating the whole binding
        // on "is the target editable" would have taken the close half with it.
        await page.keyboard.press('ControlOrMeta+k');

        await expect(homePage.commandInput()).toBeHidden();
    });
});
