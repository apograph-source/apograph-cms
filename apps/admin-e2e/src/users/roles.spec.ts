import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { DEFAULT_MEMBERS, mockMembers } from '../support/api/members';
import { mockUserDetail } from '../support/api/userDetail';

/** Grace — an ordinary active contributor, so nothing locks her picker. */
const GRACE = DEFAULT_MEMBERS.find((member) => member.id === 'u_grace')!;

/** Ada — the sole active admin (`isLastAdmin`), and the signed-in user. */
const ADA = DEFAULT_MEMBERS.find((member) => member.id === 'u_ada')!;

/**
 * A member holding a role outside the three assignable system roles. The
 * server's `Role.create` accepts any non-empty key, so this is a shape the
 * admin has to render honestly rather than round down to `viewer`.
 */
const CUSTOM_ROLE_MEMBER = {
    ...GRACE,
    id: 'u_custom',
    email: 'editor@ortha.dev',
    name: 'Edie Editor',
    role: { id: 'role_editor', key: 'editor', name: 'Editor' }
};

/**
 * The Role tab's guardrails. Each one exists so the control can explain itself
 * *before* the request instead of bouncing off a 409 with a generic "please try
 * again" — and, for a custom role, so the UI never asserts a privilege level the
 * member does not hold.
 */
test.describe('Role tab guardrails', () => {
    test('locks your own role with the reason, rather than 409-ing', async ({
        userDetailPage,
        page
    }) => {
        // Signed in *as* Ada, looking at Ada.
        await mockSignedIn(page, {
            id: ADA.id,
            email: ADA.email,
            name: ADA.name
        });
        await mockMembers(page);
        await mockUserDetail(page);

        await userDetailPage.goto(ADA.id);
        await userDetailPage.openTab('Role');

        await expect(
            page.getByText('You can’t change your own role')
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Apply role' })
        ).toBeDisabled();
    });

    test('locks the sole active admin with the reason [users:I-16]', async ({
        userDetailPage,
        page
    }) => {
        // Signed in as somebody else, so `self` doesn't mask `lastAdmin`.
        await mockSignedIn(page, {
            id: GRACE.id,
            email: GRACE.email,
            name: GRACE.name
        });
        await mockMembers(page);
        await mockUserDetail(page);

        await userDetailPage.goto(ADA.id);
        await userDetailPage.openTab('Role');

        await expect(
            page.getByText('last remaining admin', { exact: false })
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: 'Apply role' })
        ).toBeDisabled();
    });

    test('shows a custom role by its server name and refuses to guess', async ({
        userDetailPage,
        page
    }) => {
        const members = [...DEFAULT_MEMBERS, CUSTOM_ROLE_MEMBER];
        await mockSignedIn(page, {
            id: ADA.id,
            email: ADA.email,
            name: ADA.name
        });
        await mockMembers(page, members);
        await mockUserDetail(page, members);

        await userDetailPage.goto(CUSTOM_ROLE_MEMBER.id);

        // The hero/stats chip shows "Editor" — not "Viewer", which is what a
        // `?? 'viewer'` mapper fallback would have asserted.
        await expect(page.getByText('Editor').first()).toBeVisible();

        await userDetailPage.openTab('Role');
        await expect(
            page.getByText('This member holds the custom role “Editor”', {
                exact: false
            })
        ).toBeVisible();
        // No card claims to be their current role.
        await expect(page.getByText('Current')).toHaveCount(0);
        await expect(
            page.getByRole('button', { name: 'Apply role' })
        ).toBeDisabled();
    });

    test('lets an ordinary member’s role be changed behind a confirm', async ({
        userDetailPage,
        page
    }) => {
        await mockSignedIn(page, {
            id: ADA.id,
            email: ADA.email,
            name: ADA.name
        });
        await mockMembers(page);
        await mockUserDetail(page);

        await userDetailPage.goto(GRACE.id);
        await userDetailPage.openTab('Role');

        await expect(
            page.getByRole('button', { name: 'Apply role' })
        ).toBeDisabled();

        await page.locator('label', { hasText: 'Admin' }).first().click();
        await page.getByRole('button', { name: 'Apply role' }).click();

        // Escalation to Admin gets its own warning.
        await expect(
            page.getByRole('heading', { name: `Change ${GRACE.name}’s role?` })
        ).toBeVisible();
        await expect(page.getByRole('dialog')).toContainText(
            'Admins have full access'
        );
    });
});
