import { type Page } from '@playwright/test';

/** A thread as `GET /api/copilot/conversations` returns it. */
export interface CopilotConversationView {
    id: string;
    title: string | null;
    surface: string;
    archived: boolean;
    /**
     * The model the thread was last left on: `null` when nobody has picked one,
     * `'default'` for the host's resolver, else `'<provider>:<model>'`. The
     * three states are distinct on purpose — see the seed below.
     */
    modelChoice: string | null;
    createdAt: string;
    updatedAt: string;
}

/** One turn, as the transcript route serves it (the model port's blocks). */
interface PersistedMessage {
    id: string;
    runId: string;
    role: 'user' | 'assistant';
    content: unknown[];
    /** Files attached to a user turn; null otherwise. Its own column server-side. */
    attachments?: unknown[] | null;
    /** Skills in force for a user turn; null otherwise. Its own column too. */
    skills?: { name: string; title: string; source: 'code' | 'cms' }[] | null;
    stopReason: string | null;
}

/** One skill as `GET /api/copilot/skills` returns it — never with its body. */
export interface CopilotSkillView {
    id: string | null;
    name: string;
    title: string;
    description: string;
    mode: 'manual' | 'always';
    source: 'code' | 'cms';
    enabled: boolean;
    editable: boolean;
}

/**
 * The catalogue the picker renders: one code skill, one workspace skill, and
 * one that is **always on**.
 *
 * Three because the picker treats them differently — a code skill is badged and
 * read-only, an always-on one is listed but not toggleable, and only the third
 * is something a person can actually stage.
 */
function seedSkills(): CopilotSkillView[] {
    return [
        {
            id: null,
            name: 'house-style',
            title: 'House style',
            description: 'How we write product copy.',
            mode: 'always',
            source: 'code',
            enabled: true,
            editable: false
        },
        {
            id: null,
            name: 'seo-checklist',
            title: 'SEO checklist',
            description: 'What to check before publishing.',
            mode: 'manual',
            source: 'code',
            enabled: true,
            editable: false
        },
        {
            id: 'sk_tone',
            name: 'tone-of-voice',
            title: 'Tone of voice',
            description: 'Warm, direct, never breathless.',
            mode: 'manual',
            source: 'cms',
            enabled: true,
            editable: true
        }
    ];
}

/**
 * A thread whose first turn carried a file, so a spec can prove a **reopened**
 * conversation redraws its chips. The attachment lives on the row rather than
 * inside `content`, which is exactly what makes that possible.
 */
const ATTACHED_TRANSCRIPT: PersistedMessage[] = [
    {
        id: 'ma1',
        runId: 'ra1',
        role: 'user',
        content: [{ type: 'text', text: 'What does this brief say?' }],
        attachments: [
            {
                assetId: '44444444-4444-4444-8444-000000000001',
                name: 'brief.md',
                mimeType: 'text/markdown',
                kind: 'document',
                size: 128,
                readable: true
            }
        ],
        stopReason: null
    },
    {
        id: 'ma2',
        runId: 'ra1',
        role: 'assistant',
        content: [{ type: 'text', text: 'It asks for a Q3 launch plan.' }],
        attachments: null,
        stopReason: null
    }
];

/** What a test can assert about the calls the app made. */
export interface CopilotSpy {
    /** Every `PATCH /conversations/:id` body, in order. */
    readonly patches: { id: string; body: Record<string, unknown> }[];
    /** Every `POST /runs` body, in order. */
    readonly runs: Record<string, unknown>[];
    /** The mock's current threads — mutated by PATCH, like the real table. */
    readonly conversations: CopilotConversationView[];
    /** The mock's current skills — mutated by the write routes. */
    readonly skills: CopilotSkillView[];
    /** Every skill write, in order: the method, the id, and the body sent. */
    readonly skillWrites: {
        method: string;
        id: string | null;
        body: Record<string, unknown>;
    }[];
}

/**
 * Local **noon**, `days` calendar days ago.
 *
 * The rail buckets threads by calendar day, so a seed measured in elapsed hours
 * lands in a different group depending on what time the suite runs — "two hours
 * ago" is *yesterday* at 01:00. Anchoring each row to the middle of its own day
 * makes "today", "yesterday" and "previous 7 days" the same answer at every
 * clock time, without freezing the browser's own clock.
 */
function daysAgo(days: number): string {
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    noon.setDate(noon.getDate() - days);
    return noon.toISOString();
}

/**
 * Threads dated **relative to today**, because a fixed ISO string would drift
 * into the wrong bucket the day after it was written and take the group
 * assertions with it.
 */
function seedConversations(): CopilotConversationView[] {
    const row = (
        id: string,
        title: string | null,
        days: number,
        archived = false,
        modelChoice: string | null = null
    ): CopilotConversationView => ({
        id,
        title,
        surface: 'chat',
        archived,
        modelChoice,
        createdAt: daysAgo(days),
        updatedAt: daysAgo(days)
    });

    return [
        // No stored model: nobody has picked on this thread, so opening it must
        // leave the picker on whatever the tab's own last pick seeded.
        row('c_summary', 'Which articles are missing a summary?', 0),
        row('c_attached', 'What does this brief say?', 0),
        // Left on a concrete backend — the thread the "reopening restores the
        // model" case opens.
        row(
            'c_pricing',
            'Rewrite the pricing page intro',
            0,
            false,
            'openai:gpt-5.2'
        ),
        // Untitled, so the filter's "an untitled thread matches nothing" rule
        // has something to drop.
        row('c_untitled', null, 1),
        row('c_translate', 'Translate the launch post into German', 3),
        // Explicitly **Default**, which is a choice rather than the absence of
        // one — the third state, and the one that is easy to collapse into
        // "unset" by accident.
        row(
            'c_bios',
            'Audit author bios for broken links',
            5,
            false,
            'default'
        ),
        row('c_notes', 'Draft release notes for 2.4', 12),
        row('c_authors', 'Which entries have no author linked?', 40)
    ];
}

/**
 * The transcript of `c_summary`: prose, the call that changed something, then
 * the sentence written **after** the change.
 *
 * Shaped that way on purpose — it is the fixture the transcript-ordering
 * assertions read, and the bug they guard against was a change card rendering
 * below text that was written before it.
 */
const SUMMARY_TRANSCRIPT: PersistedMessage[] = [
    {
        id: 'm1',
        runId: 'r1',
        role: 'user',
        content: [{ type: 'text', text: 'Which articles have no summary?' }],
        // On the row rather than inside `content`, which is what lets a
        // reopened thread redraw the chips — the same property the attachment
        // fixture above exists to prove.
        skills: [
            { name: 'house-style', title: 'House style', source: 'code' },
            { name: 'tone-of-voice', title: 'Tone of voice', source: 'cms' }
        ],
        stopReason: null
    },
    {
        id: 'm2',
        runId: 'r1',
        role: 'assistant',
        content: [
            { type: 'text', text: 'Checking the published articles.' },
            {
                type: 'tool_use',
                id: 'call_search',
                name: 'admin_content_search',
                input: { contentType: 'article' }
            }
        ],
        stopReason: null
    },
    {
        id: 'm3',
        runId: 'r1',
        role: 'user',
        content: [
            {
                type: 'tool_result',
                toolUseId: 'call_search',
                content: '3 results',
                isError: false
            }
        ],
        stopReason: null
    },
    {
        id: 'm4',
        runId: 'r1',
        role: 'assistant',
        content: [
            {
                type: 'text',
                text: 'Three have none. I wrote one for the most read.'
            },
            {
                type: 'tool_use',
                id: 'call_update',
                name: 'content_propose_update',
                input: { contentType: 'article', id: 'e42' }
            },
            { type: 'text', text: 'That change is saved and published.' }
        ],
        stopReason: 'end'
    },
    {
        id: 'm5',
        runId: 'r1',
        role: 'user',
        content: [
            {
                type: 'tool_result',
                toolUseId: 'call_update',
                content: 'Applied',
                isError: false
            }
        ],
        stopReason: null
    }
];

/** The change `c_summary` made — joined to its call by `toolCallId`. */
const SUMMARY_PROPOSALS = [
    {
        id: 'p_summary',
        toolCallId: 'call_update',
        toolName: 'content_propose_update',
        kind: 'content.entry.update',
        summary: 'Set a summary on “Designing for editors”',
        target: { contentType: 'article', id: 'e42' },
        changes: [
            {
                field: 'summary',
                label: 'Summary',
                before: '',
                after: 'What changes when you treat editing as the product.'
            }
        ],
        status: 'accepted',
        result: { entityId: 'e42' },
        error: null
    }
];

/**
 * One SSE frame, as the run route writes it.
 *
 * Exported so a test can script a run the default one does not cover — a
 * truncating stop reason, a failed tool call, a table in the answer — without a
 * new boolean option on {@link CopilotMockOptions} per case.
 */
export const frame = (event: Record<string, unknown>) =>
    `data: ${JSON.stringify(event)}\n\n`;

/**
 * A scripted run: prose, a tool call, the change it made, then more prose.
 *
 * The **same shape** as the stored transcript above, so the live path and the
 * reopened path are asserted against one expectation.
 */
function runBody(conversationId: string): string {
    return [
        frame({ type: 'run-started', runId: 'r_live', conversationId }),
        frame({
            type: 'text-delta',
            text: 'Setting the summary on that article. '
        }),
        frame({
            type: 'tool-call',
            id: 'call_live',
            name: 'content_propose_update',
            input: { contentType: 'article', id: 'e42' }
        }),
        frame({
            type: 'tool-result',
            id: 'call_live',
            ok: true,
            summary: 'Applied',
            durationMs: 41
        }),
        frame({
            type: 'proposal',
            id: 'p_live',
            toolCallId: 'call_live',
            toolName: 'content_propose_update',
            kind: 'content.entry.update',
            summary: 'Set a summary on “Designing for editors”',
            target: { contentType: 'article', id: 'e42' },
            changes: [
                {
                    field: 'summary',
                    label: 'Summary',
                    before: '',
                    after: 'A short summary.'
                }
            ],
            status: 'accepted',
            entityId: 'e42'
        }),
        frame({ type: 'text-delta', text: 'Afterwards: the change is saved.' }),
        frame({ type: 'done', messageId: 'm_live', stopReason: 'end' })
    ].join('');
}

/**
 * A run whose change **did not apply** — the receipt nobody wants to read.
 *
 * Pass it as `runBody`. The proposal lands `pending`, which since ADR-0009
 * means the apply failed, and carries the server's own reason — which is what
 * the card's alert renders. Shared between the transcript suite and the axe
 * scan so both are looking at one fixture.
 *
 * The tool input carries a `summary` because that is the shape the real
 * `propose` tools take: their schema asks the model to write one line for a
 * person, and the step list shows it as the call's subject.
 */
export function failedProposalRun(conversationId: string): string {
    return failedRun(conversationId, SHORT_FAILURE_REASON);
}

/** The one-line reason {@link failedProposalRun} sends. */
export const SHORT_FAILURE_REASON =
    'No translation group “prescribing-information” on tag.';

/**
 * A reason long enough to **overflow the card's bound**, not merely long.
 *
 * The transcript's column is capped at `max-w-3xl`, so a reason of a few
 * hundred characters is still only three or four lines there and would prove
 * nothing about a 14rem ceiling. A server that refuses a translation
 * field-by-field produces exactly this shape — one sentence per field — and
 * twenty of them clear the bound at any viewport the column can reach.
 */
export const LONG_FAILURE_REASON = [
    SHORT_FAILURE_REASON,
    ...Array.from(
        { length: 20 },
        (_, index) =>
            `Field “section_${index + 1}” has no German counterpart in that group, so it was left exactly as it was.`
    )
].join(' ');

/**
 * The same failed run, with a reason that does not fit.
 *
 * Pass it as `runBody`. Deliberately the *same* proposal otherwise — the diff
 * and the status badge the long-reason spec asserts are still on screen are the
 * ones the short-reason spec reads.
 */
export function longFailedProposalRun(conversationId: string): string {
    return failedRun(conversationId, LONG_FAILURE_REASON);
}

/** The failed run's frames, over whichever reason the server is said to send. */
function failedRun(conversationId: string, reason: string): string {
    return [
        frame({ type: 'run-started', runId: 'r_fail', conversationId }),
        frame({
            type: 'tool-call',
            id: 'call_fail',
            name: 'i18n_propose_translation',
            input: {
                typeName: 'article',
                id: 'e42',
                locale: 'de',
                summary: 'German translation of Prescribing Information'
            }
        }),
        frame({
            type: 'tool-result',
            id: 'call_fail',
            ok: false,
            summary: 'failed: add the translation',
            error: reason,
            durationMs: 9
        }),
        frame({
            type: 'proposal',
            id: 'p_fail',
            toolCallId: 'call_fail',
            toolName: 'i18n_propose_translation',
            kind: 'i18n.translation.create',
            summary: 'German translation of Prescribing Information',
            target: { typeName: 'article', id: 'e42', locale: 'de' },
            changes: [
                {
                    field: 'name',
                    label: 'Name',
                    after: 'Fachinformation'
                }
            ],
            status: 'pending',
            error: reason
        }),
        frame({ type: 'done', messageId: 'm_fail', stopReason: 'end' })
    ].join('');
}

/** How the mock should behave, for the error and empty paths. */
export interface CopilotMockOptions {
    /** Start with no threads, for the rail's empty state. */
    empty?: boolean;
    /** Fail the thread list, for "error is not empty". */
    listStatus?: number;
    /** Fail `PATCH`, for the rename/archive failure paths. */
    patchStatus?: number;
    /** Fail the transcript fetch, for the thread-open error state. */
    detailStatus?: number;
    /** Models the picker offers. Two or more, or the picker hides itself. */
    models?: { provider: string; model: string }[];
    /**
     * Skills the workspace offers. Pass `[]` for the case where the composer
     * shows no skills control at all.
     */
    skills?: CopilotSkillView[];
    /** Fail every skill write, for the "the server refused" path. */
    skillWriteStatus?: number;
    /** The message a refused write comes back with. */
    skillWriteMessage?: string;
    /** Hold the run open this long before answering. */
    runDelayMs?: number;
    /**
     * Replaces the scripted run body. Compose one with {@link frame}; the
     * default is prose → tool call → change card → prose, ending `end`.
     */
    runBody?(conversationId: string): string;
}

/**
 * Stubs every copilot endpoint the admin calls, and keeps the thread list in
 * memory so a `PATCH` is visible to the next `GET` — the front-end analog of the
 * server suite's table. Returns a spy for asserting what the app sent.
 *
 * **The run route is fulfilled as `text/event-stream`.** The package notes said
 * that could not be done and therefore that the chat was untestable here; it can
 * — the whole body arrives in one read, so what is lost is only the *progressive*
 * arrival of frames, not the transcript they produce. Everything about a
 * finished turn — its text, its steps, the change card, and crucially their
 * **order** — is assertable. Only "watch it type" is not.
 */
export async function mockCopilotApi(
    page: Page,
    options: CopilotMockOptions = {}
): Promise<CopilotSpy> {
    const spy: CopilotSpy = {
        patches: [],
        runs: [],
        conversations: options.empty ? [] : seedConversations(),
        skills: options.skills ?? seedSkills(),
        skillWrites: []
    };

    const models = options.models ?? [
        { provider: 'anthropic', model: 'claude-sonnet-5' },
        { provider: 'anthropic', model: 'claude-opus-5' },
        { provider: 'openai', model: 'gpt-5.2' }
    ];

    const json = (body: unknown, status = 200) => ({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body)
    });

    await page.route('**/api/copilot/models', (route) =>
        route.fulfill(json({ items: models }))
    );

    // The two skill patterns are deliberately disjoint, for the same reason the
    // conversation ones are: a glob `*` does not cross a `/`, so `skills` below
    // sees only the bare collection and never `skills/manage` or `skills/:id`.
    await page.route('**/api/copilot/skills/*', async (route) => {
        const id = new URL(route.request().url()).pathname.split('/').pop();
        const method = route.request().method();

        // The admin's own listing — code skills and disabled rows included.
        if (id === 'manage' && method === 'GET') {
            return route.fulfill(json(spy.skills));
        }

        const skill = spy.skills.find((row) => row.id === id);
        if (method === 'GET') {
            return skill
                ? route.fulfill(
                      json({
                          ...skill,
                          instructions: 'Warm, direct, never breathless.',
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString()
                      })
                  )
                : route.fulfill(json({ message: 'Skill not found.' }, 404));
        }

        const body = (
            method === 'DELETE'
                ? {}
                : JSON.parse(route.request().postData() ?? '{}')
        ) as Record<string, unknown>;
        spy.skillWrites.push({ method, id: id ?? null, body });

        if (options.skillWriteStatus) {
            return route.fulfill(
                json(
                    { message: options.skillWriteMessage ?? 'Refused.' },
                    options.skillWriteStatus
                )
            );
        }
        if (!skill) {
            return route.fulfill(json({ message: 'Skill not found.' }, 404));
        }
        if (method === 'DELETE') {
            spy.skills.splice(spy.skills.indexOf(skill), 1);
            return route.fulfill({ status: 204, body: '' });
        }
        Object.assign(skill, body);
        return route.fulfill(json(skill));
    });

    await page.route('**/api/copilot/skills', async (route) => {
        if (route.request().method() === 'POST') {
            const body = JSON.parse(
                route.request().postData() ?? '{}'
            ) as Record<string, unknown>;
            spy.skillWrites.push({ method: 'POST', id: null, body });
            if (options.skillWriteStatus) {
                return route.fulfill(
                    json(
                        { message: options.skillWriteMessage ?? 'Refused.' },
                        options.skillWriteStatus
                    )
                );
            }
            const created: CopilotSkillView = {
                id: `sk_${spy.skills.length + 1}`,
                name: String(body['name'] ?? ''),
                title: String(body['title'] ?? ''),
                description: String(body['description'] ?? ''),
                mode: body['mode'] === 'always' ? 'always' : 'manual',
                source: 'cms',
                enabled: body['enabled'] !== false,
                editable: true
            };
            spy.skills.push(created);
            return route.fulfill(json(created, 201));
        }
        // The picker's catalogue: enabled rows only, and never a body.
        return route.fulfill(json(spy.skills.filter((skill) => skill.enabled)));
    });

    await page.route('**/api/copilot/proposals*', (route) => {
        const id = new URL(route.request().url()).searchParams.get(
            'conversationId'
        );
        return route.fulfill(
            json({ items: id === 'c_summary' ? SUMMARY_PROPOSALS : [] })
        );
    });

    await page.route('**/api/copilot/runs', async (route) => {
        spy.runs.push(
            JSON.parse(route.request().postData() ?? '{}') as Record<
                string,
                unknown
            >
        );
        if (options.runDelayMs) {
            await new Promise((r) => setTimeout(r, options.runDelayMs));
        }
        // The thread the run creates, so the rail lists it afterwards — the
        // real server does the same, deriving a title from the first message.
        if (!spy.conversations.some((row) => row.id === 'c_new')) {
            const now = new Date().toISOString();
            spy.conversations.unshift({
                id: 'c_new',
                title: 'Set the summary please',
                surface: 'chat',
                archived: false,
                // A fresh thread has recorded nothing: the run route does not
                // write the choice, the client does — and only for a model
                // somebody actually picked for this chat.
                modelChoice: null,
                createdAt: now,
                updatedAt: now
            });
        }
        try {
            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: (options.runBody ?? runBody)('c_new')
            });
        } catch {
            // Stop cancels the `fetch` while a delayed run is still being held
            // open here, so by the time this resolves there is nothing left to
            // answer. That is the feature working, not a failure — and letting
            // it reject would surface as an unhandled rejection in the runner.
        }
    });

    // Registered before the list route, and the two patterns are deliberately
    // disjoint: Playwright matches the **last** registered route first, and a
    // glob `*` does not cross a `/` — so `conversations*` below sees the list
    // (with or without its query string) and never `conversations/:id`.
    await page.route('**/api/copilot/conversations/*', async (route) => {
        const id = new URL(route.request().url()).pathname.split('/').pop();
        const conversation = spy.conversations.find((row) => row.id === id);

        if (route.request().method() === 'PATCH') {
            const body = JSON.parse(
                route.request().postData() ?? '{}'
            ) as Record<string, unknown>;
            spy.patches.push({ id: id ?? '', body });
            if (options.patchStatus) {
                return route.fulfill(
                    json({ message: 'Nope' }, options.patchStatus)
                );
            }
            if (!conversation) {
                return route.fulfill(json({ message: 'Not found' }, 404));
            }
            if (typeof body.title === 'string') {
                conversation.title = body.title.trim();
            }
            if (typeof body.archived === 'boolean') {
                conversation.archived = body.archived;
            }
            // Like the real column: written when the person picks, never
            // cleared, and never a reason to bump `updatedAt`.
            if (typeof body.modelChoice === 'string') {
                conversation.modelChoice = body.modelChoice;
            }
            return route.fulfill(json(conversation));
        }

        if (options.detailStatus) {
            return route.fulfill(
                json({ message: 'Gone' }, options.detailStatus)
            );
        }
        if (!conversation) {
            return route.fulfill(json({ message: 'Not found' }, 404));
        }
        return route.fulfill(
            json({
                conversation,
                messages:
                    id === 'c_summary'
                        ? SUMMARY_TRANSCRIPT
                        : id === 'c_attached'
                          ? ATTACHED_TRANSCRIPT
                          : []
            })
        );
    });

    await page.route('**/api/copilot/conversations*', (route) => {
        if (options.listStatus) {
            return route.fulfill(json({ message: 'Boom' }, options.listStatus));
        }
        const archived =
            new URL(route.request().url()).searchParams.get('archived') ===
            'true';
        return route.fulfill(
            json({
                items: spy.conversations.filter(
                    (row) => row.archived === archived
                )
            })
        );
    });

    return spy;
}
