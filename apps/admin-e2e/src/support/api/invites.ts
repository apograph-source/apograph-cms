import { type Page } from '@playwright/test';

/** A live invite as `GET /api/auth/invite/:token` describes it. */
export interface InviteSeed {
    /** The email the invite was addressed to. */
    email: string;
    /** The display name the inviting admin set, or `null`. */
    name: string | null;
}

/** The default invite the accept suite works with. */
export const DEFAULT_INVITE: InviteSeed = {
    email: 'ada@ortha.dev',
    name: 'Ada Lovelace'
};

/**
 * Stub `GET /api/auth/invite/:token` — the lookup the accept page runs to learn
 * who a link is for. The front-end analog of the server suite's invite fixture:
 * instead of a token row, it fixes what the API would answer.
 *
 * Pass `status: 404` for a dead link (the server returns one generic 404 for
 * unknown, expired, and already-accepted, so the UI has exactly one failure
 * shape to render). `delayMs` holds it open so a test can observe the skeleton.
 *
 * Registered per-`page`, so it resets between tests with the browser context.
 */
export async function mockInvite(
    page: Page,
    invite: InviteSeed = DEFAULT_INVITE,
    { status = 200, delayMs }: { status?: number; delayMs?: number } = {}
): Promise<void> {
    await page.route('**/api/auth/invite/*', async (route) => {
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
                status === 200 ? invite : { message: 'Not Found' }
            )
        });
    });
}

/** Records what the accept endpoint was called with, for a test to assert. */
export interface AcceptInviteSpy {
    /** How many times the endpoint was hit. */
    readonly count: number;
    /** The bodies posted, in order. */
    readonly bodies: Record<string, unknown>[];
}

/**
 * Stub `POST /api/auth/invite/accept` and record each call, so a test can assert
 * both that the request carried what the form collected and that client-side
 * validation suppressed it when it shouldn't have fired.
 *
 * Defaults to `201` (the server activated the account and set the session
 * cookie). Pass `404` for a link that died mid-form or `400` for a password the
 * server rejected — the two failures the page renders differently.
 *
 * Route order does not matter against {@link mockInvite}, even though both
 * match the same `/api/auth/invite/` prefix: each falls back when the method
 * isn't the one it handles, so the lookup GET and the accept POST always reach
 * the right stub.
 */
export async function spyAcceptInvite(
    page: Page,
    { status = 201, delayMs }: { status?: number; delayMs?: number } = {}
): Promise<AcceptInviteSpy> {
    let count = 0;
    const bodies: Record<string, unknown>[] = [];

    await page.route('**/api/auth/invite/accept', async (route) => {
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
