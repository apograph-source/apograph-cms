import type { ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { ChevronRight, CircleAlert, CircleCheck } from 'lucide-react';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Spinner
} from '@orthacms/design-system';
import type { ChatToolStep } from '../../domain/types/chat';
import { toolResultRendererFor } from '../slots/copilotSlots';
import { humanizeToolName, toolPhrase, toolSubject } from './labels';

const messages = defineMessages({
    // Fallbacks for a tool with no phrase of its own — an MCP connector's, or
    // one added without touching `labels.ts`. The name is interpolated rather
    // than left bare so the line still reads as a sentence.
    runningOther: {
        id: 'copilot.step.runningOther',
        defaultMessage: '{tool}…'
    },
    doneOther: {
        id: 'copilot.step.doneOther',
        defaultMessage: '{tool}'
    },
    toolName: {
        id: 'copilot.step.toolName',
        defaultMessage: 'Tool'
    },
    failed: {
        id: 'copilot.step.failed',
        defaultMessage: 'Failed'
    },
    // The status is otherwise carried by icon shape and colour alone — a red
    // ring vs a green tick — which is nothing at all to a screen reader and
    // 1.4.1 to anyone who cannot tell the two apart. Visually hidden, because
    // the icon is the design and the word is the same information in text.
    statusRunning: {
        id: 'copilot.step.status.running',
        defaultMessage: 'Running'
    },
    statusSucceeded: {
        id: 'copilot.step.status.succeeded',
        defaultMessage: 'Succeeded'
    },
    statusFailed: {
        id: 'copilot.step.status.failed',
        defaultMessage: 'Failed'
    },
    input: {
        id: 'copilot.step.input',
        defaultMessage: 'Input'
    },
    output: {
        id: 'copilot.step.output',
        defaultMessage: 'Output'
    },
    duration: {
        id: 'copilot.step.duration',
        defaultMessage: '{ms}ms'
    },
    result: {
        id: 'copilot.step.result',
        defaultMessage: 'Result'
    }
});

/**
 * One tool call, collapsed to a single line and expandable to the exact input
 * and output — "no invisible actions"
 * ([`docs/design/copilot.md`](../../../../../../docs/design/copilot.md) §2).
 *
 * The step appears the moment the call is issued, before it has run, so a slow
 * or failing tool is visible rather than a gap in the answer.
 *
 * **It reads as a sentence in both tenses**: "Searching content…" while it runs,
 * "Searched content · 12 results" once it has. It used to show the raw
 * `admin_content_search` with a separate "Running…", which is a pending state
 * that technically existed and told nobody anything — for a tool that takes
 * 20ms it also flashes past, so what a user actually saw was a list of
 * snake_case function names. The identifier is still available, one click away
 * in the expanded panel, where someone debugging wants it and nobody else has
 * to read it.
 */
export function ToolStep({ step }: { step: ChatToolStep }) {
    const intl = useIntl();
    const running = step.status === 'running';
    const phrase = toolPhrase(step.name, running ? 'running' : 'done');
    const label = phrase
        ? intl.formatMessage(phrase)
        : intl.formatMessage(
              running ? messages.runningOther : messages.doneOther,
              {
                  tool: humanizeToolName(step.name)
              }
          );
    // What the call is *about*, from its own arguments. Untrusted text — see
    // `toolSubject` — and rendered as a text node, never as markup.
    const subject = toolSubject(step.input);
    // A plugin's own rendering of this tool's result, if one is registered.
    // Resolved with a plain lookup, not a hook — see `toolResultRendererFor`.
    // Only for a call that finished and returned something: a failure is
    // already stated by the status, and a renderer should never have to
    // second-guess whether it is looking at a result or an error.
    const renderer =
        step.status === 'ok' && step.output !== undefined
            ? toolResultRendererFor(step.name)
            : undefined;
    const Result = renderer?.Component;

    return (
        <Collapsible className="border-border/60 bg-muted/40 rounded-md border">
            <CollapsibleTrigger className="group flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs">
                <ChevronRight
                    aria-hidden
                    className="text-muted-foreground size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
                />
                <StatusIcon status={step.status} />
                {/* The status in words, for anyone the icon's shape and colour
                    do not reach. */}
                <span className="sr-only">
                    {intl.formatMessage(
                        running
                            ? messages.statusRunning
                            : step.status === 'error'
                              ? messages.statusFailed
                              : messages.statusSucceeded
                    )}
                </span>
                {/* The running step is the one thing on this list that is
                    *happening*, so it carries a little more weight than the
                    entries above it, which are a log of what already did. */}
                <span className={running ? 'shrink-0 font-medium' : 'shrink-0'}>
                    {label}
                </span>
                {/* **What the call is about**, not just what kind of call it
                    is. "Creating an entry…" is a category; "Creating an entry ·
                    German translation of Prescribing Information" is the thing
                    the person asked for, and it is already on the wire — the
                    `tool-call` frame carries the arguments and arrives *before*
                    the call runs. */}
                {subject && (
                    <span className="text-muted-foreground min-w-0 truncate">
                        · {subject}
                    </span>
                )}
                {/* The tool's own one-liner — "12 results", "applied" — after
                    the phrase rather than instead of it.

                    **"Failed" is no longer conditional on there being no
                    summary.** It was `summary ?? 'Failed'`, so a step that
                    failed *and* returned a summary printed only the summary —
                    and the server writes one for the failure path too
                    ("failed: set the number"), which is the case most likely to
                    reach a user. The word came from the branch that could not
                    happen. Now the failure is stated by the `sr-only` status
                    above and by the icon, and the summary is what it always
                    was: extra detail after it. */}
                {!running && (step.summary || step.status === 'error') && (
                    <span className="text-muted-foreground truncate">
                        {step.summary ?? intl.formatMessage(messages.failed)}
                    </span>
                )}
                {step.durationMs !== undefined && (
                    <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">
                        {intl.formatMessage(messages.duration, {
                            ms: step.durationMs
                        })}
                    </span>
                )}
            </CollapsibleTrigger>

            <CollapsibleContent className="space-y-2 px-2.5 pb-2.5">
                <Payload
                    label={intl.formatMessage(messages.toolName)}
                    value={step.name}
                />
                <Payload
                    label={intl.formatMessage(messages.input)}
                    value={step.input}
                />
                {/* The owning plugin's rendering, **above** the raw payload
                    and never in place of it. A result that is itself the
                    answer — a list of flagged records — deserves better than a
                    JSON array, but "no invisible actions" means the exact
                    output stays one scroll below it rather than being
                    swapped out. */}
                {Result ? (
                    <Payload label={intl.formatMessage(messages.result)}>
                        <Result
                            name={step.name}
                            input={step.input}
                            output={step.output}
                        />
                    </Payload>
                ) : null}

                {step.status === 'error' ? (
                    <Payload
                        label={intl.formatMessage(messages.failed)}
                        value={step.error}
                    />
                ) : (
                    step.output !== undefined && (
                        <Payload
                            label={intl.formatMessage(messages.output)}
                            value={step.output}
                        />
                    )
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}

/**
 * The status glyph. Every branch is `aria-hidden`: the word beside it in the
 * trigger is the accessible version, and a bare `Spinner` would otherwise mount
 * an **unnamed `role="status"` live region per running step** inside a
 * transcript that is already a live region.
 *
 * `motion-reduce:animate-none` on the spinner because 503.2 asks software with a
 * corresponding feature to respect the platform setting, and this one spins for
 * as long as the tool runs.
 */
function StatusIcon({ status }: { status: ChatToolStep['status'] }) {
    if (status === 'running') {
        return (
            <Spinner
                aria-hidden
                role="presentation"
                className="size-3.5 shrink-0 motion-reduce:animate-none"
            />
        );
    }
    if (status === 'error') {
        return (
            <CircleAlert
                aria-hidden
                className="text-destructive size-3.5 shrink-0"
            />
        );
    }
    return (
        <CircleCheck
            aria-hidden
            className="size-3.5 shrink-0 text-emerald-600"
        />
    );
}

/**
 * One labelled payload. Rendered as text in a `<pre>`, never as markup: a tool
 * result is content the workspace authored, and the expanded step is the one
 * place a user reads it raw.
 */
/**
 * A labelled block in the expanded panel.
 *
 * Renders `children` when given them and the pretty-printed `value` otherwise,
 * so a plugin's rich result and the raw payloads it sits above share one label
 * treatment rather than a copied class string that drifts.
 */
function Payload({
    label,
    value,
    children
}: {
    label: string;
    value?: unknown;
    children?: ReactNode;
}) {
    return (
        <div>
            <div className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wide uppercase">
                {label}
            </div>
            {children ?? (
                <pre className="bg-background max-h-56 overflow-auto rounded border p-2 text-[11px] leading-relaxed">
                    {stringify(value)}
                </pre>
            )}
        </div>
    );
}

/** Pretty JSON, or the value itself when it is already a string. */
function stringify(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2) ?? '';
    } catch {
        return String(value);
    }
}
