import type { ModelStopReason, ModelUsage } from '@orthacms/copilot-domain';
import type { ChatCompletionChunk } from './types';

/** Maps OpenAI's finish reasons onto the port's vocabulary. */
export function toStopReason(
    finishReason: string | null | undefined
): ModelStopReason {
    switch (finishReason) {
        case 'tool_calls':
        case 'function_call':
            return 'tool_use';
        case 'length':
            return 'max_tokens';
        case 'content_filter':
            return 'refusal';
        default:
            return 'end';
    }
}

/**
 * Reads the usage record from a chunk that carries one. Servers that don't
 * support `stream_options.include_usage` never send it, which is why the
 * caller keeps a zeroed default rather than treating absence as an error.
 */
export function toUsage(
    usage: NonNullable<ChatCompletionChunk['usage']>
): ModelUsage {
    const cached = usage.prompt_tokens_details?.cached_tokens;
    return {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        ...(cached === undefined ? {} : { cachedInputTokens: cached })
    };
}
