import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockActivity } from '../support/api/activity';
import { expectNoA11yViolations } from '../support/a11y';

/**
 * The Activity Log query-builder filter drawer
 * (`@orthacms/query-builder-admin`): building a condition narrows the log, the
 * choice deep-links into the URL as `?filter=<json>`, and Reset clears it. The
 * `GET /api/activity` mock honours the `filter` param (AND-ed with the actor
 * search), mirroring the server.
 */
test.describe('Activity filter (query builder)', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockActivity(page);
    });

    test('expands the inline filter panel from the toolbar', async ({
        activityLogPage
    }) => {
        await activityLogPage.goto();
        await expect(activityLogPage.heading).toBeVisible();

        // The builder is an inline accordion here, matching a collection's
        // records list — press the toggle and it expands in place.
        await activityLogPage.openFilters();
        await expect(activityLogPage.filterSurface()).toBeVisible();
        await expect(activityLogPage.filterTrigger()).toHaveAttribute(
            'aria-expanded',
            'true'
        );
    });

    test('filters the log by kind and deep-links the choice', async ({
        activityLogPage,
        page
    }) => {
        await activityLogPage.goto();
        await expect(
            activityLogPage.row('ada@ortha.dev').first()
        ).toBeVisible();

        // Default field is "Action" with the "equals" operator. It is an enum
        // field, so the value editor is a select over the kind catalogue — the
        // reader picks the label the Action column renders ("Suspended
        // member"), never the `user.suspended` token it stands for.
        await activityLogPage.openFilters();
        await activityLogPage.addRule();
        await activityLogPage.selectEnumValue('Suspended member');
        await activityLogPage.applyFilters();

        // Only the suspension event (actor grace) survives. The panel stays
        // expanded after Apply — asserting a drawer's absence here passed
        // trivially, since this page has mounted no drawer since it migrated.
        await expect(activityLogPage.filterSurface()).toBeVisible();
        await expect(activityLogPage.filterTrigger()).toHaveAttribute(
            'aria-expanded',
            'true'
        );
        await expect(
            activityLogPage.row('grace@ortha.dev').first()
        ).toBeVisible();
        await expect(activityLogPage.row('ada@ortha.dev')).toHaveCount(0);

        await expect(page).toHaveURL(/filter=/);
        const filterParam = new URL(page.url()).searchParams.get('filter');
        // The label is display only — what travels is still the wire token.
        expect(filterParam).toContain('"kind"');
        expect(filterParam).toContain('user.suspended');
    });

    test('reflects the active condition count on the trigger', async ({
        activityLogPage
    }) => {
        await activityLogPage.goto();
        await activityLogPage.openFilters();
        await activityLogPage.addRule();
        await activityLogPage.selectEnumValue('Suspended member');
        await activityLogPage.applyFilters();

        await expect(activityLogPage.filterTrigger()).toHaveText(
            /Filters \(1\)/
        );
    });

    test('restores the filter from a deep link on load [activity:I-30]', async ({
        activityLogPage,
        page
    }) => {
        const filter = encodeURIComponent(
            JSON.stringify({ field: 'kind', op: 'eq', value: 'user.suspended' })
        );
        await page.goto(`/activity?filter=${filter}`);

        await expect(
            activityLogPage.row('grace@ortha.dev').first()
        ).toBeVisible();
        await expect(activityLogPage.row('ada@ortha.dev')).toHaveCount(0);
        await expect(activityLogPage.filterTrigger()).toHaveText(
            /Filters \(1\)/
        );
    });

    test('blocks Apply when a UUID "is one of" rule has a non-UUID value', async ({
        activityLogPage,
        page
    }) => {
        await activityLogPage.goto();
        await expect(
            activityLogPage.row('ada@ortha.dev').first()
        ).toBeVisible();

        // Actor ID is a UUID field offering "is one of" (free-text CSV). A
        // non-UUID item must be caught client-side, not round-tripped to a 400.
        await activityLogPage.openFilters();
        await activityLogPage.addRule();
        await activityLogPage.selectField('Actor ID');
        await activityLogPage.selectOperator('is one of');
        await activityLogPage.fillValue('not-a-uuid');
        await activityLogPage.applyFilters();

        // The panel stays open, the rule shows its validation error, and
        // nothing was committed to the URL.
        await expect(activityLogPage.filterSurface()).toBeVisible();
        // Prefixed with the rule's field path since `ORT-157`: a burst of bare
        // "Value required" alerts named nothing, and 3.3.1 requires the item in
        // error to be identified.
        await expect(activityLogPage.ruleError()).toHaveText(
            'Actor ID: Must be a valid UUID'
        );
        await expect(page).not.toHaveURL(/filter=/);
    });

    test('the open filter panel with a rule is accessible (axe)', async ({
        activityLogPage,
        makeAxe
    }) => {
        await activityLogPage.goto();
        await activityLogPage.openFilters();
        await activityLogPage.addRule();
        await activityLogPage.selectField('Actor email');
        await expectNoA11yViolations(makeAxe());
    });

    test('Reset clears the filter and restores the full log', async ({
        activityLogPage,
        page
    }) => {
        const filter = encodeURIComponent(
            JSON.stringify({ field: 'kind', op: 'eq', value: 'user.suspended' })
        );
        await page.goto(`/activity?filter=${filter}`);
        await expect(
            activityLogPage.row('grace@ortha.dev').first()
        ).toBeVisible();

        await activityLogPage.openFilters();
        await activityLogPage.resetFilters();

        await expect(
            activityLogPage.row('ada@ortha.dev').first()
        ).toBeVisible();
        await expect(page).not.toHaveURL(/filter=/);
        await expect(activityLogPage.filterTrigger()).toHaveText(/^Filters$/);
    });
});
