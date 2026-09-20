import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    MEDIA_FIELDS_WORKSPACE,
    MEDIA_FIELDS_SCHEMA_SEED,
    MEDIA_FIELDS_DETAIL_SEED,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockContentEntryWrites,
    mockContentEntryRead,
    mockEntryMedia,
    spyEntrySave,
    type EntrySaveSpy
} from '../support/api/content';
import {
    failMediaReads,
    mockMediaApi,
    uploadedAssetId,
    MEDIA_ASSET_IDS,
    type MediaUploadSpy
} from '../support/api/media';
import { expectNoA11yViolations } from '../support/a11y';

const WS = MEDIA_FIELDS_WORKSPACE.id;

/**
 * The entry editor's **Media tab** (`@orthacms/media-admin`, contributed
 * through content-admin's `ENTRY_TAB_SLOT`): attaching an asset from the Media
 * Library, staging an upload that only goes up **with the record**, removing and
 * reordering, and accessibility. Both backends are mocked — the content schema /
 * save endpoints and the real media endpoints the picker and upload drive.
 */
test.describe('Entry editor — Media tab', () => {
    let uploads: MediaUploadSpy;
    let saves: EntrySaveSpy;

    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [MEDIA_FIELDS_WORKSPACE]);
        await mockContentSchema(page, { types: MEDIA_FIELDS_SCHEMA_SEED });
        await mockContentSchemaDetail(page, {
            details: MEDIA_FIELDS_DETAIL_SEED
        });
        await mockContentEntries(page, {
            details: MEDIA_FIELDS_DETAIL_SEED,
            entries: { article: [] }
        });
        await mockContentEntryWrites(page, {
            details: MEDIA_FIELDS_DETAIL_SEED
        });
        // After the write mock, whose multi-segment route would otherwise answer
        // `/:id/media` with an entry record.
        await mockEntryMedia(page);
        uploads = await mockMediaApi(page);
        saves = await spyEntrySave(page);
    });

    test('renders a card per media field, each with its empty state', async ({
        mediaFieldPage
    }) => {
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.openMediaTab();

        await expect(mediaFieldPage.section('Cover image')).toBeVisible();
        await expect(mediaFieldPage.section('Gallery')).toBeVisible();
        // The two shapes read differently, and say what a drop would do.
        await expect(mediaFieldPage.emptySingle).toBeVisible();
        await expect(mediaFieldPage.emptyMultiple).toBeVisible();
        await expect(
            mediaFieldPage.libraryButton('Select from library')
        ).toBeVisible();
        await expect(
            mediaFieldPage.libraryButton('Add from library')
        ).toBeVisible();
    });

    test('attaches an asset picked from the library and saves its id', async ({
        mediaFieldPage
    }) => {
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.title.fill('A record');
        await mediaFieldPage.openMediaTab();

        await mediaFieldPage.libraryButton('Select from library').click();
        await expect(mediaFieldPage.pickerDialog).toBeVisible();
        await mediaFieldPage.pickAsset('hero.png');

        await expect(mediaFieldPage.pickerDialog).toBeHidden();
        // The tile shows the asset, and the trigger now offers a replacement.
        await expect(mediaFieldPage.removeAsset('hero.png')).toBeVisible();
        await expect(mediaFieldPage.libraryButton('Replace')).toBeVisible();
        // Picking an existing asset uploads nothing — it is already in the
        // library; only its id joins the record.
        expect(uploads.count).toBe(0);

        await mediaFieldPage.save.click();
        await expect.poll(() => saves.bodies.length).toBeGreaterThan(0);
        // `{ id }`, not a bare id: a media value carries its per-usage text
        // alternative since `ORT-83`, and an attach with no alt yet is exactly
        // "the id, and nobody has answered the alt question".
        expect(saves.bodies[0].values.cover).toEqual({
            id: MEDIA_ASSET_IDS.hero
        });
    });

    test('prompts for alt text, and round-trips it with the attachment', async ({
        mediaFieldPage
    }) => {
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.title.fill('A record');
        await mediaFieldPage.openMediaTab();

        await mediaFieldPage.libraryButton('Select from library').click();
        await mediaFieldPage.pickAsset('hero.png');
        await expect(mediaFieldPage.pickerDialog).toBeHidden();

        // Attaching asks the question. Before `ORT-83` there was nowhere to put
        // an answer at all: the value was a bare id, so an author could publish
        // an image nobody could read and the tool called the entry valid.
        await expect(mediaFieldPage.altInput('hero.png')).toBeVisible();
        await expect(mediaFieldPage.altMissingWarning()).toBeVisible();

        await mediaFieldPage.altInput('hero.png').fill('A green rectangle');
        await expect(mediaFieldPage.altMissingWarning()).toBeHidden();

        await mediaFieldPage.save.click();
        await expect.poll(() => saves.bodies.length).toBeGreaterThan(0);
        expect(saves.bodies[0].values.cover).toEqual({
            id: MEDIA_ASSET_IDS.hero,
            alt: 'A green rectangle'
        });
    });

    test('takes "decorative" as an answer, and it is not the same as blank', async ({
        mediaFieldPage
    }) => {
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.title.fill('A record');
        await mediaFieldPage.openMediaTab();

        await mediaFieldPage.libraryButton('Select from library').click();
        await mediaFieldPage.pickAsset('hero.png');
        await expect(mediaFieldPage.pickerDialog).toBeHidden();

        await mediaFieldPage.decorativeToggle('hero.png').click();

        // The warning goes, because the question **has** been answered — which
        // is the distinction WCAG 1.1.1 turns on and an empty string cannot
        // carry: an author who left the box blank and an author who decided the
        // image says nothing produce the same bytes otherwise.
        await expect(mediaFieldPage.altMissingWarning()).toBeHidden();
        await expect(mediaFieldPage.altInput('hero.png')).toBeDisabled();

        await mediaFieldPage.save.click();
        await expect.poll(() => saves.bodies.length).toBeGreaterThan(0);
        expect(saves.bodies[0].values.cover).toEqual({
            id: MEDIA_ASSET_IDS.hero,
            decorative: true
        });
    });

    test('restricts the picker to the kinds the field accepts', async ({
        mediaFieldPage
    }) => {
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.openMediaTab();

        // `cover` accepts images only, so the seeded PDF is not a candidate.
        await mediaFieldPage.libraryButton('Select from library').click();
        await expect(mediaFieldPage.pickerTile('hero.png')).toBeVisible();
        await expect(mediaFieldPage.pickerTile('report.pdf')).toBeHidden();
    });

    test('walks into a folder and back out through the breadcrumb', async ({
        mediaFieldPage
    }) => {
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.openMediaTab();

        await mediaFieldPage.libraryButton('Add from library').click();
        await mediaFieldPage.pickerFolder('Images').click();
        // Inside the folder: its asset, not the root's.
        await expect(mediaFieldPage.pickerTile('inside.png')).toBeVisible();
        await expect(mediaFieldPage.pickerTile('hero.png')).toBeHidden();
        // Descending used to be one-way; the breadcrumb is the way back.
        await mediaFieldPage.pickerRootCrumb.click();
        await expect(mediaFieldPage.pickerTile('hero.png')).toBeVisible();
    });

    test('stages an upload and sends it only when the record is saved [media:I-38]', async ({
        mediaFieldPage
    }) => {
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.title.fill('A record');
        await mediaFieldPage.openMediaTab();

        await mediaFieldPage.stageUpload('Cover image', 'new-cover.png');

        // Staged, not uploaded: the tile says so and no request has gone out.
        await expect(mediaFieldPage.pendingMarker).toBeVisible();
        await expect(mediaFieldPage.pendingCount).toBeVisible();
        expect(uploads.count).toBe(0);

        await mediaFieldPage.save.click();

        // The save uploads it first, then writes the record with the new id.
        await expect.poll(() => uploads.count).toBe(1);
        await expect.poll(() => saves.bodies.length).toBeGreaterThan(0);
        expect(saves.bodies[0].values.cover).toEqual({
            id: uploadedAssetId(1)
        });
    });

    test('drops a staged file without ever uploading it', async ({
        mediaFieldPage
    }) => {
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.title.fill('A record');
        await mediaFieldPage.openMediaTab();

        await mediaFieldPage.stageUpload('Gallery', 'scrap.png');
        await expect(mediaFieldPage.removeAsset('scrap.png')).toBeVisible();

        await mediaFieldPage.removeAsset('scrap.png').click();
        await expect(mediaFieldPage.emptyMultiple).toBeVisible();

        await mediaFieldPage.save.click();
        await expect.poll(() => saves.bodies.length).toBeGreaterThan(0);
        // Abandoned before the save, so it never reached the library.
        expect(uploads.count).toBe(0);
        expect(saves.bodies[0].values.gallery).toEqual([]);
    });

    test('appends to a multiple field and reorders it', async ({
        mediaFieldPage
    }) => {
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.title.fill('A record');
        await mediaFieldPage.openMediaTab();

        await mediaFieldPage.libraryButton('Add from library').click();
        await mediaFieldPage.pickerTile('hero.png').click();
        await mediaFieldPage.pickerTile('report.pdf').click();
        await mediaFieldPage.pickerConfirm.click();

        expect(await mediaFieldPage.attachedNames('Gallery')).toEqual([
            'hero.png',
            'report.pdf'
        ]);

        // The order is the delivered order, so it has to be editable.
        await mediaFieldPage.moveAssetDown('hero.png').click();
        expect(await mediaFieldPage.attachedNames('Gallery')).toEqual([
            'report.pdf',
            'hero.png'
        ]);

        await mediaFieldPage.save.click();
        await expect.poll(() => saves.bodies.length).toBeGreaterThan(0);
        expect(saves.bodies[0].values.gallery).toEqual([
            { id: MEDIA_ASSET_IDS.report },
            { id: MEDIA_ASSET_IDS.hero }
        ]);
    });

    test('shows a saved record’s assets by name, not by id', async ({
        page,
        mediaFieldPage
    }) => {
        // A saved record stores ids; the editor resolves them through
        // `GET /:id/media`, which is what keeps a uuid off the screen.
        await mockContentEntryRead(page, {
            records: {
                'article/article-1': {
                    text: 'Saved',
                    cover: MEDIA_ASSET_IDS.hero
                }
            }
        });
        await mockEntryMedia(page, {
            media: {
                'article/article-1': {
                    cover: [
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
        await mediaFieldPage.gotoArticle(WS, 'article-1');
        await mediaFieldPage.openMediaTab();

        await expect(mediaFieldPage.removeAsset('hero.png')).toBeVisible();
    });

    test('waits for the ref instead of fetching the original', async ({
        page,
        mediaFieldPage
    }) => {
        // The record holds an id and the media read is still in flight. The
        // tile must not guess `/raw`: that guess fetched a full-size original
        // on every edit-mode open, to draw a 180px tile.
        await mockContentEntryRead(page, {
            records: {
                'article/article-2': {
                    text: 'Saved',
                    cover: MEDIA_ASSET_IDS.hero
                }
            }
        });
        await mockEntryMedia(page, { media: {}, delayMs: 4000 });
        await mediaFieldPage.gotoArticle(WS, 'article-2');
        await mediaFieldPage.openMediaTab();

        await expect(mediaFieldPage.resolvingTile).toBeVisible();
        await expect(mediaFieldPage.rawImages).toHaveCount(0);
    });

    test('falls back to the original once the read resolves nothing', async ({
        page,
        mediaFieldPage
    }) => {
        // Settled-with-no-ref is not the same as still-loading: waiting on a
        // read that already answered would leave the tile blank forever (a host
        // with no media server binding, or a failed read).
        await mockContentEntryRead(page, {
            records: {
                'article/article-3': {
                    text: 'Saved',
                    cover: MEDIA_ASSET_IDS.hero
                }
            }
        });
        await mockEntryMedia(page, { media: {} });
        await mediaFieldPage.gotoArticle(WS, 'article-3');
        await mediaFieldPage.openMediaTab();

        await expect(mediaFieldPage.rawImages).toHaveCount(1);
        await expect(mediaFieldPage.resolvingTile).toBeHidden();
    });

    test('says the library failed to load, not that it is empty [media:I-36]', async ({
        page,
        mediaFieldPage
    }) => {
        // "No assets here" for a failed read sends the user hunting for assets
        // that exist — the error state has to be its own thing.
        await failMediaReads(page);
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.openMediaTab();

        await mediaFieldPage.libraryButton('Select from library').click();
        // The app's QueryClient keeps TanStack's default retries, so the read
        // spends a few seconds in backoff before it settles as an error — the
        // skeletons are correct until then.
        await expect(mediaFieldPage.pickerLoadError).toBeVisible({
            timeout: 20_000
        });
        await expect(mediaFieldPage.pickerRetry).toBeVisible();
        await expect(
            mediaFieldPage.pickerDialog.getByText('Nothing to pick here')
        ).toBeHidden();
    });

    test('offers no upload without media:create', async ({
        page,
        mediaFieldPage
    }) => {
        // Uploads are deferred to the save, so an ungranted upload would 403
        // *inside* the write and take the whole record save down with it.
        //
        // `content:create` is what makes this a *writable* create form —
        // without it the editor is a read-only preview and every media control
        // is gone, which would pass this assertion for the wrong reason. This
        // case is about the `media:*` matrix, so the content side is granted.
        await mockSignedIn(page, {
            permissions: [
                'content:read',
                'content:create',
                'content:update',
                'media:read'
            ]
        });
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.openMediaTab();

        await expect(
            mediaFieldPage.libraryButton('Select from library')
        ).toBeEnabled();
        await expect(mediaFieldPage.uploadButton('Cover image')).toHaveCount(0);
    });

    test('disables library picking without media:read', async ({
        page,
        mediaFieldPage
    }) => {
        // As above: `content:create` keeps the create form writable, so what
        // this case observes is the missing `media:read` and nothing else.
        await mockSignedIn(page, {
            permissions: ['content:read', 'content:create', 'content:update']
        });
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.openMediaTab();

        await expect(
            mediaFieldPage.libraryButton('Select from library')
        ).toBeDisabled();
        await expect(mediaFieldPage.noMediaAccess).toBeVisible();
    });

    test('has no accessibility violations, picker included', async ({
        mediaFieldPage,
        makeAxe
    }) => {
        await mediaFieldPage.gotoNewArticle(WS);
        await mediaFieldPage.openMediaTab();
        await expect(mediaFieldPage.emptySingle).toBeVisible();
        await expectNoA11yViolations(makeAxe());

        // And with an asset attached + the picker open (the dynamic states).
        await mediaFieldPage.libraryButton('Add from library').click();
        await expect(mediaFieldPage.pickerDialog).toBeVisible();
        await expectNoA11yViolations(makeAxe());
    });
});
