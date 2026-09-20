import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the user detail page at `/users/:id` (from
 * `@orthacms/users-admin`). Data comes from the `mockUserDetail` /
 * `mockUserSessions` / activity mocks; tests also need `mockSignedIn` for the
 * auth probe and `mockMembers` for the list it links back to. Which side-rail
 * tabs appear depends on the signed-in user's `permissions`.
 */
export class UserDetailPage extends BasePage {
    /** The shell's primary nav — proof the gated layout wrapped the page. */
    readonly nav: Locator;
    /** The detail side rail (its own `nav` landmark). */
    readonly rail: Locator;

    constructor(page: Page) {
        super(page);
        this.nav = page.getByRole('navigation', { name: 'Primary' });
        this.rail = page.getByRole('navigation', {
            name: 'User detail sections'
        });
    }

    /** Open a member's detail page directly (defaults to the General tab). */
    async goto(id: string) {
        await this.page.goto(`/users/${id}`);
    }

    /** The hero's `<h1>` (the member's name). */
    heading(name: string): Locator {
        return this.page.getByRole('heading', { name, level: 1 });
    }

    /** A side-rail tab link, by its visible label (e.g. "Sessions"). */
    tab(label: string): Locator {
        return this.rail.getByRole('link', { name: label });
    }

    /** Open a tab by label. */
    async openTab(label: string) {
        await this.tab(label).click();
    }

    /** The General tab's full-name input. */
    nameInput(): Locator {
        return this.page.getByLabel('Full name');
    }

    /** The General tab's "Save changes" button. */
    saveButton(): Locator {
        return this.page.getByRole('button', { name: 'Save changes' });
    }

    /**
     * The layout's failure alert. The 404 and the generic error share this one
     * element, so the copy — not the role — is what tells them apart; see
     * {@link notFoundAlert}.
     */
    errorAlert(): Locator {
        return this.page.getByRole('alert');
    }

    /**
     * The alert for a member id that matches nobody. Distinct copy on purpose:
     * a deleted member is a settled answer, and offering the retry the generic
     * message implies would send the admin round a loop that cannot succeed.
     */
    notFoundAlert(): Locator {
        return this.errorAlert().filter({
            hasText: 'This member no longer exists.'
        });
    }

    /**
     * The Sessions card's header — the anchor the tab hands focus back to when
     * a revoked card unmounts. It is a `div` with `tabIndex={-1}` rather than a
     * heading element, so it is located by the copy it carries.
     */
    sessionsCardHeader(): Locator {
        return this.page
            .locator('div[tabindex="-1"]')
            .filter({ hasText: 'Devices currently signed in as this member.' });
    }

    /** A confirm-dialog button by label (e.g. "Revoke", "Suspend member"). */
    confirmButton(label: string): Locator {
        return this.page
            .getByRole('dialog')
            .getByRole('button', { name: label });
    }

    // --- Access tab: sign-in access + the password reset link ---

    /**
     * The sign-in access card's one action, whichever direction it is offering.
     * A single locator on purpose: the page renders exactly one of the two at a
     * time, so a test asserting "Suspend member" is visible is also asserting
     * "Reactivate member" is not.
     */
    accessAction(label: 'Suspend member' | 'Reactivate member'): Locator {
        return this.page.getByRole('button', { name: label });
    }

    /**
     * Copy on the sign-in access card, by text or pattern.
     *
     * `exact` matters more than it looks: the password card below repeats the
     * access card's wording inside a longer sentence ("This member is suspended
     * **and can't sign in, so a reset link…**"), so a substring match resolves
     * to two elements and fails strict mode.
     */
    accessStatus(text: string | RegExp, { exact = false } = {}): Locator {
        return this.page.getByText(text, exact ? { exact: true } : undefined);
    }

    /** The Access tab's "Generate reset link" button. */
    generateResetLink(): Locator {
        return this.page.getByRole('button', {
            name: /Generate reset link|Generating reset link/
        });
    }

    /** The reveal-once dialog that shows the minted reset link. */
    resetLinkDialog(): Locator {
        return this.page.getByRole('dialog');
    }

    /** The read-only link field inside the reveal dialog, by the member's email. */
    resetLinkField(email: string): Locator {
        return this.page.getByLabel(`Password reset link for ${email}`);
    }

    /** The dialog's copy button. */
    copyResetLink(): Locator {
        return this.page.getByRole('button', { name: 'Copy link' });
    }

    /** The dialog's dismiss button (guarded until the link has been copied). */
    resetLinkDone(): Locator {
        return this.page.getByRole('button', { name: 'Done' });
    }

    // --- Preferences tab (self-only): the colour-theme picker ---

    /**
     * A theme option in the Preferences tab's radio group, by name (Light /
     * Dark / System). Each option is a `radio` whose accessible name comes from
     * its card label, so a substring match is robust to the hint copy. Used for
     * visibility/checked assertions; {@link selectTheme} does the clicking.
     */
    themeOption(name: 'Light' | 'Dark' | 'System'): Locator {
        return this.page.getByRole('radio', { name: new RegExp(name) });
    }

    /**
     * Select a theme by clicking its card. The radio itself is visually hidden
     * (`sr-only`) behind a custom card, so — as a user does — we click the card
     * label, which is wired to the radio via `htmlFor`.
     */
    async selectTheme(name: 'Light' | 'Dark' | 'System') {
        await this.page.locator('label', { hasText: name }).click();
    }

    /** True when the app has applied the dark theme (the `.dark` class on <html>). */
    async isDark(): Promise<boolean> {
        const cls =
            (await this.page.locator('html').getAttribute('class')) ?? '';
        return cls.split(/\s+/).includes('dark');
    }

    /** The "Theme saved." success toast shown after a theme is persisted. */
    savedToast(): Locator {
        return this.page.getByText('Theme saved.');
    }
}
