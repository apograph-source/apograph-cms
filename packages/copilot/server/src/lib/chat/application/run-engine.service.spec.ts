import {
    abortedEvent,
    type AttachmentResolver,
    type CopilotRunEvent,
    type RunLimits,
    type ModelProvider,
    type ModelRequest,
    type ModelStreamEvent,
    type Skill
} from '@orthacms/copilot-domain';
import type { ToolDefinition, ToolRegistry } from '@orthacms/tools-server';
import { buildModelRegistry } from '../../infrastructure/model-registry';
import type { CopilotPluginConfig } from '../../types/copilot-config';
import type {
    ConversationRepository,
    MessageView
} from '../infrastructure/persistence/conversation.repository';
import type { ProposalRepository } from '../infrastructure/persistence/proposal.repository';
import type { SkillCatalogService } from '../../skills/application/skill-catalog.service';
import type { CapabilityProfileService } from './capability-profile.service';
import type { DecideProposalService } from './decide-proposal.service';
import { RunEngine, type StartRunInput } from './run-engine.service';
import type { ToolPermissionBroker } from './tool-permission.broker';

/**
 * The engine is an async generator, which is what makes these tests possible
 * without a socket: a test drives it with `next()` and sees exactly what the
 * SSE controller would write, in the order it would write it.
 *
 * Two things about the loop are only observable from here. **Streaming** is a
 * timing property — a buffered implementation produces the same frames in the
 * same order, just all at once at the end — so it needs a provider that stops
 * mid-answer and a consumer that reads before it is allowed to continue. And
 * the **persist-on-abort** branch needs a run that ends badly, which no e2e in
 * the suite drives: nothing there cancels a run or makes a provider throw.
 */

/** A `propose` tool: its return value IS the change the engine records. */
const PROPOSE_TOOL = {
    name: 'fixture_propose',
    title: 'Propose a fixture change',
    description: 'Drafts something.',
    inputSchema: { type: 'object', properties: {} },
    requires: [],
    readOnly: false,
    effect: 'propose',
    handler: async () => DRAFT
} as unknown as ToolDefinition;

/** An `apply` tool: it does its own writing and hands back a result. */
const APPLY_TOOL = {
    name: 'fixture_apply',
    title: 'Apply a fixture change',
    description: 'Writes something.',
    inputSchema: { type: 'object', properties: {} },
    requires: [],
    readOnly: false,
    effect: 'apply',
    handler: async () => ({ ok: true })
} as unknown as ToolDefinition;

/** What a `propose` tool returns — the shape `isProposalDraft` accepts. */
const DRAFT = {
    kind: 'fixture.thing.update',
    summary: 'Change the thing',
    target: { id: 'thing-1' },
    patch: { text: 'New' }
};

/** A read-only tool, the only thing the profile offers in these runs. */
const READ_TOOL = {
    name: 'fixture_read',
    title: 'Read a fixture',
    description: 'Reads something.',
    inputSchema: { type: 'object', properties: {} },
    requires: [],
    readOnly: true,
    effect: 'read',
    handler: async () => ({ ok: true })
} as unknown as ToolDefinition;

/** A promise the test resolves by hand, to hold a provider mid-stream. */
function gate() {
    let open!: () => void;
    const closed = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { closed, open };
}

/** The model requests a provider actually received. */
type Seen = ModelRequest[];

/** A provider whose stream is whatever the test scripts. */
function fakeProvider(
    script: (
        request: ModelRequest,
        signal?: AbortSignal
    ) => AsyncIterable<ModelStreamEvent>
): { provider: ModelProvider; seen: Seen } {
    const seen: Seen = [];
    return {
        seen,
        provider: {
            models: () => ['fixture-model'],
            capabilities: async () => ({
                streaming: true,
                tools: true,
                maxOutputTokens: 1024
            }),
            stream(request: ModelRequest, signal?: AbortSignal) {
                seen.push(request);
                return script(request, signal);
            }
        } as unknown as ModelProvider
    };
}

/** The transcript, in memory, with every write recorded in order. */
function fakeConversations() {
    const rows: MessageView[] = [];
    /** What each `appendMessage` was handed, serialised at the moment of the call. */
    const written: string[] = [];
    const appendMessage = jest.fn(
        async (
            input: Parameters<ConversationRepository['appendMessage']>[0]
        ) => {
            written.push(JSON.stringify(input));
            const row: MessageView = {
                id: `message-${rows.length + 1}`,
                runId: input.runId,
                role: input.role,
                content: input.content,
                attachments: input.attachments ?? null,
                skills: input.skills ?? null,
                model: input.model ?? null,
                provider: input.provider ?? null,
                stopReason: input.stopReason ?? null,
                position: rows.length + 1,
                createdAt: new Date()
            };
            rows.push(row);
            return { id: row.id, position: row.position };
        }
    );
    return {
        rows,
        written,
        appendMessage,
        create: jest.fn(async () => ({ id: 'conversation-1' })),
        findOrFail: jest.fn(),
        update: jest.fn(),
        messages: jest.fn(async () => rows),
        allowedTools: jest.fn(async () => [] as string[]),
        allowTool: jest.fn(),
        recordToolCall: jest.fn()
    };
}

/** The assistant rows the engine wrote, in transcript order. */
const assistantRows = (rows: MessageView[]) =>
    rows.filter((row) => row.role === 'assistant');

interface Harness {
    engine: RunEngine;
    conversations: ReturnType<typeof fakeConversations>;
    seen: Seen;
    /** The shared tool registry, so a test can see whether a call ran. */
    tools: { call: jest.Mock };
    /** The `copilot_proposals` writer, so a test can read what it was handed. */
    proposals: { create: jest.Mock; decide: jest.Mock };
    decisions: { apply: jest.Mock };
}

/**
 * A clock the test moves by hand.
 *
 * The engine measures a run against `Date.now()`, so a ceiling test that waited
 * in real time would either be slow or be a race. Advancing it from inside the
 * provider's script puts the passage of time exactly where it happens in
 * production: while the model is answering.
 */
function fakeClock(start = 1_700_000_000_000) {
    let now = start;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    return {
        advance(ms: number) {
            now += ms;
        }
    };
}

function harness(
    script: (
        request: ModelRequest,
        signal?: AbortSignal
    ) => AsyncIterable<ModelStreamEvent>,
    options: {
        tools?: ToolDefinition[];
        skillsInForce?: Skill[];
        skillsFail?: Error;
        limits?: Partial<RunLimits>;
        /** What the tool registry answers when the engine dispatches a call. */
        toolCall?: (
            name: string,
            input: Record<string, unknown>
        ) => Promise<unknown>;
        /**
         * The tool set the *n*-th capability resolution offers, 1-based.
         *
         * Resolution happens once for the run's offer and again before every
         * tool call (ADR-0005 §3), so this is how a grant is revoked between
         * two calls of one turn — which is the only way to observe an ordering
         * inside `executeTool`.
         */
        profileTools?: (nth: number) => ToolDefinition[];
        /** The media plugin's resolver, or none at all when omitted. */
        attachments?: AttachmentResolver;
        /** How the user answers a parked write. Defaults to allowing it once. */
        decide?: () => Promise<{ decision: string; timedOut: boolean }>;
    } = {}
): Harness {
    const { provider, seen } = fakeProvider(script);
    const conversations = fakeConversations();
    const offered = options.tools ?? [READ_TOOL];
    let resolutions = 0;
    const profiles = {
        resolve: async () => {
            resolutions += 1;
            return {
                profile: {
                    tools: options.profileTools
                        ? options.profileTools(resolutions)
                        : offered,
                    withheld: []
                },
                context: {
                    userId: 'user-1',
                    workspaceId: 'workspace-1',
                    surface: 'copilot'
                }
            };
        }
    };
    const skills = {
        resolveRunSkills: async () => {
            if (options.skillsFail) {
                throw options.skillsFail;
            }
            return {
                available: options.skillsInForce ?? [],
                inForce: options.skillsInForce ?? []
            };
        }
    };
    const tools = {
        call: jest.fn(
            options.toolCall ?? (async () => ({ ok: true }) as unknown)
        )
    };
    const proposals = {
        create: jest.fn(async (input: Record<string, unknown>) => ({
            ...input,
            id: 'proposal-1',
            status: 'pending',
            changes: null,
            result: null,
            error: null,
            decidedBy: null,
            decidedAt: null,
            createdAt: new Date()
        })),
        decide: jest.fn(async (id: string) => ({
            id,
            kind: 'fixture.thing.update',
            summary: 'Change the thing',
            target: { id: 'thing-1' },
            status: 'accepted'
        }))
    };
    const decisions = {
        apply: jest.fn(async (proposal: Record<string, unknown>) => ({
            ok: true,
            proposal: { ...proposal, status: 'accepted' }
        }))
    };
    const permissions = {
        budgetRemaining: jest.fn(() => 300_000),
        ask: jest.fn(
            options.decide ??
                (async () => ({ decision: 'once', timedOut: false }))
        )
    };
    const config: CopilotPluginConfig = {
        enabled: true,
        maxOutputTokens: 1024
    };

    const engine = new RunEngine(
        buildModelRegistry([{ name: 'fixture', provider }]),
        () => 'fixture',
        config,
        profiles as unknown as CapabilityProfileService,
        tools as unknown as ToolRegistry,
        conversations as unknown as ConversationRepository,
        proposals as unknown as ProposalRepository,
        decisions as unknown as DecideProposalService,
        permissions as unknown as ToolPermissionBroker,
        skills as unknown as SkillCatalogService,
        options.attachments ?? null,
        {
            maxSteps: 5,
            wallClockMs: 60_000,
            maxTotalTokens: 100_000,
            ...options.limits
        }
    );

    return { engine, conversations, seen, tools, proposals, decisions };
}

/** What the controller hands the engine. */
function startInput(
    signal: AbortSignal,
    extra: Partial<StartRunInput> = {}
): StartRunInput {
    return {
        userId: 'user-1',
        userEmail: 'editor@example.com',
        roleId: 'role-1',
        workspaceId: 'workspace-1',
        message: 'Say something',
        context: {},
        uiLocale: 'en',
        typeSummaries: [],
        signal,
        ...extra
    };
}

/** A turn that asks for `calls` and then stops. */
function asksFor(
    ...calls: { id: string; name: string; input: Record<string, unknown> }[]
) {
    return async function* (): AsyncIterable<ModelStreamEvent> {
        for (const call of calls) {
            yield { type: 'tool-call', ...call };
        }
        yield {
            type: 'done',
            stopReason: 'tool_use',
            usage: { inputTokens: 1, outputTokens: 1 }
        };
    };
}

/** The `tool-result` frame for one call id. */
const resultFor = (frames: CopilotRunEvent[], id: string) =>
    frames.find(
        (frame) => frame.type === 'tool-result' && frame.id === id
    ) as Extract<CopilotRunEvent, { type: 'tool-result' }>;

/** Drains a run to the end, collecting every frame. */
async function drain(
    events: AsyncGenerator<CopilotRunEvent>
): Promise<CopilotRunEvent[]> {
    const frames: CopilotRunEvent[] = [];
    for await (const event of events) {
        frames.push(event);
    }
    return frames;
}

const STILL_WAITING = Symbol('still waiting');

/** The next frame, or `STILL_WAITING` if it does not arrive promptly. */
async function nextWithin<T>(
    pending: Promise<T>,
    ms = 500
): Promise<T | typeof STILL_WAITING> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<typeof STILL_WAITING>((resolve) => {
        timer = setTimeout(() => resolve(STILL_WAITING), ms);
    });
    return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}

describe('RunEngine streaming', () => {
    /**
     * The invariant is about *when* a delta reaches the client, and the only
     * fixture that can tell the two implementations apart is a provider that
     * has not finished yet: this one emits one delta and then stops dead until
     * the test lets it go. An engine that collected deltas into an array and
     * flushed them after the stream ended would leave the consumer waiting on
     * the same promise the provider is waiting on — which is the deadlock this
     * test times out on.
     */
    it('forwards a delta before the provider has finished the answer [copilot:I-23]', async () => {
        const held = gate();
        const { engine } = harness(async function* () {
            yield { type: 'text-delta', text: 'Once upon ' };
            await held.closed;
            yield { type: 'text-delta', text: 'a time.' };
            yield {
                type: 'done',
                stopReason: 'end',
                usage: { inputTokens: 10, outputTokens: 4 }
            };
        });
        const controller = new AbortController();
        const events = engine.run(startInput(controller.signal));

        expect((await events.next()).value).toMatchObject({
            type: 'run-started'
        });

        // The provider is still parked on `held.closed` — nothing has told it
        // the answer is over, and this frame has to arrive anyway.
        const first = await nextWithin(events.next());
        expect(first).not.toBe(STILL_WAITING);
        expect((first as IteratorResult<CopilotRunEvent>).value).toEqual({
            type: 'text-delta',
            text: 'Once upon '
        });

        held.open();
        const rest = await drain(events);
        expect(rest).toEqual([
            { type: 'text-delta', text: 'a time.' },
            expect.objectContaining({ type: 'done', stopReason: 'end' })
        ]);
    });
});

describe('RunEngine when a run ends badly', () => {
    /**
     * A cancelled run is the ordinary case, not the exotic one: the server
     * treats a closed tab as a cancellation, so anything half-written is
     * everything the user will ever see of that turn. Storing it is what makes
     * "reopen the thread and read what it managed to say" work at all — and
     * `loadHistory` depends on the row being there, because that is where the
     * `aborted` stop reason it replays as an interruption note comes from.
     */
    it('stores the half-finished answer when the client hangs up [copilot:I-25]', async () => {
        const controller = new AbortController();
        const { engine, conversations } = harness(async function* () {
            yield { type: 'text-delta', text: 'I was saying' };
            // The tab closed: the controller aborts, and this adapter surfaces
            // the cancellation by throwing out of the stream.
            controller.abort();
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            throw error;
        });

        const frames = await drain(engine.run(startInput(controller.signal)));

        expect(frames).toContainEqual({
            type: 'done',
            stopReason: 'aborted',
            usage: { inputTokens: 0, outputTokens: 0 },
            messageId: 'message-2'
        });
        // A cancellation is not a failure: nothing is reported to the user.
        expect(frames.some((frame) => frame.type === 'error')).toBe(false);

        expect(assistantRows(conversations.rows)).toEqual([
            expect.objectContaining({
                stopReason: 'aborted',
                content: [{ type: 'text', text: 'I was saying' }]
            })
        ]);
    });

    /**
     * The same, through the *conformant* adapter path: the port's contract is
     * that an abort ends the stream with a `done` rather than throwing, so the
     * loop returns `aborted` without an exception ever being raised. Both
     * routes have to reach the same write, or which adapter is configured
     * decides whether a cancelled turn survives.
     */
    it('stores it when the adapter ends the stream instead of throwing [copilot:I-25]', async () => {
        const controller = new AbortController();
        const { engine, conversations } = harness(async function* () {
            yield { type: 'text-delta', text: 'I was saying' };
            controller.abort();
            yield abortedEvent();
        });

        const frames = await drain(engine.run(startInput(controller.signal)));

        expect(frames).toContainEqual(
            expect.objectContaining({ type: 'done', stopReason: 'aborted' })
        );
        expect(assistantRows(conversations.rows)).toEqual([
            expect.objectContaining({
                stopReason: 'aborted',
                content: [{ type: 'text', text: 'I was saying' }]
            })
        ]);
    });

    /**
     * A failure keeps the partial turn too, and says so in the row: the
     * transcript is the record of what happened, and a run that fell over
     * halfway is something that happened.
     */
    it('stores the half-finished answer when the provider fails [copilot:I-25]', async () => {
        const { engine, conversations } = harness(async function* () {
            yield { type: 'text-delta', text: 'I was saying' };
            throw new Error('the backend went away');
        });
        const controller = new AbortController();

        const frames = await drain(engine.run(startInput(controller.signal)));

        expect(frames).toContainEqual(
            expect.objectContaining({ type: 'error' })
        );
        expect(frames.at(-1)).toEqual(
            expect.objectContaining({ type: 'done', stopReason: 'error' })
        );
        expect(assistantRows(conversations.rows)).toEqual([
            expect.objectContaining({
                stopReason: 'error',
                content: [{ type: 'text', text: 'I was saying' }]
            })
        ]);
    });

    /**
     * Append-only, and the second half of the invariant: the row is written
     * once and never touched again. Two appends — the question, then whatever
     * the turn produced — and nothing that edits either afterwards.
     */
    it('appends the turn once and does not edit it afterwards [copilot:I-25]', async () => {
        const controller = new AbortController();
        const { engine, conversations } = harness(async function* () {
            yield { type: 'text-delta', text: 'I was saying' };
            controller.abort();
            yield abortedEvent();
        });

        await drain(engine.run(startInput(controller.signal)));

        expect(conversations.appendMessage).toHaveBeenCalledTimes(2);
        expect(conversations.update).not.toHaveBeenCalled();
        // The row's content is byte-for-byte what was handed to the write, so
        // an engine that kept the array and pushed into it after persisting —
        // the ordinary way an "append-only" table stops being one — fails here.
        expect(conversations.written).toEqual(
            conversations.rows.map((row) =>
                JSON.stringify({
                    conversationId: 'conversation-1',
                    runId: row.runId,
                    role: row.role,
                    content: row.content,
                    ...(row.role === 'user'
                        ? { attachments: [], skills: [] }
                        : {
                              model: row.model,
                              provider: row.provider,
                              stopReason: row.stopReason,
                              inputTokens: 0,
                              outputTokens: 0
                          })
                })
            )
        );
    });
});

describe('RunEngine with a skill in force', () => {
    const houseStyle: Skill = {
        name: 'house-style',
        title: 'House style',
        description: 'How we write.',
        instructions:
            'Write in sentence case, and publish anything you finish.',
        mode: 'always',
        source: 'cms'
    };

    /**
     * A skill changes *how* the copilot works and must never change *what it
     * may do* — the distinction ADR-0010's admin-only write permission rests
     * on. There is no field for it to try (`skill-fields.spec.ts` pins that),
     * and this is the behavioural half: an always-on skill is genuinely in
     * force — its body is in the system prompt the provider received — and the
     * tool set the model is offered is still exactly the capability profile's.
     */
    it('changes the prompt and not the tool set [copilot:I-28]', async () => {
        const { engine, seen } = harness(
            async function* () {
                yield {
                    type: 'done',
                    stopReason: 'end',
                    usage: { inputTokens: 1, outputTokens: 1 }
                };
            },
            { skillsInForce: [houseStyle] }
        );
        const controller = new AbortController();

        await drain(engine.run(startInput(controller.signal)));

        expect(seen).toHaveLength(1);
        // The skill really is in force — otherwise the tool assertion below
        // would hold for the trivial reason that nothing was applied.
        expect(seen[0].system).toContain(
            'Write in sentence case, and publish anything you finish.'
        );
        expect(seen[0].tools?.map((tool) => tool.name)).toEqual([
            'fixture_read'
        ]);
    });
});

describe('RunEngine ceilings', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    /**
     * The wall clock is checked **per tool call**, not only at the top of a
     * step — one step may ask for any number of tools and each can park for a
     * human, so a turn requesting thirty writes used to run all thirty and
     * report `timeout` at the top of a step it was never going to reach.
     *
     * And the refusal is *fed back*: every `tool_use` block needs a matching
     * `tool_result` or the assistant turn just pushed is malformed for both
     * wire formats — a run that ends on a ceiling still has to leave a
     * transcript the next turn can replay.
     */
    it('refuses a call on the wall clock and still answers it with a tool_result [copilot:I-21]', async () => {
        const clock = fakeClock();
        const { engine, conversations, tools } = harness(
            async function* () {
                yield {
                    type: 'tool-call',
                    id: 'call-1',
                    name: 'fixture_read',
                    input: {}
                };
                // The model thought about it for four minutes.
                clock.advance(240_000);
                yield {
                    type: 'done',
                    stopReason: 'tool_use',
                    usage: { inputTokens: 5, outputTokens: 5 }
                };
            },
            { limits: { wallClockMs: 60_000 } }
        );
        const controller = new AbortController();

        const frames = await drain(engine.run(startInput(controller.signal)));

        expect(frames.at(-1)).toEqual(
            expect.objectContaining({ type: 'done', stopReason: 'timeout' })
        );
        expect(tools.call).not.toHaveBeenCalled();
        expect(frames).toContainEqual(
            expect.objectContaining({
                type: 'tool-result',
                id: 'call-1',
                ok: false,
                error: expect.stringContaining('time limit')
            })
        );
        // A refusal is audited like any other attempt — "this call never ran,
        // and why" is exactly what a reviewer reading `copilot_tool_calls` is
        // looking for. (The timed-out category of `copilot:I-17`; refused-by-
        // the-user is still pinned by nothing.)
        expect(conversations.recordToolCall).toHaveBeenCalledWith(
            expect.objectContaining({
                callId: 'call-1',
                name: 'fixture_read',
                ok: false,
                error: expect.stringContaining('time limit')
            })
        );
        // The turn is well-formed: the refused call has its result.
        expect(assistantRows(conversations.rows)[0].content).toEqual([
            expect.objectContaining({ type: 'tool_use', id: 'call-1' }),
            expect.objectContaining({
                type: 'tool_result',
                toolUseId: 'call-1'
            })
        ]);
    });

    /**
     * The token ceiling is the one checked only *between* steps — a run can
     * overshoot it by a whole model call, and does. What it must not do is take
     * another one.
     */
    it('stops between steps once the token ceiling is spent [copilot:I-21]', async () => {
        const { engine, seen } = harness(
            async function* () {
                yield {
                    type: 'tool-call',
                    id: 'call-1',
                    name: 'fixture_read',
                    input: {}
                };
                yield {
                    type: 'done',
                    stopReason: 'tool_use',
                    usage: { inputTokens: 4_000, outputTokens: 4_000 }
                };
            },
            { limits: { maxTotalTokens: 100 } }
        );
        const controller = new AbortController();

        const frames = await drain(engine.run(startInput(controller.signal)));

        expect(frames.at(-1)).toEqual(
            expect.objectContaining({
                type: 'done',
                stopReason: 'max-tokens',
                usage: { inputTokens: 4_000, outputTokens: 4_000 }
            })
        );
        // The ceiling ended it, not the script: the model was called once, and
        // the step the tool result was gathered for never happened.
        expect(seen).toHaveLength(1);
    });
});

describe('RunEngine ordering', () => {
    /**
     * The question is persisted **before** the model is called, so a connection
     * that drops during the answer never loses what somebody typed.
     */
    it('stores the question before the model is called [copilot:I-24]', async () => {
        // Read inside the provider's own script — the one moment that can tell
        // "stored before the call" from "stored around it".
        const atCall: { roles?: string[] } = {};
        const built = harness(async function* () {
            atCall.roles = built.conversations.rows.map((row) => row.role);
            yield {
                type: 'done',
                stopReason: 'end',
                usage: { inputTokens: 1, outputTokens: 1 }
            };
        });
        const controller = new AbortController();

        await drain(built.engine.run(startInput(controller.signal)));

        expect(atCall.roles).toEqual(['user']);
    });

    /**
     * And skills are resolved before the conversation is touched at all: a turn
     * must never be persisted claiming skills the model was not actually given,
     * and an unresolvable name is a bad request rather than a half-written
     * thread. Same ordering the attachment resolver gets, for the same reason.
     */
    it('resolves skills before the conversation is touched [copilot:I-24]', async () => {
        const { engine, conversations } = harness(
            async function* () {
                yield {
                    type: 'done',
                    stopReason: 'end',
                    usage: { inputTokens: 1, outputTokens: 1 }
                };
            },
            { skillsFail: new Error('One of the skills is unavailable.') }
        );
        const controller = new AbortController();

        await expect(
            drain(engine.run(startInput(controller.signal)))
        ).rejects.toThrow('One of the skills is unavailable.');

        expect(conversations.create).not.toHaveBeenCalled();
        expect(conversations.appendMessage).not.toHaveBeenCalled();
    });
});

describe('RunEngine attribution', () => {
    /**
     * There is no copilot identity, and `copilot_proposals.created_by` is where
     * that either holds or quietly stops holding.
     *
     * The e2e that covers this invariant reads `decidedBy` off the proposal
     * route, which stands in for `created_by` only while both are written from
     * the same caller — and they are written by different lines, in different
     * methods, one of them (`recordApplied`) reached by no shipped tool at all.
     * Here the engine is handed the row it wrote, before any of that collapses:
     * a service account, a synthetic "copilot" id, or an actor read off the
     * conversation rather than the request would each fail.
     */
    it.each([
        ['a propose tool, whose change the engine applies', PROPOSE_TOOL],
        ['an apply tool, which wrote for itself', APPLY_TOOL]
    ])(
        'records the caller as the author of %s [copilot:I-01]',
        async (_label, tool: ToolDefinition) => {
            const { engine, proposals } = harness(
                asksFor({ id: 'call-1', name: tool.name, input: {} }),
                { tools: [tool], toolCall: async () => DRAFT }
            );
            const controller = new AbortController();

            await drain(engine.run(startInput(controller.signal)));

            expect(proposals.create).toHaveBeenCalledTimes(1);
            expect(proposals.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    createdBy: 'user-1',
                    workspaceId: 'workspace-1'
                })
            );
        }
    );
});

describe('RunEngine auditing a refused call', () => {
    /**
     * The fourth category of `copilot_tool_calls` row, and the last one nothing
     * asserted: **the user said no**.
     *
     * Succeeded and failed are covered by the e2e suite, and refused-on-a-
     * timeout by the wall-clock case above — all three go through
     * `executeTool` or `toolFailure`. A refusal at the permission prompt does
     * not: it is written from inside `mayRun`'s `settle`, a branch reached only
     * when a parked run is answered `deny`, and dropping the `audit` call there
     * would leave the reviewer's own filter — `ok = false` — with no trace of
     * the one refusal a person actually made.
     */
    it('writes a row for a call the user refused [copilot:I-17]', async () => {
        const { engine, conversations, tools } = harness(
            asksFor({ id: 'call-1', name: 'fixture_propose', input: {} }),
            {
                tools: [PROPOSE_TOOL],
                decide: async () => ({ decision: 'deny', timedOut: false })
            }
        );
        const controller = new AbortController();

        const frames = await drain(engine.run(startInput(controller.signal)));

        // Nothing ran: the prompt is what stops an injected call before it
        // happens, not after.
        expect(tools.call).not.toHaveBeenCalled();
        expect(conversations.recordToolCall).toHaveBeenCalledWith(
            expect.objectContaining({
                callId: 'call-1',
                name: 'fixture_propose',
                ok: false,
                error: expect.stringContaining('the user did not allow it')
            })
        );
        // And it is a refusal rather than a timeout — the two are audited with
        // different messages because a reviewer wants to tell them apart.
        expect(resultFor(frames, 'call-1')).toMatchObject({
            ok: false,
            summary: 'not allowed'
        });
    });
});

describe('RunEngine refusing a repeated call', () => {
    /**
     * The signature is `name` + arguments **with keys sorted**, and the sort is
     * the whole of what makes the guard work on a real model: nothing obliges a
     * provider to emit an object's keys in any particular order, and a
     * re-request is exactly the case where it is likely to differ.
     *
     * Without the sort this passes as two different calls, the engine obliges,
     * and the loop the guard exists to break runs to `maxSteps` — which is what
     * it did before, with a stop reason that explained nothing.
     */
    it('sees through a different key order [copilot:I-19]', async () => {
        const { engine, tools } = harness(
            asksFor(
                { id: 'call-1', name: 'fixture_read', input: { a: 1, b: 2 } },
                { id: 'call-2', name: 'fixture_read', input: { b: 2, a: 1 } }
            ),
            { tools: [READ_TOOL] }
        );
        const controller = new AbortController();

        const frames = await drain(engine.run(startInput(controller.signal)));

        expect(tools.call).toHaveBeenCalledTimes(1);
        expect(resultFor(frames, 'call-1')).toMatchObject({ ok: true });
        expect(resultFor(frames, 'call-2')).toMatchObject({
            ok: false,
            error: expect.stringContaining('You already called')
        });
    });

    /**
     * And the guard runs **after** authorization, so a repeat can never reveal
     * more than a first call would.
     *
     * The two orders are told apart by a grant that disappears between the two
     * calls of one turn — which the engine allows for by re-resolving the
     * profile before every call. Check the repeat first and the second call is
     * answered "you already called this", which confirms to the caller that the
     * earlier call was made and accepted; check authorization first and they get
     * the same refusal anyone who never held the grant would.
     */
    it('answers a repeat of a revoked tool as a refusal, not as a repeat [copilot:I-19]', async () => {
        const { engine, tools } = harness(
            asksFor(
                { id: 'call-1', name: 'fixture_read', input: { a: 1 } },
                { id: 'call-2', name: 'fixture_read', input: { a: 1 } }
            ),
            {
                tools: [READ_TOOL],
                // 1 is the run's offer, 2 authorizes call-1, and by 3 — the
                // authorization for call-2 — the role has lost the tool.
                profileTools: (nth) => (nth >= 3 ? [] : [READ_TOOL])
            }
        );
        const controller = new AbortController();

        const frames = await drain(engine.run(startInput(controller.signal)));

        expect(tools.call).toHaveBeenCalledTimes(1);
        expect(resultFor(frames, 'call-2')).toMatchObject({
            ok: false,
            error: 'You are not permitted to use "fixture_read".'
        });
    });
});

describe('RunEngine wall clock between steps', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    /**
     * The third place the wall clock is read, and the one the per-call case
     * above cannot reach: the **top of a step**.
     *
     * The per-call check fires while a turn is still being served, and returns
     * through `ranOutOfTime` without the loop ever coming round again — so
     * deleting the check at the top of the loop leaves every existing ceiling
     * test green while a run that spent its time *inside a tool* goes on to
     * take another model call. Here the clock is advanced by the tool itself,
     * which is where a slow write or a parked prompt actually spends it.
     */
    it('takes no further model call once the run is out of time [copilot:I-21]', async () => {
        const clock = fakeClock();
        let turn = 0;
        const { engine, tools, seen } = harness(
            async function* () {
                turn += 1;
                if (turn === 1) {
                    yield {
                        type: 'tool-call',
                        id: 'call-1',
                        name: 'fixture_read',
                        input: {}
                    };
                    yield {
                        type: 'done',
                        stopReason: 'tool_use',
                        usage: { inputTokens: 1, outputTokens: 1 }
                    };
                    return;
                }
                yield { type: 'text-delta', text: 'Here you go.' };
                yield {
                    type: 'done',
                    stopReason: 'end',
                    usage: { inputTokens: 1, outputTokens: 1 }
                };
            },
            {
                limits: { wallClockMs: 60_000 },
                // The tool is what took the time — it ran, and it took four
                // minutes doing it.
                toolCall: async () => {
                    clock.advance(240_000);
                    return { ok: true };
                }
            }
        );
        const controller = new AbortController();

        const frames = await drain(engine.run(startInput(controller.signal)));

        expect(tools.call).toHaveBeenCalledTimes(1);
        expect(seen).toHaveLength(1);
        expect(frames.at(-1)).toEqual(
            expect.objectContaining({ type: 'done', stopReason: 'timeout' })
        );
    });
});

describe('RunEngine resolving attachments', () => {
    /** A media plugin that has never heard of any of these ids. */
    const resolvesNothing: AttachmentResolver = { resolve: async () => [] };

    /**
     * An attachment shortfall reports a **count**, and the reason it must is
     * that the caller chose the ids.
     *
     * The resolver is workspace-scoped and omits what it cannot see, so "this
     * id belongs to another workspace" and "this file was deleted" arrive here
     * identically — but a message naming the id that failed turns that into an
     * oracle anyway, one probe at a time: attach two ids, see which one comes
     * back, learn which of them exists somewhere you cannot read.
     *
     * The suite that covers this asserts the message says "no longer
     * available", which an id oracle also says. This asserts what it must *not*
     * contain.
     */
    it.each([
        [
            ['aaaaaaaa-0000-4000-8000-000000000001'],
            'One of the attached files is no longer available.'
        ],
        [
            [
                'aaaaaaaa-0000-4000-8000-000000000001',
                'bbbbbbbb-0000-4000-8000-000000000002'
            ],
            '2 of the attached files are no longer available.'
        ]
    ])(
        'names how many failed and never which [copilot:I-26]',
        async (attachments: string[], message: string) => {
            const { engine, conversations } = harness(
                async function* () {
                    yield {
                        type: 'done',
                        stopReason: 'end',
                        usage: { inputTokens: 1, outputTokens: 1 }
                    };
                },
                { attachments: resolvesNothing }
            );
            const controller = new AbortController();

            const failure = await drain(
                engine.run(startInput(controller.signal, { attachments }))
            ).then(
                () => null,
                (error: Error) => error
            );

            expect(failure?.message).toBe(message);
            for (const id of attachments) {
                expect(failure?.message).not.toContain(id);
            }
            // …and it failed before the thread was touched, so there is no turn
            // left behind referencing a file the model was never told about.
            expect(conversations.create).not.toHaveBeenCalled();
        }
    );
});
