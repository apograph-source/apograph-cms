import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    LIBRARY_WORKSPACE,
    RELATIONS_WORKSPACE,
    RELATIONS_SCHEMA_SEED,
    RELATIONS_DETAIL_SEED,
    RELATIONS_ENTRIES_SEED,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites,
    mockContentEntryRead,
    mockEntryRelations,
    mockRelationFieldLinks,
    spyEntrySave,
    type EntrySaveSpy
} from '../support/api/content';
import {
    mockSegmentsApi,
    PAGED_SEGMENT_SEED,
    type SegmentsApiSpy
} from '../support/api/segments';
import { mockEntryRevisionFlow } from '../support/api/revisions';
import { mockEntryReview } from '../support/api/protection';
import { expectNoA11yViolations } from '../support/a11y';

const WS = RELATIONS_WORKSPACE.id;
/** The article the relations seed already provides an editor for. */
const ENTRY = RELATIONS_ENTRIES_SEED['article'][0].id;

/**
 * The entry editor's **Access** tab — who may read this record.
 *
 * The behaviour worth a browser is the one that is invisible in a unit test:
 * the tab has **no Save button**, and what it stages must reach the entry's own
 * save body. `spyEntrySave` is the assertion target, because "did the staging
 * get there" is the only question the screen cannot answer for itself.
 */
test.describe('Entry editor — Access tab', () => {
    let saves: EntrySaveSpy;
    let segments: SegmentsApiSpy;

    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [RELATIONS_WORKSPACE]);
        await mockContentSchema(page, { types: RELATIONS_SCHEMA_SEED });
        await mockContentSchemaDetail(page, { details: RELATIONS_DETAIL_SEED });
        await mockContentEntries(page, {
            details: RELATIONS_DETAIL_SEED,
            entries: RELATIONS_ENTRIES_SEED
        });
        await mockContentEntryWrites(page, { details: RELATIONS_DETAIL_SEED });
        // Both relation reads, and both are required rather than tidiness. The
        // article seed carries relation fields, so the editor mounts a
        // `RelationFieldLive` for each; unmocked, the per-field links read falls
        // through to the dev proxy and its page arrives without `items`, which
        // `useRelationFieldLinks`'s `getNextPageParam` reduces over. The editor
        // then dies inside the error boundary, and every assertion in this file
        // reads as "the Access tab staged nothing" instead of "the page is
        // gone". `mockEntryRelations` stops at `/relations`, so it never matches
        // the deeper path.
        await mockEntryRelations(page);
        await mockRelationFieldLinks(page);
        // The record itself, rather than the values the write mock fabricates
        // from the schema. Those fill a relation field with a readable string,
        // which the editor validates as "Must be a valid entry id" and refuses
        // to save — so every assertion about what the save *body* carried would
        // fail on a form that was never submitted.
        await mockContentEntryRead(page, {
            records: {
                [`article/${ENTRY}`]: {
                    text: 'Getting started',
                    author: null,
                    seo: null
                }
            }
        });
        segments = await mockSegmentsApi(page);
        saves = await spyEntrySave(page);
    });

    /** Open the article's editor on its Access tab. */
    async function openAccessTab(contentLibraryPage: {
        gotoEntry: (ws: string, type: string, id: string) => Promise<void>;
        openEditorTab: (name: string) => Promise<void>;
    }) {
        await contentLibraryPage.gotoEntry(WS, 'article', ENTRY);
        await contentLibraryPage.openEditorTab('Access');
    }

    test('lists one three-state control per audience', async ({
        contentLibraryPage,
        segmentsPage
    }) => {
        await openAccessTab(contentLibraryPage);

        // Three states, not a checkbox: "not set" is a real answer, and a
        // two-state control would leave it unreachable once a row was touched.
        await expect(segmentsPage.accessControl('Acme Corp')).toBeVisible();
        await expect(
            segmentsPage.accessOption('Acme Corp', 'Not set')
        ).toHaveAttribute('aria-checked', 'true');
    });

    test('scopes the list to the open workspace', async ({
        contentLibraryPage
    }) => {
        // An editor is offered the audiences their workspace was given, not the
        // installation's whole vocabulary.
        await openAccessTab(contentLibraryPage);

        await expect
            .poll(() => segments.listedWorkspaces.filter(Boolean))
            .toContain(WS);
    });

    test('has no Save button of its own', async ({
        page,
        contentLibraryPage
    }) => {
        // The point of the whole design: who may read a record is part of the
        // record, so it rides the editor's Save rather than a second button
        // the user has to remember their change belonged to.
        await openAccessTab(contentLibraryPage);

        await expect(
            page.getByRole('button', { name: /Save access|^Undo$/ })
        ).toHaveCount(0);
    });

    // Also `protection:I-19`: the form's fields are untouched here, so it is the
    // staged audience alone that makes Publish save before it publishes.
    test('marks a staged change, and sends it with the entry’s save [protection:I-19]', async ({
        contentLibraryPage,
        segmentsPage
    }) => {
        await openAccessTab(contentLibraryPage);
        await segmentsPage.setAccess('Acme Corp', 'Can see');

        // The same "Changed" pill a field carries — the tab is part of the
        // record, so it says so the same way.
        await expect(segmentsPage.accessChanged).toBeVisible();
        await expect(segmentsPage.accessSummary.first()).toHaveText(
            'Restricted'
        );

        await contentLibraryPage.editorSave.click();

        // The assertion the screen cannot make: the staging reached the save
        // **body**, which is what puts it in one transaction with the record.
        await expect
            .poll(() => saves.bodies.at(-1)?.extensions)
            .toEqual({ access: { allow: ['seg-acme'], deny: [] } });
    });

    /**
     * The publish verdict has to answer for **the version Publish will ship**,
     * and a staged audience is a version this record does not have yet: the
     * press saves first, that save appends a revision, and the approvals bound
     * to the old head stop counting at that moment.
     *
     * The editor's own dirty flag cannot see this — it is fields and staged
     * links — so the guard was being handed `dirty: false` and judging the
     * stored head, which is approved. The button unlocked and the API answered
     * 409. This is the case `protection:I-18`'s checklist row calls "stage only
     * a link **or an audience**"; the link half had a test and this half did
     * not.
     */
    test('holds Publish for a staged audience alone [protection:I-18]', async ({
        contentLibraryPage,
        segmentsPage,
        page
    }) => {
        // Approved as it stands, and blocked the moment anything is saved.
        await mockEntryReview(page, {
            required: 1,
            given: 1,
            blocked: false,
            afterSave: { required: 1, given: 0, blocked: true }
        });
        await openAccessTab(contentLibraryPage);

        // Nothing about the form is touched — the audience is the whole change.
        await expect(contentLibraryPage.editorSave).not.toHaveAttribute(
            'aria-disabled',
            'true'
        );

        await segmentsPage.setAccess('Acme Corp', 'Can see');

        await expect(contentLibraryPage.editorSave).toHaveAttribute(
            'aria-disabled',
            'true'
        );
    });

    test('sends nothing about access when nothing was staged [segments:I-26]', async ({
        contentLibraryPage
    }) => {
        // What keeps the feature inert: an editor who never opens this tab
        // changes nothing and pays no request. A field is edited so that there
        // is a save to inspect at all — Publish on an unchanged record publishes
        // it without saving.
        await contentLibraryPage.gotoEntry(WS, 'article', ENTRY);
        await contentLibraryPage.fieldTextbox('Title').fill('Getting started!');
        await contentLibraryPage.editorSave.click();

        await expect.poll(() => saves.bodies.length).toBeGreaterThan(0);
        expect(saves.bodies.at(-1)?.extensions).toBeUndefined();
    });

    test('clears the staging when a toggle returns to what is stored', async ({
        contentLibraryPage,
        segmentsPage
    }) => {
        // Staging what is already stored would light the badge and cost a write
        // for a round trip back to where the entry started.
        await openAccessTab(contentLibraryPage);

        await segmentsPage.setAccess('Acme Corp', 'Can see');
        await expect(segmentsPage.accessChanged).toBeVisible();

        await segmentsPage.setAccess('Acme Corp', 'Not set');
        await expect(segmentsPage.accessChanged).toHaveCount(0);
    });

    test('survives a tab switch, because the staging lives above the panel', async ({
        contentLibraryPage,
        segmentsPage
    }) => {
        // Editor tabs are routes: this panel unmounts the moment the user
        // switches tab, and an unsaved decision must not go with it.
        await openAccessTab(contentLibraryPage);
        await segmentsPage.setAccess('Acme Corp', 'Cannot see');

        await contentLibraryPage.openEditorTab('General');
        await contentLibraryPage.openEditorTab('Access');

        await expect(
            segmentsPage.accessOption('Acme Corp', 'Cannot see')
        ).toHaveAttribute('aria-checked', 'true');
    });

    test('sets every matched audience at once, not just the page [segments:I-27]', async ({
        page,
        contentLibraryPage,
        segmentsPage
    }) => {
        // A control called "set every audience" that quietly set the visible
        // rows would be worse than none: the mistake is invisible until a
        // reader is turned away.
        //
        // The broken implementation this has to tell apart is one line:
        // `onApply` folding the state over `list` (the rows drawn) instead of
        // `matchedIds` (the list response's `ids`). The default seed of three
        // against the tab's page size of ten cannot see the difference — every
        // match is on screen — so this case seeds **fourteen**, and four of
        // them are never rendered.
        await mockSegmentsApi(page, { segments: PAGED_SEGMENT_SEED });
        await openAccessTab(contentLibraryPage);

        // The fixture only discriminates if page two is genuinely off screen.
        await expect(segmentsPage.accessControl('Audience 01')).toBeVisible();
        await expect(segmentsPage.accessControl('Audience 11')).toHaveCount(0);
        // And the control says what it is about to do in terms of the match
        // count, not the page's — 14, not 10.
        await expect(
            page.getByText(
                'Applies to all 14 audiences, not just the ones on this page.'
            )
        ).toBeVisible();

        await segmentsPage.bulkAction('Can see').click();
        await contentLibraryPage.editorSave.click();

        // Request-level, because the screen cannot answer for the rows it
        // never drew: all fourteen matched ids have to be in the save body,
        // and `seg-11`…`seg-14` can only have got there from the list
        // response's `ids`.
        await expect
            .poll(() => saves.bodies.at(-1)?.extensions)
            .toEqual({
                access: {
                    allow: PAGED_SEGMENT_SEED.map((segment) => segment.id),
                    deny: []
                }
            });
    });

    test('refuses the bulk set when more matched than an entry can name [segments:I-27]', async ({
        page,
        contentLibraryPage,
        segmentsPage
    }) => {
        // The other half of the same invariant. The server caps the `ids` it
        // returns (`MATCHED_IDS_CAP`), so past it the client is holding a
        // *partial* set — and applying a partial set is worse than applying
        // nothing, because "set every audience" would have set some of them.
        // The controls go dead with the reason instead.
        await mockSegmentsApi(page, {
            segments: PAGED_SEGMENT_SEED,
            matchedIdsCap: 12
        });
        await openAccessTab(contentLibraryPage);

        await expect(segmentsPage.bulkAction('Can see')).toBeDisabled();
        await expect(segmentsPage.bulkAction('Cannot see')).toBeDisabled();
        await expect(segmentsPage.bulkAction('Clear all')).toBeDisabled();
        // Disabled, not hidden, and with the way out named in the same
        // sentence: the search is what narrows the match set back under the cap.
        await expect(
            page.getByText(
                /more audiences than an entry can name at once[\s\S]*Narrow the list with the search/
            )
        ).toBeVisible();
    });

    test('clears every audience with the same control', async ({
        contentLibraryPage,
        segmentsPage
    }) => {
        await openAccessTab(contentLibraryPage);

        await segmentsPage.setAccess('Acme Corp', 'Can see');
        await segmentsPage.bulkAction('Clear all').click();

        await expect(segmentsPage.accessSummary.first()).toHaveText(
            'Readable by everyone'
        );
    });

    test('keeps a decision on an audience the list no longer shows [segments:I-28]', async ({
        page,
        contentLibraryPage,
        segmentsPage
    }) => {
        // An audience narrowed out of this workspace after somebody restricted
        // an entry to it. The directory read is workspace-scoped, so the row is
        // gone from the tab — while the entry still holds the decision, and a
        // reader is still matched against it.
        //
        // The tab writes **both lists whole** on every save, so anything it
        // dropped from its own view it would erase from the record. That is the
        // quiet failure this pins: nobody would connect an entry becoming
        // readable to a change made on a screen about where an audience is
        // offered.
        await mockSegmentsApi(page, {
            segments: [
                {
                    id: 'seg-acme',
                    key: 'acme',
                    label: 'Acme Corp',
                    tags: ['acme'],
                    workspaceIds: [],
                    usageCount: 0
                }
            ],
            access: { [ENTRY]: { allow: ['seg-elsewhere'], deny: [] } }
        });
        await openAccessTab(contentLibraryPage);

        // Not on screen — it is not offered here, so it cannot be *decided*
        // here…
        await expect(segmentsPage.accessControl('Acme Corp')).toBeVisible();
        await expect(segmentsPage.accessSummary.first()).toHaveText(
            'Restricted'
        );
        // …but it is counted, so the editor is not told the entry is governed
        // only by what they can see.
        await expect(
            page.getByText(/1 more decision on audiences this list does not/)
        ).toBeVisible();

        await segmentsPage.setAccess('Acme Corp', 'Can see');
        await contentLibraryPage.editorSave.click();

        // The assertion: the hidden id is still in the body the save carried.
        await expect
            .poll(
                () =>
                    (
                        saves.bodies.at(-1)?.extensions as
                            | { access?: { allow?: string[] } }
                            | undefined
                    )?.access?.allow
            )
            .toEqual(expect.arrayContaining(['seg-elsewhere', 'seg-acme']));
    });

    test('is read-only for an editor without segments:manage', async ({
        page,
        contentLibraryPage,
        segmentsPage
    }) => {
        // Two gates, and they are different: `content:update` says they may
        // rewrite the article, `segments:manage` says they may publish it to a
        // new audience.
        await mockSignedIn(page, {
            permissions: [
                'workspaces:read',
                'content:read',
                'content:create',
                'content:update',
                'segments:read'
            ]
        });
        await openAccessTab(contentLibraryPage);

        await expect(
            segmentsPage.accessOption('Acme Corp', 'Can see')
        ).toBeDisabled();
        await expect(
            page.getByText(/needs the “segments:manage” permission/)
        ).toBeVisible();
        // The bulk controls go entirely, rather than sitting there dead.
        await expect(segmentsPage.bulkAction('Can see')).toHaveCount(0);
    });

    test('says a decision covers every language, on a localized type', async ({
        page,
        contentLibraryPage
    }) => {
        // The server writes access to the record's whole locale group, because
        // who may read a record is a fact about the record rather than about its
        // German wording. That is the one thing on this tab that is not about
        // the row in front of the editor, so leaving it to be discovered would
        // be leaving it to be discovered by a reader.
        await mockContentSchemaDetail(page, {
            details: {
                ...RELATIONS_DETAIL_SEED,
                article: { ...RELATIONS_DETAIL_SEED['article'], i18n: true }
            }
        });
        await openAccessTab(contentLibraryPage);

        await expect(
            page.getByText(/applies to every language of the record/)
        ).toBeVisible();
    });

    test('does not say it on a type with no languages', async ({
        page,
        contentLibraryPage
    }) => {
        // A sentence about translations on a type that has none is noise about a
        // feature this workspace is not running.
        await openAccessTab(contentLibraryPage);

        await expect(
            page.getByText(/applies to every language of the record/)
        ).toHaveCount(0);
    });

    test('has no axe violations', async ({
        contentLibraryPage,
        segmentsPage,
        makeAxe
    }) => {
        await openAccessTab(contentLibraryPage);
        await expect(segmentsPage.accessControl('Acme Corp')).toBeVisible();

        await expectNoA11yViolations(makeAxe());
    });
});

/**
 * The revision preview's **"Who can read this"** row — what a version captured
 * about its audiences, and what restoring it would therefore change.
 *
 * Three states, and the third is the one that has to be right: a version taken
 * before this plugin existed recorded **nothing**, and a restore leaves an
 * unmentioned key alone. Rendering that as "readable by everyone" would promise
 * a change the restore will not make — which is exactly the half of a restore
 * nobody thinks to check.
 */
test.describe('Revision preview — who could read it', () => {
    const ENTRY_ID = 'blog_post-access';

    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [LIBRARY_WORKSPACE]);
        await mockContentSchema(page);
        await mockContentSchemaDetail(page);
        await mockContentEntries(page);
        await mockEntryRelations(page);
    });

    /**
     * Open version 1's preview.
     *
     * It saves once first, because the preview compares a version **against the
     * current one** — `showPreview` is `!isLatest`, so the only version of a
     * one-version entry offers no button, correctly: it would be comparing a
     * version with itself.
     */
    async function openPreview(contentLibraryPage: {
        gotoEntry: (ws: string, type: string, id: string) => Promise<void>;
        openEditorTab: (name: string) => Promise<void>;
        fieldTextbox: (label: string) => import('@playwright/test').Locator;
        saveDraft: () => Promise<void>;
        revisionPreview: (n: number) => import('@playwright/test').Locator;
    }) {
        await contentLibraryPage.gotoEntry(
            LIBRARY_WORKSPACE.id,
            'blog_post',
            ENTRY_ID
        );
        await contentLibraryPage.fieldTextbox('Title').fill('Edited');
        await contentLibraryPage.saveDraft();
        await contentLibraryPage.openEditorTab('History');
        await contentLibraryPage.revisionPreview(1).click();
    }

    test('names the audiences a version captured', async ({
        page,
        contentLibraryPage
    }) => {
        await mockSegmentsApi(page);
        await mockEntryRevisionFlow(page, {
            name: 'blog_post',
            id: ENTRY_ID,
            values: { title: 'Restricted post' },
            extras: { 1: { access: { allow: ['seg-acme'], deny: [] } } }
        });

        await openPreview(contentLibraryPage);

        const dialog = page.getByRole('dialog');
        // The label, not the uuid: the id is all the version holds, and a uuid
        // on screen is not an answer to "who could read this".
        await expect(dialog.getByText('Acme Corp')).toBeVisible();
        await expect(dialog.getByText(/seg-acme/)).toHaveCount(0);
    });

    test('says so when the older version recorded nothing', async ({
        page,
        contentLibraryPage
    }) => {
        // The case a restore turns on: version 1 predates the plugin and
        // captured no `access` key at all, while today's entry is restricted.
        // Restoring it leaves the audiences alone — so the row must say "not
        // recorded" rather than "readable by everyone", which would promise a
        // change the restore will not make.
        await mockSegmentsApi(page);
        await mockEntryRevisionFlow(page, {
            name: 'blog_post',
            id: ENTRY_ID,
            values: { title: 'Old post' },
            extras: { 2: { access: { allow: ['seg-acme'], deny: [] } } }
        });

        await contentLibraryPage.gotoEntry(
            LIBRARY_WORKSPACE.id,
            'blog_post',
            ENTRY_ID
        );
        // A second version, so the dialog has a *current* to compare against —
        // with one revision the selected version is the latest and there is
        // nothing to differ from.
        await contentLibraryPage.fieldTextbox('Title').fill('Old post v2');
        await contentLibraryPage.saveDraft();

        await contentLibraryPage.openEditorTab('History');
        await contentLibraryPage.revisionPreview(1).click();

        const dialog = page.getByRole('dialog');
        await expect(
            dialog.getByText('Not recorded in this version')
        ).toBeVisible();
        await expect(dialog.getByText('Readable by everyone')).toHaveCount(0);
    });

    test('marks an audience deleted since as deleted, not as a uuid', async ({
        page,
        contentLibraryPage
    }) => {
        // The id the version holds resolves to nothing today. It is looked up
        // **by id** rather than found on a page of the directory — a paginated
        // miss rendered as "deleted" would be a claim rather than a gap.
        await mockSegmentsApi(page);
        await mockEntryRevisionFlow(page, {
            name: 'blog_post',
            id: ENTRY_ID,
            values: { title: 'Post' },
            extras: { 1: { access: { allow: ['seg-gone-since'], deny: [] } } }
        });

        await openPreview(contentLibraryPage);

        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Deleted audience')).toBeVisible();
        await expect(dialog.getByText(/seg-gone-since/)).toHaveCount(0);
    });
});
