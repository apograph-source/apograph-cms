import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    ALWAYS_LIVE_DETAIL_SEED,
    ALWAYS_LIVE_ENTRIES_SEED,
    ALWAYS_LIVE_ENTRY_ID,
    ALWAYS_LIVE_SCHEMA_SEED,
    ALWAYS_LIVE_WORKSPACE,
    HIDDEN_FIELD_DETAIL_SEED,
    HIDDEN_FIELD_SCHEMA_SEED,
    HIDDEN_FIELD_WORKSPACE,
    LIBRARY_WORKSPACE,
    RELATIONS_DETAIL_SEED,
    RELATIONS_ENTRIES_SEED,
    RELATIONS_SCHEMA_SEED,
    RELATIONS_WORKSPACE,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites,
    mockPublishRejection
} from '../support/api/content';

/**
 * The entry editor's **refusal** paths — what the reader is told, and where they
 * are put, when a save or a publish cannot go through. Each case pins a state
 * that used to end in silence: a gate that disagreed with its own toast, a hint
 * that was on screen but never announced, or a refusal that left focus on the
 * button that had just stopped working.
 */
test.describe('Entry editor validation', () => {
    test.describe('a required field the editor renders nowhere', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockContentSchema(page, { types: HIDDEN_FIELD_SCHEMA_SEED });
            await mockContentSchemaDetail(page, {
                details: HIDDEN_FIELD_DETAIL_SEED
            });
            await mockContentEntries(page, {
                details: HIDDEN_FIELD_DETAIL_SEED
            });
            await mockContentEntryWrites(page, {
                details: HIDDEN_FIELD_DETAIL_SEED
            });
            await mockWorkspaces(page, [HIDDEN_FIELD_WORKSPACE]);
        });

        test('is left out of the publish gate and out of client validation alike', async ({
            page
        }) => {
            // The gate is built from the *visible* fields, so it read "ready"
            // while validation still counted the hidden one — two surfaces
            // contradicting each other over a control that exists nowhere.
            await page.goto(
                `/workspaces/${HIDDEN_FIELD_WORKSPACE.id}/content/gadget/new`
            );

            await expect(
                page.getByRole('heading', { name: 'New Gadgets' })
            ).toBeVisible();
            await expect(page.locator('#entry-field-title')).toBeVisible();
            await expect(page.locator('#entry-field-internalCode')).toHaveCount(
                0
            );

            await page.locator('#entry-field-title').fill('A gadget');
            // Every check the reader can act on now passes, so the primary
            // action reaches the server rather than dead-ending on the client.
            await expect(page.getByText('Needs attention:')).toHaveCount(0);
        });

        test('surfaces the server 422 as a toast when it names an unrendered field', async ({
            page,
            contentLibraryPage
        }) => {
            await mockPublishRejection(page, { field: 'internalCode' });
            await page.goto(
                `/workspaces/${HIDDEN_FIELD_WORKSPACE.id}/content/gadget/new`
            );

            await page.locator('#entry-field-title').fill('A gadget');
            await contentLibraryPage.editorSave.first().click();

            // An issue on a field with no control has nowhere inline to land, so
            // without this the busy cover simply lifted and nothing appeared.
            await expect(
                page.getByText(/The server refused “internalCode”/)
            ).toBeVisible();
        });

        test('a field keeps announcing its hint once it is showing an error', async ({
            page,
            contentLibraryPage
        }) => {
            // The error used to *replace* the description, so a reader who
            // tripped a rule lost the very instruction that would have kept
            // them out of it — the two can now both be announced.
            await page.goto(
                `/workspaces/${HIDDEN_FIELD_WORKSPACE.id}/content/gadget/new`
            );
            const title = page.locator('#entry-field-title');
            await expect(title).toHaveAttribute(
                'aria-describedby',
                'entry-field-title-description'
            );

            await contentLibraryPage.editorSave.first().click();

            await expect(title).toHaveAttribute('aria-invalid', 'true');
            await expect(title).toHaveAttribute(
                'aria-describedby',
                'entry-field-title-description entry-field-title-error'
            );
        });
    });

    test.describe('refused submits and field hints', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockContentSchema(page);
            await mockContentSchemaDetail(page);
            await mockContentEntries(page);
            await mockContentEntryWrites(page);
            await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        });

        test('a refused publish moves focus to the first invalid control', async ({
            page,
            contentLibraryPage
        }) => {
            // The toast says "start with X"; without this the reader had to find
            // X by hand — Shift+Tab out of the top bar, past the breadcrumb, into
            // a panel that may have just been swapped underneath them.
            await page.goto(
                `/workspaces/${LIBRARY_WORKSPACE.id}/content/blog_post/new`
            );
            await contentLibraryPage.editorSave.first().click();

            await expect(page.locator('#entry-field-title')).toBeFocused();
        });

        test('the publish gate states a failing row in words, not by colour', async ({
            page
        }) => {
            // The failure was carried by an `aria-hidden` icon and its colour
            // alone, so a row read as a bare field label.
            await page.goto(
                `/workspaces/${LIBRARY_WORKSPACE.id}/content/blog_post/new`
            );

            await expect(page.getByText('Needs attention:')).toBeVisible();
        });
    });

    test.describe('the publish gate lists what blocks, not what exists', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockContentSchema(page);
            await mockContentSchemaDetail(page);
            await mockContentEntries(page);
            await mockContentEntryWrites(page);
            await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        });

        test('reads one line and "ready" when every check passes', async ({
            page,
            contentLibraryPage
        }) => {
            await page.goto(
                `/workspaces/${LIBRARY_WORKSPACE.id}/content/blog_post/new`
            );
            await page.locator('#entry-field-title').fill('A post');

            // No per-field list at all: the passing rows were a re-statement of
            // every required field on the type, which the reader had to scan to
            // find the one red line.
            const gate = contentLibraryPage.gateBlock('Publish gate');
            await expect(gate).toContainText(
                'Every check passes — ready to publish.'
            );
            await expect(gate).toContainText('ready');
            await expect(contentLibraryPage.gateFailures()).toHaveCount(0);
        });

        test('lists only the failing field, and counts it in the heading', async ({
            page,
            contentLibraryPage
        }) => {
            await page.goto(
                `/workspaces/${LIBRARY_WORKSPACE.id}/content/blog_post/new`
            );
            await page.locator('#entry-field-title').fill('A post');
            await expect(contentLibraryPage.gateFailures()).toHaveCount(0);

            // Emptying the one required field is the whole difference.
            await page.locator('#entry-field-title').fill('');

            const gate = contentLibraryPage.gateBlock('Publish gate');
            await expect(gate).toContainText('1 blocking');
            await expect(gate).not.toContainText('Every check passes');
            await expect(contentLibraryPage.gateFailures()).toHaveCount(1);
            await expect(contentLibraryPage.gateFailures()).toContainText(
                'Title'
            );
        });
    });

    test.describe('a required link-managed relation', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockContentSchema(page, { types: RELATIONS_SCHEMA_SEED });
            await mockContentSchemaDetail(page, {
                details: RELATIONS_DETAIL_SEED
            });
            await mockContentEntries(page, {
                details: RELATIONS_DETAIL_SEED,
                entries: RELATIONS_ENTRIES_SEED
            });
            await mockContentEntryWrites(page, {
                details: RELATIONS_DETAIL_SEED
            });
            await mockWorkspaces(page, [RELATIONS_WORKSPACE]);
        });

        test('blocks the gate on its link count, before any save', async ({
            page,
            contentLibraryPage
        }) => {
            // A required many relation is link-managed, so it never reaches the
            // values bag the field gate reads. The editor mirrors the server's
            // `assertRequiredRelations` from the link counts instead — a second,
            // count-based check that has to survive every change to how the
            // gate is drawn.
            await page.goto(
                `/workspaces/${RELATIONS_WORKSPACE.id}/content/article/new`
            );
            await page.locator('#entry-field-text').fill('An article');

            // Title is satisfied; Tags has zero links and is the only blocker.
            const gate = contentLibraryPage.gateBlock('Publish gate');
            await expect(gate).toContainText('1 blocking');
            await expect(contentLibraryPage.gateFailures()).toContainText(
                'Tags'
            );
        });
    });

    test.describe('an always-live type', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await mockContentSchema(page, { types: ALWAYS_LIVE_SCHEMA_SEED });
            await mockContentSchemaDetail(page, {
                details: ALWAYS_LIVE_DETAIL_SEED
            });
            await mockContentEntries(page, {
                details: ALWAYS_LIVE_DETAIL_SEED,
                entries: ALWAYS_LIVE_ENTRIES_SEED
            });
            await mockContentEntryWrites(page, {
                details: ALWAYS_LIVE_DETAIL_SEED
            });
            await mockWorkspaces(page, [ALWAYS_LIVE_WORKSPACE]);
        });

        test('calls the block "Save gate" and drops the Status row [content:I-07]', async ({
            page,
            contentLibraryPage
        }) => {
            await page.goto(
                `/workspaces/${ALWAYS_LIVE_WORKSPACE.id}/content/notice/${ALWAYS_LIVE_ENTRY_ID}`
            );
            await expect(contentLibraryPage.editorSave).toBeVisible();

            // Save really is strict here — there is no permissive draft to
            // explain away — so the block says what it gates.
            const gate = contentLibraryPage.gateBlock('Save gate');
            await expect(gate).toContainText(
                'Every check passes — ready to save.'
            );
            await expect(
                contentLibraryPage.gateBlock('Publish gate')
            ).toHaveCount(0);

            // And "Draft" would name a state this type does not have.
            await expect(contentLibraryPage.railBlock('Details')).toBeVisible();
            await expect(contentLibraryPage.entryDetailsStatus).toHaveCount(0);
        });
    });
});
