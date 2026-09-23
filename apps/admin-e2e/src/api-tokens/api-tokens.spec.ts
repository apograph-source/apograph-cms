import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import {
    mockWorkspaces,
    mockWorkspacesUnavailable
} from '../support/api/workspaces';
import {
    mockApiTokensApi,
    manyApiTokens,
    API_TOKENS_SEED
} from '../support/api/apiTokens';

/**
 * A failed query is not instant: the shared client retries a 5xx three times on
 * a backoff ladder before it settles, so an error state can take ~10s to reach
 * the screen. Assertions on one wait that long rather than racing it.
 */
const SETTLED = { timeout: 20_000 };

/**
 * The API tokens page at `/api-tokens` (`@orthacms/api-tokens-admin`): the
 * table's derived states, the four page states, the create dialog's contract
 * with the server, revocation, and the URL-backed pager.
 *
 * The reveal-once secret has its own suite (`reveal-secret.spec.ts`) — it is
 * the one interaction where getting it wrong destroys a credential.
 */
test.describe('API tokens page', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page);
    });

    test('lists tokens with every column the table promises', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        for (const header of [
            'Name',
            'Workspaces',
            'Token',
            'Access',
            'Status',
            'Expires',
            'Last used'
        ]) {
            await expect(
                apiTokensPage.table.getByRole('columnheader', { name: header })
            ).toBeVisible();
        }

        // The Token column carries the non-secret lookup prefix only — never a
        // usable credential.
        await expect(apiTokensPage.row('Production website')).toContainText(
            'orthacms_aa11bb'
        );
        await expect(apiTokensPage.row('Production website')).toContainText(
            'Read-only'
        );
        await expect(apiTokensPage.row('Build pipeline')).toContainText('Full');

        // `expiresAt: null` and `lastUsedAt: null` both read "Never".
        await expect(
            apiTokensPage.row('Production website').getByRole('cell').nth(5)
        ).toHaveText('Never');
        await expect(
            apiTokensPage.row('Production website').getByRole('cell').nth(6)
        ).toHaveText('Never');
    });

    test('derives status from expiry and revocation, revocation winning', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await expect(apiTokensPage.rowStatus('Production website')).toHaveText(
            'Active'
        );
        await expect(apiTokensPage.rowStatus('Old preview build')).toHaveText(
            'Expired'
        );
        await expect(apiTokensPage.rowStatus('Leaked laptop token')).toHaveText(
            'Revoked'
        );
        // Revoked *and* past its expiry: revocation is the truthful label,
        // because it is the one that cannot be undone by waiting.
        await expect(apiTokensPage.rowStatus('Retired importer')).toHaveText(
            'Revoked'
        );
    });

    test('resolves workspace ids to names, falling back to the raw id', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await expect(
            apiTokensPage.rowWorkspaces('Production website')
        ).toHaveText('Marketing site');
        // A bucket spanning two workspaces shows both names.
        await expect(apiTokensPage.rowWorkspaces('Build pipeline')).toHaveText(
            'Marketing siteProduct docs'
        );
        // An id the selector never heard of is shown raw rather than dropped —
        // an empty cell would read as "this token reaches nothing".
        await expect(apiTokensPage.rowWorkspaces('Orphaned bucket')).toHaveText(
            'ws_deleted'
        );
    });

    test('offers Revoke only on an active token', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await expect(
            apiTokensPage.rowActions('Production website')
        ).toBeVisible();
        await expect(apiTokensPage.rowActions('Old preview build')).toHaveCount(
            0
        );
        await expect(
            apiTokensPage.rowActions('Leaked laptop token')
        ).toHaveCount(0);
    });

    test('a failed list gets its own state, not the empty one [api-tokens:I-23]', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page, { listStatus: 500 });
        await apiTokensPage.goto();

        await expect(apiTokensPage.errorAlert()).toBeVisible(SETTLED);
        // The distinction that matters: an outage must not read as "you have no
        // tokens", which would invite minting a duplicate.
        await expect(apiTokensPage.emptyHeading()).toHaveCount(0);
        await expect(apiTokensPage.table).toHaveCount(0);
    });

    test('Retry recovers the list once the API is back', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page, { listStatus: 500 });
        await apiTokensPage.goto();
        await apiTokensPage.errorAlert().waitFor(SETTLED);

        await mockApiTokensApi(page);
        await apiTokensPage.retryButton().click();

        await expect(apiTokensPage.table).toBeVisible();
        await expect(apiTokensPage.errorAlert()).toHaveCount(0);
    });

    test('an empty deployment gets the empty state with a create action', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page, { tokens: [] });
        await apiTokensPage.goto();

        await expect(apiTokensPage.emptyHeading()).toBeVisible();
        await expect(apiTokensPage.emptyCreateButton()).toBeVisible();
    });

    test('without tokens:create the empty state offers no way in', async ({
        page,
        apiTokensPage
    }) => {
        await mockSignedIn(page, { permissions: ['tokens:read'] });
        await mockApiTokensApi(page, { tokens: [] });
        await apiTokensPage.goto();

        await expect(apiTokensPage.emptyHeading()).toBeVisible();
        await expect(apiTokensPage.newTokenButton).toHaveCount(0);
    });

    test('without tokens:read the page refuses and never asks the API [api-tokens:I-22]', async ({
        page,
        apiTokensPage
    }) => {
        await mockSignedIn(page, { permissions: ['workspaces:read'] });
        const api = await mockApiTokensApi(page);
        await apiTokensPage.goto();

        await expect(apiTokensPage.noAccessHeading()).toBeVisible();
        await expect(apiTokensPage.navLink).toHaveCount(0);
        // The query is disabled, not merely hidden — a read the server would
        // refuse should never leave the browser.
        expect(api.listCalls).toBe(0);
    });

    test('without tokens:delete the actions column is absent entirely [api-tokens:I-22]', async ({
        page,
        apiTokensPage
    }) => {
        await mockSignedIn(page, {
            permissions: ['tokens:read', 'tokens:create']
        });
        await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await expect(
            apiTokensPage.rowActions('Production website')
        ).toHaveCount(0);
        // The *header* has to go too, not just the buttons: a column that names
        // itself and then holds nothing leaves every row a cell short of its
        // headers, which is what a screen reader reads the table by. Asserted
        // against the loaded table on purpose — the loading skeleton draws its
        // own eight-column header regardless of permissions.
        await expect(apiTokensPage.columnHeaders()).toHaveCount(7);
        await expect(apiTokensPage.actionsColumnHeader()).toHaveCount(0);
    });

    test('with tokens:delete the actions column is there at all', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        // The control for the assertion above: seven columns only means
        // something if eight is what a permitted admin actually gets.
        await expect(apiTokensPage.columnHeaders()).toHaveCount(8);
        await expect(apiTokensPage.actionsColumnHeader()).toHaveCount(1);
    });

    test('without tokens:create a populated page offers no way in either [api-tokens:I-22]', async ({
        page,
        apiTokensPage
    }) => {
        await mockSignedIn(page, { permissions: ['tokens:read'] });
        await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        // Pinned only in the empty state until now — which is the one place the
        // button is *also* rendered by the empty state itself, so the header
        // action's own gate went unasserted for the case an admin actually
        // meets: a deployment that already has tokens.
        await expect(apiTokensPage.row('Production website')).toBeVisible();
        await expect(apiTokensPage.newTokenButton).toHaveCount(0);
    });

    test('the create dialog sends exactly what the server expects', async ({
        page,
        apiTokensPage
    }) => {
        const api = await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.openCreate();
        // Nothing entered yet: the client refuses rather than letting the
        // server answer 400 to an empty bucket.
        await expect(apiTokensPage.submitCreateButton()).toBeDisabled();

        await apiTokensPage.nameField().fill('Marketing build');
        await expect(apiTokensPage.submitCreateButton()).toBeDisabled();

        await apiTokensPage.pickWorkspace('Marketing site');
        await apiTokensPage.workspacesSelect().click();
        await page.getByRole('option', { name: 'Product docs' }).click();
        await page.keyboard.press('Escape');

        await apiTokensPage.accessSelect().click();
        await apiTokensPage.chooseOption('Full access');

        await expect(apiTokensPage.submitCreateButton()).toBeEnabled();
        await apiTokensPage.submitCreateButton().click();
        await apiTokensPage.revealDialog().waitFor();

        expect(api.lastCreateBody).toMatchObject({
            name: 'Marketing build',
            workspaceIds: ['ws_marketing', 'ws_docs'],
            scope: 'full'
        });
        // "Never" is the default preset, so no expiry is sent at all.
        expect(api.lastCreateBody).not.toHaveProperty('expiresAt');
    });

    test('a cancelled draft is gone when the dialog is reopened', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.openCreate();
        await apiTokensPage.nameField().fill('Cancelled draft');
        await apiTokensPage.pickWorkspace('Marketing site');
        await apiTokensPage.accessSelect().click();
        await apiTokensPage.chooseOption('Full access');
        await apiTokensPage.expiresSelect().click();
        await apiTokensPage.chooseOption('30 days');

        await apiTokensPage.cancelCreateButton().click();
        await expect(apiTokensPage.createDialog()).toHaveCount(0);

        await apiTokensPage.openCreate();
        // Cancel used to bypass the reset that Escape, the backdrop and the
        // corner X all went through, so the next open presented the abandoned
        // draft as a fresh form — including a `Full access` scope nobody chose
        // this time. An admin who cancelled “Production website” and reopened
        // was one click from a second live credential wearing the same name.
        await expect(apiTokensPage.nameField()).toHaveValue('');
        await expect(apiTokensPage.workspacesSelect()).toContainText(
            'Select workspaces'
        );
        await expect(apiTokensPage.accessSelect()).toContainText('Read-only');
        await expect(apiTokensPage.expiresSelect()).toContainText('Never');
        await expect(apiTokensPage.submitCreateButton()).toBeDisabled();
    });

    test('a minted token is gone from the form when the dialog is reopened', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.createToken('Minted once');
        await apiTokensPage.secretField().waitFor();
        await apiTokensPage.doneButton().click();
        await apiTokensPage.closeWithoutCopyingButton().click();
        await expect(apiTokensPage.revealDialog()).toHaveCount(0);

        await apiTokensPage.openCreate();
        // The success path closes the dialog by flipping the page's controlled
        // `open` prop, which never reaches Radix's `onOpenChange` — so a reset
        // hanging off the closing edge alone misses it entirely, and the form
        // re-opens pre-filled with the token that was just created.
        await expect(apiTokensPage.nameField()).toHaveValue('');
        await expect(apiTokensPage.workspacesSelect()).toContainText(
            'Select workspaces'
        );
        await expect(apiTokensPage.submitCreateButton()).toBeDisabled();
    });

    test('an expiry preset becomes an ISO timestamp in the future', async ({
        page,
        apiTokensPage
    }) => {
        const api = await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.openCreate();
        await apiTokensPage.nameField().fill('Thirty days');
        await apiTokensPage.pickWorkspace('Marketing site');
        await apiTokensPage.expiresSelect().click();
        await apiTokensPage.chooseOption('30 days');
        await apiTokensPage.submitCreateButton().click();
        await apiTokensPage.revealDialog().waitFor();

        const expiresAt = (api.lastCreateBody as { expiresAt?: string })
            .expiresAt;
        expect(expiresAt).toBeTruthy();
        const days =
            (Date.parse(expiresAt as string) - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(29.9);
        expect(days).toBeLessThan(30.1);
    });

    test('a failed create keeps the form and its values on screen', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page, { createStatus: 500 });
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.openCreate();
        await apiTokensPage.nameField().fill('Doomed token');
        await apiTokensPage.pickWorkspace('Marketing site');
        await apiTokensPage.submitCreateButton().click();

        await expect(
            apiTokensPage.toast('Couldn’t create the token. Please try again.')
        ).toBeVisible();
        // Closing on failure would throw away everything the admin typed.
        await expect(apiTokensPage.createDialog()).toBeVisible();
        await expect(apiTokensPage.nameField()).toHaveValue('Doomed token');
        await expect(apiTokensPage.revealDialog()).toHaveCount(0);
    });

    test('a rejected create keeps the form too, and is not retried', async ({
        page,
        apiTokensPage
    }) => {
        // A 400 is the server's settled answer, not an outage: the shared
        // client's retry predicate stops on it, so this state arrives at once
        // and the admin sees a form they can correct rather than a spinner.
        const api = await mockApiTokensApi(page, { createStatus: 400 });
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.openCreate();
        await apiTokensPage.nameField().fill('Rejected token');
        await apiTokensPage.pickWorkspace('Marketing site');
        await apiTokensPage.submitCreateButton().click();

        await expect(
            apiTokensPage.toast('Couldn’t create the token. Please try again.')
        ).toBeVisible();
        await expect(apiTokensPage.createDialog()).toBeVisible();
        await expect(apiTokensPage.nameField()).toHaveValue('Rejected token');
        await expect(apiTokensPage.workspacesSelect()).toContainText(
            'Marketing site'
        );
        await expect(apiTokensPage.revealDialog()).toHaveCount(0);
        // Correctable, not stuck: the submit comes back rather than staying
        // disabled behind a mutation that has already settled.
        await expect(apiTokensPage.submitCreateButton()).toBeEnabled();
        expect(api.createCalls).toBe(1);
    });

    test('the submit cannot be double-fired while a create is in flight', async ({
        page,
        apiTokensPage
    }) => {
        const api = await mockApiTokensApi(page, { createDelayMs: 1_000 });
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.openCreate();
        await apiTokensPage.nameField().fill('Slow token');
        await apiTokensPage.pickWorkspace('Marketing site');
        await apiTokensPage.submitCreateButton().click();

        // Two tokens minted but only the second secret revealed would silently
        // orphan a live credential.
        await expect(apiTokensPage.submitCreateButton()).toBeDisabled();
        await apiTokensPage.revealDialog().waitFor();
        expect(api.createCalls).toBe(1);
    });

    test('a broken workspace fetch says so instead of reading as empty [api-tokens:I-23]', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        await mockWorkspacesUnavailable(page);
        await apiTokensPage.goto();
        await apiTokensPage.heading.waitFor();

        await apiTokensPage.openCreate();
        // The selector alone would show "No workspaces found." — which is what a
        // deployment with no workspaces looks like, and would have an admin mint
        // a token against the wrong bucket rather than retry.
        await expect(apiTokensPage.workspacesError()).toBeVisible(SETTLED);
    });

    test('no workspaces at all says exactly that, and raises no alarm', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        // Registered after the `beforeEach` mock, so this one answers: the last
        // matching route wins.
        await mockWorkspaces(page, []);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.openCreate();
        // Named first, so the disabled submit below is about the missing bucket
        // rather than the empty name field.
        await apiTokensPage.nameField().fill('Nowhere to point it');
        await apiTokensPage.openWorkspacePopover();

        // The other half of the test above. These two states have to be
        // distinguishable in both directions: a deployment with nothing to pick
        // must not cry outage, or the alert stops meaning anything the day it
        // is real.
        await expect(apiTokensPage.workspacesEmpty()).toBeVisible();
        await expect(apiTokensPage.workspacesError()).toHaveCount(0);
        // And with no bucket to scope it to, there is nothing to mint.
        await expect(apiTokensPage.submitCreateButton()).toBeDisabled();
    });

    test('the selector’s own Retry recovers it in place', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        await mockWorkspacesUnavailable(page);
        await apiTokensPage.goto();
        await apiTokensPage.heading.waitFor();
        await apiTokensPage.openCreate();
        await apiTokensPage.workspacesError().waitFor(SETTLED);

        // The endpoint comes back; the alert's Retry is the admin's way out
        // without losing the dialog — reopening it is what the offer implies
        // they don't have to do.
        await mockWorkspaces(page);
        await apiTokensPage.workspacesRetryButton().click();

        await expect(apiTokensPage.workspacesError()).toHaveCount(0);
        // Recovered means pickable, not merely quiet.
        await apiTokensPage.openWorkspacePopover();
        await expect(
            apiTokensPage.workspaceOption('Marketing site')
        ).toBeVisible();
    });

    test('revoking flips the row in place and says it happened', async ({
        page,
        apiTokensPage
    }) => {
        const api = await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.chooseRevoke('Production website');
        await expect(apiTokensPage.confirmDialog()).toContainText(
            'Any app using “Production website” will immediately lose access.'
        );
        await apiTokensPage.confirmRevokeButton().click();

        await expect(apiTokensPage.rowStatus('Production website')).toHaveText(
            'Revoked'
        );
        // The row stays — a revoked token is history an operator needs to see —
        // but its only action is gone.
        await expect(
            apiTokensPage.rowActions('Production website')
        ).toHaveCount(0);
        await expect(apiTokensPage.toast('Token revoked')).toBeVisible();
        expect(api.revokeCalls).toBe(1);
    });

    test('cancelling a revoke sends nothing', async ({
        page,
        apiTokensPage
    }) => {
        const api = await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.chooseRevoke('Production website');
        await apiTokensPage.cancelRevokeButton().click();

        await expect(apiTokensPage.rowStatus('Production website')).toHaveText(
            'Active'
        );
        expect(api.revokeCalls).toBe(0);
    });

    test('a failed revoke toasts and leaves the row alone', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page, { revokeStatus: 500 });
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await apiTokensPage.chooseRevoke('Production website');
        await apiTokensPage.confirmRevokeButton().click();

        await expect(
            apiTokensPage.toast('Couldn’t revoke the token. Please try again.')
        ).toBeVisible();
        await expect(apiTokensPage.rowStatus('Production website')).toHaveText(
            'Active'
        );
    });

    test('announces the result count so a change without a navigation is heard', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page);
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await expect(apiTokensPage.resultsStatus()).toHaveText(
            `${API_TOKENS_SEED.length} API tokens`
        );

        await apiTokensPage.createToken('Announced token');
        await apiTokensPage.secretField().waitFor();
        await apiTokensPage.doneButton().click();
        await apiTokensPage.closeWithoutCopyingButton().click();

        await expect(apiTokensPage.resultsStatus()).toHaveText(
            `${API_TOKENS_SEED.length + 1} API tokens`
        );
    });

    test('no pager on a single page', async ({ page, apiTokensPage }) => {
        await mockApiTokensApi(page, { tokens: manyApiTokens(25) });
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await expect(apiTokensPage.pageIndicator()).toHaveCount(0);
    });

    test('the page lives in the URL, so it is linkable and survives a reload [api-tokens:I-24]', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page, { tokens: manyApiTokens(26) });
        await apiTokensPage.goto();
        await apiTokensPage.table.waitFor();

        await expect(apiTokensPage.pageIndicator()).toHaveText('Page 1 of 2');
        await expect(apiTokensPage.previousButton()).toBeDisabled();

        await apiTokensPage.nextButton().click();
        await expect(apiTokensPage.pageIndicator()).toHaveText('Page 2 of 2');
        await expect(apiTokensPage.nextButton()).toBeDisabled();
        await expect(page).toHaveURL(/[?&]page=2/);

        // A token list page is a thing an operator shares with a colleague, so
        // it has to outlive the click that reached it.
        await page.reload();
        await apiTokensPage.table.waitFor();
        await expect(apiTokensPage.pageIndicator()).toHaveText('Page 2 of 2');
    });

    test('a deep link past the end clamps back to the last page [api-tokens:I-24]', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page, { tokens: manyApiTokens(26) });
        await apiTokensPage.gotoWith('page=9');
        await apiTokensPage.table.waitFor();

        await expect(apiTokensPage.pageIndicator()).toHaveText('Page 2 of 2');
        await expect(page).toHaveURL(/[?&]page=2/);
    });

    test('a nonsense ?page= lands on the first page rather than an error [api-tokens:I-24]', async ({
        page,
        apiTokensPage
    }) => {
        await mockApiTokensApi(page, { tokens: manyApiTokens(26) });

        // Not typos so much as stale links and hand-edited URLs. All three are
        // unusable as a page number — `abc` isn't one, and `0`/`-3` are outside
        // the 1-based range — and the honest answer to each is the first page.
        // Passing them through would put `?page=0` on the wire, which the server
        // answers 400, and the page would then show its "couldn't load" alert
        // over a list that is perfectly fine.
        for (const value of ['abc', '0', '-3']) {
            await apiTokensPage.gotoWith(`page=${value}`);
            await apiTokensPage.table.waitFor();

            await expect(apiTokensPage.pageIndicator()).toHaveText(
                'Page 1 of 2'
            );
            await expect(apiTokensPage.previousButton()).toBeDisabled();
            await expect(apiTokensPage.row('Bulk token 00')).toBeVisible();
            await expect(apiTokensPage.errorAlert()).toHaveCount(0);
        }
    });
});
