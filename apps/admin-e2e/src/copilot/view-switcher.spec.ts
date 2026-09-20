import { expect, test } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import { mockContentSchema } from '../support/api/content';
import { mockCopilotApi } from '../support/api/copilot';

const WORKSPACE_ID = 'ws_marketing';

/**
 * The sidebar's CMS ⇄ Agents control — the answer to "how do I get back?".
 *
 * A full page reached from a nav row is a place people get stuck: the way out is
 * wherever they happen to remember. A control on screen in *both* modes says
 * there are two of them, which one you are in, and costs one click either way —
 * and the CMS half returns to the page you left, because breaking off mid-entry
 * to ask a question should not cost you your place.
 */
test.describe('CMS ⇄ Agents switcher', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
        await mockCopilotApi(page);
    });

    test('says which view you are in, in both of them', async ({
        agentsPage,
        contentLibraryPage
    }) => {
        await contentLibraryPage.goto(WORKSPACE_ID);
        await expect(agentsPage.viewTab('CMS')).toHaveAttribute(
            'aria-checked',
            'true'
        );

        await agentsPage.switchView('Agents');

        await expect(agentsPage.viewTab('Agents')).toHaveAttribute(
            'aria-checked',
            'true'
        );
        await expect(agentsPage.viewTab('CMS')).toHaveAttribute(
            'aria-checked',
            'false'
        );
    });

    test('goes back to the CMS page you left, not the workspace root', async ({
        page,
        agentsPage,
        contentLibraryPage
    }) => {
        await contentLibraryPage.goto(WORKSPACE_ID);
        await contentLibraryPage.sidebar.waitFor();
        const left = new URL(page.url()).pathname;

        await agentsPage.switchView('Agents');
        await expect(agentsPage.welcomeHeading()).toBeVisible();

        await agentsPage.switchView('CMS');

        await expect(page).toHaveURL(new RegExp(`${left}$`));
    });

    test('clicking the view you are already in is not a third state', async ({
        page,
        agentsPage
    }) => {
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        // Radix clears the value when the selected item is clicked again; that
        // is a deselect, and there is nowhere for the user to land.
        await agentsPage.switchView('Agents');

        await expect(page).toHaveURL(
            new RegExp(`/workspaces/${WORKSPACE_ID}/agents$`)
        );
        await expect(agentsPage.viewTab('Agents')).toHaveAttribute(
            'aria-checked',
            'true'
        );
    });

    test('the dock stands down on the Agents view', async ({
        agentsPage,
        contentLibraryPage
    }) => {
        await contentLibraryPage.goto(WORKSPACE_ID);
        // On the CMS the dock *is* the entry point — with no chats open it is a
        // labelled Ortha AI button in the corner.
        await expect(agentsPage.dock).toContainText('Ortha AI');

        await agentsPage.switchView('Agents');

        // Here it would offer to open the page you are already on.
        await expect(agentsPage.dock).toBeHidden();
    });

    test('…and stays down even when it owns a chat', async ({
        agentsPage,
        contentLibraryPage,
        copilotDockPage
    }) => {
        // A chat opened on the CMS, so the dock owns a pill *and* a window.
        await contentLibraryPage.goto(WORKSPACE_ID);
        await copilotDockPage.startChat();
        await expect(copilotDockPage.panel()).toBeVisible();

        await agentsPage.switchView('Agents');

        // The page is the chat surface now, so a floating window over it is a
        // second one saying the same thing — the bar and the windows both go.
        await expect(agentsPage.dock).toBeHidden();
        await expect(copilotDockPage.panel()).toBeHidden();

        // Back on the CMS both are there again — hidden, never closed, so a
        // chat that was running was not thrown away behind the user's back.
        await agentsPage.switchView('CMS');
        await expect(agentsPage.dock).toBeVisible();
        await expect(copilotDockPage.panel()).toBeVisible();
    });
});
