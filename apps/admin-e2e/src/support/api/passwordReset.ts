import { type Page } from '@playwright/test';
import { DEFAULT_MEMBERS, type MemberSeed } from './members';

/** Whose account a reset link opens, as `GET /api/auth/reset/:token` answers. */
export interface PasswordResetSeed {
    /** The email of the account the link resets. */
    email: string;
    /** The account's display name, or `null`. */
    name: string | null;
}

/** The default account the reset suite works with. */
export const DEFAULT_RESET: PasswordResetSeed = {
    email: 'grace@ortha.dev',
    name: 'Grace Hopper'
};

/** The raw token the admin-side mint hands back, turned into a link by the UI. */
export const RESET_TOKEN = 'reset-token-abc123';

/**
 * Stub `GET /api/auth/reset/:token` — the lookup the reset page runs to learn
 * whose account a link opens. The front-end analog of the server suite's token
 * fixture: instead of a token row, it fixes what the API would answer.
 *
 * Pass `status: 404` for a dead link (the server returns one generic 404 for
 * unknown, expired, already-used, and "the account is no longer active", so the
 * UI has exactly one failure shape to render). `delayMs` holds it open so a test
 * can observe the skeleton.
 *
 * Registered per-`page`, so it resets between tests with the browser context.
 */
export async function mockPasswordReset(
    page: Page,
    reset: PasswordResetSeed = DEFAULT_RESET,
    { status = 200, delayMs }: { status?: number; delayMs?: number } = {}
): Promise<void> {
    await page.route('**/api/auth/reset/*', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.fallback();
            return;
        }
        if (delayMs) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(
                status === 200 ? reset : { message: 'Not Found' }
            )
        });
    });
}

/** Records what the reset endpoint was called with, for a test to assert. */
export interface ResetPasswordSpy {
    /** How many times the endpoint was hit. */
    readonly count: number;
    /** The bodies posted, in order. */
    readonly bodies: Record<string, unknown>[];
}

/**
 * Stub `POST /api/auth/reset` and record each call, so a test can assert both
 * that the request carried what the form collected and that client-side
 * validation suppressed it when it shouldn't have fired.
 *
 * Defaults to `201`. Pass `404` for a link that died mid-form or `400` for a
 * password the server rejected — the two failures the page renders differently.
 *
 * Route order does not matter against {@link mockPasswordReset}, even though
 * both match `/api/auth/reset`: each falls back when the method isn't the one it
 * handles, so the lookup GET and the redemption POST always reach the right stub.
 */
export async function spyResetPassword(
    page: Page,
    { status = 201, delayMs }: { status?: number; delayMs?: number } = {}
): Promise<ResetPasswordSpy> {
    let count = 0;
    const bodies: Record<string, unknown>[] = [];

    await page.route('**/api/auth/reset', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.fallback();
            return;
        }
        count += 1;
        bodies.push(JSON.parse(route.request().postData() ?? '{}'));
        if (delayMs) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(
                status === 201 ? { ok: true } : { message: 'Rejected' }
            )
        });
    });

    return {
        get count() {
            return count;
        },
        get bodies() {
            return bodies;
        }
    };
}

/**
 * Stub `POST /api/users/:id/password-reset` — the admin-side mint — echoing the
 * member back with a raw token, and recording each call.
 *
 * Pass `status: 409` with a `code` to exercise the two conflicts the card
 * explains differently: `PASSWORD_RESET_RECENTLY_SENT` (with its
 * `retryAfterSeconds`) and `INVALID_MEMBER_STATE`.
 */
export async function spyIssuePasswordReset(
    page: Page,
    {
        member = DEFAULT_MEMBERS[1],
        status = 201,
        code,
        retryAfterSeconds
    }: {
        member?: MemberSeed;
        status?: number;
        code?: string;
        retryAfterSeconds?: number;
    } = {}
): Promise<{ readonly count: number }> {
    let count = 0;
    await page.route('**/api/users/*/password-reset', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.fallback();
            return;
        }
        count += 1;
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(
                status === 201
                    ? { ...member, resetToken: RESET_TOKEN }
                    : {
                          statusCode: status,
                          error: 'Conflict',
                          message: 'Conflict',
                          code,
                          retryAfterSeconds
                      }
            )
        });
    });
    return {
        get count() {
            return count;
        }
    };
}
