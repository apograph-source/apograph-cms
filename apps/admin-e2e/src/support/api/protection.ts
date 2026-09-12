import type { Page } from '@playwright/test';

/** One approval, as `GET /api/protection/entries/:type/:id` returns it. */
export type ApprovalSeed = {
    userId: string;
    revisionId?: string;
    revisionNumber?: number | null;
    isStale?: boolean;
    createdAt?: string;
};

/** A verdict for a version not yet written, as the protection routes return it. */
export type PublishOutlookSeed = {
    required?: number;
    given?: number;
    blocked?: boolean;
    bypassable?: boolean;
};

/** One entry's review state, as the same route returns it. */
export type EntryReviewSeed = {
    protected?: boolean;
    required?: number;
    given?: number;
    stale?: number;
    blocked?: boolean;
    bypassable?: boolean;
    headRevisionId?: string;
    headRevisionNumber?: number;
    callerWroteHead?: boolean;
    callerApprovedHead?: boolean;
    /**
     * The verdict a save by the caller would meet. Defaults to what the default
     * rule gives: every approval off the new head, so held whenever a rule is.
     */
    afterSave?: PublishOutlookSeed;
    approvals?: ApprovalSeed[];
    request?: {
        id: string;
        requestedBy: string;
        reviewerIds: string[];
        revisionId: string;
        createdAt: string;
    } | null;
    /** Who `GET …/reviewers` offers the request dialog. */
    candidates?: { userId: string; email: string }[];
};

/** What the review routes were sent — the request dialog's POST, above all. */
export type CapturedReviewWrite = {
    method: string;
    /** The route's last segment: `request`, `approve`, … */
    action: string;
    body: unknown;
};

/** An unprotected type — the state every installation is in until a rule exists. */
export const UNPROTECTED: EntryReviewSeed = {
    protected: false,
    required: 0,
    given: 0,
    blocked: false,
    bypassable: false,
    afterSave: { required: 0, given: 0, blocked: false, bypassable: false }
};

/**
 * Serves one entry's review state, its reviewer candidates, and the write
 * routes — and returns every write it answered.
 *
 * Every field has a default so a test states only what it is about; the
 * defaults describe a **protected, unreviewed** entry, because that is the
 * state the interface has the most to say about.
 */
export async function mockEntryReview(
    page: Page,
    seed: EntryReviewSeed = {}
): Promise<CapturedReviewWrite[]> {
    const writes: CapturedReviewWrite[] = [];
    const isProtected = seed.protected ?? true;
    const required = seed.required ?? 2;
    const bypassable = seed.bypassable ?? false;
    const body = {
        protected: isProtected,
        required,
        given: seed.given ?? 0,
        stale: seed.stale ?? 0,
        blocked: seed.blocked ?? true,
        bypassable,
        afterSave: {
            required: seed.afterSave?.required ?? required,
            given: seed.afterSave?.given ?? 0,
            blocked: seed.afterSave?.blocked ?? (isProtected && required > 0),
            bypassable: seed.afterSave?.bypassable ?? bypassable
        },
        headRevisionId: seed.headRevisionId ?? 'rev-7',
        headRevisionNumber: seed.headRevisionNumber ?? 7,
        callerWroteHead: seed.callerWroteHead ?? false,
        callerApprovedHead: seed.callerApprovedHead ?? false,
        approvals: (seed.approvals ?? []).map((vote) => ({
            userId: vote.userId,
            revisionId: vote.revisionId ?? 'rev-7',
            revisionNumber: vote.revisionNumber ?? 7,
            isStale: vote.isStale ?? false,
            createdAt: vote.createdAt ?? '2026-09-09T09:00:00.000Z'
        })),
        request: seed.request ?? null
    };

    await page.route('**/api/protection/entries/**', async (route) => {
        const request = route.request();
        const action = new URL(request.url()).pathname.split('/').pop() ?? '';
        if (request.method() !== 'GET') {
            let sent: unknown = null;
            try {
                sent = request.postDataJSON();
            } catch {
                sent = null;
            }
            writes.push({ method: request.method(), action, body: sent });
            await route.fulfill({ status: 204, body: '' });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                action === 'reviewers'
                    ? { candidates: seed.candidates ?? [] }
                    : body
            )
        });
    });

    return writes;
}

/**
 * Serves `GET /api/protection/types/:type` — what a new entry would meet, the
 * create form's read. Defaults describe a protected type an ordinary member may
 * not publish past, for the reason {@link mockEntryReview}'s do.
 */
export async function mockNewEntryProtection(
    page: Page,
    seed: PublishOutlookSeed & { protected?: boolean } = {}
): Promise<void> {
    const isProtected = seed.protected ?? true;
    const required = seed.required ?? (isProtected ? 2 : 0);
    const body = {
        protected: isProtected,
        required,
        given: seed.given ?? 0,
        blocked: seed.blocked ?? (isProtected && required > 0),
        bypassable: seed.bypassable ?? false
    };
    await page.route('**/api/protection/types/*', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body)
        });
    });
}

/** One stored rule, as `GET /api/protection/rules` returns it. */
export type ProtectionRuleSeed = {
    id?: string;
    kind?: string;
    slug: string;
    enabled?: boolean;
    requiredApprovals?: number;
    requireOtherPerson?: boolean;
    countStaleApprovals?: boolean;
    adminBypass?: boolean;
    allowTokenPublish?: boolean;
};

/** What a captured `PUT /api/protection/rules/:kind/:slug` carried. */
export type CapturedRuleWrite = {
    /** The `:kind/:slug` the write addressed. */
    path: string;
    /** The body, as sent. */
    body: Record<string, unknown>;
};

/**
 * Serves the workspace's rule list and captures every write.
 *
 * The returned array is filled as the page saves, so a test can assert on
 * **what was sent** rather than only on what the screen did — which is the only
 * way to pin that the editor submits all six fields, since a partial body would
 * look identical in the browser and silently reset the rest server-side.
 */
export async function mockProtectionRules(
    page: Page,
    rules: ProtectionRuleSeed[] = [],
    { status = 200 }: { status?: number } = {}
): Promise<CapturedRuleWrite[]> {
    const writes: CapturedRuleWrite[] = [];
    const body = rules.map((rule) => ({
        id: rule.id ?? `rule-${rule.slug}`,
        kind: rule.kind ?? 'collection',
        slug: rule.slug,
        enabled: rule.enabled ?? true,
        requiredApprovals: rule.requiredApprovals ?? 2,
        requireOtherPerson: rule.requireOtherPerson ?? true,
        countStaleApprovals: rule.countStaleApprovals ?? false,
        adminBypass: rule.adminBypass ?? true,
        allowTokenPublish: rule.allowTokenPublish ?? false
    }));

    await page.route('**/api/protection/rules**', async (route) => {
        const request = route.request();
        if (request.method() === 'GET') {
            await route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(status === 200 ? body : { message: 'no' })
            });
            return;
        }
        if (request.method() === 'PUT') {
            writes.push({
                path: new URL(request.url()).pathname.split('/rules/')[1] ?? '',
                body: request.postDataJSON() as Record<string, unknown>
            });
            await route.fulfill({ status: 200, body: '{}' });
            return;
        }
        await route.fulfill({ status: 204, body: '' });
    });

    return writes;
}

/** One line of the reviewer queue, as `GET /api/protection/queue` returns it. */
export type ReviewQueueSeed = {
    id: string;
    contentType?: string;
    entryId?: string;
    /** Who asked. Match the signed-in user's id to land it in "My requests". */
    requestedBy: string;
    /** Who was asked. Include the signed-in user's id to land it in "Waiting on me". */
    reviewerIds?: string[];
    required?: number;
    given?: number;
    /** ISO-8601. Defaults to now, so a seed is "fresh" unless it says otherwise. */
    createdAt?: string;
};

/** `createdAt` for an ask opened `days` ago — the age column's input. */
export function daysAgo(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Serves the reviewer queue.
 *
 * One route for both tabs, because the page fetches one window and splits it
 * client-side — so a seed is a single list and the tabs are two views of it.
 * Pass `status` to exercise the failed-read state, which the page must keep
 * distinct from an empty one.
 */
export async function mockReviewQueue(
    page: Page,
    items: ReviewQueueSeed[] = [],
    options: { status?: number; overdueAfterDays?: number } = {}
): Promise<void> {
    await page.route('**/api/protection/queue*', async (route) => {
        if (options.status && options.status >= 400) {
            await route.fulfill({
                status: options.status,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Queue unavailable' })
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                items: items.map((item) => ({
                    id: item.id,
                    contentType: item.contentType ?? 'blog_post',
                    entryId: item.entryId ?? `entry-${item.id}`,
                    requestedBy: item.requestedBy,
                    reviewerIds: item.reviewerIds ?? [],
                    required: item.required ?? 2,
                    given: item.given ?? 0,
                    createdAt: item.createdAt ?? new Date().toISOString()
                })),
                total: items.length,
                // The server's own cut, which the queue takes off the wire
                // rather than restating — a mock that left it out would make
                // every age compare against `undefined` and quietly never read
                // as overdue.
                overdueAfterDays: options.overdueAfterDays ?? 3
            })
        });
    });
}

/** One entry's row in the records column, as the batched read returns it. */
export type ReviewStatusSeed = {
    protected?: boolean;
    required?: number;
    given?: number;
    stale?: number;
    requested?: boolean;
    blocked?: boolean;
};

/** What {@link mockReviewStatusByEntry} records about the calls it answered. */
export interface ReviewStatusRecorder {
    /**
     * The `ids` query parameter of every batched read, in order.
     *
     * The assertion this exists for is a **negative** one: while the column is
     * switched off nothing may be requested at all, and no pixel on screen
     * would say whether it was. `[]` is the interesting value.
     */
    requests: string[];
}

/**
 * Serves the records column's batched read, and records what it was asked.
 *
 * **Register this after {@link mockEntryReview}.** That one claims the whole
 * `api/protection/entries` subtree, which also matches
 * `…/entries/:type/status`, and `page.route` matching runs in reverse
 * registration order — so the general pattern registered second would swallow
 * this one and the column would render an entry's panel payload.
 */
export async function mockReviewStatusByEntry(
    page: Page,
    byEntry: Record<string, ReviewStatusSeed> = {},
    options: { status?: number } = {}
): Promise<ReviewStatusRecorder> {
    const recorder: ReviewStatusRecorder = { requests: [] };

    await page.route(
        '**/api/protection/entries/*/status*',
        async (route, request) => {
            recorder.requests.push(
                new URL(request.url()).searchParams.get('ids') ?? ''
            );

            if (options.status && options.status >= 400) {
                await route.fulfill({
                    status: options.status,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        message: 'Review state unavailable'
                    })
                });
                return;
            }

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    byEntry: Object.fromEntries(
                        Object.entries(byEntry).map(([id, seed]) => [
                            id,
                            {
                                protected: seed.protected ?? true,
                                required: seed.required ?? 2,
                                given: seed.given ?? 0,
                                stale: seed.stale ?? 0,
                                requested: seed.requested ?? false,
                                blocked:
                                    seed.blocked ??
                                    (seed.given ?? 0) < (seed.required ?? 2)
                            }
                        ])
                    )
                })
            });
        }
    );

    return recorder;
}

/** Serves the Insights card's two figures. */
export async function mockProtectionInsights(
    page: Page,
    view: { open?: number; overdue?: number; overdueAfterDays?: number } = {}
): Promise<void> {
    await page.route('**/api/insights/protection/reviews*', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                open: view.open ?? 0,
                overdue: view.overdue ?? 0,
                overdueAfterDays: view.overdueAfterDays ?? 3
            })
        });
    });
}
