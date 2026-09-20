import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import { mockContentSchema } from '../support/api/content';
import {
    mockWebhooksApi,
    REVEALED_SECRET,
    WEBHOOKS_SEED
} from '../support/api/webhooks';

/**
 * A failed query is not instant: the shared client retries a 5xx three times on
 * a backoff ladder before it settles, so an error state can take ~10s to reach
 * the screen. Assertions on one wait that long rather than racing it.
 */
const SETTLED = { timeout: 20_000 };

/**
 * The webhooks pages (`@orthacms/webhooks-admin`): the list's derived states,
 * the four page states, the editor's "All …" toggles, the one-time secret, and
 * the detail page's two tabs.
 */
test.describe('Webhooks', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
        // The editor's type picker reads content's registry
        // (`GET /api/content-schema`) rather than a webhooks-owned list.
        await mockContentSchema(page);
    });

    test.describe('the endpoint list', () => {
        test('renders every column the table promises', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            for (const header of [
                'Name',
                'URL',
                'Sends',
                'State',
                'Last delivery'
            ]) {
                await expect(
                    webhooksPage.table.getByRole('columnheader', {
                        name: header
                    })
                ).toBeVisible();
            }
        });

        test('reads an empty filter as "all", not as "none"', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            // The seed's first row has `eventKinds: []` and
            // `allWorkspaces: true`. Rendering that as "0 events" would be the
            // exact inversion of what the subscription model means.
            const row = webhooksPage.row('Rebuild the storefront');
            await expect(row).toContainText('All events');
            await expect(row).toContainText('All workspaces');
        });

        test('counts a named filter', async ({ page, webhooksPage }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            const row = webhooksPage.row('Search re-index');
            await expect(row).toContainText('2 events');
            await expect(row).toContainText('1 workspace');
            await expect(row).toContainText('1 type');
        });

        test('tells "paused" apart from "stopped after failures"', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            // Both are `enabled: false`; only one needs someone to do
            // something. Rendering them identically is the bug this asserts
            // against.
            await expect(webhooksPage.row('Search re-index')).toContainText(
                'Paused'
            );
            await expect(webhooksPage.row('Old staging preview')).toContainText(
                'Stopped after failures'
            );
        });

        test('shows the empty state with the create action', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page, { endpoints: [] });
            await webhooksPage.goto();

            await expect(webhooksPage.emptyHeading()).toBeVisible();
            await expect(webhooksPage.newWebhookButton).toBeVisible();
        });

        test('shows an error state, never the empty one', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page, { listFails: true });
            await webhooksPage.goto();

            // A failed load that reads as "nothing configured" would have an
            // operator adding a second copy of an endpoint that already exists.
            await expect(webhooksPage.errorAlert()).toBeVisible(SETTLED);
            await expect(webhooksPage.emptyHeading()).toBeHidden();
        });

        test('is reachable from the sidebar', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await expect(webhooksPage.navLink).toBeVisible();
        });
    });

    test.describe('permissions', () => {
        test('shows the no-access state without webhooks:read', async ({
            page,
            webhooksPage
        }) => {
            await mockSignedIn(page, {
                permissions: ['workspaces:read', 'content:read']
            });
            await mockWebhooksApi(page);
            await webhooksPage.goto();

            await expect(webhooksPage.noAccessHeading()).toBeVisible();
            await expect(webhooksPage.table).toBeHidden();
        });

        test('hides the create action without webhooks:manage', async ({
            page,
            webhooksPage
        }) => {
            await mockSignedIn(page, {
                permissions: ['workspaces:read', 'webhooks:read']
            });
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            await expect(webhooksPage.newWebhookButton).toBeHidden();
        });
    });

    test.describe('creating one', () => {
        test('submits no filter values when "all" is chosen', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            const posted = page.waitForRequest(
                (request) =>
                    request.url().endsWith('/api/webhooks') &&
                    request.method() === 'POST'
            );

            await webhooksPage.newWebhookButton.click();
            await webhooksPage.nameField().fill('Cache purge');
            await webhooksPage.urlField().fill('https://cdn.example.com/hooks');
            await webhooksPage.allWorkspacesToggle().click();
            await webhooksPage.submitButton().click();

            const body = (await posted).postDataJSON();
            // Empty arrays and the flag — not an enumerated list, which would
            // silently stop covering the next workspace or event kind.
            expect(body).toMatchObject({
                name: 'Cache purge',
                url: 'https://cdn.example.com/hooks',
                allWorkspaces: true,
                workspaceIds: [],
                eventKinds: []
            });
        });

        test('reveals the signing secret exactly once', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            await webhooksPage.newWebhookButton.click();
            await webhooksPage.nameField().fill('Cache purge');
            await webhooksPage.urlField().fill('https://cdn.example.com/hooks');
            await webhooksPage.allWorkspacesToggle().click();
            await webhooksPage.submitButton().click();

            // Readable and selectable without the Copy button, because the
            // clipboard can be refused and this is the only copy that exists.
            await expect(webhooksPage.secretField()).toHaveValue(
                REVEALED_SECRET
            );
            await expect(webhooksPage.copySecretButton()).toBeVisible();
        });

        test('asks before dismissing an uncopied secret', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            await webhooksPage.newWebhookButton.click();
            await webhooksPage.nameField().fill('Cache purge');
            await webhooksPage.urlField().fill('https://cdn.example.com/hooks');
            await webhooksPage.allWorkspacesToggle().click();
            await webhooksPage.submitButton().click();
            await expect(webhooksPage.secretField()).toBeVisible();

            // Esc is reached by reflex, and the secret cannot be shown again.
            await page.keyboard.press('Escape');
            await expect(webhooksPage.uncopiedWarning()).toBeVisible();
            await expect(webhooksPage.secretField()).toBeVisible();
        });

        test('shows a refused URL in the form and stays on it', async ({
            page,
            webhooksPage
        }) => {
            const refusal =
                '127.0.0.1 is a private or reserved address. Webhooks may only reach public hosts.';
            await mockWebhooksApi(page, { createRejects: refusal });
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            await webhooksPage.newWebhookButton.click();
            await webhooksPage.nameField().fill('Local');
            await webhooksPage.urlField().fill('https://127.0.0.1/hooks');
            await webhooksPage.allWorkspacesToggle().click();
            await webhooksPage.submitButton().click();

            // The server writes that message for whoever typed the URL, so it
            // belongs in the form — and the form stays put, with what was
            // typed intact, so the URL is corrected in place.
            await expect(webhooksPage.formError(refusal)).toBeVisible();
            await expect(page).toHaveURL(/\/webhooks\/new$/);
            await expect(webhooksPage.urlField()).toHaveValue(
                'https://127.0.0.1/hooks'
            );
        });

        test('asks before turning an endpoint off', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.gotoNew();
            await webhooksPage.editorHeading('New webhook').waitFor();

            await expect(webhooksPage.enabledSwitch()).toBeChecked();
            await webhooksPage.enabledSwitch().click();

            // What happens while an endpoint is off is not recorded anywhere,
            // so the switch says so before it moves. Declining leaves it on —
            // the switch is read after the dialog closes, because an open Radix
            // dialog hides the rest of the page from the accessibility tree.
            await expect(webhooksPage.disableConfirm()).toBeVisible();
            await webhooksPage.keepEnabledButton().click();
            await expect(webhooksPage.disableConfirm()).toBeHidden();
            await expect(webhooksPage.enabledSwitch()).toBeChecked();

            await webhooksPage.enabledSwitch().click();
            await webhooksPage.disableConfirmButton().click();
            await expect(webhooksPage.enabledSwitch()).not.toBeChecked();
        });

        test('turns an endpoint back on without asking', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            // `wh_paused` is switched off in the seed.
            await webhooksPage.gotoEdit('wh_paused');
            await webhooksPage.editorHeading('Edit webhook').waitFor();

            await expect(webhooksPage.enabledSwitch()).not.toBeChecked();
            await webhooksPage.enabledSwitch().click();

            // Turning it on loses nothing, so there is nothing to confirm.
            await expect(webhooksPage.disableConfirm()).toBeHidden();
            await expect(webhooksPage.enabledSwitch()).toBeChecked();
        });

        test('sends a custom header with the endpoint', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.gotoNew();
            await webhooksPage.editorHeading('New webhook').waitFor();

            const posted = page.waitForRequest(
                (request) =>
                    request.url().endsWith('/api/webhooks') &&
                    request.method() === 'POST'
            );

            await webhooksPage.nameField().fill('Authorized');
            await webhooksPage.urlField().fill('https://cdn.example.com/hooks');
            await webhooksPage.allWorkspacesToggle().click();
            await webhooksPage.addHeaderButton().click();
            await webhooksPage.headerNameField().fill('Authorization');
            await webhooksPage.headerValueField().fill('Bearer t0ken');
            await webhooksPage.submitButton().click();

            expect((await posted).postDataJSON()).toMatchObject({
                headers: { Authorization: 'Bearer t0ken' }
            });
        });

        test('refuses a header the delivery owns, before the server does', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.gotoNew();
            await webhooksPage.editorHeading('New webhook').waitFor();

            await webhooksPage.nameField().fill('Spoofer');
            await webhooksPage.urlField().fill('https://cdn.example.com/hooks');
            await webhooksPage.allWorkspacesToggle().click();
            await webhooksPage.addHeaderButton().click();
            // Overwriting this would let a delivery claim to be signed by
            // someone else.
            await webhooksPage.headerNameField().fill('X-Ortha-Signature');
            await webhooksPage.headerValueField().fill('t=1,v1=deadbeef');

            await expect(webhooksPage.headerError()).toBeVisible();

            let posted = false;
            page.on('request', (request) => {
                if (
                    request.url().endsWith('/api/webhooks') &&
                    request.method() === 'POST'
                ) {
                    posted = true;
                }
            });
            await webhooksPage.submitButton().click();
            await expect(page).toHaveURL(/\/webhooks\/new$/);
            expect(posted).toBe(false);
        });

        test('does not offer ping as something to subscribe to', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            await webhooksPage.newWebhookButton.click();
            // The picker only exists once "Every event" is switched off.
            await webhooksPage.openEventPicker();

            await expect(
                webhooksPage.eventOption('Entry published')
            ).toBeVisible();
            await expect(webhooksPage.eventOption('Test ping')).toBeHidden();
        });

        test('does not ask about types before a workspace is chosen', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            await webhooksPage.newWebhookButton.click();
            await webhooksPage.editorHeading('New webhook').waitFor();

            // Which types exist is a question about the workspaces, so it
            // cannot be answered before they are picked.
            await expect(webhooksPage.contentTypesGateHint()).toBeVisible();
            await expect(webhooksPage.allContentTypesToggle()).toBeHidden();
        });

        test('offers the types the chosen workspace was granted', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            await webhooksPage.newWebhookButton.click();
            // Marketing site is granted blog_post / product / home / about in
            // the workspace seed; nothing else can reach this endpoint.
            await webhooksPage.chooseWorkspace('Marketing site');
            await webhooksPage.openContentTypePicker();

            await expect(webhooksPage.eventOption('Blog posts')).toBeVisible();
            await expect(webhooksPage.eventOption('Products')).toBeVisible();
        });

        test('does not offer to add a type the picker already lists', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            await webhooksPage.newWebhookButton.click();
            await webhooksPage.chooseWorkspace('Marketing site');
            await webhooksPage.openContentTypePicker();
            await webhooksPage.contentTypeSearchBox().fill('blog_post');

            // Two rows for one name, toggling different code paths, is how a
            // duplicate entry gets into the subscription.
            await expect(
                webhooksPage.addContentTypeOption('blog_post')
            ).toBeHidden();
            await expect(webhooksPage.eventOption('Blog posts')).toBeVisible();
        });

        test('offers nothing for a workspace granted nothing', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            await webhooksPage.newWebhookButton.click();
            // Product docs has no grants in the seed. An empty picker without
            // a reason reads as broken, so the form says why — and free entry
            // still works.
            await webhooksPage.chooseWorkspace('Product docs');
            await webhooksPage.openContentTypePicker();

            await expect(
                webhooksPage.addContentTypeOption('report')
            ).toBeHidden();
            await webhooksPage.contentTypeSearchBox().fill('report');
            // Nothing to pick from, but the picker is still how a name gets in.
            await expect(
                webhooksPage.addContentTypeOption('report')
            ).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(webhooksPage.noGrantsHint()).toBeVisible();
        });

        test('offers every type when the endpoint takes all workspaces', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            await webhooksPage.newWebhookButton.click();
            await webhooksPage.allWorkspacesToggle().click();
            await webhooksPage.openContentTypePicker();

            // Workspaces created later may be granted anything, so narrowing
            // to today's grants would be wrong here.
            await expect(webhooksPage.eventOption('Blog posts')).toBeVisible();
            await expect(webhooksPage.eventOption('About')).toBeVisible();
        });

        test('takes a type name the registry does not list', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            const posted = page.waitForRequest(
                (request) =>
                    request.url().endsWith('/api/webhooks') &&
                    request.method() === 'POST'
            );

            await webhooksPage.newWebhookButton.click();
            await webhooksPage.nameField().fill('Cache purge');
            await webhooksPage.urlField().fill('https://cdn.example.com/hooks');
            await webhooksPage.allWorkspacesToggle().click();
            // A type that is about to be added: the picker cannot list it, and
            // an endpoint has to be able to subscribe to it before it exists.
            // The picker's own search box is the way in — there is no second
            // field beside it.
            await webhooksPage.openContentTypePicker();
            await webhooksPage.addContentTypeByName('landing_page');
            await webhooksPage.submitButton().click();

            expect((await posted).postDataJSON()).toMatchObject({
                contentTypes: ['landing_page']
            });
        });

        test('reads a pasted list as several types', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            const posted = page.waitForRequest(
                (request) =>
                    request.url().endsWith('/api/webhooks') &&
                    request.method() === 'POST'
            );

            await webhooksPage.newWebhookButton.click();
            await webhooksPage.nameField().fill('Cache purge');
            await webhooksPage.urlField().fill('https://cdn.example.com/hooks');
            await webhooksPage.allWorkspacesToggle().click();
            await webhooksPage.openContentTypePicker();
            await webhooksPage.addContentTypeByName('landing_page, campaign');
            await webhooksPage.submitButton().click();

            expect((await posted).postDataJSON()).toMatchObject({
                contentTypes: ['landing_page', 'campaign']
            });
        });

        test('sends no content-type filter when every type is chosen', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.goto();
            await webhooksPage.table.waitFor();

            const posted = page.waitForRequest(
                (request) =>
                    request.url().endsWith('/api/webhooks') &&
                    request.method() === 'POST'
            );

            await webhooksPage.newWebhookButton.click();
            await webhooksPage.nameField().fill('Cache purge');
            await webhooksPage.urlField().fill('https://cdn.example.com/hooks');
            await webhooksPage.allWorkspacesToggle().click();
            await webhooksPage.submitButton().click();

            // Empty is how "every type, including ones added later" is spelled
            // on the wire.
            expect((await posted).postDataJSON()).toMatchObject({
                contentTypes: []
            });
        });
    });

    test.describe('one endpoint', () => {
        test('keeps a subscribed type this build no longer defines', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            // `wh_paused` subscribes to `article`, which is deliberately absent
            // from the registry seed — the type was removed, or is a typo, or
            // has not been written yet.
            await webhooksPage.gotoDetail('wh_paused');

            const saved = page.waitForRequest(
                (request) =>
                    request.url().endsWith('/api/webhooks/wh_paused') &&
                    request.method() === 'PATCH'
            );

            await webhooksPage.editButton().click();
            await webhooksPage.editorHeading('Edit webhook').waitFor();
            // Shown, and shown as unrecognised — an endpoint filtered to a type
            // that does not exist receives nothing, and this is where that is
            // visible.
            await expect(
                webhooksPage.pickedValue('article (not defined here)')
            ).toBeVisible();

            await webhooksPage.saveButton().click();

            // The real regression this guards: dropping the unknown name would
            // widen the endpoint from one type to every type.
            expect((await saved).postDataJSON()).toMatchObject({
                contentTypes: ['article']
            });
        });

        test('opens on the delivery log', async ({ page, webhooksPage }) => {
            await mockWebhooksApi(page);
            await webhooksPage.gotoDetail(WEBHOOKS_SEED[0].id);

            // "Did it arrive?" is the question asked every time; "what does it
            // send?" is asked once, when it was created.
            await expect(webhooksPage.deliveriesTable()).toBeVisible();
            await expect(webhooksPage.deliveriesTable()).toContainText(
                'entry.published'
            );
        });

        test('shows only the secret hint, never the secret', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.gotoDetail(WEBHOOKS_SEED[0].id);
            await webhooksPage.settingsTab().click();

            await expect(webhooksPage.secretHint('a1b2')).toBeVisible();
            await expect(webhooksPage.anyText(REVEALED_SECRET)).toBeHidden();
        });

        test('says why an endpoint switched itself off', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.gotoDetail('wh_broken');

            await expect(webhooksPage.autoDisabledAlert()).toBeVisible();
            // And says what to do about it, which the list row cannot.
            await expect(webhooksPage.autoDisabledAlert()).toContainText(
                'switch the webhook back on'
            );
        });

        test('opens one delivery with the body that was sent', async ({
            page,
            webhooksPage
        }) => {
            await mockWebhooksApi(page);
            await webhooksPage.gotoDetail(WEBHOOKS_SEED[0].id);
            await webhooksPage.deliveriesTable().waitFor();

            await webhooksPage.firstDeliveryViewButton().click();

            const sheet = webhooksPage.deliverySheet();
            await expect(sheet).toContainText('entry.published');
            // The stored body, verbatim — the only version worth debugging
            // against.
            await expect(sheet).toContainText('"eventId": "evt_1"');
            await expect(sheet).toContainText('received');
        });
    });
});
