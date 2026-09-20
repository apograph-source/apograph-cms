import { expect, test } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import { mockContentSchema } from '../support/api/content';
import {
    failedProposalRun,
    frame,
    longFailedProposalRun,
    mockCopilotApi
} from '../support/api/copilot';

const WORKSPACE_ID = 'ws_marketing';

/**
 * The Agents view's **writing** half: asking something, what the answer looks
 * like as it lands, and the two things that must survive leaving the page — the
 * run itself, and the model the user picked.
 *
 * The run route is stubbed as a real `text/event-stream`, so the transcript here
 * is built by the same reducer a live server drives. What the stub cannot
 * reproduce is frames arriving progressively; everything about the finished turn
 * — its prose, its steps, its change card and their **order** — is exactly what
 * the server would produce.
 */
test.describe('Agents view — asking', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
    });

    test('asks, promotes the URL to the new thread, and answers in order', async ({
        page,
        agentsPage
    }) => {
        const spy = await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Set the summary please');

        // The first turn mints a thread id, and the URL adopts it — `replace`,
        // so "new chat" and "that chat" are one step in the browser's history.
        await expect(page).toHaveURL(
            new RegExp(`/workspaces/${WORKSPACE_ID}/agents/c_new$`)
        );
        expect(spy.runs[0]).toMatchObject({
            message: 'Set the summary please'
        });

        await expect(agentsPage.toolStep(/Updated an entry/)).toBeVisible();
        await expect(agentsPage.proposalCard(/Set a summary on/)).toBeVisible();

        const text = await agentsPage.transcriptText();
        expect(
            text.indexOf('Setting the summary on that article')
        ).toBeLessThan(text.indexOf('Updated an entry'));
        expect(text.indexOf('Updated an entry')).toBeLessThan(
            text.indexOf('Set a summary on')
        );
        // The sentence written *after* the change renders after the receipt for
        // it, which is the whole point of a turn being an ordered block list.
        expect(text.indexOf('Set a summary on')).toBeLessThan(
            text.indexOf('Afterwards: the change is saved.')
        );
    });

    test('switching threads is navigation, so Back moves between them', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);

        await agentsPage
            .railRow('Which articles are missing a summary?')
            .click();
        await expect(agentsPage.transcript()).toBeVisible();
        await agentsPage.railRow('Rewrite the pricing page intro').click();
        await expect(page).toHaveURL(/\/agents\/c_pricing$/);

        await page.goBack();

        // The URL is the thread, which is what makes the browser's own Back
        // button work here at all.
        await expect(page).toHaveURL(/\/agents\/c_summary$/);
        await expect(
            agentsPage.railRow('Which articles are missing a summary?')
        ).toHaveAttribute('aria-current', 'page');
    });

    test('sends the picked model, and still has it after a trip through the CMS', async ({
        page,
        agentsPage
    }) => {
        const spy = await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        // A new chat opens on the catalogue's FIRST entry, not on a
        // "Default" row that named no model — the first registered provider is
        // the deployment default, and the header says which one that is.
        await expect(agentsPage.modelPicker()).toContainText('claude-sonnet-5');
        await agentsPage.chooseModel('gpt-5.2');
        await expect(agentsPage.modelPicker()).toContainText('gpt-5.2');

        await agentsPage.ask('Set the summary please');
        await expect.poll(() => spy.runs.length).toBe(1);
        expect(spy.runs[0]).toMatchObject({
            provider: 'openai',
            model: 'gpt-5.2'
        });

        // The reported bug: the choice lived in the component that drew the
        // picker, so leaving the page silently put the user back on the default.
        await agentsPage.switchView('CMS');
        await agentsPage.switchView('Agents');

        await expect(agentsPage.modelPicker()).toContainText('gpt-5.2');
    });

    test('the composer grows with what you type, up to a ceiling', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        const twoRows = await agentsPage.composerHeight();

        await agentsPage.composer().fill('a paragraph\n'.repeat(4));
        const grown = await agentsPage.composerHeight();
        expect(grown).toBeGreaterThan(twoRows);

        await agentsPage.composer().fill('a paragraph\n'.repeat(40));
        const capped = await agentsPage.composerHeight();
        // ~six lines, and then it scrolls — a composer without a ceiling eats
        // the answer it is a reply to.
        expect(capped).toBeLessThanOrEqual(160);

        // And back down: `scrollHeight` never reports less than the height
        // already set, so shrinking is the half that breaks first.
        await agentsPage.composer().fill('short');
        expect(await agentsPage.composerHeight()).toBeLessThan(grown);
    });

    test('a run outlives the page it started on, and says so', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, { runDelayMs: 2_000 });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Set the summary please');
        await expect(agentsPage.stopButton()).toBeVisible();

        // Leaving mid-answer used to be a disguised Stop. Now the chat is handed
        // to the dock as a live pill and keeps streaming.
        await agentsPage.switchView('CMS');

        await expect(agentsPage.dockPill(/finished/)).toBeVisible({
            timeout: 15_000
        });
        // …and the tab says so too, for a user who has switched to another one.
        await expect.poll(() => page.title()).toMatch(/^\(1\)/);
    });

    test('stopping a run leaves a note rather than an error', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, { runDelayMs: 10_000 });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Set the summary please');
        await agentsPage.stopButton().click();

        // Cancelling is something the user did on purpose, so it gets a quiet
        // line — not the destructive alert a failed turn gets.
        await expect(
            agentsPage.transcript().getByText('You stopped this answer.')
        ).toBeVisible();
        await expect(agentsPage.sendButton()).toBeVisible();
    });
});

/**
 * The five defects a QA pass found in the transcript and the composer.
 *
 * Note what is **not** here: the streaming experience. `page.route` delivers the
 * SSE body in one read, so every assertion below is about a run's frames landing
 * — which is enough for all five, because each is a rule about what the app does
 * *when the transcript changes*, not about how fast the changes arrive.
 */
test.describe('Agents view — regressions', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
    });

    test('sending while a run is in flight says why, instead of silence', async ({
        page,
        agentsPage
    }) => {
        const spy = await mockCopilotApi(page, { runDelayMs: 4_000 });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Set the summary please');
        await expect(agentsPage.stopButton()).toBeVisible();

        // A second question, mid-answer. The send is correctly refused — one
        // run per chat — and the typed text is correctly kept. What was missing
        // is any indication of either, so someone who had not noticed the
        // button become Stop read it as a dropped keystroke.
        await agentsPage.composer().fill('And the headline too');
        await agentsPage.composer().press('Enter');

        await expect(agentsPage.composerHint()).toContainText(
            /Still answering/
        );
        // Kept, not sent: the text is still in the box and no second run went.
        await expect(agentsPage.composer()).toHaveValue('And the headline too');
        expect(spy.runs).toHaveLength(1);

        // And the notice does not outlive the state that caused it.
        await expect(agentsPage.sendButton()).toBeVisible({ timeout: 15_000 });
        await expect(agentsPage.composerHint()).toContainText(/Enter to send/);
    });

    test('a truncated run explains itself in a translatable sentence', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, {
            runBody: (conversationId) =>
                [
                    frame({
                        type: 'run-started',
                        runId: 'r_t',
                        conversationId
                    }),
                    frame({ type: 'text-delta', text: 'Halfway through…' }),
                    frame({
                        type: 'done',
                        messageId: 'm_t',
                        stopReason: 'max-steps'
                    })
                ].join('')
        });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Do something long');

        // A warning, not a destructive alert: the answer is real, just short.
        // The reason fragment used to be a bare English literal interpolated
        // into the translated frame around it, so no extractor could see it and
        // no catalogue could ever translate it — the sentence localized and the
        // half carrying its meaning did not.
        await expect(
            agentsPage
                .transcript()
                .getByText(
                    'Stopped because it reached the maximum number of steps.'
                )
        ).toBeVisible();
        // The partial answer is kept beside it.
        await expect(agentsPage.transcript()).toContainText('Halfway through');
    });

    test('a failed step says it failed, even when the tool returned a summary', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, {
            runBody: (conversationId) =>
                [
                    frame({
                        type: 'run-started',
                        runId: 'r_f',
                        conversationId
                    }),
                    frame({
                        type: 'tool-call',
                        id: 'call_f',
                        name: 'content_propose_update',
                        input: { contentType: 'article', id: 'e42' }
                    }),
                    // The shape a failed apply actually arrives in since the
                    // server pass: `ok: false`, **with** a summary. The step's
                    // "Failed" used to be the `??` fallback for having no
                    // summary at all, so the one case most likely to reach a
                    // user was the one that never said so.
                    frame({
                        type: 'tool-result',
                        id: 'call_f',
                        ok: false,
                        summary: 'failed: set the number',
                        error: 'value out of range',
                        durationMs: 12
                    }),
                    frame({
                        type: 'done',
                        messageId: 'm_f',
                        stopReason: 'end'
                    })
                ].join('')
        });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Set the number');

        // The status is in the step's accessible name, not only in a red ring
        // and a colour — which is nothing at all to a screen reader (1.4.1).
        const step = agentsPage.toolStep(/Updated an entry/);
        await expect(step).toBeVisible();
        await expect(step).toHaveAccessibleName(/Failed/);
        // The tool's own line still shows, after the status rather than
        // instead of it.
        await expect(step).toContainText('failed: set the number');
    });

    test('a table in an answer has headers, a name, and a scroll region a keyboard can reach', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, {
            runBody: (conversationId) =>
                [
                    frame({
                        type: 'run-started',
                        runId: 'r_x',
                        conversationId
                    }),
                    frame({
                        type: 'text-delta',
                        text: '| Type | Entries |\n| --- | --- |\n| Article | 12 |\n'
                    }),
                    frame({
                        type: 'done',
                        messageId: 'm_x',
                        stopReason: 'end'
                    })
                ].join('')
        });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('List the content types');

        const table = agentsPage.transcript().getByRole('table');
        await expect(table).toBeVisible();
        // Named, so it is not announced as an anonymous "table with 2 columns".
        await expect(table).toHaveAccessibleName('Table in this answer');
        // `scope="col"`, without which cell navigation announces bare values.
        await expect(
            table.getByRole('columnheader', { name: 'Type' })
        ).toHaveAttribute('scope', 'col');
        // The wrapper scrolls sideways, so it has to be focusable — a scroll
        // container with no tab stop hides its right-hand columns from anyone
        // without a mouse (2.1.1).
        await expect(
            agentsPage
                .transcript()
                .getByRole('region', { name: 'Table in this answer' })
        ).toHaveAttribute('tabindex', '0');
    });
});

/**
 * **What the run says it is doing, and what it says when it could not.**
 *
 * Two things a QA pass named: a change card whose failure banner was cramped
 * against the line below it and whose icon sat above its own sentence, and a
 * transcript that answered "what is happening?" with the word "Thinking…" in
 * every gap, including the ones where it had just done something specific.
 *
 * The pending phases are observable here despite `page.route` delivering the
 * whole SSE body in one read, and the trick is worth knowing: a body that
 * simply **stops** — no `done` frame — leaves the turn `streaming` for good,
 * because `done` is the only frame that clears it. So the state the eye would
 * catch for half a second becomes a state the assertions can take their time
 * over. What is still out of reach is watching it change.
 */
/** A rectangle in the page, as `boundingBox()` reports one. */
interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * A box, or a failure that names what could not be measured.
 *
 * `boundingBox()` is nullable for a good reason — an element that is not laid
 * out has no rectangle — and the alternative here is a `!` on every read, which
 * turns "the icon never rendered" into an unreadable `undefined` arithmetic
 * failure three lines later.
 */
function laidOut(box: Box | null, what: string): Box {
    if (!box) {
        throw new Error(`${what} is not laid out, so it cannot be measured.`);
    }
    return box;
}

test.describe('Agents view — what the run is doing', () => {
    const FAILED = 'German translation of Prescribing Information';

    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        await mockContentSchema(page);
    });

    test('a change that did not apply says so, with room around it', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, { runBody: failedProposalRun });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Translate that into German');

        // The server's own reason, not a generic apology — this card is the
        // only place a user learns their content did not change.
        const alert = agentsPage.proposalError(FAILED);
        await expect(alert).toContainText(
            'No translation group “prescribing-information” on tag.'
        );

        // **Spacing.** The wrapper was `pt-3` with no bottom padding, so the
        // banner butted straight into the rule below it and read as part of it.
        // Measured rather than snapshotted: the number that matters is the gap,
        // and it survives a font change.
        //
        // Against the **card's own bottom edge**, not a footer: a failure that
        // carried its own reason omits the footer entirely (it would restate,
        // and contradict, the sentence in the banner — "Nothing was saved."
        // under "the first 3 were saved"). This measured the gap to that
        // footer, so on the one card the case describes there was nothing to
        // measure to, and it waited 30s for an element the component is right
        // not to render.
        const alertBox = laidOut(await alert.boundingBox(), 'the alert');
        const cardBox = laidOut(
            await agentsPage.proposalCard(FAILED).boundingBox(),
            'the change card'
        );
        expect(
            cardBox.y + cardBox.height - (alertBox.y + alertBox.height)
        ).toBeGreaterThanOrEqual(8);
        // …and the footer really is absent, so the assertion above is measuring
        // the case it claims to.
        await expect(agentsPage.proposalFooter(FAILED)).toHaveCount(0);

        // **Alignment.** The design system positions a top-level `<svg>` at a
        // fixed `top-4` and nudges the text up 3px — geometry for an alert with
        // a title over a description. On this one, a description alone, the
        // icon sat high and the sentence sat off centre.
        const iconBox = laidOut(
            await agentsPage.proposalErrorIcon(FAILED).boundingBox(),
            'the alert’s icon'
        );
        expect(
            Math.abs(
                iconBox.y +
                    iconBox.height / 2 -
                    (alertBox.y + alertBox.height / 2)
            )
        ).toBeLessThanOrEqual(2);
    });

    test('a long reason scrolls rather than pushing the diff off the card', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, { runBody: longFailedProposalRun });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Translate that into German');

        const reason = agentsPage.proposalReason(FAILED);
        // The end of the server's message, so the fixture really is the long
        // one and not a truncation of it — nothing here shortens `error`.
        await expect(reason).toContainText('section_20');

        // **The two things the bound exists to protect.** An unbounded reason
        // made the alert taller than everything above it, so the reader was
        // left scrolling through an explanation of a change they could no
        // longer see. `toBeInViewport`, not `toBeVisible`: the whole failure
        // was about being pushed off the screen, and a laid-out element far
        // above the fold is "visible" to Playwright.
        await expect(
            agentsPage.proposalBadge(FAILED, 'Not saved')
        ).toBeInViewport();
        await expect(agentsPage.proposalDiff(FAILED)).toBeInViewport();

        // Bounded **and** scrolling, which is the difference between this and
        // clipping: the content is taller than the box it is drawn in.
        const bounded = await agentsPage.proposalReasonScroll(FAILED);
        expect(bounded.scroll).toBeGreaterThan(bounded.client);
        // `max-h-56` — 14rem, the same ceiling the tool step's payload uses.
        expect(bounded.client).toBeLessThanOrEqual(224);

        // **Reachable by keyboard alone** (2.1.1). A scroll container with no
        // tab stop puts everything past the fold out of reach of someone
        // without a mouse — on the one block that says why their content did
        // not change.
        await reason.focus();
        await expect(reason).toBeFocused();
        await page.keyboard.press('End');
        await expect
            .poll(
                async () => (await agentsPage.proposalReasonScroll(FAILED)).top
            )
            .toBeGreaterThan(0);

        // **Alignment, the tall case.** `items-center` floated the icon to the
        // middle of the box, where it pointed at whichever sentence happened to
        // be halfway down. It belongs beside the first line.
        const alertBox = laidOut(
            await agentsPage.proposalError(FAILED).boundingBox(),
            'the alert'
        );
        const iconBox = laidOut(
            await agentsPage.proposalErrorIcon(FAILED).boundingBox(),
            'the alert’s icon'
        );
        expect(iconBox.y - alertBox.y).toBeLessThanOrEqual(20);
        expect(iconBox.y + iconBox.height).toBeLessThan(
            alertBox.y + alertBox.height / 2
        );
    });

    test('a one-line reason reserves no space and grows no scrollbar', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, { runBody: failedProposalRun });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Translate that into German');

        await expect(agentsPage.proposalReason(FAILED)).toBeVisible();

        // The fussy half of the bound. `max-h` reserves nothing and
        // `overflow-auto` draws nothing while there is nothing to scroll, so
        // the ordinary reason — which is nearly every reason — is the same one
        // line it always was. Equal heights is exactly "no scrollbar": a
        // scrollbar only exists where the content exceeds the box.
        const short = await agentsPage.proposalReasonScroll(FAILED);
        expect(short.scroll).toBe(short.client);
        // One 20px line of `text-sm`, with nothing padded under it.
        expect(short.client).toBeLessThanOrEqual(24);

        // The icon's own position in this case is asserted by the spacing test
        // above, which measures it against the banner's centre.
    });

    test('a step names the thing it is doing, not just the kind of thing', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, { runBody: failedProposalRun });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Translate that into German');

        // "Added a translation" is a category. The `summary` the propose tools
        // are asked to write for a person is on the `tool-call` frame already,
        // and it is the thing the user actually asked for.
        const step = agentsPage.toolStep(/Added a translation/);
        await expect(step).toBeVisible();
        await expect(step).toContainText(FAILED);
    });

    test('the pending line names the call that just ran', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, {
            runBody: (conversationId) =>
                [
                    frame({
                        type: 'run-started',
                        runId: 'r_gap',
                        conversationId
                    }),
                    frame({
                        type: 'text-delta',
                        text: 'Let me look that up. '
                    }),
                    frame({
                        type: 'tool-call',
                        id: 'call_gap',
                        name: 'admin_content_search',
                        input: { typeName: 'article', search: 'pricing' }
                    }),
                    frame({
                        type: 'tool-result',
                        id: 'call_gap',
                        ok: true,
                        summary: '3 results',
                        durationMs: 8
                    })
                    // No `done`: the turn stays streaming, which is what makes
                    // the gap between one call and the next assertable at all.
                ].join('')
        });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Which pricing articles are stale?');

        await expect(
            agentsPage.activityLine(/Searched content — working out what/)
        ).toBeVisible();
        // Two regressions in one assertion: the generic word is gone, and this
        // gap used to show *nothing at all* — the old condition stood down for
        // the rest of the turn as soon as any prose had arrived.
        await expect(agentsPage.transcript()).not.toContainText('Thinking');
        // The search's own subject rides along on the step above it.
        await expect(agentsPage.toolStep(/Searched content/)).toContainText(
            'pricing'
        );
    });

    test('and still says “Thinking…” when that is genuinely all it knows', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page, {
            // The turn has been accepted and nothing has come back yet. There
            // is no action to name here, and inventing one would be worse than
            // the generic word.
            runBody: (conversationId) =>
                frame({
                    type: 'run-started',
                    runId: 'r_idle',
                    conversationId
                })
        });
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Think about it');

        await expect(agentsPage.activityLine('Thinking…')).toBeVisible();
    });

    test('a reopened thread names its steps exactly as the live run did', async ({
        page,
        agentsPage
    }) => {
        await mockCopilotApi(page);
        await agentsPage.goto(WORKSPACE_ID);
        await agentsPage.welcomeHeading().waitFor();

        await agentsPage.ask('Set the summary please');
        const live = await agentsPage.toolStep(/Updated an entry/).innerText();

        // The subject is derived on the client from the call's arguments, and a
        // stored `tool_use` block keeps them — so the two paths must agree with
        // no protocol change and no second mapping to keep in step.
        await agentsPage
            .railRow('Which articles are missing a summary?')
            .click();
        await expect(agentsPage.toolStep(/Updated an entry/)).toBeVisible();
        const reopened = await agentsPage
            .toolStep(/Updated an entry/)
            .innerText();

        expect(live).toContain('article');
        expect(reopened).toContain('article');
    });
});
