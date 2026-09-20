import type { ModelRequest, ModelUsage } from '@orthacms/copilot-domain';

/**
 * Rough, deterministic token estimate. **Not a tokenizer** — the point is that
 * usage accounting has stable non-zero numbers to assert against, not that the
 * numbers match any real model's billing.
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** Every character the request would put in front of the model. */
function requestText(request: ModelRequest): string {
    const parts: string[] = [request.system ?? ''];
    for (const message of request.messages) {
        for (const block of message.content) {
            if (block.type === 'text') {
                parts.push(block.text);
            } else if (block.type === 'tool_result') {
                parts.push(block.content);
            } else {
                parts.push(block.name, JSON.stringify(block.input));
            }
        }
    }
    for (const tool of request.tools ?? []) {
        parts.push(tool.name, tool.description);
    }
    return parts.join('');
}

/** The usage record a turn reports when the script doesn't override it. */
export function estimateUsage(
    request: ModelRequest,
    replyText: string
): ModelUsage {
    return {
        inputTokens: estimateTokens(requestText(request)),
        outputTokens: estimateTokens(replyText)
    };
}
