import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    I18N_WORKSPACE,
    failEntryLocales,
    failLocaleSummaries,
    failLocales,
    mockI18n,
    spyLocaleSummaries
} from '../support/api/i18n';
import { type ContentLibraryPage } from '../support/pages/ContentLibraryPage';

/**
 * How long to wait for a *settled* failure.
 *
 * The app's query client retries a `5xx` three times with exponential backoff
 * before giving up (`isWorthRetrying`), which is the right behaviour for a
 * transient outage and means an error state legitimately takes several seconds
 * to appear. The default 5s expect timeout lands inside that ladder, so these
 * assertions wait it out rather than racing it.
 */
const SETTLED = { timeout: 20_000 };

/**
 * What `@apograph/i18n-admin` does when it is **not** on the happy path.
 *
 * Every surface in the plugin is gated on a read — the configured locale list,
 * a record's translation group, a page's batch of groups — and each of those
 * gates used to fail into a state that *looked* like an answer: no switcher, a
 * locale offered for creation that already existed, an empty cell. This suite
 * pins the difference between "there is nothing" and "we could not ask",
 * because in this plugin they are the two readings that lead to opposite
 * actions.
 */
test.describe('Content i18n — degraded reads and edge locales', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [I18N_WORKSPACE]);
        await mockI18n(page);
    });

    async function openCollection(contentLibraryPage: ContentLibraryPage) {
        await contentLibraryPage.goto(I18N_WORKSPACE.id);
        await contentLibraryPage.typeLink('Localized posts').click();
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).toBeVisible();
    }

    test('a failed locale list leaves a retry in the toolbar, not a hole [i18n:I-30]', async ({
        page,
        contentLibraryPage
    }) => {
        await failLocales(page);
        await page.goto(
            `/workspaces/${I18N_WORKSPACE.id}/content/localized_post?locale=de`
        );
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).toBeVisible();

        // The list is still scoped to German, so removing the switcher would
        // strand the user in a language with no way back.
        await expect(page).toHaveURL(/locale=de/);
        await expect(contentLibraryPage.localesUnavailable).toBeVisible(
            SETTLED
        );
        await expect(contentLibraryPage.localeSwitcher).toHaveCount(0);
    });

    test('a failed group read says so instead of offering to create what exists [i18n:I-30]', async ({
        page,
        contentLibraryPage
    }) => {
        await failEntryLocales(page);
        // lp-en-1 is in group G1, which *does* have a German sibling.
        await page.goto(
            `/workspaces/${I18N_WORKSPACE.id}/content/localized_post/lp-en-1`
        );
        await expect(contentLibraryPage.editorSave).toBeVisible();

        await expect(contentLibraryPage.localeWidgetError).toBeVisible(SETTLED);
        // Offering this would produce a create form whose save 409s against the
        // sibling that is already there.
        await expect(
            contentLibraryPage.createTranslation('Deutsch')
        ).toHaveCount(0);
        await expect(contentLibraryPage.switchLocale('Deutsch')).toHaveCount(0);
        // …and the rows say why they are inert rather than dimming silently.
        await expect(
            contentLibraryPage.paneText(/Unknown — couldn’t load/).first()
        ).toBeVisible();
    });

    test('a failed summary batch marks the Locales cells unavailable [i18n:I-30]', async ({
        page,
        contentLibraryPage
    }) => {
        await failLocaleSummaries(page);
        await openCollection(contentLibraryPage);
        await contentLibraryPage.showLocalesColumn();

        // An empty cell would read as "this record has no other locales" —
        // which for Winter boots (group G1) is the opposite of the truth.
        const g1Row = contentLibraryPage
            .recordRows('Localized posts')
            .filter({ hasText: 'Winter boots' });
        await expect(g1Row.getByText('Unavailable')).toBeVisible(SETTLED);
    });

    test('the Locales column does not fetch while it is switched off', async ({
        page,
        contentLibraryPage
    }) => {
        const summaries = spyLocaleSummaries(page);
        await openCollection(contentLibraryPage);
        await expect(
            contentLibraryPage.recordRows('Localized posts').first()
        ).toBeVisible();

        // The column is hidden by default, so nothing on screen depends on it.
        expect(summaries.count).toBe(0);

        await contentLibraryPage.showLocalesColumn();
        await expect(
            contentLibraryPage
                .recordRows('Localized posts')
                .filter({ hasText: 'Winter boots' })
                .getByRole('link', { name: /Open the de version/ })
        ).toBeVisible();
        // Switching it on is what pays for the request — one batch, not one
        // per row.
        expect(summaries.count).toBe(1);
    });

    test('an unconfigured ?locale= is reported, and any pick clears it [i18n:I-05]', async ({
        page,
        contentLibraryPage
    }) => {
        await page.goto(
            `/workspaces/${I18N_WORKSPACE.id}/content/localized_post?locale=xx`
        );

        // The switcher must not claim English while the request carries `xx`
        // (the server 400s it, so the table is in its error state).
        await expect(contentLibraryPage.unknownLocaleSwitcher).toBeVisible();
        await expect(contentLibraryPage.localeSwitcher).toHaveCount(0);

        // Picking the default is the one press that clears the bad param — it
        // used to be swallowed as "already active".
        await contentLibraryPage.unknownLocaleSwitcher.click();
        await contentLibraryPage.localeOption(/English/).click();
        await expect(page).not.toHaveURL(/locale=/);
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).toContainText('Winter boots');
    });

    test('an empty ?locale= falls back to the default rather than scoping to nothing', async ({
        page,
        contentLibraryPage
    }) => {
        await page.goto(
            `/workspaces/${I18N_WORKSPACE.id}/content/localized_post?locale=`
        );
        await expect(contentLibraryPage.localeSwitcher).toHaveText(/English/);
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).toContainText('Winter boots');
    });

    test('leaving within the cover cancels the pending locale swap', async ({
        page,
        contentLibraryPage
    }) => {
        await page.goto(
            `/workspaces/${I18N_WORKSPACE.id}/content/localized_post/lp-en-1`
        );
        await expect(contentLibraryPage.editorSave).toBeVisible();

        // Press the switch, then leave before the deferred navigation runs —
        // the overlay is `pointer-events-none`, so this is a click the user can
        // physically make. The swap must not fire from a screen they left.
        await contentLibraryPage.switchLocale('Deutsch').click();
        await contentLibraryPage.editorBackLink.click();

        await expect(page).toHaveURL(/\/localized_post$/);
        await expect(
            contentLibraryPage.recordsTable('Localized posts')
        ).toBeVisible();
        // Give the old timer longer than it had to fire.
        await page.waitForTimeout(600);
        await expect(page).toHaveURL(/\/localized_post$/);
    });
});
