import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the reset-password screen at
 * `/identity/reset-password?token=…` (from `@orthacms/identity-admin`) — the
 * far end of the link an admin generates on a member's Access tab. Owns every
 * selector the reset suite needs, so specs assert behavior without touching the
 * DOM.
 *
 * Data comes from the `GET /api/auth/reset/:token` mock (`mockPasswordReset`);
 * the route is public, so no auth probe seeding is required.
 */
export class ResetPasswordPage extends BasePage {
    /** The page's `<h1>` on the happy path. */
    readonly heading: Locator;
    /** The new-password field. */
    readonly password: Locator;
    /** The re-typed password field. */
    readonly confirmPassword: Locator;
    /** The submit control; its label flips while submitting. */
    readonly submit: Locator;
    /**
     * The submission-error banner. Field errors also render `role="alert"`, so
     * this is anchored on the banner's constant title rather than the bare role.
     */
    readonly errorBanner: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.getByRole('heading', {
            name: 'Choose a new password'
        });
        this.password = page.getByLabel('New password', { exact: true });
        this.confirmPassword = page.getByLabel('Confirm new password');
        this.submit = page.getByRole('button', {
            name: /Set new password|Setting your new password/
        });
        this.errorBanner = page
            .getByRole('alert')
            .filter({ hasText: 'Couldn’t set your new password' });
    }

    /** Open the reset page with `token` in the query string. */
    async goto(token = 'reset-token-abc123') {
        await this.page.goto(
            `/identity/reset-password?token=${encodeURIComponent(token)}`
        );
    }

    /** Open the reset page with no `?token=` at all — a truncated link. */
    async gotoWithoutToken() {
        await this.page.goto('/identity/reset-password');
    }

    /** Fill both password fields and submit. */
    async setPassword(password: string, confirmation = password) {
        await this.password.fill(password);
        await this.confirmPassword.fill(confirmation);
        await this.submit.click();
    }

    /** The read-only email of the account the link resets. */
    emailField(): Locator {
        return this.page.getByLabel('Email');
    }

    /** The success state's heading — the hand-off back to sign-in. */
    doneHeading(): Locator {
        return this.page.getByRole('heading', {
            name: 'Your password is set'
        });
    }

    /** The dead-link state's heading. */
    unavailableHeading(): Locator {
        return this.page.getByRole('heading', {
            name: 'This reset link no longer works'
        });
    }

    /** Any state's escape hatch back to sign-in. */
    signInLink(): Locator {
        return this.page.getByRole('link', { name: 'Go to sign in' });
    }

    /**
     * The *outage* state's heading — the lookup failed for a reason other than
     * the server refusing the token, so the link is probably still good.
     */
    lookupFailedHeading(): Locator {
        return this.page.getByRole('heading', {
            name: 'We couldn’t check your reset link'
        });
    }

    /** The outage state's retry control. */
    retryLookup(): Locator {
        return this.page.getByRole('button', { name: 'Try again' });
    }

    /** A field-level validation message (e.g. "Use at least 12 characters…"). */
    fieldError(pattern: string | RegExp): Locator {
        return this.page.getByText(pattern);
    }
}
