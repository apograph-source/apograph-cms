import { test, expect } from '../support/fixtures';
import { expectNoA11yViolations } from '../support/a11y';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    LIBRARY_WORKSPACE,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites,
    mockEntryRelations
} from '../support/api/content';
import {
    UNPROTECTED,
    mockEntryReview,
    mockNewEntryProtection
} from '../support/api/protection';

const WS = LIBRARY_WORKSPACE.id;
const TYPE = 'blog_post';
/** The first row of the fabricated page — the record whose editor is opened. */
const ENTRY = 'blog_post-01';
/** The signed-in admin `mockSignedIn` seeds by default. */
const ME = '00000000-0000-0000-0000-000000000001';

/**
 * Publication protection **inside the entry editor** — the three surfaces an
 * editor actually meets it through, in a real browser.
 *
 * The server side is covered by `server-e2e`; what only a browser can answer is
 * whether the requirement is *legible*: whether a person who has not read the
 * ADR can tell why Publish will not go, and whether the count rolling back
 * after a save explains itself instead of just changing.
 */
test.describe('Publication protection in the entry editor', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        await mockContentSchema(page);
        await mockContentSchemaDetail(page);
        await mockContentEntries(page);
        await mockContentEntryWrites(page);
        await mockEntryRelations(page);
    });

    /**
     * The state every installation is in until somebody writes a rule, and the
     * one this plugin spends almost all of its life in. Nothing may appear.
     */
    test('says nothing at all on an unprotected type', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, UNPROTECTED);
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        await expect(page.getByText(/needs review/i)).toHaveCount(0);
        await expect(
            page.getByRole('heading', { name: 'Review', exact: true })
        ).toHaveCount(0);
        const publish = page.getByRole('button', { name: /^publish$/i });
        await expect(publish).toBeVisible();
        await expect(publish).not.toHaveAttribute('aria-disabled', 'true');
    });

    test('shows the requirement in the chip and the rail', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, { required: 2, given: 0 });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        await expect(page.getByText('Needs review · 0 of 2')).toBeVisible();
        await expect(
            page.getByRole('heading', { name: 'Review', exact: true })
        ).toBeVisible();
        await expect(page.getByText('0 of 2', { exact: true })).toBeVisible();
    });

    /**
     * ⭐ The line the whole feature turns on: somebody whose approval a save
     * left behind is pending again, and the sentence saying why is real text.
     */
    test('explains a stale approval in words, not only in decoration', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 2,
            given: 1,
            stale: 1,
            approvals: [
                { userId: 'u-anna', revisionNumber: 7 },
                {
                    userId: 'u-dmitry',
                    revisionNumber: 4,
                    revisionId: 'rev-4',
                    isStale: true
                }
            ]
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        await expect(
            page.getByText(
                /approved version 4 .* the entry has changed since, so this no longer counts/
            )
        ).toBeVisible();
    });

    /**
     * Who was asked, and where each of them stands: a green check once they
     * approved this version, a yellow dot while that is pending — each with its
     * state written out, so colour is never the only signal.
     */
    test('lists the requested reviewers with a check or a pending dot', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 2,
            given: 1,
            approvals: [{ userId: 'u_ada', revisionNumber: 7 }],
            request: {
                id: 'req-1',
                requestedBy: ME,
                reviewerIds: ['u_ada', 'u_gone'],
                revisionId: 'rev-7',
                createdAt: '2026-09-09T09:00:00.000Z'
            }
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        const ada = page
            .getByRole('listitem')
            .filter({ hasText: 'Ada Lovelace' });
        await expect(ada).toContainText('Approved');
        await expect(ada.locator('[data-state="approved"] svg')).toBeVisible();

        const pending = page
            .getByRole('listitem')
            .filter({ hasText: 'A former member' });
        await expect(pending).toContainText('Pending');
        await expect(pending.locator('[data-state="pending"] svg')).toHaveCount(
            0
        );

        // Asked already, so the button changes who is asked.
        await expect(
            page.getByRole('button', { name: 'Change reviewers' })
        ).toBeVisible();
    });

    /**
     * Request review opens a picker of the people who can approve; the request
     * carries who was picked, and nothing else — there are no notes.
     */
    test('requests review from the people picked in the dialog', async ({
        page,
        contentLibraryPage
    }) => {
        const writes = await mockEntryReview(page, {
            required: 1,
            given: 0,
            candidates: [{ userId: 'u_ada', email: 'ada@ortha.dev' }]
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        // Activated from the keyboard: the copilot dock is `fixed bottom-3
        // right-4` with `z-40` and floats over the bottom of the properties
        // rail, which is where this button sits — a pointer click never becomes
        // actionable and the test times out waiting for it. The same workaround
        // the records footer needs, for the same reason.
        await page.getByRole('button', { name: 'Request review' }).focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', { name: 'Request review' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('textbox')).toHaveCount(0);

        // Nobody picked is refused out loud rather than with a dead button.
        await dialog.getByRole('button', { name: 'Request' }).click();
        await expect(dialog.getByRole('alert')).toContainText(
            /at least one reviewer/i
        );
        expect(writes).toHaveLength(0);

        await dialog.getByRole('checkbox', { name: /Ada Lovelace/ }).click();
        await dialog.getByRole('button', { name: 'Request' }).click();

        await expect(dialog).toHaveCount(0);
        expect(writes).toEqual([
            {
                method: 'POST',
                action: 'request',
                body: { reviewerIds: ['u_ada'] }
            }
        ]);
    });

    /** Once you approved this version there is nothing left to press. */
    test('offers no Approve button to somebody who already approved', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 2,
            given: 1,
            callerApprovedHead: true,
            approvals: [{ userId: 'u_ada', revisionNumber: 7 }]
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        await expect(
            page.getByRole('listitem').filter({ hasText: 'Ada Lovelace' })
        ).toContainText('Approved');
        await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(
            0
        );
    });

    test('offers Approve to a reviewer who has not approved this version', async ({
        page,
        contentLibraryPage
    }) => {
        const writes = await mockEntryReview(page, { required: 2, given: 0 });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        await page.getByRole('button', { name: 'Approve' }).click();

        await expect
            .poll(() => writes.map((w) => w.action))
            .toEqual(['approve']);
        // No note travels with it.
        expect(writes[0].body).toBeNull();
    });

    test('holds the publish button and says how far short it is', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, { required: 2, given: 0, blocked: true });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        const publish = page.getByRole('button', { name: /^publish$/i });
        await expect(publish).toHaveAttribute('aria-disabled', 'true');
        // The reason reaches a screen reader as the button's *description*.
        await expect(
            page.getByText('2 approvals required on this version, 0 given.')
        ).toBeAttached();
    });

    /**
     * The button an administrator meets is an ordinary Publish — the bypass is
     * announced by the dialog the click opens, which names the rule and demands
     * a confirmation, not by a second kind of button.
     */
    test('keeps an ordinary Publish for an administrator and asks to confirm on click [protection:I-20]', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 2,
            given: 0,
            blocked: true,
            bypassable: true
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        const publish = page.getByRole('button', { name: /^publish$/i });
        await expect(publish).toBeVisible();
        await expect(publish).not.toHaveAttribute('aria-disabled', 'true');
        await expect(
            page.getByRole('button', { name: /publish anyway/i })
        ).toHaveCount(0);

        await publish.click();
        await expect(page.getByRole('dialog')).toBeVisible();
    });

    /**
     * ⭐ The bug this pins: Publish used to save first unconditionally, and the
     * save wrote a new version — so the approval just given was on a version
     * nobody was publishing, and the publish was refused for it.
     */
    test('publishes an approved, unchanged entry without saving it first [protection:I-19]', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 1,
            given: 1,
            blocked: false
        });
        const saves: string[] = [];
        page.on('request', (request) => {
            if (
                request.method() === 'PATCH' &&
                request.url().includes(`/api/content/${TYPE}/${ENTRY}`)
            ) {
                saves.push(request.url());
            }
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        const published = page.waitForRequest(
            (request) =>
                request.method() === 'POST' &&
                request.url().endsWith(`/api/content/${TYPE}/${ENTRY}/publish`)
        );
        await page.getByRole('button', { name: /^publish$/i }).click();
        await published;

        expect(saves).toHaveLength(0);
    });

    /**
     * The other half of the same fact: with unsaved edits, Publish saves first,
     * that save is a new version, and the approval on the stored one will not
     * count. The button has to say so before the click, not after the save.
     */
    test('holds Publish once there are unsaved edits the approval does not cover [protection:I-18]', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 1,
            given: 1,
            blocked: false,
            afterSave: { required: 1, given: 0, blocked: true }
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        const publish = page.getByRole('button', { name: /^publish$/i });
        await expect(publish).not.toHaveAttribute('aria-disabled', 'true');

        await contentLibraryPage.fieldTextbox('Title').fill('A late edit');

        await expect(publish).toHaveAttribute('aria-disabled', 'true');
        await expect(
            page.getByText(
                'Saving your changes starts a new version: 1 approval required, 0 would count.'
            )
        ).toBeAttached();
    });

    test('sends the bypass with the publish itself, once confirmed [protection:I-20]', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 2,
            given: 0,
            blocked: true,
            bypassable: true
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        await page.getByRole('button', { name: /^publish$/i }).click();
        const dialog = page.getByRole('dialog');
        // A confirmation: nothing to write, only the rule and the log row.
        await expect(dialog.getByRole('textbox')).toHaveCount(0);

        const published = page.waitForRequest(
            (request) =>
                request.method() === 'POST' &&
                request.url().endsWith(`/api/content/${TYPE}/${ENTRY}/publish`)
        );
        await dialog.getByRole('button', { name: /publish anyway/i }).click();

        expect((await published).postDataJSON()).toEqual({ bypass: true });
        await expect(dialog).toHaveCount(0);
    });

    /**
     * ⭐ The half of the bypass fix nothing else sees: the edits on screen go
     * out **before** the publish that carries the bypass. The dialog used to
     * post the publish itself, shipping the stored record and dropping the
     * edit.
     */
    test('saves the edits on screen, then publishes past the rule [protection:I-20]', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 1,
            given: 1,
            blocked: false,
            afterSave: { given: 0, blocked: true, bypassable: true }
        });
        const writes: { method: string; path: string; body: unknown }[] = [];
        page.on('request', (request) => {
            const path = new URL(request.url()).pathname;
            if (!path.startsWith(`/api/content/${TYPE}/${ENTRY}`)) return;
            if (request.method() !== 'PATCH' && request.method() !== 'POST')
                return;
            writes.push({
                method: request.method(),
                path,
                body: request.postDataJSON()
            });
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);
        await contentLibraryPage.fieldTextbox('Title').fill('Corrected title');

        await page.getByRole('button', { name: /^publish$/i }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: /publish anyway/i }).click();

        await expect.poll(() => writes.length).toBe(2);
        expect(writes[0]).toMatchObject({
            method: 'PATCH',
            body: {
                values: expect.objectContaining({ title: 'Corrected title' })
            }
        });
        expect(writes[1]).toEqual({
            method: 'POST',
            path: `/api/content/${TYPE}/${ENTRY}/publish`,
            body: { bypass: true }
        });
    });

    /** The menu is the second door; it must be shut with the first. */
    test('holds the menu’s Save & publish along with the button [protection:I-21]', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, { required: 2, given: 0, blocked: true });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);
        await expect(
            page.getByRole('button', { name: /^publish$/i })
        ).toHaveAttribute('aria-disabled', 'true');

        await contentLibraryPage.openEditorMenu();
        await expect(
            page.getByRole('menuitem', { name: 'Save & publish' })
        ).toHaveAttribute('aria-disabled', 'true');
    });

    test('opens the bypass confirmation from the menu when a bypass is offered [protection:I-21]', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 2,
            given: 0,
            blocked: true,
            bypassable: true
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        await contentLibraryPage.openEditorMenu();
        await contentLibraryPage.chooseEditorAction('Save & publish');

        await expect(page.getByRole('dialog')).toContainText(
            /entry\.publish_bypassed/
        );
    });

    /**
     * A refusal that is not a field problem carries its only explanation in the
     * response body — and used to leave the screen saying nothing at all.
     */
    test('says why when the server refuses the publish', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, UNPROTECTED);
        await page.route(`**/api/content/${TYPE}/${ENTRY}/publish`, (route) =>
            route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify({
                    statusCode: 409,
                    code: 'protection.insufficient_approvals',
                    message:
                        'Publishing "blog_post" needs 1 approval(s) on the current version; it has 0.'
                })
            })
        );
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        await page.getByRole('button', { name: /^publish$/i }).click();

        await expect(
            contentLibraryPage.toast(
                'Not published: Publishing "blog_post" needs 1 approval(s) on the current version; it has 0.'
            )
        ).toBeVisible();
    });

    /** Cancelling the confirmation publishes nothing. */
    test('publishes nothing when the bypass is cancelled', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 2,
            given: 0,
            blocked: true,
            bypassable: true
        });
        const publishes: string[] = [];
        page.on('request', (request) => {
            if (request.url().endsWith('/publish'))
                publishes.push(request.url());
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        await page.getByRole('button', { name: /^publish$/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText(/entry\.publish_bypassed/)).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();

        await expect(dialog).toHaveCount(0);
        expect(publishes).toHaveLength(0);
    });

    test('returns focus to the trigger when the dialog closes', async ({
        page,
        contentLibraryPage
    }) => {
        await mockEntryReview(page, {
            required: 2,
            given: 0,
            blocked: true,
            bypassable: true
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);

        const trigger = page.getByRole('button', { name: /^publish$/i });
        await trigger.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(trigger).toBeFocused();
    });

    /**
     * A create form has no entry to read a review of, so it asks what a new
     * entry of the type would meet — and an administrator is asked to confirm
     * **before** anything is written, then the record is created and published
     * in the one press.
     */
    test('asks an administrator to confirm on a create form, then creates and publishes [protection:I-20]', async ({
        page,
        contentLibraryPage
    }) => {
        await mockNewEntryProtection(page, {
            required: 1,
            blocked: true,
            bypassable: true
        });
        await contentLibraryPage.gotoNewEntry(WS, TYPE);
        await contentLibraryPage.fieldTextbox('Title').fill('Launch notes');

        const publish = page.getByRole('button', { name: /^publish$/i });
        await expect(publish).not.toHaveAttribute('aria-disabled', 'true');
        await publish.click();

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        const created = page.waitForRequest(
            (request) =>
                request.method() === 'POST' &&
                /\/api\/content\/blog_post(\?|$)/.test(request.url())
        );
        const published = page.waitForRequest(
            (request) =>
                request.method() === 'POST' &&
                request
                    .url()
                    .endsWith(`/api/content/${TYPE}/${TYPE}-new/publish`)
        );
        await dialog.getByRole('button', { name: /publish anyway/i }).click();

        await created;
        expect((await published).postDataJSON()).toEqual({ bypass: true });
    });

    test('holds Publish on a create form for a member who may not bypass [protection:I-18]', async ({
        page,
        contentLibraryPage
    }) => {
        await mockNewEntryProtection(page, { required: 1, bypassable: false });
        await contentLibraryPage.gotoNewEntry(WS, TYPE);

        const publish = page.getByRole('button', { name: /^publish$/i });
        await expect(publish).toHaveAttribute('aria-disabled', 'true');
        await expect(
            page.getByText(
                '1 approval required before a new entry of this type can be published.'
            )
        ).toBeAttached();
    });

    test('has no accessibility violations with a rule in force', async ({
        page,
        contentLibraryPage,
        makeAxe
    }) => {
        await mockEntryReview(page, {
            required: 2,
            given: 1,
            stale: 1,
            bypassable: true,
            approvals: [
                { userId: 'u-anna', revisionNumber: 7 },
                {
                    userId: 'u-dmitry',
                    revisionNumber: 4,
                    isStale: true
                }
            ]
        });
        await contentLibraryPage.gotoEntry(WS, TYPE, ENTRY);
        await expect(
            page.getByRole('heading', { name: 'Review', exact: true })
        ).toBeVisible();

        await expectNoA11yViolations(makeAxe());
    });
});
