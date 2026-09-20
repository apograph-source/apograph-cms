import { type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the accept-invite screen at
 * `/identity/accept-invite?token=…` (from `@orthacms/identity-admin`). Owns
 * every selector the accept suite needs, so specs assert behavior without
 * touching the DOM.
 *
 * Data comes from the `GET /api/auth/invite/:token` mock (`mockInvite`); the
 * route is public, so no auth probe seeding is required — though a suite that
 * asserts the post-accept landing still needs `mockSignedIn`.
 */
export class AcceptInvitePage extends BasePage {
    /** The page's `<h1>` on the happy path. */
    readonly heading: Locator;
    /** The password field. */
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
    /**
     * The "or accept with" divider above the single-sign-on links. Present only
     * when the deployment registers at least one provider, so it is also how a
     * suite asserts the block is absent.
     */
    readonly ssoSeparator: Locator;

    constructor(page: Page) {
        super(page);
        this.heading = page.getByRole('heading', {
            name: 'Set your password'
        });
        this.password = page.getByLabel('Password', { exact: true });
        this.confirmPassword = page.getByLabel('Confirm password');
        this.submit = page.getByRole('button', {
            name: /Create my account|Setting up your account/
        });
        this.errorBanner = page
            .getByRole('alert')
            .filter({ hasText: 'Couldn’t finish setting up' });
        this.ssoSeparator = page.getByText('or accept with');
    }

    /**
     * One provider's acceptance control, by the label the operator configured.
     *
     * A **link**, like the sign-in page's: accepting with a work account is a
     * full-page navigation, and asserting the role is what keeps it from
     * regressing into a scripted click.
     */
    ssoLink(label: string): Locator {
        return this.page.getByRole('link', { name: `Continue with ${label}` });
    }

    /** Open the accept page with `token` in the query string. */
    async goto(token = 'invite-token-abc123') {
        await this.page.goto(
            `/identity/accept-invite?token=${encodeURIComponent(token)}`
        );
    }

    /** Open the accept page with no `?token=` at all — a truncated link. */
    async gotoWithoutToken() {
        await this.page.goto('/identity/accept-invite');
    }

    /** Fill both password fields and submit. */
    async setPassword(password: string, confirmation = password) {
        await this.password.fill(password);
        await this.confirmPassword.fill(confirmation);
        await this.submit.click();
    }

    /** The read-only email carried over from the invite. */
    emailField(): Locator {
        return this.page.getByLabel('Email');
    }

    /** The read-only name carried over from the invite. */
    nameField(): Locator {
        return this.page.getByLabel('Name');
    }

    /** A field-level validation message (e.g. "Use at least 12 characters…"). */
    fieldError(pattern: string | RegExp): Locator {
        return this.page.getByText(pattern);
    }

    /**
     * A field's whole validation region — the `role="alert"` the input points
     * at with `aria-describedby`. Assert its *text* to pin how many messages a
     * field announces at once: stacked messages render as a list inside this
     * one region.
     */
    fieldErrorRegion(field: 'password' | 'confirm-password'): Locator {
        return this.page.locator(`#accept-invite-${field}-error`);
    }

    /** The dead-link state's heading. */
    unavailableHeading(): Locator {
        return this.page.getByRole('heading', {
            name: 'This invite link no longer works'
        });
    }

    /** The dead-link state's escape hatch back to sign-in. */
    signInLink(): Locator {
        return this.page.getByRole('link', { name: 'Go to sign in' });
    }

    /**
     * The *outage* state's heading — the lookup failed for a reason other than
     * the server refusing the token, so the link is probably still good.
     */
    lookupFailedHeading(): Locator {
        return this.page.getByRole('heading', {
            name: 'We couldn’t check your invite'
        });
    }

    /** The outage state's retry control. */
    retryLookup(): Locator {
        return this.page.getByRole('button', { name: 'Try again' });
    }

    /** The busy region shown while the invite lookup is in flight. */
    loadingStatus(): Locator {
        return this.page
            .getByRole('status')
            .filter({ hasText: /Checking your invite/ });
    }

    /**
     * A field's description region — the `${id}-description` node `InputField`
     * points at with `aria-describedby`. The read-only fields use it to say why
     * they cannot be edited, which is the only thing separating "prefilled for
     * you" from "inexplicably stuck" for a screen-reader user.
     */
    fieldDescription(field: 'name' | 'email' | 'password'): Locator {
        return this.page.locator(`#accept-invite-${field}-description`);
    }

    /**
     * The individual pulsing blocks of the busy card. Selected by the animation
     * utility itself because that *is* what is under test — whether the pulse is
     * suppressed under `prefers-reduced-motion`.
     */
    skeletonBlocks(): Locator {
        return this.page.locator('[data-slot="skeleton"], .animate-pulse');
    }
}
