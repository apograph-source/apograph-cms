import { expect, test } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import { mockContentSchema } from '../support/api/content';
import { mockCopilotApi } from '../support/api/copilot';

/** The workspace the suite opens (from the workspaces mock's default seed). */
const WORKSPACE_ID = 'ws_marketing';

/** The seeded thread that has a transcript, a tool call and a change card. */
const THREAD = {
    id: 'c_summary',
    title: 'Which articles are missing a summary?'
};

/**
 * The Agents view's **reading** half: the thread rail, opening a thread, and the
 * states a list has that are not "here are your chats" — a failed load, a filter
 * that matches nothing, a thread that will not open, and a user who may not be
 * here at all.
 */
test.describe('Agents view — the rail and the thread', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
    });

    test('lists the workspace threads under recency headings', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);

        await expect(agentsPage.railRow(THREAD.title)).toBeVisible();
        await expect(
            agentsPage.railRow('Draft release notes for 2.4')
        ).toBeVisible();
        // An untitled thread is still a row — it just has the rail's own word
        // for it, which is deliberately not "New chat".
        await expect(agentsPage.railRow('Untitled chat')).toBeVisible();

        // Newest bucket first, and no heading over an empty bucket. Upper-cased
        // because the headings are, in CSS — this is the rendered text.
        expect(await agentsPage.railGroupNames()).toEqual([
            'TODAY',
            'YESTERDAY',
            'PREVIOUS 7 DAYS',
            'PREVIOUS 30 DAYS',
            'OLDER'
        ]);
    });

    test('filters by title, and an untitled thread matches nothing', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.railRow(THREAD.title).waitFor();

        await agentsPage.filterChats('pricing');

        await expect(
            agentsPage.railRow('Rewrite the pricing page intro')
        ).toBeVisible();
        await expect(agentsPage.railRow(THREAD.title)).toBeHidden();
        // The title is the only text the list route carries, so a thread with
        // no title cannot match a query — including this one.
        await expect(agentsPage.railRow('Untitled chat')).toBeHidden();

        await agentsPage.filterChats('nothing matches this');
        await expect(
            agentsPage.railMessage(/No chats match “nothing matches this”/)
        ).toBeVisible();
    });

    // ORT-182 — the transcript and the input are one column, and they were two.
    // The scroller ran the full width with `px-4` and centred a `max-w-3xl`
    // child inside it; the composer put the same cap on the *outer* element and
    // padded within it, so past the cap the box measured 32px narrower than the
    // messages and the two edges visibly failed to line up.
    test('the composer is the same column as the transcript', async ({
        page,
        agentsPage
    }) => {
        // Wide on purpose. Below the cap both elements are simply the pane
        // width and any nesting passes; the defect only appears once the
        // `max-w-3xl` actually bites, which the default viewport (sidebar +
        // rail + thread) does not reach.
        await page.setViewportSize({ width: 1600, height: 900 });
        await mockCopilotApi(page);
        await agentsPage.gotoThread(WORKSPACE_ID, THREAD.id);
        await expect(agentsPage.transcript()).toBeVisible();

        const column = await agentsPage.transcriptColumn().boundingBox();
        const box = await agentsPage.composerBox().boundingBox();

        expect(column?.width).toBe(768);
        expect(Math.round(box!.x)).toBe(Math.round(column!.x));
        expect(Math.round(box!.x + box!.width)).toBe(
            Math.round(column!.x + column!.width)
        );
    });

    test('a failed list says so instead of claiming there are no chats', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, { listStatus: 500 });
        await agentsPage.goto(WORKSPACE_ID);

        // TanStack Query retries (3×, exponential backoff) before surfacing the
        // error, so allow more than the default assertion timeout.
        await expect(agentsPage.railError()).toBeVisible({ timeout: 15_000 });
        // Saying "no chats yet" after a 500 tells the user their history is
        // gone. It is the one thing this state must never do.
        await expect(agentsPage.railMessage(/No chats yet/)).toBeHidden();

        // Recover: the next list succeeds, and retry renders the threads.
        await mockCopilotApi(page);
        await agentsPage.railRetry().click();
        await expect(agentsPage.railRow(THREAD.title)).toBeVisible();
    });

    test('opens a thread from the rail and announces which one is current', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);

        await agentsPage.railRow(THREAD.title).click();

        await expect(page).toHaveURL(
            new RegExp(`/workspaces/${WORKSPACE_ID}/agents/${THREAD.id}$`)
        );
        await expect(agentsPage.railRow(THREAD.title)).toHaveAttribute(
            'aria-current',
            'page'
        );
        await expect(agentsPage.breadcrumbLeaf()).toHaveText(THREAD.title);
        await expect(agentsPage.transcript()).toBeVisible();
    });

    test('a reopened thread rebuilds the order the run produced', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);
        await agentsPage.gotoThread(WORKSPACE_ID, THREAD.id);

        await expect(agentsPage.transcript()).toBeVisible();
        await expect(agentsPage.toolStep(/Updated an entry/)).toBeVisible();
        await expect(agentsPage.proposalCard(/Set a summary on/)).toBeVisible();

        // The bug this guards: the card used to be pinned below the whole turn,
        // so a model that explained, saved, and kept writing showed the change
        // happening *after* the sentences written after it.
        const text = await agentsPage.transcriptText();
        expect(text.indexOf('Three have none')).toBeLessThan(
            text.indexOf('Updated an entry')
        );
        expect(text.indexOf('Updated an entry')).toBeLessThan(
            text.indexOf('Set a summary on')
        );
        expect(text.indexOf('Set a summary on')).toBeLessThan(
            text.indexOf('That change is saved and published.')
        );
    });

    test('New chat leaves the thread instead of bouncing back into it', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);
        await agentsPage.gotoThread(WORKSPACE_ID, THREAD.id);
        await expect(agentsPage.transcript()).toBeVisible();

        await agentsPage.railNewChat().click();

        const base = new RegExp(`/workspaces/${WORKSPACE_ID}/agents$`);
        await expect(page).toHaveURL(base);
        await expect(agentsPage.welcomeHeading()).toBeVisible();
        // It bounced *back* — a redirect one commit later — so a single URL
        // check the instant after the click would have passed while the bug was
        // live. This waits the page out.
        await expect(agentsPage.transcript()).toBeHidden();
        await expect(page).toHaveURL(base);
    });

    test('the empty thread offers openers, and picking one asks it', async ({
        page,
        agentsPage
    }) => {
        const spy = await mockCopilotApi(page, { empty: true });
        await agentsPage.goto(WORKSPACE_ID);

        await expect(agentsPage.welcomeHeading()).toContainText(
            'Marketing site'
        );
        await expect(
            agentsPage.railMessage(
                /No chats yet\. Ask something to start one\./
            )
        ).toBeVisible();

        await agentsPage
            .suggestion(/What content types can I work with/)
            .click();

        await expect.poll(() => spy.runs.length).toBe(1);
        expect(spy.runs[0]).toMatchObject({
            message: 'What content types can I work with here?'
        });
    });

    test('a thread that will not open offers a retry', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, { detailStatus: 500 });
        await agentsPage.gotoThread(WORKSPACE_ID, THREAD.id);

        // Retries first (3×, exponential backoff), same as the rail above.
        await expect(agentsPage.threadError()).toBeVisible({ timeout: 15_000 });

        await mockCopilotApi(page);
        await agentsPage.threadRetry().click();
        await expect(agentsPage.transcript()).toBeVisible();
    });

    test('without copilot:use there is no page and no switcher', async ({
        page,
        agentsPage
    }) => {
        // Every permission the admin has, minus the one this surface is gated
        // on — the shape of a role that can edit content but not use Ortha AI.
        await mockSignedIn(page, { permissions: ['workspaces:read'] });
        await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);

        await expect(page.getByRole('alert')).toContainText('No access');
        await expect(agentsPage.viewSwitcher()).toBeHidden();
        await expect(agentsPage.rail).toBeHidden();
    });
});

/**
 * What a **thread** remembers about the model it was left on.
 *
 * The choice is still sent per turn — a conversation can start cheap and
 * escalate, and nothing here pins it. What is fixed is the forgetting: it used
 * to live only in this tab's memory, so reopening a saved conversation
 * tomorrow, or in a second tab, silently put the user back on Default without
 * saying so.
 *
 * The seeded threads carry the three states a stored value can be in:
 * `c_pricing` was left on a concrete backend, `c_bios` on the retired
 * `'default'` sentinel (rows written when "Default" was still an option), and
 * `c_summary` on nothing at all.
 */
test.describe('Agents view — the model a thread was left on', () => {
    /** Left on `openai:gpt-5.2`. */
    const PICKED = 'Rewrite the pricing page intro';
    /** Left on the retired `'default'` sentinel — an old row. */
    const DEFAULTED = 'Audit author bios for broken links';

    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
    });

    test('reopening a thread offers the backend it was left on', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);

        await agentsPage.gotoThread(WORKSPACE_ID, 'c_pricing');

        // Nothing in this tab picked it — it came back from the thread, which
        // is the whole point: a fresh tab used to start every saved
        // conversation on Default.
        await expect(agentsPage.modelPicker()).toContainText('gpt-5.2');
    });

    test('a thread left on the retired Default sentinel opens on the first model', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);

        // A pick in this tab, which seeds every chat started after it.
        await agentsPage.chooseModel('claude-opus-5');
        await expect(agentsPage.modelPicker()).toContainText('claude-opus-5');

        await agentsPage.railRow(DEFAULTED).click();

        // `'default'` used to mean "whatever the host's resolver picks". The
        // option is gone and so is the setting behind it, so an old row
        // carrying it reads as "nobody picked here" — which lands on the
        // catalogue's first entry. It still overrules the tab's seed: the
        // thread said something, even if what it said no longer exists.
        await expect(agentsPage.modelPicker()).toContainText('claude-sonnet-5');

        await agentsPage.railRow(THREAD.title).click();

        // …and a thread that never carried a value keeps the seed, rather than
        // being quietly reset by the same code path.
        await expect(agentsPage.modelPicker()).toContainText('claude-opus-5');
    });

    test('a model picked on a thread is written to it, and survives a reload', async ({
        page,
        agentsPage
    }) => {
        const spy = await mockCopilotApi(page);
        await agentsPage.gotoThread(WORKSPACE_ID, THREAD.id);
        await expect(agentsPage.transcript()).toBeVisible();

        await agentsPage.chooseModel('gpt-5.2');

        await expect
            .poll(() => spy.patches)
            .toContainEqual({
                id: THREAD.id,
                body: { modelChoice: 'openai:gpt-5.2' }
            });

        // A reload is the honest test of "it outlived the tab": the store, the
        // per-tab seed and every component are gone, so anything the picker
        // shows now came back over the wire.
        await page.reload();

        await expect(agentsPage.modelPicker()).toContainText('gpt-5.2');
    });

    test('adopting a thread’s model does not write it straight back', async ({
        page,
        agentsPage
    }) => {
        const spy = await mockCopilotApi(page);

        await agentsPage.gotoThread(WORKSPACE_ID, 'c_pricing');
        await expect(agentsPage.modelPicker()).toContainText('gpt-5.2');

        // Reading is not picking. Echoing the value the server just sent would
        // be a write per thread opened — and it would make the rail's own
        // "last used" ordering answer for something nobody did.
        expect(spy.patches).toEqual([]);
    });

    test('a fresh chat still inherits the last model picked in the tab', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.chooseModel('claude-opus-5');

        // Through a thread that has its own stored model, so the seed has every
        // chance to be clobbered on the way past.
        await agentsPage.railRow(PICKED).click();
        await expect(agentsPage.modelPicker()).toContainText('gpt-5.2');
        await agentsPage.railNewChat().click();

        // The per-tab seed is what the person last **picked**, and adopting a
        // thread's model is not picking: somebody who always wants the bigger
        // model does not re-pick it because they read an old conversation.
        await expect(agentsPage.welcomeHeading()).toBeVisible();
        await expect(agentsPage.modelPicker()).toContainText('claude-opus-5');
    });
});
