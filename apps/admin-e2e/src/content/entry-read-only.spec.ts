import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    READ_ONLY_WORKSPACE,
    READ_ONLY_SCHEMA_SEED,
    READ_ONLY_DETAIL_SEED,
    READ_ONLY_ENTRIES_SEED,
    READ_ONLY_PERMISSIONS,
    READ_ONLY_ENTRY_ID,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites,
    mockEntryMedia,
    spyEntrySave,
    type EntrySaveSpy
} from '../support/api/content';
import { mockMediaApi, MEDIA_ASSET_IDS } from '../support/api/media';
import { expectNoA11yViolations } from '../support/a11y';

const WS = READ_ONLY_WORKSPACE.id;
const TYPE = 'landing';

/**
 * The entry editor as a **read-only preview**, for a reader holding
 * `content:read` but not `content:update`.
 *
 * The gap this covers is specific and was real: the editor's *actions* were
 * permission-gated from the start (no Save, no Publish, no Delete), but its
 * *fields* were not — so a reader could retype a page's title, change its
 * accent colour, stage an image upload, and only discover at Save that none of
 * it was theirs to change. Server-side the write was always refused; what was
 * missing was the UI telling the truth about it.
 *
 * The suite is written on a **single** (a routed page) because that is where a
 * reader most often lands — opening the type *is* opening its editor — and it
 * covers one field per control shape, since read-only is applied per shape.
 */
test.describe('Entry editor — read-only', () => {
    let saves: EntrySaveSpy;

    /** Everything except the session, which each block sets to its own role. */
    async function seedBackend(page: Parameters<typeof mockWorkspaces>[0]) {
        await mockWorkspaces(page, [READ_ONLY_WORKSPACE]);
        await mockContentSchema(page, { types: READ_ONLY_SCHEMA_SEED });
        await mockContentSchemaDetail(page, {
            details: READ_ONLY_DETAIL_SEED
        });
        await mockContentEntries(page, {
            details: READ_ONLY_DETAIL_SEED,
            entries: READ_ONLY_ENTRIES_SEED
        });
        await mockContentEntryWrites(page, { details: READ_ONLY_DETAIL_SEED });
        // After the write mock, whose multi-segment route would otherwise
        // answer `/:id/media` with an entry record. Seeded with the hero's ref
        // so the tile shows its **file name** — unresolved, the control falls
        // back to printing the bare uuid, which would make "the asset is still
        // shown" a much weaker claim than it should be.
        await mockEntryMedia(page, {
            media: {
                [`${TYPE}/${READ_ONLY_ENTRY_ID}`]: {
                    hero: [
                        {
                            id: MEDIA_ASSET_IDS.hero,
                            name: 'hero.png',
                            url: `/api/media/assets/${MEDIA_ASSET_IDS.hero}/raw`,
                            kind: 'image',
                            mimeType: 'image/png'
                        }
                    ]
                }
            }
        });
        await mockMediaApi(page);
    }

    test.describe('as a reader (no content:update)', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page, { permissions: READ_ONLY_PERMISSIONS });
            await seedBackend(page);
            saves = await spyEntrySave(page);
        });

        test('explains itself and offers no save action', async ({
            contentLibraryPage
        }) => {
            await contentLibraryPage.gotoSingle(WS, TYPE);

            await expect(contentLibraryPage.readOnlyNotice).toBeVisible();
            await expect(contentLibraryPage.editorSave).toHaveCount(0);
        });

        test('renders every text field read-only, colour field included [content:I-39]', async ({
            contentLibraryPage
        }) => {
            await contentLibraryPage.gotoSingle(WS, TYPE);

            // The values are still there to read — that is what makes this a
            // preview rather than a blanked-out form.
            await expect(
                contentLibraryPage.fieldTextbox('Title', { exact: true })
            ).toHaveValue('Welcome to Ortha');
            await expect(
                contentLibraryPage.fieldTextbox('Accent color')
            ).toHaveValue('#4f46e5');

            // `readOnly`, not `disabled`: a reader can still select and copy the
            // value, and the control stays in the tab order.
            for (const label of ['Title', 'Subtitle', 'Accent color']) {
                const box = contentLibraryPage.fieldTextbox(label, {
                    exact: true
                });
                await expect(box).toHaveAttribute('readonly', '');
                await expect(box).toBeEnabled();
            }
        });

        test('refuses typing into the colour field', async ({
            contentLibraryPage
        }) => {
            await contentLibraryPage.gotoSingle(WS, TYPE);

            const colour = contentLibraryPage.fieldTextbox('Accent color');
            await colour.click();
            await colour.pressSequentially('#ff0000');

            // The point of the whole change: the keystrokes land nowhere.
            await expect(colour).toHaveValue('#4f46e5');
        });

        test('disables the controls that have no read-only state', async ({
            contentLibraryPage
        }) => {
            await contentLibraryPage.gotoSingle(WS, TYPE);

            // A select, a date picker, and the boolean segments reach their
            // value only through a popover or a press, so `disabled` is the
            // only thing that closes them off.
            await expect(
                contentLibraryPage.fieldTrigger('variant')
            ).toBeDisabled();
            await expect(
                contentLibraryPage.fieldTrigger('goLiveOn')
            ).toBeDisabled();

            const segments = contentLibraryPage.booleanSegments('featured');
            await expect(segments).not.toHaveCount(0);
            for (const segment of await segments.all()) {
                await expect(segment).toBeDisabled();
            }
        });

        test('offers the rich-text body to view, not to edit [wysiwyg:I-31]', async ({
            contentLibraryPage,
            wysiwygFieldPage
        }) => {
            await contentLibraryPage.gotoSingle(WS, TYPE);

            await expect(wysiwygFieldPage.control('Body')).toHaveCount(0);
            await expect(wysiwygFieldPage.viewControl('Body')).toBeVisible();

            // Expanding is kept — a clamped preview can't show a long body —
            // but what it opens has no toolbar to write with.
            await wysiwygFieldPage.viewControl('Body').click();
            await expect(
                wysiwygFieldPage.expandedHeading('Body')
            ).toBeVisible();
            await expect(wysiwygFieldPage.toolbar).toHaveCount(0);

            // The footer counts the document that is actually on screen.
            // `useEditorState` only refreshes on a transaction, and a read-only
            // editor fires none — so this read "0 words · 0 characters" over a
            // full body until the panel stopped waiting for an event that never
            // comes. The exit says what it does, too: "Done" is the end of an
            // editing session, which this reader never started.
            await expect(wysiwygFieldPage.counts).toHaveText(
                '5 words · 26 characters'
            );
            // Two: the header link and the footer button, both now saying the
            // same thing because they do the same thing.
            await expect(
                wysiwygFieldPage.exitButton('Back to fields')
            ).toHaveCount(2);
            await expect(wysiwygFieldPage.exitButton('Done')).toHaveCount(0);
        });

        test('opens the body as a passage to read, and takes nothing back from it [wysiwyg:I-31]', async ({
            page,
            contentLibraryPage,
            wysiwygFieldPage
        }) => {
            await contentLibraryPage.gotoSingle(WS, TYPE);
            await wysiwygFieldPage.viewControl('Body').click();

            // A labelled `region`, not a `textbox`: a textbox that takes no
            // text misdescribes what is on screen, and `aria-multiline` /
            // `aria-required` say nothing about something a reader cannot fill.
            await expect(wysiwygFieldPage.readingSurface('Body')).toBeVisible();
            await expect(wysiwygFieldPage.surface('Body')).toHaveCount(0);
            await expect(wysiwygFieldPage.editorSurfaces).toHaveCount(0);
            // And no caret in it — the reader has nothing to type, so the
            // document is inert rather than merely unsaveable.
            await expect(
                wysiwygFieldPage.readingSurface('Body')
            ).toHaveAttribute('contenteditable', 'false');

            // The whole claim, driven rather than inspected: keystrokes aimed
            // at the document change neither the document…
            await wysiwygFieldPage.readingSurface('Body').click();
            await page.keyboard.type('rewritten by a reader');
            // The stored body is still all of what is there — so the assertion
            // below is about the keystrokes, not about a surface that rendered
            // nothing in the first place.
            await expect(wysiwygFieldPage.readingSurface('Body')).toContainText(
                'What we ship'
            );
            await expect(
                wysiwygFieldPage.readingSurface('Body')
            ).not.toContainText('rewritten by a reader');

            // …nor the form behind it. The collapsed card renders the entry's
            // own value, so a stray `onUpdate` write would be visible here even
            // though this reader has no Save to send it with.
            await wysiwygFieldPage.exitButton('Back to fields').first().click();
            await expect(wysiwygFieldPage.viewPreview('Body')).toContainText(
                'What we ship'
            );
            await expect(
                wysiwygFieldPage.viewPreview('Body')
            ).not.toContainText('rewritten by a reader');
            expect(saves.bodies).toHaveLength(0);
        });

        test('shows the media field without any way to attach or upload', async ({
            contentLibraryPage,
            mediaFieldPage
        }) => {
            await contentLibraryPage.gotoSingle(WS, TYPE);
            await mediaFieldPage.openMediaTab();

            // The attached asset is still shown, by name…
            expect(await mediaFieldPage.attachedNames('Hero image')).toEqual([
                'hero.png'
            ]);

            // …with nothing on offer that would change it.
            await expect(mediaFieldPage.libraryButton('Replace')).toHaveCount(
                0
            );
            await expect(
                mediaFieldPage.libraryButton('Select from library')
            ).toHaveCount(0);
            await expect(mediaFieldPage.uploadButton('Hero image')).toHaveCount(
                0
            );
            await expect(mediaFieldPage.removeAsset('hero.png')).toHaveCount(0);
        });

        test('never saves, even on a form submit from a field [content:I-39]', async ({
            contentLibraryPage,
            page
        }) => {
            await contentLibraryPage.gotoSingle(WS, TYPE);

            // Enter in a text field submits the `<form>` directly, which is the
            // one save path that never goes through a button — so it is the one
            // a button-only gate would miss.
            await contentLibraryPage
                .fieldTextbox('Title', { exact: true })
                .click();
            await page.keyboard.press('Enter');

            await expect(contentLibraryPage.savedToast).toHaveCount(0);
            expect(saves.bodies).toHaveLength(0);
        });

        test('has no accessibility violations', async ({
            contentLibraryPage,
            makeAxe
        }) => {
            await contentLibraryPage.gotoSingle(WS, TYPE);
            await expect(contentLibraryPage.readOnlyNotice).toBeVisible();

            await expectNoA11yViolations(makeAxe());
        });
    });

    /**
     * The control case. Every assertion above is about something *missing*, and
     * a bug that removed the whole form would pass all of them — so one block
     * proves the same editor is fully live for a role that holds the write.
     */
    test.describe('as an editor (with content:update)', () => {
        test.beforeEach(async ({ page }) => {
            await mockSignedIn(page);
            await seedBackend(page);
            saves = await spyEntrySave(page);
        });

        test('keeps the fields and the actions live', async ({
            contentLibraryPage,
            wysiwygFieldPage
        }) => {
            await contentLibraryPage.gotoSingle(WS, TYPE);

            await expect(contentLibraryPage.readOnlyNotice).toHaveCount(0);
            await expect(contentLibraryPage.editorSave).toBeVisible();

            const colour = contentLibraryPage.fieldTextbox('Accent color');
            await expect(colour).not.toHaveAttribute('readonly', '');
            await colour.fill('#ff0000');
            await expect(colour).toHaveValue('#ff0000');

            await expect(
                contentLibraryPage.fieldTrigger('variant')
            ).toBeEnabled();
            await expect(wysiwygFieldPage.control('Body')).toBeVisible();
        });
    });
});
