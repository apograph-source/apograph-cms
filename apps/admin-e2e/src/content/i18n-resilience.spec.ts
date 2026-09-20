import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    I18N_WORKSPACE,
    failEntryLocales,
    failLocaleSummaries,
    failLocales,
    holdLocales,
    mockI18n,
    spyLocaleSummaries,
    type I18nMock
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
 * What `@orthacms/i18n-admin` does when it is **not** on the happy path.
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
    /**
     * The current test's i18n mock, for the cases that need to hold one of its
     * routes open. Module scope is safe here: `fullyParallel` is off, so the
     * tests in a file run serially in one worker and `beforeEach` re-assigns
     * this before each of them.
     */
    let i18n: I18nMock;

    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [I18N_WORKSPACE]);
        i18n = await mockI18n(page);
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

        // The menu is where the group's locales are listed now, so the failure
        // has to be readable **there** — the assertion needs it open.
        await contentLibraryPage.openLocaleMenu();
        await expect(contentLibraryPage.localeMembersError).toBeVisible(
            SETTLED
        );
        // …with a way to ask again, rather than a dead end.
        await expect(
            contentLibraryPage.localeMenu.getByRole('menuitem', {
                name: 'Try again'
            })
        ).toBeVisible();
        // Offering this would produce a create form whose save 409s against the
        // sibling that is already there.
        await expect(
            contentLibraryPage.createTranslation('Deutsch')
        ).toHaveCount(0);
        await expect(contentLibraryPage.switchLocale('Deutsch')).toHaveCount(0);
        // …and the rows say why they are inert rather than dimming silently.
        await expect(
            contentLibraryPage.localeMenu
                .getByText(/Unknown — couldn’t load/)
                .first()
        ).toBeVisible();
    });

    test('a locale list still loading is not a failed one [i18n:I-30]', async ({
        page,
        contentLibraryPage
    }) => {
        // The entry read can settle before `GET /api/i18n/locales` does — a
        // deep link into an editor is exactly that order — so the menu opens
        // with the locale list still in flight. Claiming a broken config there,
        // and offering a retry for it, is the I-30 mistake pointed the other
        // way: not-yet is not the same answer as couldn't.
        const held = await holdLocales(page);
        await page.goto(
            `/workspaces/${I18N_WORKSPACE.id}/content/localized_post/lp-en-1`
        );
        await expect(contentLibraryPage.editorSave).toBeVisible();

        await contentLibraryPage.openLocaleMenu();
        await expect(
            contentLibraryPage.localeMenu.getByText('Loading locales…')
        ).toBeVisible();
        // Neither of the two settled answers may be on screen yet.
        await expect(
            contentLibraryPage.localeMenu.getByText(/couldn’t be loaded/)
        ).toHaveCount(0);
        await expect(
            contentLibraryPage.localeMenu.getByRole('menuitem', {
                name: 'Reload locales'
            })
        ).toHaveCount(0);

        // …and when it lands, the menu fills in without another press.
        held.release();
        await expect(contentLibraryPage.switchLocale('Deutsch')).toBeVisible();
        await expect(
            contentLibraryPage.localeMenu.getByText('Loading locales…')
        ).toHaveCount(0);
    });

    test('group members still loading are not offered for creation [i18n:I-30]', async ({
        page,
        contentLibraryPage
    }) => {
        // lp-en-1 is in group G1, which **does** have a German sibling. Until
        // the group read lands, every locale resolves to `undefined` and so
        // looks missing — offering "+ Add" there opens a create form whose save
        // 409s against the row that is already there. Unknown outranks
        // permission, and pending is a way of not knowing.
        const held = await i18n.holdEntryLocales();
        await page.goto(
            `/workspaces/${I18N_WORKSPACE.id}/content/localized_post/lp-en-1`
        );
        await expect(contentLibraryPage.editorSave).toBeVisible();

        await contentLibraryPage.openLocaleMenu();
        await expect(
            contentLibraryPage.createTranslation('Deutsch')
        ).toHaveCount(0);
        await expect(contentLibraryPage.switchLocale('Deutsch')).toHaveCount(0);
        // The row says which kind of not-knowing it is: nothing has failed.
        await expect(
            contentLibraryPage.localeMenu.getByText('Checking…').first()
        ).toBeVisible();
        await expect(
            contentLibraryPage.localeMenu.getByText(/Unknown — couldn’t load/)
        ).toHaveCount(0);
        // And the count is withheld rather than guessed at `0/4`.
        await expect(contentLibraryPage.editorTitleChip).toHaveText(
            'EN · English'
        );

        // Once the group lands, the German sibling is a switch target — never
        // a create.
        held.release();
        await expect(contentLibraryPage.switchLocale('Deutsch')).toBeVisible();
        await expect(
            contentLibraryPage.createTranslation('Deutsch')
        ).toHaveCount(0);
        await expect(contentLibraryPage.editorTitleChip).toHaveText(
            'EN · English2/4'
        );
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
        await contentLibraryPage.switchToLocale('Deutsch');
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
