/**
 * The ceilings one run may not exceed. A bounded loop is what stops a model
 * that keeps asking for tools from spending a workspace's budget on a
 * conversation nobody is reading
 * ([`docs/design/copilot.md`](../../../../../docs/design/copilot.md) §5, step 8).
 *
 * All three are enforced, and exceeding any one ends the run with a reason the
 * UI shows — never a silent stop.
 */
export interface RunLimits {
    /**
     * Model calls per run. One "step" is a model call plus any tools it asked
     * for, so this bounds the tool loop's depth, not its width.
     */
    maxSteps: number;
    /** Wall clock for the whole run, in milliseconds. */
    wallClockMs: number;
    /** Input + output tokens across every model call in the run. */
    maxTotalTokens: number;
}

/**
 * Defaults sized for a run that **writes**, not the phase-1 read-only catalogue
 * these were first tuned for. There, a search-then-answer turn took two steps
 * and a multi-part question a handful more, so eight steps in two minutes was
 * generous. A write turn is not shaped like that: the model reads the type,
 * reads the entries it is about to change, proposes, reads the result, and
 * reports — and an instruction covering several entries repeats the middle of
 * that. Batching (`content_propose_bulk_save`) collapses the writes into one
 * call but not the reads around them, and runs were still ending on
 * `max-steps` with the answer half-written.
 *
 * All three move together on purpose. They are checked in the same loop, so
 * raising one alone just relocates the wall — a run given 30 steps and 120
 * seconds ends on `timeout` instead, which is the same truncated answer under
 * a different name. Every step is still authorized, audited and recorded; what
 * these bound is spend, and the ceiling that matters for spend is the token
 * one.
 *
 * Each is overridable per deployment — see `CopilotPluginConfig.limits`, and
 * `COPILOT_MAX_STEPS` / `COPILOT_WALL_CLOCK_MS` / `COPILOT_MAX_TOTAL_TOKENS`
 * in the host's `ortha.config.ts`.
 */
export const DEFAULT_RUN_LIMITS: RunLimits = {
    maxSteps: 30,
    wallClockMs: 300_000,
    maxTotalTokens: 400_000
};

/**
 * Why a run ended. A superset of the provider's `ModelStopReason`: the model
 * reports why *it* stopped generating, while this reports why the *run* ended,
 * which includes limits the engine imposes and the model never sees.
 */
export type RunStopReason =
    /** The model produced a final answer. */
    | 'end'
    /** Hit {@link RunLimits.maxSteps}. */
    | 'max-steps'
    /** Hit {@link RunLimits.maxTotalTokens}. */
    | 'max-tokens'
    /** Hit {@link RunLimits.wallClockMs}. */
    | 'timeout'
    /** One model response was truncated by its own output ceiling. */
    | 'max-output-tokens'
    /** The provider's safety classifiers declined. */
    | 'refusal'
    /** The client disconnected, or the user cancelled. */
    | 'aborted'
    /** The run failed. The message is carried on the error event. */
    | 'error';

/**
 * How each stop reason is phrased **to the model**, inside
 * {@link interruptionNote}.
 *
 * Deliberately not exported, and deliberately not the UI's copy. It was both,
 * as `RUN_STOP_EXPLANATIONS` — "for the UI to show" — and a
 * `Record<RunStopReason, string>` of finished English sentences cannot enter
 * the admin's i18n pipeline: there is no message id to extract, nothing for a
 * translator to see, and no `IntlProvider` involvement. A localized admin given
 * this could only render English, so `copilot/admin` reasonably restated all
 * five in its own `defineMessages` — leaving two sources of truth for the same
 * sentences, already drifted in both wording and coverage.
 *
 * Rendering is presentation, and {@link RunStopReason} is the contract the
 * admin keys off. What is left here is the one case where server-authored
 * English is right: text the **model** reads.
 */
const RUN_STOP_NOTES: Record<RunStopReason, string> = {
    end: 'Finished.',
    'max-steps': 'Stopped after reaching the maximum number of steps.',
    'max-tokens': 'Stopped after reaching this run’s token budget.',
    timeout: 'Stopped after running longer than allowed.',
    'max-output-tokens': 'The answer was cut short by the response limit.',
    refusal: 'The model declined to answer.',
    aborted: 'Cancelled.',
    error: 'Stopped by an error.'
};

/**
 * The stop reasons that mean an assistant turn was **cut off**, rather than
 * ended by the model having said what it had to say.
 *
 * `end` is the ordinary finish. `refusal` is deliberate and is left out on
 * purpose: the model declined, and a note inviting it to "pick up where it
 * stopped" is precisely the nudge that should not be there.
 */
const CUT_SHORT_REASONS: ReadonlySet<string> = new Set<RunStopReason>([
    'max-steps',
    'max-tokens',
    'timeout',
    'max-output-tokens',
    'aborted',
    'error'
]);

/**
 * Whether a persisted `stopReason` names a turn that was cut off. Takes the
 * stored `string | null` rather than the union, because that is what comes back
 * out of the database.
 */
export function wasCutShort(stopReason: string | null): boolean {
    return stopReason !== null && CUT_SHORT_REASONS.has(stopReason);
}

/**
 * The line that tells the model an earlier turn of this conversation was
 * interrupted, and why — replayed as part of that turn.
 *
 * Why it has to be said at all: the ceilings are the engine's, not the
 * provider's, so {@link RunStopReason} is explicit that they are "limits the
 * engine imposes and the model never sees". A turn cut off at one replays
 * looking exactly like a turn that finished, and "continue" then restarts the
 * whole task instead of resuming the interrupted one.
 *
 * **A note, on the turns it happened to — not a summary of the thread.** One
 * sentence on a turn that was already cut off: a few dozen tokens on a
 * conversation where something went wrong, and nothing at all on one where
 * nothing did. The phrasings live in `RUN_STOP_NOTES` above; they are written
 * for the model, and are **not** what the user is shown — the admin renders its
 * own translated copy from the same {@link RunStopReason}.
 *
 * The dropped-tool-calls sentence is not incidental: `normalizeTranscript`
 * removes `tool_use` blocks a cut-off run never got results for, so work the
 * model can see itself starting is genuinely missing from what it replays.
 * Unsaid, the transcript reads as though those steps were never attempted.
 */
export function interruptionNote(stopReason: RunStopReason): string {
    return (
        `(That turn did not finish. ${RUN_STOP_NOTES[stopReason]} ` +
        'Any tool call it had started but not completed is absent from this ' +
        'transcript. If the user asks you to continue, resume from where it ' +
        'stopped rather than starting the task again.)'
    );
}
