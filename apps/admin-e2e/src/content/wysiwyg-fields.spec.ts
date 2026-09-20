import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    WYSIWYG_WORKSPACE,
    WYSIWYG_SCHEMA_SEED,
    WYSIWYG_DETAIL_SEED,
    WYSIWYG_ENTRY_ID,
    WYSIWYG_ENTRY_BODY,
    WYSIWYG_GERMAN_ENTRY_ID,
    WYSIWYG_GERMAN_LOCALE,
    WYSIWYG_GERMAN_BODY,
    WYSIWYG_MEDIA_ENTRY_ID,
    WYSIWYG_MEDIA_ENTRY_BODY,
    WYSIWYG_INACCESSIBLE_ENTRY_ID,
    WYSIWYG_INACCESSIBLE_BODY,
    WYSIWYG_WARNING_ENTRY_ID,
    WYSIWYG_WARNING_BODY,
    WYSIWYG_SHARED_NOTES,
    WYSIWYG_HOSTILE_ENTRY_ID,
    WYSIWYG_HOSTILE_BODY,
    WYSIWYG_HOSTILE_IMAGE_SRC,
    WYSIWYG_HOSTILE_FLAG,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites,
    mockContentEntryRead,
    spyEntrySave,
    type EntrySaveSpy
} from '../support/api/content';
import {
    mockMediaApi,
    MEDIA_ASSET_IDS,
    MEDIA_HERO_ALT,
    type MediaUploadSpy
} from '../support/api/media';
import { expectNoA11yViolations } from '../support/a11y';
import {
    attr,
    savedDocument,
    savedNodesOfType,
    savedText
} from '../support/richText';

const WS = WYSIWYG_WORKSPACE.id;

/**
 * The **rich-text field** (`@orthacms/wysiwyg-admin`, contributed through
 * content-admin's `ENTRY_FIELD_CONTROL_SLOT`): the entry form shows what was
 * written rather than the HTML behind it, pressing it expands the TipTap editor
 * into the work area, and everything the toolbar does ends up in the saved
 * value.
 *
 * The save spy is the point of most of these — the visible editor is only half
 * the feature; what gets *stored* is the other half, and only the request body
 * shows that.
 */
test.describe('Entry editor — rich text field', () => {
    let saves: EntrySaveSpy;
    let uploads: MediaUploadSpy;

    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [WYSIWYG_WORKSPACE]);
        await mockContentSchema(page, { types: WYSIWYG_SCHEMA_SEED });
        await mockContentSchemaDetail(page, { details: WYSIWYG_DETAIL_SEED });
        await mockContentEntries(page, {
            details: WYSIWYG_DETAIL_SEED,
            entries: { article: [] }
        });
        await mockContentEntryWrites(page, { details: WYSIWYG_DETAIL_SEED });
        // After the write mock, so the read-one serves our HTML rather than the
        // value the write mock fabricates from the schema.
        await mockContentEntryRead(page, {
            records: {
                [`article/${WYSIWYG_ENTRY_ID}`]: {
                    title: 'Release 2.0',
                    body: WYSIWYG_ENTRY_BODY,
                    summary: '<p>Short and sweet.</p>',
                    notes: WYSIWYG_SHARED_NOTES,
                    rawHtml: '<div class="legacy">kept as-is</div>'
                },
                [`article/${WYSIWYG_MEDIA_ENTRY_ID}`]: {
                    title: 'With media',
                    body: WYSIWYG_MEDIA_ENTRY_BODY,
                    summary: '<p>Short and sweet.</p>',
                    notes: WYSIWYG_SHARED_NOTES,
                    rawHtml: ''
                },
                [`article/${WYSIWYG_GERMAN_ENTRY_ID}`]: {
                    title: 'Ausgabe 2.0',
                    body: WYSIWYG_GERMAN_BODY,
                    summary: '<p>Kurz und knapp.</p>',
                    notes: WYSIWYG_SHARED_NOTES,
                    rawHtml: ''
                },
                [`article/${WYSIWYG_INACCESSIBLE_ENTRY_ID}`]: {
                    title: 'Needs work',
                    body: WYSIWYG_INACCESSIBLE_BODY,
                    summary: '<p>Short and sweet.</p>',
                    notes: WYSIWYG_SHARED_NOTES,
                    rawHtml: ''
                },
                [`article/${WYSIWYG_WARNING_ENTRY_ID}`]: {
                    title: 'Worth a look',
                    body: WYSIWYG_WARNING_BODY,
                    summary: '<p>Short and sweet.</p>',
                    notes: WYSIWYG_SHARED_NOTES,
                    rawHtml: ''
                },
                [`article/${WYSIWYG_HOSTILE_ENTRY_ID}`]: {
                    title: 'Submitted copy',
                    body: WYSIWYG_HOSTILE_BODY,
                    summary: '<p>Short and sweet.</p>',
                    notes: WYSIWYG_SHARED_NOTES,
                    rawHtml: ''
                }
            },
            locales: {
                [`article/${WYSIWYG_GERMAN_ENTRY_ID}`]: WYSIWYG_GERMAN_LOCALE
            }
        });
        saves = await spyEntrySave(page);
        // The Media Library sources come from `@orthacms/media-admin` through
        // the editor's own slot, so the media endpoints have to answer too.
        uploads = await mockMediaApi(page);
    });

    test.describe('the collapsed field', () => {
        test('renders stored HTML as content, not markup [wysiwyg:I-02]', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);

            // The heading, the emphasis, and the list items all survive as real
            // elements — the whole reason the field isn't a textarea.
            const preview = wysiwygFieldPage.preview('Body');
            await expect(
                preview.getByRole('heading', { name: 'Release notes' })
            ).toBeVisible();
            await expect(preview.getByRole('list')).toBeVisible();
            await expect(
                preview.getByRole('listitem').filter({ hasText: 'Cold start' })
            ).toBeVisible();
            // …and no tags leaked through as text.
            await expect(preview).not.toContainText('<strong>');
        });

        test('flattens the body’s links, so there is none to fall into on the way to the editor [wysiwyg:I-05]', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);

            // The stored body **has** an anchor. Without one, "no links here"
            // is a statement about the fixture rather than about the renderer,
            // and deleting `flattenLinks` would leave this green.
            await expect(
                wysiwygFieldPage.previewFlattenedLinks('Body')
            ).toHaveText('the full changelog');

            // The control is a button laid over the preview; a live anchor
            // underneath would be a tab stop hidden beneath it, and pressing it
            // would navigate out of the record.
            await expect(
                wysiwygFieldPage.preview('Body').getByRole('link')
            ).toHaveCount(0);
        });

        test('renders a hostile stored body as inert markup [wysiwyg:I-04]', async ({
            page,
            wysiwygFieldPage
        }) => {
            // The image's own source, answered here so the failure that fires
            // an `onerror` is this route and not the network.
            let requested = 0;
            await page.route(
                `**${WYSIWYG_HOSTILE_IMAGE_SRC}`,
                async (route) => {
                    requested += 1;
                    await route.fulfill({ status: 404, body: '' });
                }
            );

            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_HOSTILE_ENTRY_ID);
            const preview = wysiwygFieldPage.preview('Body');

            // The control: the safe content came through, so nothing below is
            // satisfied by a preview that rendered an empty card.
            await expect(preview).toContainText('Filed by a contributor.');
            await expect(preview).toContainText('Hover me.');

            // An attribute the schema declares survives…
            const image = wysiwygFieldPage.previewMarkup('Body', 'img');
            await expect(image).toHaveAttribute('alt', 'A chart');
            await expect(image).toHaveAttribute(
                'src',
                WYSIWYG_HOSTILE_IMAGE_SRC
            );

            // …and one it does not, does not — on a tag that was itself kept,
            // so this is the attribute filter and not the tag filter. This is
            // the whole difference between the schema round-trip and handing
            // the stored string to `dangerouslySetInnerHTML`: `<script>` does
            // not run on `innerHTML`, `<img onerror>` does.
            await expect(
                wysiwygFieldPage.previewMarkup('Body', '[onerror]')
            ).toHaveCount(0);
            await expect(
                wysiwygFieldPage.previewMarkup('Body', '[onmouseover]')
            ).toHaveCount(0);
            // A tag no extension declares has nowhere in the schema to land.
            await expect(
                wysiwygFieldPage.previewMarkup('Body', 'iframe')
            ).toHaveCount(0);
            // The Link extension's protocol allowlist: `javascript:` fails it,
            // so the mark is refused at parse time and the words come through
            // as ordinary text — nothing is silently deleted, and there is no
            // address left to press.
            await expect(preview).toContainText('the original report');
            await expect(
                wysiwygFieldPage.previewMarkup('Body', '[href^="javascript:"]')
            ).toHaveCount(0);
            await expect(preview.getByRole('link')).toHaveCount(0);

            // And nothing ran. The image has been asked for and answered, so
            // the load has settled either way — under a raw-`innerHTML`
            // renderer the handler would have fired by now. (`Loaded` is
            // spelled out locally: this project's `tsconfig` has no `dom` lib.)
            type Loaded = { complete: boolean };
            await expect.poll(() => requested).toBeGreaterThan(0);
            await expect
                .poll(() =>
                    image.evaluate(
                        (element) => (element as unknown as Loaded).complete
                    )
                )
                .toBe(true);
            expect(
                await page.evaluate(
                    (flag) =>
                        (globalThis as unknown as Record<string, unknown>)[
                            flag
                        ],
                    WYSIWYG_HOSTILE_FLAG
                )
            ).toBeUndefined();
        });

        test('shows the field placeholder while empty', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await expect(wysiwygFieldPage.preview('Body')).toContainText(
                'Tell the story…'
            );
        });

        test('keeps a plain textarea for a field that opted out [wysiwyg:I-02]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);

            // `admin: { widget: 'textarea' }` — the escape hatch for a body that
            // is hand-maintained markup, which a WYSIWYG would reformat.
            await expect(
                contentLibraryPage.fieldTextbox('Raw HTML')
            ).toHaveValue('<div class="legacy">kept as-is</div>');
            await expect(wysiwygFieldPage.control('Raw HTML')).toHaveCount(0);
        });
    });

    test.describe('the expanded editor', () => {
        test('takes over the work area with the caret already in the text [wysiwyg:I-07]', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.open('Body');

            await expect(
                wysiwygFieldPage.expandedHeading('Body')
            ).toBeVisible();
            // The form it replaced is gone, not merely covered — this is a view
            // swap, so the tab strip and the other fields have unmounted.
            await expect(wysiwygFieldPage.editorTabs).toBeHidden();
            await expect(wysiwygFieldPage.control('Summary')).toHaveCount(0);
            // Focus lands in the document — the author pressed this to write.
            await expect(wysiwygFieldPage.surface('Body')).toBeFocused();
        });

        test('keeps the record and its chrome on screen [wysiwyg:I-07]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.open('Body');

            // The whole point of expanding into the work area rather than
            // opening a modal: everything around the field keeps working.
            await expect(wysiwygFieldPage.contentNav).toBeVisible();
            await expect(wysiwygFieldPage.propertiesPanel).toBeVisible();
            await expect(contentLibraryPage.editorSave).toBeVisible();
            // …including which record is being edited.
            await expect(
                contentLibraryPage.viewHeading('Articles')
            ).toBeVisible();
        });

        test('unfolds one field at a time, and only the one that asked [wysiwyg:I-08]', async ({
            wysiwygFieldPage
        }) => {
            // Two rich-text fields on this record, which is what makes "one at
            // a time" a statement about anything at all.
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await expect(wysiwygFieldPage.control('Body')).toBeVisible();
            await expect(wysiwygFieldPage.control('Summary')).toBeVisible();

            await wysiwygFieldPage.open('Body');

            // One panel exists in the whole page — not one *visible* panel. The
            // state is a single field **name** on `EntryEditor`, which resolves
            // to a single `FullView`; a control that owned its own expansion
            // would leave the form (and every other field's control) mounted
            // underneath, and two of them could be open at once.
            await expect(wysiwygFieldPage.editorSurfaces).toHaveCount(1);
            await expect(wysiwygFieldPage.control('Summary')).toHaveCount(0);
            await expect(
                wysiwygFieldPage.expandedHeading('Summary')
            ).toHaveCount(0);

            await wysiwygFieldPage.done();
            await wysiwygFieldPage.open('Summary');

            // Still one, and it is the field that asked: the view is looked up
            // from the name, so it carries Summary's value and not Body's.
            await expect(wysiwygFieldPage.editorSurfaces).toHaveCount(1);
            await expect(wysiwygFieldPage.surface('Summary')).toContainText(
                'Short and sweet.'
            );
            await expect(wysiwygFieldPage.surface('Summary')).not.toContainText(
                'Release notes'
            );
            await expect(wysiwygFieldPage.control('Body')).toHaveCount(0);
        });

        test('mounts the editor only while the field is unfolded, and seeds it at mount [wysiwyg:I-09]', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);

            // Collapsed, there is no editor at all — the field is a rendered
            // preview and a button. Nothing of TipTap is standing by behind a
            // `hidden` attribute waiting to be shown.
            await expect(wysiwygFieldPage.editorSurfaces).toHaveCount(0);

            await wysiwygFieldPage.open('Body');
            await expect(wysiwygFieldPage.editorSurfaces).toHaveCount(1);
            // Seeded from the value it was handed.
            await expect(wysiwygFieldPage.surface('Body')).toContainText(
                'Release notes'
            );

            // Typed as one run at the caret. Under a controlled `setContent`
            // sync — the thing this invariant rules out — every keystroke would
            // write the form's value back over the document and drop the caret
            // at the top, so a phrase typed at the end arrives reversed and in
            // the wrong place. A whole phrase, not a keystroke, so that shows.
            await wysiwygFieldPage.type(' Also this.');
            await expect(wysiwygFieldPage.surface('Body')).toContainText(
                'Watch mode Also this.'
            );

            await wysiwygFieldPage.done();
            // Unmounted on the way out, which is what makes the seeding safe:
            // there is no editor left holding a stale copy of the document.
            await expect(wysiwygFieldPage.editorSurfaces).toHaveCount(0);

            // …and the next unfold seeds a *fresh* editor from the form's
            // current value, so the edit made in the previous mount is there.
            await wysiwygFieldPage.open('Body');
            await expect(wysiwygFieldPage.editorSurfaces).toHaveCount(1);
            await expect(wysiwygFieldPage.surface('Body')).toContainText(
                'Watch mode Also this.'
            );
        });

        test('keeps the toolbar on a single row', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.open('Body');

            // Twenty flat controls wrapped onto a second line at ordinary
            // widths, pushing everything below them down. The bar now folds
            // marks, alignment, and block insertion into three menus to fit.
            expect(await wysiwygFieldPage.toolbarRowCount()).toBe(1);
        });

        test('returns to the form from either exit', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.backToFields();
            await expect(wysiwygFieldPage.editorTabs).toBeVisible();
            await expect(wysiwygFieldPage.control('Body')).toBeVisible();

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.done();
            await expect(wysiwygFieldPage.editorTabs).toBeVisible();
        });

        test('writes edits back to the form as they are made [wysiwyg:I-10]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.type('Hello there');
            await wysiwygFieldPage.done();

            // Back on the form, the preview already shows it — nothing is
            // "committed" by collapsing, so leaving the view is always safe.
            await expect(wysiwygFieldPage.preview('Body')).toContainText(
                'Hello there'
            );
        });

        test('stores the formatting the toolbar applied [wysiwyg:I-11]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.toolbarButton('Bold').click();
            await wysiwygFieldPage.type('Loud');
            await wysiwygFieldPage.toolbarButton('Bold').click();
            await wysiwygFieldPage.type(' and quiet');
            await wysiwygFieldPage.done();

            // Saved as a **draft**: the type is publishable and `summary` is
            // required, so the primary action would be blocked by a field this
            // test isn't about.
            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            // The stored value is the **document**, so the mark is a fact
            // about the run rather than a tag around it.
            expect(savedDocument(saves.bodies[0].values?.['body'])).toEqual({
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        attrs: { textAlign: null },
                        content: [
                            {
                                type: 'text',
                                marks: [{ type: 'bold' }],
                                text: 'Loud'
                            },
                            { type: 'text', text: ' and quiet' }
                        ]
                    }
                ]
            });
        });

        test('never lets a toolbar press take the selection it is about to act on [wysiwyg:I-29]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.type('Selected words');
            await wysiwygFieldPage.selectAll();
            // The control. Without a live selection the two assertions below
            // would be statements about an empty string.
            expect(await wysiwygFieldPage.selectedText()).toBe(
                'Selected words'
            );

            // Asserted **between mousedown and mouseup**, which is the only
            // moment the suppression is visible: every command in the bar runs
            // `chain().focus()`, so by the time the click handler is done it has
            // put focus and the selection back, and an assertion made after the
            // press cannot tell the two implementations apart. The press itself
            // is where a `mousedown` whose default action runs moves focus to
            // the button and collapses the document's selection into it.
            await wysiwygFieldPage.pressMouseOn(
                wysiwygFieldPage.toolbarButton('Bold')
            );
            await expect(wysiwygFieldPage.surface('Body')).toBeFocused();
            expect(await wysiwygFieldPage.selectedText()).toBe(
                'Selected words'
            );
            await wysiwygFieldPage.releaseMouse();

            // The same for a menu trigger — the toolbar's other control shape,
            // and the one whose menu is *about* the selection. Focus can't be
            // the assertion here (the dropdown takes it deliberately, so the
            // arrow keys work), but the selection the menu will act on has to
            // survive the press that opened it.
            await wysiwygFieldPage.pressMouseOn(
                wysiwygFieldPage.toolbarButton('Text color')
            );
            expect(await wysiwygFieldPage.selectedText()).toBe(
                'Selected words'
            );
            await wysiwygFieldPage.releaseMouse();
            await wysiwygFieldPage.menuItem('Amber').click();

            await wysiwygFieldPage.done();
            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            // …and the consequence, in the saved document: both commands landed
            // on the whole phrase, which is what "the selection the command
            // works on" means. A colour applied from the palette is also the
            // half of the paste filter nothing else asserts — the transform
            // strips a *pasted* colour, and this is a choice.
            const runs = savedNodesOfType(
                saves.bodies[0].values?.['body'],
                'text'
            );
            expect(runs).toHaveLength(1);
            expect(runs[0].text).toBe('Selected words');
            expect(runs[0].marks?.map((mark) => mark.type)).toEqual(
                expect.arrayContaining(['bold', 'textStyle'])
            );
            // Amber's own value, so this is the swatch that was pressed and not
            // merely "a colour arrived". A **pasted** colour is stripped by
            // `transformPastedHTML`; a chosen one is a decision and is kept, and
            // nothing else in the suite asserted that half positively.
            // covers: wysiwyg:I-32
            expect(
                runs[0].marks?.find((mark) => mark.type === 'textStyle')
                    ?.attrs?.['color']
            ).toBe('#b45309');
        });

        test('stores a callout as its own node, carrying its tone', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.type('Mind the gap');
            await wysiwygFieldPage.openInsertSubmenu('Callout');
            await wysiwygFieldPage.menuItem('Warning').click();
            await wysiwygFieldPage.done();

            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            // The tone travels as an attribute on the node, so whatever
            // renders this document styles it itself — no admin styling leaks
            // into published content. (The document also ends in an empty
            // paragraph, the editor's own: a body ending in a callout would
            // otherwise have nowhere left to type.)
            const callouts = savedNodesOfType(
                saves.bodies[0].values?.['body'],
                'callout'
            );
            expect(callouts).toHaveLength(1);
            expect(attr(callouts[0], 'tone')).toBe('warning');
            expect(savedText(saves.bodies[0].values?.['body'])).toContain(
                'Mind the gap'
            );
        });

        test('stores a table with its header row', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openInsertSubmenu('Table');
            await wysiwygFieldPage.menuItem('Insert table').click();
            await expect(wysiwygFieldPage.editorTable).toBeVisible();
            await wysiwygFieldPage.done();

            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            // The header row is now a **modelled** fact: three `tableHeader`
            // cells, not three `<th>` tags to grep for. That is what makes it
            // checkable — `inspectRichText` refuses a table without them
            // (WCAG 1.3.1), and this is the shape it reads.
            const body = saves.bodies[0].values?.['body'];
            expect(savedNodesOfType(body, 'table')).toHaveLength(1);
            expect(savedNodesOfType(body, 'tableRow')).toHaveLength(3);
            expect(savedNodesOfType(body, 'tableHeader')).toHaveLength(3);
        });

        test('grows a table by one row on Tab, then lets go of the keystroke [wysiwyg:I-17]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openInsertSubmenu('Table');
            await wysiwygFieldPage.menuItem('Insert table').click();
            await expect(wysiwygFieldPage.editorTable).toBeVisible();
            // A header row and two ordinary ones.
            await expect(wysiwygFieldPage.editorTableRows).toHaveCount(3);

            // Into the very last cell, and write in it: the append only arms
            // for a row the author has actually used, so this is the state in
            // which Tab is meant to build.
            await wysiwygFieldPage.editorTableLastCell.click();
            await wysiwygFieldPage.type('last');

            // Word's and Google Docs' behaviour, kept: one press, one new row,
            // caret in it.
            await wysiwygFieldPage.pressTab();
            await expect(wysiwygFieldPage.editorTableRows).toHaveCount(4);
            await expect(wysiwygFieldPage.surface('Body')).toBeFocused();

            // Now the part that was `ORT-165`: an author who is merely trying
            // to *leave* walks the row that was just made — three cells, three
            // presses — and the third finds the last cell of a row nobody has
            // written in. `TableKit`'s own binding appends there too, and would
            // go on appending one row per three presses with focus never
            // escaping (measured at 3 rows to 9 over 27 presses). Bounded to a
            // single row, the keystroke is handed back instead, and the
            // editor's ordinary Tab handling takes focus out of the document.
            await wysiwygFieldPage.pressTab(3);
            await expect(wysiwygFieldPage.editorTableRows).toHaveCount(4);
            await expect(wysiwygFieldPage.surface('Body')).not.toBeFocused();
        });

        test('stores a paragraph’s alignment on the block', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.type('Centred');
            await wysiwygFieldPage.align('Align center');
            await wysiwygFieldPage.done();

            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            // Text aligns by `textAlign` on the block; media, which is a block
            // and has no inline children to position, aligns by its own
            // attribute instead. The one menu picks the right one — this is the
            // text half.
            const paragraphs = savedNodesOfType(
                saves.bodies[0].values?.['body'],
                'paragraph'
            );
            expect(
                paragraphs.some((node) => attr(node, 'textAlign') === 'center')
            ).toBe(true);
        });

        test('stores a column layout as nested nodes', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openInsertSubmenu('Columns');
            await wysiwygFieldPage.menuRadio('3 columns').click();
            await wysiwygFieldPage.done();

            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            const body = saves.bodies[0].values?.['body'];
            const blocks = savedNodesOfType(body, 'columnBlock');
            expect(blocks).toHaveLength(1);
            expect(attr(blocks[0], 'count')).toBe(3);
            expect(savedNodesOfType(body, 'column')).toHaveLength(3);
        });

        test('stores an emptied field as empty, not as a blank paragraph', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);

            // `summary` is required, so an emptied editor has to read as empty
            // — an `<p></p>` would sail past the rule and publish a blank field.
            await wysiwygFieldPage.open('Summary');
            await wysiwygFieldPage.clearAll();
            await wysiwygFieldPage.done();

            await contentLibraryPage.editorSave.click();
            await expect(wysiwygFieldPage.fieldError('summary')).toHaveText(
                'Required'
            );
            expect(saves.bodies).toHaveLength(0);
        });
    });

    test.describe('structure and language', () => {
        test('upgrades a legacy HTML body to a document on save', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            // The stored body is still an HTML string — every body written
            // before rich text became structured is. Opening it parses it
            // through the editor's own schema, and saving commits the document,
            // so content upgrades as it is edited rather than in one migration
            // that has to guess.
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.type(' Also this.');
            await wysiwygFieldPage.done();

            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            const body = saves.bodies[0].values?.['body'];
            // A document, and nothing of the original was lost on the way.
            expect(savedNodesOfType(body, 'heading')).toHaveLength(1);
            expect(savedNodesOfType(body, 'listItem')).toHaveLength(2);
            expect(savedText(body)).toContain('Release notes');
            expect(savedText(body)).toContain('Also this.');
        });

        test('names the structural problems in a body it is handed [wysiwyg:I-13]', async ({
            wysiwygFieldPage
        }) => {
            // The ORT-84 repro, opened in the editor. The insert command always
            // builds a header row, so this table could only have come from
            // somewhere else — which is exactly the content the rules have to
            // reach.
            await wysiwygFieldPage.gotoArticle(
                WS,
                WYSIWYG_INACCESSIBLE_ENTRY_ID
            );
            await wysiwygFieldPage.open('Body');

            // Named under the document, while the author can still act on it —
            // which is the whole of 504.2: a rule nobody meets until a save is
            // refused enables nothing.
            await expect(
                wysiwygFieldPage.issues.filter({ hasText: 'header cells' })
            ).toBeVisible();
            await expect(
                wysiwygFieldPage.issues.filter({ hasText: 'above the level' })
            ).toBeVisible();
        });

        test('refuses to save a body a screen reader could not follow [wysiwyg:I-13]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoArticle(
                WS,
                WYSIWYG_INACCESSIBLE_ENTRY_ID
            );
            // Dirty the record without touching the body, so what is judged is
            // the stored value itself.
            await contentLibraryPage
                .fieldTextbox('Title')
                .fill('Still needs work');

            await contentLibraryPage.editorSave.click();
            await expect(wysiwygFieldPage.fieldError('body')).toContainText(
                'header cells'
            );
            // Nothing was sent: the same rule the server applies, applied here
            // first, so the author is told by the form rather than by a 422.
            expect(saves.bodies).toHaveLength(0);
        });

        test('lets a body with only a warning through [wysiwyg:I-13]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            // The other grade. `inspectRichText` reports two, and only one of
            // them is a gate — "click here" is poor link text, but it is not
            // decidable from the string that the body means it badly, so it is
            // advice. Without this case a regression that promoted every
            // finding to `error` would leave the whole suite green: every other
            // fixture body here is either clean or blocking.
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_WARNING_ENTRY_ID);
            await wysiwygFieldPage.open('Body');

            // Named, and named as advice: same list, different severity.
            await expect(
                wysiwygFieldPage.issues.filter({ hasText: 'Worth fixing' })
            ).toContainText('doesn’t say where it goes');
            await expect(
                wysiwygFieldPage.issues.filter({ hasText: 'Blocks saving' })
            ).toHaveCount(0);
            await wysiwygFieldPage.done();

            // The same action the blocking case is refused on, so the two are
            // the same experiment with one variable changed.
            await contentLibraryPage
                .fieldTextbox('Title')
                .fill('Still worth a look');
            await contentLibraryPage.editorSave.click();

            await expect.poll(() => saves.bodies.length).toBeGreaterThan(0);
            await expect(wysiwygFieldPage.fieldError('body')).toHaveCount(0);
        });

        test('stores the language a passage is written in', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.type('Bonjour');
            await wysiwygFieldPage.selectAll();
            await wysiwygFieldPage.setPassageLanguage('fr');
            await wysiwygFieldPage.done();

            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            // The marker rides the run in the stored document, which is what
            // makes language of parts expressible at all (WCAG 3.1.2) — and
            // what a consumer needs to render `<span lang="fr">`.
            const runs = savedNodesOfType(
                saves.bodies[0].values?.['body'],
                'text'
            );
            const marked = runs.find((node) =>
                node.marks?.some((mark) => mark.type === 'language')
            );
            expect(marked?.text).toBe('Bonjour');
            expect(
                marked?.marks?.find((mark) => mark.type === 'language')?.attrs
            ).toEqual({ lang: 'fr' });
        });

        test('refuses a language tag assistive tech would ignore [wysiwyg:I-14]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.type('Bonjour');
            await wysiwygFieldPage.selectAll();
            await wysiwygFieldPage.openToolbarMenu('More formatting');
            await wysiwygFieldPage
                .menuItem('Language of this passage…')
                .click();

            // A POSIX locale is not a BCP-47 tag, and a screen reader ignores
            // it outright — so the dialog says so rather than storing a marker
            // that does nothing.
            const dialog = wysiwygFieldPage.languageDialog;
            await dialog.getByLabel('Language tag').fill('fr_FR');
            await dialog.getByRole('button', { name: 'Apply' }).click();
            await expect(dialog).toBeVisible();
            await expect(dialog.getByRole('alert')).toContainText('BCP-47');
        });
    });

    test.describe('media', () => {
        test('offers the contributed sources beside the built-in URL entries', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openInsertSubmenu('Media');

            // The first two are the media plugin's `WYSIWYG_MEDIA_SLOT`
            // contributions — the editor itself knows nothing about a library.
            await expect(
                wysiwygFieldPage.menuItem('Media Library…')
            ).toBeVisible();
            await expect(
                wysiwygFieldPage.menuItem('Upload files…')
            ).toBeVisible();
            // …and the editor's own entries, which need no plugin at all.
            await expect(
                wysiwygFieldPage.menuItem('Image from a URL…')
            ).toBeVisible();
            await expect(
                wysiwygFieldPage.menuItem('Video from a URL…')
            ).toBeVisible();
        });

        test('stores an image named by URL [wysiwyg:I-28]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openMediaSource('Image from a URL…');
            await wysiwygFieldPage.fillMediaUrl(
                'https://example.com/photo.jpg',
                'A photo'
            );

            // Asserted on the node, not on the paint: the URL is external and
            // this suite has no network, so the image is broken and has no box.
            // What matters is that the editor made a node carrying that source.
            await expect(
                wysiwygFieldPage.editorImage('A photo')
            ).toHaveAttribute('src', 'https://example.com/photo.jpg');

            await wysiwygFieldPage.done();
            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            const images = savedNodesOfType(
                saves.bodies[0].values?.['body'],
                'image'
            );
            expect(images).toHaveLength(1);
            expect(attr(images[0], 'src')).toBe(
                'https://example.com/photo.jpg'
            );
            expect(attr(images[0], 'alt')).toBe('A photo');
        });

        test('refuses a URL the editor would not publish [wysiwyg:I-21]', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openMediaSource('Image from a URL…');

            // `javascript:` never reaches the document — the dialog says why
            // rather than inserting a node that would carry it into published
            // HTML.
            await wysiwygFieldPage.fillMediaUrl('javascript:alert(1)');
            await expect(wysiwygFieldPage.mediaUrlError).toBeVisible();
            await expect(wysiwygFieldPage.editorImage(/./)).toHaveCount(0);

            // And a **protocol-relative** address, which is the one that looks
            // ordinary: it inherits whatever scheme the *consumer* is on, and
            // this editor cannot vouch for that. A scheme allowlist alone lets
            // it through — there is no scheme in it to check.
            await wysiwygFieldPage.fillMediaUrl('//evil.host/x.png');
            await expect(wysiwygFieldPage.mediaUrlError).toBeVisible();
            await expect(wysiwygFieldPage.editorImage(/./)).toHaveCount(0);
        });

        test('places an asset picked from the Media Library [wysiwyg:I-28]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openMediaSource('Media Library…');
            await wysiwygFieldPage.pickLibraryAsset('hero.png');

            await wysiwygFieldPage.done();
            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            // The stored `src` points at the library asset, and the asset's own
            // pixel width seeds the node — so it lands at its natural size.
            const images = savedNodesOfType(
                saves.bodies[0].values?.['body'],
                'image'
            );
            expect(images).toHaveLength(1);
            expect(String(attr(images[0], 'src'))).toContain(
                `/api/media/assets/${MEDIA_ASSET_IDS.hero}`
            );
            expect(attr(images[0], 'width')).toBe(1200);
            // Nothing was uploaded: an existing asset is already in the library.
            expect(uploads.count).toBe(0);
        });

        test('resizes an image from the keyboard, and stores the width [wysiwyg:I-23]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openMediaSource('Image from a URL…');
            await wysiwygFieldPage.fillMediaUrl(
                'https://example.com/photo.jpg',
                'A photo'
            );

            // Resizing is a content decision — the width is published — so it
            // has to work without a mouse.
            await wysiwygFieldPage.nudgeResize('ArrowLeft', 2);

            await wysiwygFieldPage.done();
            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            const resized = savedNodesOfType(
                saves.bodies[0].values?.['body'],
                'image'
            )[0];
            expect(attr(resized, 'width')).toEqual(expect.any(Number));
            // A width and **no height**: the picture keeps its own aspect ratio
            // wherever this body is rendered, and a stored height is the one
            // way to distort it.
            expect(attr(resized, 'height')).toBeUndefined();
        });

        test('centres a selected image, and stores where it sits [wysiwyg:I-24]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            // From the library, so the image is a real one the browser can
            // render: the author picks it by **clicking the picture**, and a
            // source the sandbox can't fetch has no box to click.
            await wysiwygFieldPage.openMediaSource('Media Library…');
            await wysiwygFieldPage.pickLibraryAsset('hero.png');

            await wysiwygFieldPage.editorImage(MEDIA_HERO_ALT).click();
            await wysiwygFieldPage.openToolbarMenu('Alignment');
            // An image *is* the block, so there are no words inside it to
            // spread — the menu drops "Justify" while media is selected.
            await expect(wysiwygFieldPage.menuRadio('Justify')).toHaveCount(0);
            await wysiwygFieldPage.menuRadio('Align center').click();

            // Media moves by its margins, not by `text-align` — which is why
            // this is its own attribute and not the text extension's.
            await expect(wysiwygFieldPage.editorFigure).toHaveAttribute(
                'data-align',
                'center'
            );

            await wysiwygFieldPage.done();
            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            // Where a picture sits is published layout, so it has to survive the
            // round-trip — the editor agreeing is only half of it.
            expect(
                attr(
                    savedNodesOfType(
                        saves.bodies[0].values?.['body'],
                        'image'
                    )[0],
                    'align'
                )
            ).toBe('center');
        });

        test('prompts for alt text, and stores what the author writes', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openMediaSource('Image from a URL…');
            // Inserted with **no** alt — the case an upload always lands in,
            // and the one the insert dialogs can't cover on their own.
            await wysiwygFieldPage.fillMediaUrl(
                'https://example.com/photo.jpg'
            );

            // The prompt is the control: the defect is visible while writing,
            // not discovered in an audit.
            await expect(
                wysiwygFieldPage.altControl('Add alt text')
            ).toBeVisible();

            await wysiwygFieldPage.setAltText('Ada at her desk');
            // Answered — the chip stops nagging and becomes a plain edit.
            await expect(wysiwygFieldPage.altControl('Alt text')).toBeVisible();

            await wysiwygFieldPage.done();
            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            expect(
                attr(
                    savedNodesOfType(
                        saves.bodies[0].values?.['body'],
                        'image'
                    )[0],
                    'alt'
                )
            ).toBe('Ada at her desk');
        });

        test('clears the alt when the image is marked decorative [wysiwyg:I-25, wysiwyg:I-26]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openMediaSource('Image from a URL…');
            // Inserted **with** a description. An image that arrives with no
            // alt is already `alt === ''` before the box is ticked, so it can
            // say nothing about ticking it: `alt: decorative ? '' : alt` could
            // be `alt` outright and the assertion below would still hold. The
            // author changing their mind is the transition this is about.
            await wysiwygFieldPage.fillMediaUrl(
                'https://example.com/divider.png',
                'A ruled divider'
            );
            await expect(wysiwygFieldPage.altControl('Alt text')).toBeVisible();

            // The popover keeps the description in its box (disabled, not
            // emptied) while the box is ticked, so a non-empty alt really is
            // what reaches the command alongside `decorative: true`.
            await wysiwygFieldPage.markAltDecorative();

            // `alt=""` alone can't be told from "nobody wrote it yet", so the
            // decision is recorded — and the prompt stops asking.
            await expect(
                wysiwygFieldPage.altControl('Add alt text')
            ).toHaveCount(0);

            await wysiwygFieldPage.done();
            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            const images = savedNodesOfType(
                saves.bodies[0].values?.['body'],
                'image'
            );
            expect(images).toHaveLength(1);
            // The description is *gone*, not merely hidden behind the flag: a
            // non-empty alt beside `data-decorative` cannot exist in the saved
            // HTML, because a screen reader would announce it anyway.
            expect(attr(images[0], 'decorative')).toBe(true);
            expect(attr(images[0], 'alt')).toBe('');
        });

        test('never saves the record from an overlay’s own form [wysiwyg:I-27]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            // On an **existing** record, so a save would actually go out —
            // a create form's required fields would mask the bug.
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_MEDIA_ENTRY_ID);
            await wysiwygFieldPage.open('Body');

            // These overlays portal out of the DOM but stay inside the entry
            // editor's `<form>` in the React tree, and React bubbles synthetic
            // events along *that* tree — so each of their Save/Apply/Insert
            // buttons used to submit the whole record, publishing it.
            await wysiwygFieldPage.setAltText('A hero shot, described');

            await wysiwygFieldPage.openMediaSource('Image from a URL…');
            await wysiwygFieldPage.fillMediaUrl(
                'https://example.com/second.jpg',
                'Another'
            );

            await wysiwygFieldPage.openLinkPopover();
            await wysiwygFieldPage.applyLink('https://example.com');

            // Nothing reached the write endpoint: the record is saved when the
            // author saves it, and not before.
            expect(saves.bodies).toHaveLength(0);
            await expect(contentLibraryPage.savedToast).toHaveCount(0);
        });

        test('never saves the record from the language dialog either [wysiwyg:I-27]', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            // The fourth popup form, and the one the overlay case above never
            // reached. Its own test rather than a fifth step there: it needs the
            // caret in the document to have something to mark, and that is only
            // guaranteed straight after unfolding.
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.open('Body');

            await wysiwygFieldPage.selectAll();
            await wysiwygFieldPage.setPassageLanguage('fr');

            // Apply is a `type="submit"` in a dialog that portals out of the DOM
            // but not out of the entry form's React tree, which is the whole
            // shape of this bug — React bubbles synthetic events along the tree,
            // not the DOM.
            expect(saves.bodies).toHaveLength(0);
            await expect(contentLibraryPage.savedToast).toHaveCount(0);
        });

        test('carries the library asset’s own alt into the body', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoNewArticle(WS);
            await contentLibraryPage.fieldTextbox('Title').fill('Draft');

            await wysiwygFieldPage.open('Body');
            await wysiwygFieldPage.openMediaSource('Media Library…');
            await wysiwygFieldPage.pickLibraryAsset('hero.png');

            // Alt written once in the library shouldn't be written again per
            // body — so this image arrives already answered.
            await expect(wysiwygFieldPage.altControl('Alt text')).toBeVisible();

            await wysiwygFieldPage.done();
            await contentLibraryPage.saveDraft();
            await expect.poll(() => saves.bodies).toHaveLength(1);

            expect(
                attr(
                    savedNodesOfType(
                        saves.bodies[0].values?.['body'],
                        'image'
                    )[0],
                    'alt'
                )
            ).toBe(MEDIA_HERO_ALT);
        });

        test('shows a stored image in the collapsed preview', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_MEDIA_ENTRY_ID);
            // The preview renders the same node the editor does — it is the
            // same schema round-trip, so a picture reads as a picture.
            await expect(
                wysiwygFieldPage.preview('Body').getByRole('img')
            ).toBeVisible();
        });
    });

    test.describe('accessibility', () => {
        test('the collapsed field has no violations', async ({
            wysiwygFieldPage,
            makeAxe
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.control('Body').waitFor();
            await expectNoA11yViolations(makeAxe());
        });

        test('the expanded editor has no violations', async ({
            wysiwygFieldPage,
            makeAxe
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.open('Body');
            await expectNoA11yViolations(makeAxe());
        });

        test('the field is reachable and openable from the keyboard', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.openWithKeyboard('Body');

            await expect(
                wysiwygFieldPage.expandedHeading('Body')
            ).toBeVisible();
            await expect(wysiwygFieldPage.surface('Body')).toBeFocused();
        });

        test('a translated body claims its own language, expanded or not [wysiwyg:I-36]', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_GERMAN_ENTRY_ID);

            // Collapsed: the language comes from the form's Translated group,
            // which wraps every localized field.
            const preview = wysiwygFieldPage.preview('Body');
            await preview.waitFor();
            expect(await wysiwygFieldPage.resolvedLang(preview)).toBe(
                WYSIWYG_GERMAN_LOCALE
            );

            // Expanded: the view is rendered in place of the tab strip —
            // *outside* that group — so it has to claim the language itself.
            // Without it the body sits inside the admin's hardcoded
            // `<html lang="en">` and a screen reader reads German prose with
            // English pronunciation rules (WCAG 3.1.2).
            await wysiwygFieldPage.open('Body');
            const surface = wysiwygFieldPage.surface('Body');
            expect(await wysiwygFieldPage.resolvedLang(surface)).toBe(
                WYSIWYG_GERMAN_LOCALE
            );
            // …and orders its own bidi text from the content, matching the form.
            expect(await wysiwygFieldPage.resolvedDir(surface)).toBe('auto');
        });

        test('claims no language for a body that is shared across locales [wysiwyg:I-36]', async ({
            wysiwygFieldPage
        }) => {
            // The falsifying half. `notes` is the one rich-text field on this
            // type that is **not** localized: it holds one value for every
            // locale, usually still in whatever language it was first written
            // in, so claiming the row's locale for it would be a worse
            // assertion than making none. Without this field in the seed, a
            // view that set `contentLocale` unconditionally would pass the
            // localized case and nothing would notice.
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_GERMAN_ENTRY_ID);
            await wysiwygFieldPage.open('Notes');

            const surface = wysiwygFieldPage.surface('Notes');
            // `'en'` and not `null`: the walk falls back to the admin's own
            // hardcoded `<html lang="en">`, so this says "inherited the
            // chrome's language" rather than "claimed nothing anywhere".
            expect(await wysiwygFieldPage.resolvedLang(surface)).toBe('en');

            // The control, on the same page load: the localized field beside it
            // does claim `de`, so this is the `localized` branch and not a view
            // that stopped setting `lang` at all.
            await wysiwygFieldPage.done();
            await wysiwygFieldPage.open('Body');
            expect(
                await wysiwygFieldPage.resolvedLang(
                    wysiwygFieldPage.surface('Body')
                )
            ).toBe(WYSIWYG_GERMAN_LOCALE);
        });

        test('returns focus to the field when the editor closes [wysiwyg:I-37]', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.openWithKeyboard('Body');
            await wysiwygFieldPage.done();

            // Focus does not follow a removed active element — it lands on
            // `<body>`, and the author who pressed Done from the keyboard has to
            // Tab from the top of the page to get back into the form
            // (WCAG 2.4.3). It belongs on the control they came from.
            await expect(wysiwygFieldPage.control('Body')).toBeFocused();
        });

        test('offers a keyboard way out of the document, and says so', async ({
            wysiwygFieldPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.open('Body');

            // Tab cannot be the way out: inside a table it is bound to "next
            // cell", and at the last cell it appends a **row** rather than
            // falling through — so an author trying to leave grows the table one
            // row per press. WCAG 2.1.2 accepts a component consuming Tab only
            // if the user is advised of the way out, so there is one, and the
            // surface's description says what it is.
            const surface = wysiwygFieldPage.surface('Body');
            await expect(surface).toBeFocused();
            expect(await wysiwygFieldPage.describedText(surface)).toMatch(
                /Control plus M/i
            );

            await wysiwygFieldPage.pressEscapeChord();
            await expect(wysiwygFieldPage.exitButton('Done')).toBeFocused();
        });

        test('leaves ⌘K alone while the caret is in the body', async ({
            wysiwygFieldPage,
            contentLibraryPage
        }) => {
            await wysiwygFieldPage.gotoArticle(WS, WYSIWYG_ENTRY_ID);
            await wysiwygFieldPage.open('Body');

            // The workspace's content palette binds ⌘K on `window`, so it fires
            // wherever focus is. Opening it out from under a caret is a change
            // of context in response to input into a *different* control
            // (WCAG 3.2.2) — the same collision the sidebar's ⌘B toggle had with
            // **bold**, and ⌘K is "insert a link" in every editor an author has
            // used.
            await wysiwygFieldPage.pressSearchChord();
            await expect(contentLibraryPage.searchDialog).toBeHidden();
            await expect(wysiwygFieldPage.surface('Body')).toBeFocused();

            // …and the palette still opens from anywhere that is not text.
            await contentLibraryPage.openSearchByShortcut();
            await expect(contentLibraryPage.searchDialog).toBeVisible();
        });
    });
});
