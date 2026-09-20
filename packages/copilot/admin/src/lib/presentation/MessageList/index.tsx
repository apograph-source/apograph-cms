import { useEffect, useRef, useState } from 'react';
import {
    defineMessages,
    useIntl,
    type IntlShape,
    type MessageDescriptor
} from 'react-intl';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@orthacms/design-system';
import type { ToolPermissionDecision } from '@orthacms/copilot-domain';
import type { ChatMessage, ChatToolStep } from '../../domain/types/chat';
import { Markdown } from '../Markdown';
import { ToolStep } from '../ToolStep';
import { humanizeToolName, toolPhrase } from '../ToolStep/labels';
import { turnActivity } from './activity';
import { ProposalCard } from '../ProposalCard';
import { PermissionPrompt } from '../PermissionPrompt';
import { AttachmentChip } from '../AttachmentChip';
import { SkillChip } from '../SkillChip';

const messages = defineMessages({
    attachments: {
        id: 'copilot.messages.attachments',
        defaultMessage: 'Attached files'
    },
    skills: {
        id: 'copilot.messages.skills',
        defaultMessage: 'Skills used'
    },
    empty: {
        id: 'copilot.chat.empty',
        defaultMessage: 'Ask about the content in this workspace.'
    },
    emptyHint: {
        id: 'copilot.chat.emptyHint',
        defaultMessage:
            'Ortha AI can only see and change what your own role allows. Every change it makes is recorded and can be undone.'
    },
    thinking: {
        id: 'copilot.chat.thinking',
        defaultMessage: 'Thinking…'
    },
    // The gap between one call finishing and whatever comes next. "Thinking…"
    // was true here and useless: the run had just done something specific, and
    // the one line on screen refused to say what it was.
    afterStep: {
        id: 'copilot.chat.afterStep',
        defaultMessage: '{action} — working out what to do next…'
    },
    errorTitle: {
        id: 'copilot.chat.errorTitle',
        defaultMessage: 'Something went wrong'
    },
    incompleteTitle: {
        id: 'copilot.chat.incompleteTitle',
        defaultMessage: 'This answer is incomplete'
    },
    stoppedFor: {
        id: 'copilot.chat.stoppedFor',
        defaultMessage: 'Stopped because it {reason}.'
    },
    // One descriptor per reason rather than one map of bare English strings.
    // They complete the sentence above, so they used to be plain literals
    // interpolated into a translated frame — which meant no extractor could
    // see them and no catalogue could ever translate them: the sentence
    // localized and the half that carries its meaning did not.
    stopMaxSteps: {
        id: 'copilot.chat.stop.maxSteps',
        defaultMessage: 'reached the maximum number of steps'
    },
    stopMaxTokens: {
        id: 'copilot.chat.stop.maxTokens',
        defaultMessage: 'reached this run’s token budget'
    },
    stopTimeout: {
        id: 'copilot.chat.stop.timeout',
        defaultMessage: 'took too long'
    },
    stopMaxOutputTokens: {
        id: 'copilot.chat.stop.maxOutputTokens',
        defaultMessage: 'hit the response length limit'
    },
    stopRefusal: {
        id: 'copilot.chat.stop.refusal',
        defaultMessage: 'declined to answer'
    },
    cancelled: {
        id: 'copilot.chat.cancelled',
        defaultMessage: 'You stopped this answer.'
    },
    transcript: {
        id: 'copilot.chat.transcript',
        defaultMessage: 'Conversation'
    },
    // The speaker labels. Colour and alignment carried this alone: a user turn
    // was a right-aligned `bg-primary` bubble and an assistant turn was
    // left-aligned markdown, which is 1.4.1 Use of Colour and is also why the
    // `role="log"` bought so little — a log whose entries have no names is a log
    // you cannot navigate (`ORT-116`).
    youSaid: {
        id: 'copilot.chat.turn.you',
        defaultMessage: 'You'
    },
    assistantSaid: {
        id: 'copilot.chat.turn.assistant',
        defaultMessage: 'Ortha AI'
    },
    // The phases the status region announces.
    statusLabel: {
        id: 'copilot.chat.status.label',
        defaultMessage: 'Conversation status'
    },
    statusThinking: {
        id: 'copilot.chat.status.thinking',
        defaultMessage: 'Thinking'
    },
    statusAwaitingDecision: {
        id: 'copilot.chat.status.awaitingDecision',
        defaultMessage: 'Waiting for your decision'
    },
    statusComplete: {
        id: 'copilot.chat.status.complete',
        defaultMessage: 'Answer complete'
    },
    statusFailed: {
        id: 'copilot.chat.status.failed',
        defaultMessage: 'The answer failed'
    }
});

/**
 * How long a phase has to hold before it is announced, in ms.
 *
 * The phases change as fast as the run does — a search can start and finish
 * between two frames — and a live region that speaks every one of them is the
 * flood this replaced, moved somewhere else. Announcing only what is still true
 * a moment later is what makes it a status rather than a transcript.
 */
const STATUS_SETTLE_MS = 700;

/**
 * How far from the bottom still counts as "following the answer", in px.
 *
 * Generous on purpose: a reader who has nudged the scroller by a few pixels has
 * not stopped following, and a threshold tight enough to be exact would flip to
 * "not following" on the last block's own growth.
 */
const FOLLOW_SLACK = 48;

/**
 * Stop reasons that mean the answer above is **truncated**, phrased to complete
 * "Stopped because it …". `end` is the normal case and says nothing; `aborted`
 * is deliberate and handled separately below.
 */
const TRUNCATING_STOP_REASONS: Record<string, MessageDescriptor> = {
    'max-steps': messages.stopMaxSteps,
    'max-tokens': messages.stopMaxTokens,
    timeout: messages.stopTimeout,
    'max-output-tokens': messages.stopMaxOutputTokens,
    refusal: messages.stopRefusal
};

/**
 * The phase the run is in, as one short sentence — or `null` when there is
 * nothing to say (an idle transcript the user is simply reading).
 *
 * Derived from the newest turn only. Everything above it has already been
 * announced, or was there before the user arrived.
 */
function currentPhase(turns: ChatMessage[], intl: IntlShape): string | null {
    const last = turns[turns.length - 1];
    if (!last || last.role === 'user') return null;

    if (last.error) return intl.formatMessage(messages.statusFailed);

    if (last.permissions?.some((request) => !request.answered)) {
        return intl.formatMessage(messages.statusAwaitingDecision);
    }

    if (!last.streaming) return intl.formatMessage(messages.statusComplete);

    const running = last.blocks.find(
        (block) => block.kind === 'step' && block.step.status === 'running'
    );
    if (running && running.kind === 'step') {
        return stepAction(intl, running.step);
    }

    const activity = turnActivity(last);
    if (activity?.kind === 'after-step') {
        return stepAction(intl, activity.step);
    }
    return intl.formatMessage(messages.statusThinking);
}

/**
 * The one live region for the whole conversation: a named, polite
 * `role="status"` **outside** the transcript, carrying the run's current phase.
 *
 * The transcript used to be the live region — `role="log"` *and*
 * `aria-live="polite"`, with `aria-relevant` defaulting to `additions text`. A
 * `text-delta` frame arrives dozens to hundreds of times per answer and each one
 * mutates the last text block, so from the first token to the last the speech
 * queue was saturated with one sentence being re-read as it grew, and nothing
 * else could be announced while it happened (`ORT-116`). Meanwhile opening a
 * thread announced nothing at all, because the skeleton it replaced is
 * (correctly) `aria-hidden`.
 *
 * One region rather than several is the point: two would argue, which is the
 * failure the `Spinner` clean-up removed elsewhere in the design system.
 */
function TranscriptStatus({ turns }: { turns: ChatMessage[] }) {
    const intl = useIntl();
    const phase = currentPhase(turns, intl);
    const [announced, setAnnounced] = useState<string | null>(phase);

    useEffect(() => {
        // Terminal phases are announced immediately: "Answer complete" arriving
        // 700ms late is the one announcement a reader is actually waiting for.
        const terminal =
            phase === intl.formatMessage(messages.statusComplete) ||
            phase === intl.formatMessage(messages.statusFailed) ||
            phase === intl.formatMessage(messages.statusAwaitingDecision);
        if (terminal) {
            setAnnounced(phase);
            return;
        }
        const timer = setTimeout(() => setAnnounced(phase), STATUS_SETTLE_MS);
        return () => clearTimeout(timer);
    }, [phase, intl]);

    return (
        <p
            role="status"
            aria-label={intl.formatMessage(messages.statusLabel)}
            className="sr-only"
        >
            {announced ?? ''}
        </p>
    );
}

/**
 * The transcript. Each turn shows the message, the tool steps it ran, and —
 * when the run ended for a reason other than a finished answer — a line saying
 * so, because a truncated answer that looks complete is worse than a short one.
 */
export function MessageList({
    messages: turns,
    onAnswer,
    onExtend
}: {
    messages: ChatMessage[];
    /** Answers a parked tool call. Omitted, prompts render read-only. */
    onAnswer?(
        runId: string,
        callId: string,
        decision: ToolPermissionDecision
    ): void;
    /** Asks a parked run for more time. Omitted, the prompt offers no extension. */
    onExtend?(runId: string, callId: string): void;
}) {
    const intl = useIntl();
    const endRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    // Whether the reader is still following the bottom. Starts true — a
    // transcript you have just opened is one you are at the end of.
    const following = useRef(true);

    // Follow the answer as it streams — **but only while the reader is still at
    // the bottom.** This used to fire on every `turns` change unconditionally,
    // and `turns` changes on every `text-delta`: scrolling up to re-read an
    // earlier turn while an answer was still arriving yanked you back down on
    // the next token, over and over, with no way to stay put but to stop the
    // run. Scrolling away is the reader saying they are reading something else,
    // and scrolling back to the bottom is them saying they are done.
    useEffect(() => {
        if (following.current) {
            endRef.current?.scrollIntoView({ block: 'end' });
        }
    }, [turns]);

    // A tolerance rather than an exact match: sub-pixel layout, a growing last
    // block and the scroller's own padding all mean "at the bottom" is never
    // `scrollTop === scrollHeight - clientHeight` on the nose.
    const onScroll = () => {
        const el = scrollerRef.current;
        if (!el) {
            return;
        }
        following.current =
            el.scrollHeight - el.clientHeight - el.scrollTop <= FOLLOW_SLACK;
    };

    if (turns.length === 0) {
        return (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
                <TranscriptStatus turns={turns} />
                <p className="text-sm">{intl.formatMessage(messages.empty)}</p>
                <p className="text-xs">
                    {intl.formatMessage(messages.emptyHint)}
                </p>
            </div>
        );
    }

    return (
        <>
            {/* Outside the log, and `sr-only` — `sr-only` is absolutely
                positioned, so it is not a flex item that changes the layout. */}
            <TranscriptStatus turns={turns} />
            <div
                ref={scrollerRef}
                onScroll={onScroll}
                className="flex-1 overflow-y-auto px-4 py-4"
                role="log"
                // **Not a live region.** `role="log"` is kept for navigation —
                // it is what lets a screen reader treat the turns as a readable
                // sequence — but the announcing is `TranscriptStatus`'s job now.
                // Streaming text mutates this subtree on every token, and a
                // polite live region over it re-read the growing sentence from
                // the top each time (`ORT-116`).
                aria-live="off"
                aria-label={intl.formatMessage(messages.transcript)}
            >
                {/* The scroller runs the full width so the scrollbar sits at the
                edge of the surface, but the text does not: a transcript read
                across a 1400px page is a transcript nobody finishes a line of.
                A no-op in the 420px docked panel, which never reaches the cap. */}
                <div className="mx-auto w-full max-w-3xl space-y-4">
                    {turns.map((turn) => (
                        <Turn
                            key={turn.id}
                            turn={turn}
                            {...(onAnswer ? { onAnswer } : {})}
                            {...(onExtend ? { onExtend } : {})}
                        />
                    ))}
                    <div ref={endRef} />
                </div>
            </div>
        </>
    );
}

function Turn({
    turn,
    onAnswer,
    onExtend
}: {
    turn: ChatMessage;
    onAnswer?(
        runId: string,
        callId: string,
        decision: ToolPermissionDecision
    ): void;
    onExtend?(runId: string, callId: string): void;
}) {
    const intl = useIntl();
    const reason = turn.stopReason
        ? TRUNCATING_STOP_REASONS[turn.stopReason]
        : undefined;
    // Cancelling is something the user did on purpose, so it gets a quiet note
    // rather than a warning banner telling them about their own action.
    const cancelled = turn.stopReason === 'aborted';
    const activity = turnActivity(turn);

    if (turn.role === 'user') {
        return (
            // An `<article>` with a name, not a bare `<div>`: the speaker was
            // carried by fill colour and alignment alone (1.3.1, 1.4.1), and
            // naming the entries is what makes the surrounding `role="log"`
            // navigable at all (`ORT-116`).
            <article
                aria-label={intl.formatMessage(messages.youSaid)}
                className="flex flex-col items-end gap-1.5"
            >
                <div className="bg-primary text-primary-foreground max-w-[85%] rounded-lg rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap">
                    {turn.text}
                </div>
                {/* Below the bubble rather than inside it: a chip on the
                    primary fill would need its own colour pair to stay legible,
                    and the file is a companion to the message, not part of the
                    sentence. */}
                {turn.attachments?.length ? (
                    <ul
                        className="flex max-w-[85%] flex-wrap justify-end gap-1.5"
                        aria-label={intl.formatMessage(messages.attachments)}
                    >
                        {turn.attachments.map((attachment) => (
                            <li key={attachment.assetId}>
                                <AttachmentChip
                                    name={attachment.name}
                                    size={attachment.size}
                                    kind={attachment.kind}
                                    // The library's own download route. It
                                    // derives its scope from membership, so the
                                    // link works for anyone who can see the
                                    // thread and 404s for anyone who cannot.
                                    href={`/api/media/assets/${attachment.assetId}/raw`}
                                />
                            </li>
                        ))}
                    </ul>
                ) : null}
                {/* The skills this turn ran under — including the workspace's
                    always-on ones, which nobody in this chat chose. Reading a
                    thread back, this is the only place anyone learns that an
                    answer was written under instructions they never saw. */}
                {turn.skills?.length ? (
                    <ul
                        className="flex max-w-[85%] flex-wrap justify-end gap-1.5"
                        aria-label={intl.formatMessage(messages.skills)}
                    >
                        {turn.skills.map((skill) => (
                            <li key={skill.name}>
                                <SkillChip title={skill.title} />
                            </li>
                        ))}
                    </ul>
                ) : null}
            </article>
        );
    }

    return (
        <article
            aria-label={intl.formatMessage(messages.assistantSaid)}
            className="space-y-2"
        >
            {/* **In the order the run produced them.** These were three
                buckets — every step, then all the prose, then every change card
                — and the layout could not say when anything happened: a model
                that explained, saved, and kept writing showed the card pinned
                below text that was written after it. */}
            {turn.blocks.map((block) => {
                if (block.kind === 'text') {
                    return block.text ? (
                        <Markdown key={block.id} text={block.text} />
                    ) : null;
                }
                if (block.kind === 'step') {
                    return <ToolStep key={block.id} step={block.step} />;
                }
                // After the prose that introduces it and before whatever comes
                // next — a receipt where the change was made.
                return (
                    <ProposalCard key={block.id} proposal={block.proposal} />
                );
            })}

            {/* Before the change cards and after the steps: this is the one
                thing in the transcript the run is *blocked* on, so it belongs
                where the reader's eye already is — at the bottom of what has
                happened so far. */}
            {turn.permissions
                ?.filter((request) => !request.answered)
                .map((request) => (
                    <PermissionPrompt
                        key={request.id}
                        request={request}
                        onDecide={(decision) =>
                            onAnswer?.(request.runId, request.id, decision)
                        }
                        {...(onExtend
                            ? {
                                  onExtend: () =>
                                      onExtend(request.runId, request.id)
                              }
                            : {})}
                    />
                ))}

            {/* **The current action, named.** Also *between* tool calls and
                not only before the first one — a turn that searched and then
                thought for three seconds used to show a finished step and
                nothing else, and the answer looked stuck. What is new is that
                the gap after a call says which call it was, rather than the one
                word "Thinking…" standing in for every state the run can be in.
                `turnActivity` owns when it appears and what it knows; a running
                step still has its own spinner and this stands down for it
                rather than doubling up. */}
            {activity && (
                // `motion-reduce:animate-none` because this pulses for the
                // whole time the model is thinking — the longest-lived
                // animation in the package, and the one 503.2 is about.
                <p className="text-muted-foreground animate-pulse text-sm motion-reduce:animate-none">
                    {activity.kind === 'thinking'
                        ? intl.formatMessage(messages.thinking)
                        : intl.formatMessage(messages.afterStep, {
                              action: stepAction(intl, activity.step)
                          })}
                </p>
            )}

            {/* A real Alert, not a line of red text: a failed turn is the one
                thing in the transcript a user must not scroll past, and the
                design system's `role="alert"` also gets it announced. */}
            {turn.error && (
                <Alert variant="destructive">
                    <CircleAlert className="size-4" />
                    <AlertTitle>
                        {intl.formatMessage(messages.errorTitle)}
                    </AlertTitle>
                    <AlertDescription>{turn.error}</AlertDescription>
                </Alert>
            )}

            {cancelled && !turn.error && (
                <p className="text-muted-foreground text-xs">
                    {intl.formatMessage(messages.cancelled)}
                </p>
            )}

            {/* A ceiling is not an error — the answer above is real, just cut
                short — so it is a warning rather than a destructive alert. It
                used to be muted 12px text under the answer, which is exactly
                where "this is truncated" goes unread. */}
            {reason && !turn.error && (
                <Alert variant="warning">
                    <TriangleAlert className="size-4" />
                    <AlertTitle>
                        {intl.formatMessage(messages.incompleteTitle)}
                    </AlertTitle>
                    <AlertDescription>
                        {intl.formatMessage(messages.stoppedFor, {
                            reason: intl.formatMessage(reason)
                        })}
                    </AlertDescription>
                </Alert>
            )}
        </article>
    );
}

/**
 * What a finished call *did*, in words — the same past-tense phrase the step
 * list shows, reused rather than re-worded so the status line and the log
 * cannot drift into two names for one call.
 *
 * Falls back to {@link humanizeToolName} for a tool nobody wrote a phrase for
 * (an MCP connector's), which is deliberately untranslated — see `labels.ts`.
 */
function stepAction(intl: IntlShape, step: ChatToolStep): string {
    const phrase = toolPhrase(step.name, 'done');
    return phrase ? intl.formatMessage(phrase) : humanizeToolName(step.name);
}
