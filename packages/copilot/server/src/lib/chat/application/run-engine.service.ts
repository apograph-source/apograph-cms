import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
    COPILOT_ATTACHMENT_RESOLVER,
    DEFAULT_RUN_LIMITS,
    MODEL_REGISTRY,
    MODEL_RESOLVER,
    fenceUntrusted,
    interruptionNote,
    isAbortError,
    isProposalDraft,
    normalizeTranscript,
    resolveModel,
    toSkillRef,
    wasCutShort,
    type AttachmentRef,
    type AttachmentResolver,
    type CopilotRunEvent,
    type ModelContentBlock,
    type ModelMessage,
    type ModelRegistry,
    type ModelResolver,
    type ModelStreamEvent,
    type ModelTool,
    type ModelUsage,
    type ProposalDraft,
    type RunLimits,
    type RunStopReason,
    type SkillRef,
    type ToolResultBlock,
    type ToolUseBlock
} from '@orthacms/copilot-domain';
import {
    ToolRegistry,
    validateToolInput,
    type ToolDefinition
} from '@orthacms/tools-server';
import { COPILOT_RUN_LIMITS, InjectCopilotConfig } from '../../copilot.tokens';
import type { CopilotPluginConfig } from '../../types/copilot-config';
import { ConversationRepository } from '../infrastructure/persistence/conversation.repository';
import { ProposalRepository } from '../infrastructure/persistence/proposal.repository';
import {
    CapabilityProfileService,
    type RunAuthority
} from './capability-profile.service';
import { DecideProposalService } from './decide-proposal.service';
import { ToolPermissionBroker } from './tool-permission.broker';
import { SkillCatalogService } from '../../skills/application/skill-catalog.service';
import { summarizeToolOutput } from './summarize-tool-output';
import {
    buildSystemPrompt,
    SYSTEM_PROMPT_VERSION,
    type SurfaceContext
} from './system-prompt';

/** What the controller hands the engine to start one turn. */
export interface StartRunInput {
    /** The user the run acts as. */
    userId: string;
    /**
     * That user's email. Carried so an auto-applied proposal can freeze the
     * same actor snapshot onto its audit event that a hand-made edit would —
     * without a lookup in the one path where getting the actor wrong is least
     * acceptable.
     */
    userEmail: string;
    /** The user's role, for resolving the capability profile. */
    roleId: string;
    /** The workspace the run is scoped to; membership already proven. */
    workspaceId: string;
    /** Continue this thread, or start a new one when absent. */
    conversationId?: string;
    /** What the user typed. */
    message: string;
    /**
     * Media asset ids the user attached, already uploaded under their own
     * authority. Resolved against the run's workspace before anything is
     * persisted; an id that does not resolve ends the run.
     */
    attachments?: readonly string[];
    /**
     * Skill **names** the person attached to this turn.
     *
     * Names, never the instruction text: the catalogue is the only thing that
     * can say what a name means, and a request carrying a body would let anyone
     * holding `copilot:use` write their own system prompt. The same rule
     * attachments follow, for a sharper reason.
     */
    skills?: readonly string[];
    /** Where the user is. */
    context: SurfaceContext;
    /** The admin UI's locale — the language to answer in. */
    uiLocale: string;
    /** Content-type summaries for the workspace. */
    typeSummaries: readonly string[];
    /**
     * The backend this turn should run on. Either half may be omitted: no
     * provider means the host's resolver picks, and no model means that
     * provider's default. A user switching model mid-conversation simply sends
     * a different pair on the next turn — nothing is pinned to the thread.
     */
    choice?: { provider?: string; model?: string };
    /** Aborted when the client disconnects. */
    signal: AbortSignal;
}

/**
 * Thrown when a run names a provider or model that isn't registered. The
 * controller turns it into an error frame rather than a 500 — it is a bad
 * request, and by the time we know, the stream is usually already open.
 */
export class UnknownModelChoiceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnknownModelChoiceError';
    }
}

/**
 * Thrown when a run cannot start at all — the controller turns it into an
 * error frame.
 *
 * **Rarely reachable over HTTP**: the copilot's kill switch now unregisters
 * every controller (`copilot.module.ts`), so a disabled deployment 404s the run
 * route rather than opening a stream to say no. Kept because the engine is
 * drainable without a socket, and a caller that gets one anyway deserves a
 * named reason rather than a 500.
 */
export class CopilotDisabledError extends Error {
    constructor() {
        super('The copilot is disabled.');
        this.name = 'CopilotDisabledError';
    }
}

/**
 * The text of the step that is currently streaming, shared between the loop and
 * `run`.
 *
 * It exists because a step can end in two ways: by finishing — where `loop`
 * moves the turn's text into the run's assistant blocks — or by throwing, where
 * there is no return value at all. Without somewhere outside `streamTurn` to
 * accumulate into, everything a failed or cancelled step had already streamed
 * to the client is lost at the moment it becomes the only record of the turn.
 */
interface PartialTurn {
    /** What this step has said so far. Cleared when a step banks its text. */
    text: string;
}

/**
 * The run engine: a **bounded** loop that calls the model, executes the tools
 * it asks for, feeds the results back, and stops on a final answer or a ceiling
 * ([`docs/design/copilot.md`](../../../../../../docs/design/copilot.md) §5).
 *
 * It is an async generator rather than a service that writes to a response.
 * That keeps the transport out of the engine — the SSE controller serializes
 * whatever this yields — and it is what makes the loop testable without a
 * socket: a test drains the generator and asserts on the event sequence.
 */
@Injectable()
export class RunEngine {
    private readonly logger = new Logger(RunEngine.name);

    /** The ceilings this engine enforces. */
    private readonly limits: RunLimits;

    constructor(
        @Inject(MODEL_REGISTRY) private readonly registry: ModelRegistry,
        @Inject(MODEL_RESOLVER) private readonly resolver: ModelResolver,
        @InjectCopilotConfig() private readonly config: CopilotPluginConfig,
        private readonly profiles: CapabilityProfileService,
        private readonly tools: ToolRegistry,
        private readonly conversations: ConversationRepository,
        private readonly proposals: ProposalRepository,
        private readonly decisions: DecideProposalService,
        private readonly permissions: ToolPermissionBroker,
        private readonly skills: SkillCatalogService,
        // Optional and named explicitly: a deployment with no media plugin
        // binds nothing here, and a parameter typed `X | null` emits `Object`
        // for `design:paramtypes`, so an unnamed token would silently inject
        // `undefined` even when a binding exists.
        @Optional()
        @Inject(COPILOT_ATTACHMENT_RESOLVER)
        private readonly attachments: AttachmentResolver | null = null,
        @Optional()
        @Inject(COPILOT_RUN_LIMITS)
        limits: RunLimits | null = null
    ) {
        // Precedence: an explicitly bound token, then the host's config, then
        // the defaults. Config is the ordinary path (it is env-driven); the
        // token stays for tests that need to pin a limit without a whole config.
        this.limits = limits ?? { ...DEFAULT_RUN_LIMITS, ...config.limits };
    }

    /** Runs one turn, yielding events as they happen. */
    async *run(input: StartRunInput): AsyncGenerator<CopilotRunEvent> {
        if (!this.config.enabled) {
            // The operator's kill switch (ADR-0005 §10), belt-and-braces —
            // `CopilotModule.forRoot` registers no controller when it is off,
            // so a disabled deployment 404s before it reaches this line. This
            // is the guard against a future wiring change, and against a
            // caller that drains the generator without going through HTTP
            // (a tool, a job, a test).
            throw new CopilotDisabledError();
        }

        const runId = randomUUID();
        const startedAt = Date.now();

        // Resolved BEFORE the conversation is touched. An unresolvable
        // attachment is a bad request, and doing it here means it cannot leave
        // a thread holding a turn that references a file the model was never
        // told about — the one ordering that makes the transcript trustworthy.
        const attachments = await this.resolveAttachments(
            input.attachments,
            input.workspaceId
        );

        // Resolved here for the same reason, and before the same line: a turn
        // must never be persisted claiming skills the model was not actually
        // given. `SkillResolutionError` reaches the controller as an error
        // frame, exactly like a bad attachment.
        const { available: availableSkills, inForce: skillsInForce } =
            await this.skills.resolveRunSkills(
                input.workspaceId,
                input.skills ?? []
            );
        const skillRefs: SkillRef[] = skillsInForce.map(toSkillRef);

        const conversation = input.conversationId
            ? await this.conversations.findOrFail(
                  input.conversationId,
                  input.userId,
                  input.workspaceId
              )
            : await this.conversations.create(
                  input.userId,
                  input.workspaceId,
                  input.context.surface ?? 'chat',
                  input.message
              );

        // The user's message is persisted BEFORE the model is called, so a
        // dropped connection never loses what someone typed (design §5, step 3).
        const userMessage = await this.conversations.appendMessage({
            conversationId: conversation.id,
            runId,
            role: 'user',
            content: [{ type: 'text', text: input.message }],
            attachments,
            skills: skillRefs
        });

        yield {
            type: 'run-started',
            conversationId: conversation.id,
            runId,
            messageId: userMessage.id
        };

        const authority = await this.profiles.resolve(
            {
                id: input.userId,
                email: input.userEmail,
                roleId: input.roleId
            },
            input.workspaceId,
            input.signal
        );
        const profile = authority.profile;

        // An explicitly requested provider wins over the host's resolver: the
        // resolver expresses a default routing policy, not a veto over what the
        // user picked from the catalogue they were shown.
        const providerName =
            input.choice?.provider ??
            this.resolver(
                { workspaceId: input.workspaceId, userId: input.userId },
                this.registry
            );
        if (!this.registry.has(providerName)) {
            throw new UnknownModelChoiceError(
                `Unknown model provider "${providerName}".`
            );
        }
        const provider = this.registry.get(providerName);

        // Resolved once, here, rather than left to the adapter: the run record
        // has to name the model that actually answered, and an adapter
        // resolving it internally would leave us writing `null` into
        // `copilot_messages.model` — exactly the column cost accounting and
        // "which model said this?" both read.
        const model = resolveModel(input.choice?.model, provider.models());

        const system = buildSystemPrompt({
            uiLocale: input.uiLocale,
            context: input.context,
            typeSummaries: input.typeSummaries,
            toolNames: profile.tools.map((tool) => tool.name),
            hasWriteTools: profile.tools.some((tool) => tool.effect !== 'read'),
            availableSkills,
            skillsInForce
        });

        // The thread so far, plus this turn. Read from the transcript rather
        // than held in memory, so a continued conversation replays exactly what
        // was persisted.
        const history = await this.loadHistory(conversation.id);

        const usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
        const assistantBlocks: ModelContentBlock[] = [];
        // Text the model has already streamed to the client but that no
        // finished step has moved into `assistantBlocks` yet. A provider that
        // throws mid-stream — a dropped connection, a malformed frame, a
        // cancellation an adapter raises instead of ending the stream with —
        // otherwise takes the whole partial answer with it: the person watched
        // it arrive, and reopening the thread showed their question and
        // silence.
        const partial: PartialTurn = { text: '' };
        let stopReason: RunStopReason = 'end';

        try {
            stopReason = yield* this.loop({
                input,
                runId,
                conversationId: conversation.id,
                authority,
                provider: { name: providerName, provider },
                model,
                system,
                history,
                usage,
                assistantBlocks,
                partial,
                startedAt
            });
        } catch (error) {
            // Whatever the step had already said, before whatever went wrong.
            if (partial.text) {
                assistantBlocks.push({ type: 'text', text: partial.text });
            }
            if (isAbortError(error, input.signal)) {
                stopReason = 'aborted';
            } else {
                stopReason = 'error';
                this.logger.error(
                    `Copilot run ${runId} failed`,
                    error instanceof Error ? error.stack : String(error)
                );
                yield { type: 'error', message: userFacingMessage(error) };
            }
        }

        // The assistant turn is persisted even when the run was cancelled or
        // failed: the transcript is append-only and a partial answer is part of
        // what happened. Skipped only when nothing at all was produced.
        let assistantMessageId: string | undefined;
        if (assistantBlocks.length > 0) {
            const written = await this.conversations.appendMessage({
                conversationId: conversation.id,
                runId,
                role: 'assistant',
                content: assistantBlocks,
                model,
                provider: providerName,
                stopReason,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens
            });
            assistantMessageId = written.id;
        }

        yield {
            type: 'done',
            stopReason,
            usage,
            ...(assistantMessageId ? { messageId: assistantMessageId } : {})
        };
    }

    /**
     * The loop itself: model call → tool calls → repeat. Returns the reason the
     * run ended.
     */
    private async *loop(ctx: {
        input: StartRunInput;
        runId: string;
        conversationId: string;
        authority: RunAuthority;
        provider: { name: string; provider: ReturnType<ModelRegistry['get']> };
        model: string;
        system: string;
        history: ModelMessage[];
        usage: ModelUsage;
        assistantBlocks: ModelContentBlock[];
        partial: PartialTurn;
        startedAt: number;
    }): AsyncGenerator<CopilotRunEvent, RunStopReason> {
        const messages = [...ctx.history];
        const tools = toModelTools(ctx.authority.profile.tools);
        // Signatures of calls already made this run, so a model that asks for
        // the same thing twice is told rather than silently obliged.
        const alreadyCalled = new Set<string>();

        for (let step = 0; step < this.limits.maxSteps; step += 1) {
            if (ctx.input.signal.aborted) {
                return 'aborted';
            }
            if (Date.now() - ctx.startedAt > this.limits.wallClockMs) {
                return 'timeout';
            }
            if (totalTokens(ctx.usage) > this.limits.maxTotalTokens) {
                return 'max-tokens';
            }

            // `yield*` forwards each delta to the client as it arrives and
            // still gives us the turn's summary as the generator's return
            // value — the same shape `loop` itself uses to return its stop
            // reason.
            const turn = yield* this.streamTurn(ctx, messages, tools);

            ctx.usage.inputTokens += turn.usage.inputTokens;
            ctx.usage.outputTokens += turn.usage.outputTokens;
            // The cache figures accumulate too, and are reported on `done`
            // alongside the other two. A provider that reports neither leaves
            // both keys absent rather than zero, so a run on an adapter with no
            // cache is indistinguishable from one that never hit it.
            addCacheTokens(ctx.usage, turn.usage);
            if (turn.text) {
                ctx.assistantBlocks.push({ type: 'text', text: turn.text });
            }
            // Banked: anything that throws from here on must not append it a
            // second time.
            ctx.partial.text = '';
            ctx.assistantBlocks.push(...turn.toolUses);

            if (turn.stopReason === 'aborted') return 'aborted';
            if (turn.stopReason === 'refusal') return 'refusal';
            if (turn.stopReason === 'max_tokens') return 'max-output-tokens';
            if (turn.toolUses.length === 0) return 'end';

            // The model asked for tools. Everything it said this turn — text
            // and tool_use blocks together — goes back as one assistant turn,
            // then the results ride on a user turn, which is what both wire
            // formats expect.
            messages.push({
                role: 'assistant',
                content: [
                    ...(turn.text
                        ? [{ type: 'text' as const, text: turn.text }]
                        : []),
                    ...turn.toolUses
                ]
            });

            const results: ToolResultBlock[] = [];
            let ranOutOfTime = false;
            for (const call of turn.toolUses) {
                yield {
                    type: 'tool-call',
                    id: call.id,
                    name: call.name,
                    input: call.input
                };

                // The ceilings above are checked once per **step**, and one
                // step may ask for any number of tools — each of which can
                // park for a human answer. A turn requesting thirty writes
                // therefore ran all thirty however long they took, and only
                // reported `timeout` afterwards, at the top of a step it was
                // never going to reach. Checked per call, the ceiling bounds
                // what it says it bounds.
                //
                // Refused rather than dropped: every `tool_use` block needs a
                // matching `tool_result` or the turn we just pushed is
                // malformed for both wire formats.
                if (Date.now() - ctx.startedAt > this.limits.wallClockMs) {
                    ranOutOfTime = true;
                    const refusal = await this.toolFailure(
                        ctx,
                        call,
                        `"${call.name}" was not run: this run reached its time limit.`
                    );
                    results.push(refusal.block);
                    for (const event of refusal.events) yield event;
                    continue;
                }

                // **Ask before running, not after.** This is the one place a
                // call the model was talked into by poisoned content can still
                // be stopped without anything having happened — which is the
                // mitigation ADR-0009's Consequences left owing.
                const gate = await this.mayRun(ctx, call);
                if (gate) {
                    yield gate.event;
                    const refusal = await gate.settle();
                    if (refusal) {
                        results.push(refusal.block);
                        for (const event of refusal.events) yield event;
                        continue;
                    }
                }

                const outcome = await this.executeTool(
                    ctx,
                    call,
                    alreadyCalled
                );
                results.push(outcome.block);
                // More than one event when the call produced a proposal: the
                // tool result is what the model was told, the proposal is the
                // receipt the card draws. (It used to say "what the human is
                // being asked to decide" — ADR-0009 removed the deciding.)
                for (const event of outcome.events) {
                    yield event;
                }
            }

            ctx.assistantBlocks.push(...results);
            if (ranOutOfTime) {
                return 'timeout';
            }
            messages.push({ role: 'user', content: results });
        }

        return 'max-steps';
    }

    /** One model call, reduced to text, tool uses, usage and a stop reason. */
    private async *streamTurn(
        ctx: {
            input: StartRunInput;
            system: string;
            model: string;
            provider: {
                name: string;
                provider: ReturnType<ModelRegistry['get']>;
            };
            partial: PartialTurn;
        },
        messages: ModelMessage[],
        tools: ModelTool[]
    ): AsyncGenerator<
        CopilotRunEvent,
        {
            text: string;
            toolUses: ToolUseBlock[];
            usage: ModelUsage;
            stopReason: string;
        }
    > {
        const toolUses: ToolUseBlock[] = [];
        // The turn's text lives on the caller's accumulator rather than in a
        // local, so a stream that throws leaves what it had already said
        // somewhere `run` can still persist it.
        ctx.partial.text = '';
        let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
        let stopReason = 'end';

        const stream = ctx.provider.provider.stream(
            {
                model: ctx.model,
                system: ctx.system,
                messages,
                ...(tools.length > 0 ? { tools } : {}),
                maxOutputTokens: this.config.maxOutputTokens
            },
            ctx.input.signal
        );

        for await (const event of stream as AsyncIterable<ModelStreamEvent>) {
            if (event.type === 'text-delta') {
                ctx.partial.text += event.text;
                // Yielded, not collected. Buffering these into an array and
                // flushing after the provider's stream ends turns the whole
                // feature off: the answer arrives in one burst when the model
                // finishes, which looks exactly like a slow non-streaming API.
                yield { type: 'text-delta', text: event.text };
            } else if (event.type === 'tool-call') {
                toolUses.push({
                    type: 'tool_use',
                    id: event.id,
                    name: event.name,
                    input: event.input
                });
            } else {
                usage = event.usage;
                stopReason = event.stopReason;
            }
        }

        return { text: ctx.partial.text, toolUses, usage, stopReason };
    }

    /**
     * Authorizes, validates and runs one tool call, and writes its audit row.
     *
     * **Never throws.** Every failure — unknown tool, revoked permission,
     * malformed arguments, a tool that blew up — comes back as a tool *error*
     * the model can recover from, and the run continues (design §5, step 6).
     * Turning a model mistake into a 500 would lose the whole turn.
     */
    /**
     * Decides whether `call` needs the user's say-so, and parks the run if so.
     *
     * Returns `null` when it may just run — which is the overwhelmingly common
     * case, because **only write tools ask**. Prompting on reads was
     * considered and rejected: a model does three or four searches before it
     * answers anything, so a fresh chat would open with four prompts, and
     * everyone would learn to click through them without reading. That is worse
     * than not asking, because it also devalues the prompt that matters.
     *
     * Otherwise it hands back the frame to emit and a `settle` to await, rather
     * than doing both itself — the caller is the generator, and only a
     * generator can `yield`.
     */
    private async mayRun(
        ctx: {
            input: StartRunInput;
            runId: string;
            conversationId: string;
            authority: RunAuthority;
        },
        call: ToolUseBlock
    ): Promise<{
        event: CopilotRunEvent;
        settle(): Promise<{
            block: ToolResultBlock;
            events: CopilotRunEvent[];
        } | null>;
    } | null> {
        const tool = ctx.authority.profile.tools.find(
            (entry) => entry.name === call.name
        );
        // An unknown tool is `executeTool`'s to refuse, with its own message.
        // Gating it here would ask the user to approve something that does not
        // exist.
        if (!tool) return null;
        if (tool.effect !== 'propose' && tool.effect !== 'apply') return null;

        // Read per call, not per run: the list grows while the run is parked —
        // answering "allow for this chat" on the first of two calls in one turn
        // must stop the second from asking.
        const allowed = await this.conversations.allowedTools(
            ctx.conversationId
        );
        if (allowed.includes(call.name)) return null;

        return {
            event: {
                type: 'tool-permission-request',
                id: call.id,
                runId: ctx.runId,
                name: call.name,
                ...(tool.title ? { title: tool.title } : {}),
                input: call.input,
                // Read here rather than inside `settle`, because the frame is
                // emitted before the run parks — and the client needs the
                // deadline to count down to from the moment the prompt appears.
                expiresAt: new Date(
                    Date.now() + this.permissions.budgetRemaining(ctx.runId)
                ).toISOString()
            },
            settle: async () => {
                const outcome = await this.permissions.ask(
                    ctx.runId,
                    call.id,
                    // Who may answer. Recorded when the run parks rather than
                    // checked on the way in, because by then the answering
                    // request has only a `runId` — which is not a secret.
                    {
                        userId: ctx.input.userId,
                        workspaceId: ctx.input.workspaceId
                    },
                    ctx.input.signal
                );
                if (outcome.decision === 'chat') {
                    await this.conversations.allowTool(
                        ctx.conversationId,
                        call.name
                    );
                }
                if (outcome.decision !== 'deny') return null;

                // A refusal is an ordinary tool error, so the model reports it
                // and carries on rather than the run dying — the same treatment
                // an unknown tool or a revoked permission gets. It is audited
                // too: "the user said no" is exactly what a reviewer reading
                // `copilot_tool_calls` wants to see.
                const message = outcome.timedOut
                    ? `"${call.name}" was not run: nobody answered the request to allow it.`
                    : `"${call.name}" was not run: the user did not allow it.`;
                await this.audit(ctx, call, {
                    ok: false,
                    error: message,
                    durationMs: 0,
                    outputSummary: null
                });
                return {
                    block: {
                        type: 'tool_result' as const,
                        toolUseId: call.id,
                        content: message,
                        isError: true
                    },
                    events: [
                        {
                            type: 'tool-result' as const,
                            id: call.id,
                            name: call.name,
                            ok: false,
                            durationMs: 0,
                            summary: outcome.timedOut
                                ? 'no answer'
                                : 'not allowed',
                            error: message
                        }
                    ]
                };
            }
        };
    }

    private async executeTool(
        ctx: {
            input: StartRunInput;
            runId: string;
            conversationId: string;
            authority: RunAuthority;
        },
        call: ToolUseBlock,
        alreadyCalled: Set<string>
    ): Promise<{ block: ToolResultBlock; events: CopilotRunEvent[] }> {
        const startedAt = Date.now();
        const fail = (message: string) =>
            this.toolFailure(ctx, call, message, Date.now() - startedAt);

        const tool = ctx.authority.profile.tools.find(
            (entry) => entry.name === call.name
        );
        if (!tool) {
            // A hallucinated name, or one the offer withheld. Both answer
            // "unknown" — which is what the shared registry says too. The tool
            // set is not secret: it is derived from the caller's own role,
            // which they can read off their own profile, so naming it reveals
            // nothing and saves the model a wasted turn. (This used to answer
            // uniformly to avoid an enumeration signal; that reasoning is right
            // for *data* — an ungranted content type still 404s like an unknown
            // one — and wrong for the tool list. ADR-0006 §5 reached the same
            // conclusion for MCP, and one registry should not answer two ways.)
            return fail(`Unknown tool "${call.name}".`);
        }

        // Re-authorize against freshly resolved grants (ADR-0005 §3): the offer
        // was computed at the start of the run, and a role can change while a
        // long turn is in flight.
        const fresh = await this.profiles.resolve(
            {
                id: ctx.input.userId,
                email: ctx.input.userEmail,
                roleId: ctx.input.roleId
            },
            ctx.input.workspaceId,
            ctx.input.signal
        );
        if (!fresh.profile.tools.some((entry) => entry.name === call.name)) {
            this.logger.warn(
                `Run ${ctx.runId}: tool "${call.name}" was offered but is no longer permitted; refused.`
            );
            return fail(`You are not permitted to use "${call.name}".`);
        }

        const validation = validateToolInput(call.input, tool.inputSchema);
        if (!validation.valid) {
            return fail(`Invalid arguments: ${validation.errors.join('; ')}`);
        }

        // The loop guard. A model — especially a smaller local one — will
        // sometimes re-request a call it has already made instead of using the
        // result, and without this the engine obliges every time until it hits
        // `maxSteps`: eight model calls, eight identical queries, no answer, and
        // a stop reason that says nothing about why.
        //
        // Telling it what happened is what actually breaks the loop; silently
        // re-running, or refusing without saying why, both just repeat. Checked
        // AFTER authorization so a repeat can never reveal more than a first
        // call would.
        const signature = `${call.name} ${stableStringify(call.input)}`;
        if (alreadyCalled.has(signature)) {
            this.logger.warn(
                `Run ${ctx.runId}: "${call.name}" repeated with identical arguments; refusing.`
            );
            return fail(
                `You already called "${call.name}" with exactly these arguments in this ` +
                    'conversation, and its result is above. Use that result, or call a ' +
                    'different tool, or answer the question — do not repeat this call.'
            );
        }
        alreadyCalled.add(signature);

        try {
            // Dispatched through the shared registry, not called directly:
            // `ToolRegistry.call` re-checks `requires` before it runs the
            // handler, which is the one authorization point both consumers
            // share (ADR-0006 §5). The offer above is a usability filter; this
            // is the boundary.
            const output = await this.tools.call(
                call.name,
                (call.input ?? {}) as Record<string, unknown>,
                fresh.context,
                'copilot'
            );

            // A `propose` tool's return value IS the change. The engine
            // persists it and then applies it — every one of them, since
            // ADR-0009; the per-workspace opt-in this comment used to name is
            // gone. So ADR-0005 §5's guarantees live in one place instead of
            // once per binder, and the row written *before* the write is the
            // whole of what makes a change "undoable, never invisible".
            if (tool.effect === 'propose') {
                return await this.recordProposal(ctx, call, output, startedAt);
            }
            // An `apply` tool writes for itself. ADR-0009 §5 keeps offering one
            // exactly as it would a read tool, and §2 keeps the row as "the
            // whole paper trail" — so the receipt has to be written here, or an
            // apply tool is precisely the "change with no receipt" §2 forbids.
            if (tool.effect === 'apply') {
                return await this.recordApplied(
                    ctx,
                    call,
                    tool,
                    output,
                    startedAt
                );
            }

            const durationMs = Date.now() - startedAt;
            const summary = summarizeToolOutput(output);

            await this.audit(ctx, call, {
                ok: true,
                error: null,
                durationMs,
                outputSummary: summary
            });

            return {
                block: {
                    type: 'tool_result',
                    toolUseId: call.id,
                    // Fenced as untrusted data: entry bodies are user-authored
                    // and must enter the model as material, never instructions.
                    content: fenceUntrusted(call.name, output)
                },
                events: [
                    {
                        type: 'tool-result',
                        id: call.id,
                        name: call.name,
                        ok: true,
                        durationMs,
                        summary,
                        output
                    }
                ]
            };
        } catch (error) {
            this.logger.warn(
                `Run ${ctx.runId}: tool "${call.name}" threw`,
                error instanceof Error ? error.stack : String(error)
            );
            return fail(userFacingMessage(error));
        }
    }

    /**
     * Persists a `propose` tool's draft, applies it, and produces both the
     * model's receipt and the client's proposal card.
     *
     * Applies it **always** — the per-workspace auto-apply opt-in this doc used
     * to name was deleted with the policy table
     * ([ADR-0009](../../../../../../docs/adr/0009-copilot-applies-directly.md)
     * §4). The row is still written first, and that ordering is now the only
     * thing carrying "undoable, never invisible".
     *
     * **The model is told what happened, not handed the patch back.** It
     * already knows what it asked for; echoing the whole change would spend the
     * tokens twice and invite the model to "confirm" by proposing again. What
     * it needs is the id, the summary, and whether the write landed — which is
     * what makes it say "I've fixed the headline" or "that did not save",
     * rather than the pre-ADR-0009 "I've drafted this, accept it below" for a
     * change that has already happened.
     */
    private async recordProposal(
        ctx: {
            input: StartRunInput;
            runId: string;
            conversationId: string;
        },
        call: ToolUseBlock,
        output: unknown,
        startedAt: number
    ): Promise<{ block: ToolResultBlock; events: CopilotRunEvent[] }> {
        // A binder that declared `effect: 'propose'` and returned something
        // else would otherwise write a malformed row into an append-only
        // table. This turns that into an ordinary tool error — the same
        // treatment every other binder bug gets.
        if (!isProposalDraft(output)) {
            const message = `"${call.name}" did not return a valid change.`;
            this.logger.error(
                `Run ${ctx.runId}: propose tool "${call.name}" returned a value ` +
                    'that is not a ProposalDraft; nothing was recorded.'
            );
            return this.toolFailure(ctx, call, message, Date.now() - startedAt);
        }

        const draft: ProposalDraft = output;
        let proposal = await this.proposals.create({
            conversationId: ctx.conversationId,
            runId: ctx.runId,
            toolCallId: call.id,
            toolName: call.name,
            kind: draft.kind,
            workspaceId: ctx.input.workspaceId,
            createdBy: ctx.input.userId,
            target: draft.target,
            patch: draft.patch,
            summary: draft.summary,
            ...(draft.changes ? { changes: draft.changes } : {})
        });

        // **Every change applies, immediately** (ADR-0009). The row above is
        // written first regardless, and that ordering is now the only thing
        // carrying ADR-0005 §5's "undoable, never invisible": nothing waits for
        // a human any more, so the receipt is the whole paper trail.
        let applyError: string | undefined;
        const outcome = await this.decisions.apply(proposal, {
            userId: ctx.input.userId,
            email: ctx.input.userEmail,
            workspaceId: ctx.input.workspaceId
        });
        if (outcome.ok) {
            proposal = outcome.proposal;
        } else {
            // The row survives as `pending` with its error recorded. Nobody
            // will retry it — there is no accept endpoint — so this is a
            // receipt saying the change did not happen, and the model is told
            // as much so it can report the failure rather than claim success.
            applyError = outcome.message;
        }

        const durationMs = Date.now() - startedAt;
        const applied = proposal.status === 'accepted';
        const receipt = applied
            ? `Applied: ${draft.summary}`
            : `NOT applied: ${draft.summary}. The change failed and nothing was ` +
              `written (${applyError}). Tell the user it did not happen, and do ` +
              'not claim otherwise.';
        const summary = applied ? 'applied' : 'failed';

        await this.audit(ctx, call, {
            // The audit row is the security-review surface, so it has to agree
            // with the outcome rather than with the dispatch. It read `ok:
            // true` beside `output_summary: "failed: …"` and a non-null
            // `error` — a reviewer filtering for `ok = false` would find no
            // trace of a write that never landed, which is exactly the row
            // they were looking for.
            ok: !applyError,
            error: applyError ?? null,
            durationMs,
            outputSummary: `${summary}: ${draft.summary}`
        });

        return {
            block: {
                type: 'tool_result',
                toolUseId: call.id,
                content: fenceUntrusted(call.name, {
                    proposalId: proposal.id,
                    status: proposal.status,
                    message: receipt,
                    ...(applyError ? { applyError } : {})
                })
            },
            events: [
                {
                    type: 'tool-result',
                    id: call.id,
                    name: call.name,
                    // The **UI** event, not the model's block: a write that did
                    // not land is a failed step and must draw as one. It read
                    // `ok: true` with `summary: 'failed'` — a green tick beside
                    // the word "failed". The block the model gets stays a
                    // normal result whose text says NOT applied, because that
                    // is a receipt to report, not an error to recover from.
                    ok: !applyError,
                    durationMs,
                    summary,
                    output: {
                        proposalId: proposal.id,
                        status: proposal.status,
                        ...(applyError ? { applyError } : {})
                    }
                },
                {
                    type: 'proposal',
                    id: proposal.id,
                    toolCallId: call.id,
                    toolName: call.name,
                    kind: proposal.kind,
                    summary: proposal.summary,
                    target: proposal.target,
                    ...(proposal.changes ? { changes: proposal.changes } : {}),
                    status: proposal.status,
                    ...(typeof proposal.result?.['entityId'] === 'string'
                        ? { entityId: proposal.result['entityId'] }
                        : {}),
                    // The card has to be able to say the change did not
                    // happen, and this frame is its only chance — there is no
                    // review queue to go and look it up in.
                    ...(applyError ? { error: applyError } : {})
                }
            ]
        };
    }

    /**
     * Records the receipt for an `effect: 'apply'` tool — one that does its own
     * writing instead of handing back a draft for the engine to apply.
     *
     * The registry has always allowed the effect and
     * [ADR-0009](../../../../../../docs/adr/0009-copilot-applies-directly.md)
     * §5 still offers such a tool "exactly when a `read` one with the same
     * `requires` would be", while §2 keeps the `copilot_proposals` row as "the
     * whole paper trail" and names a binder that writes directly as the failure
     * the split exists to prevent. Both were true at once: an `apply` tool
     * parked for permission like a write, ran like a write, and left nothing
     * behind. Nothing shipped declares the effect today, which is why it went
     * unnoticed — and is exactly why the next binder to reach for it must not
     * have to know this.
     *
     * Two differences from {@link recordProposal}, both forced by the effect:
     *
     * - **The row is written after the fact.** The write has already happened
     *   by the time the handler returns; there was never a moment this engine
     *   could have stopped it. The permission prompt is what does that.
     * - **`kind` is `tool.<name>` and has no applier.** There is nothing left
     *   to carry out. The row exists to be read — which is the whole of what
     *   "undoable, never invisible" asks of it here.
     *
     * The model still gets the handler's own return value: for an `apply` tool
     * the return value is a *result*, not a change (`ToolEffect`).
     */
    private async recordApplied(
        ctx: {
            input: StartRunInput;
            runId: string;
            conversationId: string;
        },
        call: ToolUseBlock,
        tool: ToolDefinition,
        output: unknown,
        startedAt: number
    ): Promise<{ block: ToolResultBlock; events: CopilotRunEvent[] }> {
        const summary = `${tool.title || call.name} ran.`;
        const created = await this.proposals.create({
            conversationId: ctx.conversationId,
            runId: ctx.runId,
            toolCallId: call.id,
            toolName: call.name,
            kind: `tool.${call.name}`,
            workspaceId: ctx.input.workspaceId,
            createdBy: ctx.input.userId,
            target: { tool: call.name },
            // The arguments are the change, as far as anything here can know:
            // the shape of what the handler wrote belongs to the handler.
            patch: (call.input ?? {}) as Record<string, unknown>,
            summary
        });
        const outputSummary = summarizeToolOutput(output);
        // Accepted in the same breath, because it already happened. `decide`
        // rather than a second insert so the row carries `decidedBy`/`decidedAt`
        // like every other applied change.
        const proposal =
            (await this.proposals.decide(
                created.id,
                ctx.input.workspaceId,
                'accepted',
                ctx.input.userId,
                { detail: outputSummary }
            )) ?? created;

        const durationMs = Date.now() - startedAt;
        await this.audit(ctx, call, {
            ok: true,
            error: null,
            durationMs,
            outputSummary
        });

        return {
            block: {
                type: 'tool_result',
                toolUseId: call.id,
                content: fenceUntrusted(call.name, output)
            },
            events: [
                {
                    type: 'tool-result',
                    id: call.id,
                    name: call.name,
                    ok: true,
                    durationMs,
                    summary: outputSummary,
                    output
                },
                {
                    type: 'proposal',
                    id: proposal.id,
                    toolCallId: call.id,
                    toolName: call.name,
                    kind: proposal.kind,
                    summary: proposal.summary,
                    target: proposal.target,
                    status: proposal.status
                }
            ]
        };
    }

    /**
     * One tool call that did not happen: the audit row, the block the model is
     * told, and the frame the UI draws.
     *
     * Shared by `executeTool`'s own refusals and by the loop's time-limit
     * check, so a call refused before it was ever dispatched is recorded
     * exactly like one refused after — a reviewer reading `copilot_tool_calls`
     * should not have to know which stage said no.
     */
    private async toolFailure(
        ctx: { runId: string; conversationId: string },
        call: ToolUseBlock,
        message: string,
        durationMs = 0
    ): Promise<{ block: ToolResultBlock; events: CopilotRunEvent[] }> {
        await this.audit(ctx, call, {
            ok: false,
            error: message,
            durationMs,
            outputSummary: null
        });
        return {
            block: {
                type: 'tool_result' as const,
                toolUseId: call.id,
                content: message,
                isError: true
            },
            events: [
                {
                    type: 'tool-result' as const,
                    id: call.id,
                    name: call.name,
                    ok: false,
                    durationMs,
                    summary: 'failed',
                    error: message
                }
            ]
        };
    }

    /** Writes one `copilot_tool_calls` row. Never fails the run. */
    private async audit(
        ctx: { runId: string; conversationId: string },
        call: ToolUseBlock,
        outcome: {
            ok: boolean;
            error: string | null;
            durationMs: number;
            outputSummary: string | null;
        }
    ): Promise<void> {
        try {
            await this.conversations.recordToolCall({
                conversationId: ctx.conversationId,
                runId: ctx.runId,
                callId: call.id,
                name: call.name,
                input: call.input,
                ...outcome
            });
        } catch (error) {
            // An audit write failing must not take the answer down with it,
            // but it is exactly the kind of thing that has to be loud.
            this.logger.error(
                `Failed to record tool call "${call.name}" for run ${ctx.runId}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /**
     * Turns the attached asset ids into what the model is told about them.
     *
     * Three refusals, each a different wrong thing to do:
     *
     * - **No resolver bound** — the deployment has no media plugin, so there is
     *   nothing that could have produced these ids. Failing beats describing
     *   files nobody can look up.
     * - **An id that did not resolve** — it belongs to another workspace, or to
     *   a file deleted between the upload and the send. The resolver is
     *   workspace-scoped and omits what it cannot see, so the two are
     *   indistinguishable here, which is deliberate: telling a caller *which*
     *   of their ids exists elsewhere is an oracle.
     * - Neither case is reported per-id. One message names the count, because
     *   the user's recourse is the same either way — re-attach the file.
     */
    private async resolveAttachments(
        assetIds: readonly string[] | undefined,
        workspaceId: string
    ): Promise<AttachmentRef[]> {
        if (!assetIds?.length) {
            return [];
        }
        if (!this.attachments) {
            throw new AttachmentError(
                'Files cannot be attached in this deployment.'
            );
        }

        // De-duplicated first: the same file attached twice is a client slip,
        // not a reason to spend two lines of prompt on it — and it would make
        // the count check below fail on a request that is otherwise fine.
        const unique = [...new Set(assetIds)];
        const resolved = await this.attachments.resolve(unique, workspaceId);

        if (resolved.length !== unique.length) {
            const missing = unique.length - resolved.length;
            throw new AttachmentError(
                missing === 1
                    ? 'One of the attached files is no longer available.'
                    : `${missing} of the attached files are no longer available.`
            );
        }
        // Returned in the order they were attached rather than the order the
        // resolver happened to answer in, so the prompt and the chips agree.
        const byId = new Map(resolved.map((ref) => [ref.assetId, ref]));
        return unique
            .map((id) => byId.get(id))
            .filter((ref): ref is AttachmentRef => ref !== undefined);
    }

    /**
     * The persisted transcript, as the port's message shape.
     *
     * A turn's attachments are folded back in as a **fenced text block**, which
     * is what makes them survive into later turns: "summarise the file I sent"
     * on turn three has to reach a manifest written on turn one, and the
     * transcript is the only thing carried forward. Fenced because a file name
     * is user-authored text arriving in the prompt — the same treatment a tool
     * result gets, for the same reason.
     *
     * The rows are then run through `normalizeTranscript`, which is what makes
     * a *continued* conversation replayable at all. A run is stored as one
     * assistant row holding text, `tool_use` **and** `tool_result` blocks
     * together — the shape the transcript UI reads — and Anthropic rejects that
     * on the way back in: a tool result has to ride on a user turn after the
     * assistant turn that asked for it. It also drops `tool_use` blocks left
     * unanswered by a run that was aborted mid-step, which is the same 400
     * wearing a different message. The repair is here rather than at the write
     * so it also fixes the threads already in the database.
     */
    private async loadHistory(conversationId: string): Promise<ModelMessage[]> {
        const rows = await this.conversations.messages(conversationId);
        const turns = rows.map((row) => {
            const extra: ModelContentBlock[] = [];
            if (row.attachments?.length) {
                extra.push({
                    type: 'text',
                    text: attachmentManifest(row.attachments)
                });
            }
            // A **note**, never the bodies again. The instructions a past turn
            // ran with are already reflected in the answer it produced, and
            // re-injecting them per turn would multiply the prompt by the
            // length of the thread — five turns under one always-on skill would
            // carry five copies of it. What the model still needs is why an
            // earlier answer reads the way it does, which a name supplies.
            if (row.skills?.length) {
                extra.push({ type: 'text', text: skillNote(row.skills) });
            }
            // Why an assistant turn stops short of an answer is the one thing
            // about it the model cannot read off its own output — the ceilings
            // belong to the engine, and `RunStopReason` says outright that they
            // are "limits the engine imposes and the model never sees". So a
            // turn cut off at a ceiling replays looking exactly like a turn that
            // simply finished, and "continue" gets a fresh start on the whole
            // task instead of a resumption of the interrupted one.
            if (wasCutShort(row.stopReason)) {
                extra.push({
                    type: 'text',
                    text: interruptionNote(row.stopReason as RunStopReason)
                });
            }
            return {
                role: row.role,
                content:
                    extra.length > 0 ? [...row.content, ...extra] : row.content
            };
        });
        return normalizeTranscript(turns);
    }
}

/**
 * Thrown when a turn's attachments cannot be resolved. Surfaced by the
 * controller as an error frame rather than a 500 — like `UnknownModelChoiceError`
 * it is a bad request, and by the time we know, the stream is already open.
 */
export class AttachmentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AttachmentError';
    }
}

/** The prompt line describing a turn's attached files. */
function attachmentManifest(attachments: readonly AttachmentRef[]): string {
    return (
        'The user attached these files to the message above. They are in the ' +
        'media library — use media_asset_read with an assetId to read one whose ' +
        '`readable` is true.\n' +
        fenceUntrusted('attachments', attachments)
    );
}

/**
 * The line telling the model which skills an earlier turn ran under.
 *
 * Titles rather than bodies, and not fenced: a skill name is written by
 * somebody holding `copilot:skills:manage`, so unlike a file name it is not
 * user-supplied text arriving in the prompt from outside the trust boundary.
 * The skills in force *now* are stated in the system prompt; this only explains
 * the shape of what is already above it.
 */
function skillNote(skills: readonly SkillRef[]): string {
    const names = skills.map((skill) => skill.title).join(', ');
    return `(That turn ran with these skills in force: ${names}. They are not necessarily in force now.)`;
}

/** The prompt version this engine builds with, for the run record. */
export const ENGINE_PROMPT_VERSION = SYSTEM_PROMPT_VERSION;

/** The provider-facing view of the offered tools. */
function toModelTools(tools: readonly ToolDefinition[]): ModelTool[] {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
    }));
}

/** Input + output across a run. */
/**
 * Folds a turn's cache counts into the run's, leaving a key absent when the
 * provider reported nothing for it.
 */
function addCacheTokens(into: ModelUsage, from: ModelUsage): void {
    if (from.cachedInputTokens !== undefined) {
        into.cachedInputTokens =
            (into.cachedInputTokens ?? 0) + from.cachedInputTokens;
    }
    if (from.cacheWriteInputTokens !== undefined) {
        into.cacheWriteInputTokens =
            (into.cacheWriteInputTokens ?? 0) + from.cacheWriteInputTokens;
    }
}

function totalTokens(usage: ModelUsage): number {
    // Cache **writes** count; cache **reads** do not. A write is billed at a
    // premium over plain input, so leaving it out would let caching make a run
    // look cheaper than it is. A read is ~a tenth of the price and is the whole
    // point of caching — charging the ceiling for it would spend the run's
    // budget on re-reading the prompt, which is exactly what caching stopped.
    return (
        usage.inputTokens +
        usage.outputTokens +
        (usage.cacheWriteInputTokens ?? 0)
    );
}

/**
 * JSON with object keys sorted, so two calls that differ only in the order the
 * model happened to emit their arguments compare equal. Without the sort,
 * `{a,b}` and `{b,a}` are different strings and the loop guard misses the
 * repeat it exists to catch.
 */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
    return `{${entries.join(',')}}`;
}

/**
 * An error reduced to something safe to show a user or feed back to the model
 * — never a stack, a provider payload, or anything naming internal wiring.
 */
function userFacingMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return 'Something went wrong.';
}
