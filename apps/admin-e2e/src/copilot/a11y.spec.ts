import { test } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import { mockContentSchema } from '../support/api/content';
import {
    failedProposalRun,
    longFailedProposalRun,
    mockCopilotApi
} from '../support/api/copilot';
import { expectNoA11yViolations } from '../support/a11y';

const WORKSPACE_ID = 'ws_marketing';
const THREAD = 'Which articles are missing a summary?';

/**
 * Accessibility scans (axe, WCAG 2.1 A/AA) of the Agents view and its dynamic
 * states — the empty thread with its honeycomb backdrop, a loaded transcript
 * with a tool step and a change card, the archived list, and the rename dialog.
 * A regression guard, not a conformance claim.
 *
 * The rail's group headings are 10px uppercase, which is exactly the size at
 * which a tinted `text-muted-foreground/80` stops clearing AA — this scan is
 * what says so, and the reason the headings use the full token.
 */
test.describe('Agents view accessibility (axe, WCAG 2.1 A/AA)', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
        await mockCopilotApi(page);
    });

    test('the empty thread, its openers and the rail', async ({
        agentsPage,
        makeAxe
    }) => {
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();
        await agentsPage.railRow(THREAD).waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('a transcript with a tool step and a change card', async ({
        agentsPage,
        makeAxe
    }) => {
        await agentsPage.gotoThread(WORKSPACE_ID, 'c_summary');
        await agentsPage.proposalCard(/Set a summary on/).waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('a change card that did not apply', async ({
        page,
        agentsPage,
        makeAxe
    }) => {
        // Registered after the `beforeEach` mock, which is what makes it win —
        // Playwright matches the **last** registered route first.
        await mockCopilotApi(page, { runBody: failedProposalRun });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Translate that into German');
        await agentsPage
            .proposalCard('German translation of Prescribing Information')
            .waitFor();

        // The card's failure banner is a `role="alert"` inside a `role="log"`,
        // its icon is `aria-hidden` (the sentence beside it is the accessible
        // version), and the destructive palette has to clear AA on the tinted
        // ground it sits on — none of which the passing card exercises.
        await expectNoA11yViolations(makeAxe());
    });

    test('a change card whose reason does not fit', async ({
        page,
        agentsPage,
        makeAxe
    }) => {
        await mockCopilotApi(page, { runBody: longFailedProposalRun });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Translate that into German');
        await agentsPage
            .proposalCard('German translation of Prescribing Information')
            .waitFor();

        // Its own state, not a longer version of the one above:
        // `scrollable-region-focusable` only fires where the element actually
        // overflows, so the short-reason card scans green whether or not the
        // block is reachable. This is the scan that says the bound did not
        // trade a clipped message for an unreachable one.
        await expectNoA11yViolations(makeAxe());
    });

    test('an expanded tool step', async ({ agentsPage, makeAxe }) => {
        await agentsPage.gotoThread(WORKSPACE_ID, 'c_summary');
        await agentsPage.toolStep(/Updated an entry/).click();
        await expectNoA11yViolations(makeAxe());
    });

    test('the archived list', async ({ agentsPage, makeAxe }) => {
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.railRow(THREAD).waitFor();
        await agentsPage.chooseRowAction(THREAD, 'Archive');
        await agentsPage.archivedLink().click();
        await agentsPage.railRow(THREAD).waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('the rename dialog', async ({ agentsPage, makeAxe }) => {
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.railRow(THREAD).waitFor();
        await agentsPage.chooseRowAction(THREAD, 'Rename…');
        await agentsPage.renameInput().waitFor();
        await expectNoA11yViolations(makeAxe());
    });

    test('a rail row’s menu, open', async ({ agentsPage, makeAxe }) => {
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.railRow(THREAD).waitFor();
        await agentsPage.openRowMenu(THREAD);
        await expectNoA11yViolations(makeAxe());
    });

    test('the model picker, open', async ({ agentsPage, makeAxe }) => {
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.modelPicker().click();
        await expectNoA11yViolations(makeAxe());
    });
});
