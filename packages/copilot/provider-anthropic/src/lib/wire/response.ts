import type { StopReason, Usage } from '@anthropic-ai/sdk/resources/messages';
import type { ModelStopReason, ModelUsage } from '@orthacms/copilot-domain';

/** Maps Anthropic's stop reasons onto the port's smaller vocabulary. */
export function toStopReason(stopReason: StopReason | null): ModelStopReason {
    switch (stopReason) {
        case 'tool_use':
            return 'tool_use';
        case 'refusal':
            return 'refusal';
        case 'max_tokens':
        case 'model_context_window_exceeded':
            // Both mean "ran out of room" — the answer is truncated either way.
            return 'max_tokens';
        default:
            // `end_turn`, `stop_sequence`, `pause_turn` (unreachable without
            // server-side tools, which this adapter never enables), and null.
            return 'end';
    }
}

/**
 * Maps Anthropic's usage record onto the port's, dropping absent cache stats.
 *
 * The three input counts are **disjoint**: `input_tokens` is the uncached
 * remainder only, and the whole prompt is `input_tokens` + the two cache
 * figures. Reading only the first is how an agent that ran for an hour reports
 * 4k of input.
 */
export function toUsage(usage: Usage): ModelUsage {
    const cached = usage.cache_read_input_tokens;
    const written = usage.cache_creation_input_tokens;
    return {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        ...(cached === null || cached === undefined
            ? {}
            : { cachedInputTokens: cached }),
        ...(written === null || written === undefined
            ? {}
            : { cacheWriteInputTokens: written })
    };
}
