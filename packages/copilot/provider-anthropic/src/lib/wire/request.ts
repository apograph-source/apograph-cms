import type Anthropic from '@anthropic-ai/sdk';
import type {
    ContentBlockParam,
    MessageParam,
    Tool
} from '@anthropic-ai/sdk/resources/messages';
import type {
    ModelMessage,
    ModelRequest,
    ModelTool
} from '@orthacms/copilot-domain';
import type { AnthropicProviderConfig } from '../config';

/**
 * The body `messages.stream` accepts, derived from the method rather than
 * imported by name — the SDK moves these aliases between barrels across
 * releases, and the method signature is the thing we actually have to satisfy.
 */
type StreamParams = Parameters<Anthropic['messages']['stream']>[0];

/** A five-minute cache entry — the API's default TTL. See {@link markCache}. */
const EPHEMERAL = { type: 'ephemeral' } as const;

/**
 * The API's ceiling on `cache_control` breakpoints in one request. Exceeding it
 * is a 400, so the budget is spent deliberately: one on the static prefix
 * (tools + system), the rest rolling through the conversation.
 */
const MAX_CACHE_BREAKPOINTS = 4;

/**
 * How far back a breakpoint may sit from the previous one and still find it.
 *
 * A breakpoint walks back **at most 20 content blocks** looking for an existing
 * entry; past that it misses *silently* — no error, just a full-price prefill
 * and a `cache_read_input_tokens` of zero. A step that asks for one tool adds
 * two or three blocks and never comes close, but a turn requesting tools in
 * parallel adds a `tool_use` and a `tool_result` per call and can clear 20 on
 * its own. 15 leaves margin for the blocks the next step will append.
 */
const CACHE_LOOKBACK_MARGIN = 15;

/** Maps the port's tool descriptors onto Anthropic's tool definitions. */
export function toAnthropicTools(tools: readonly ModelTool[]): Tool[] {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Tool.InputSchema
    }));
}

/** Maps the port's block-structured turns onto Anthropic's message params. */
export function toAnthropicMessages(
    messages: readonly ModelMessage[]
): MessageParam[] {
    return messages.map((message) => ({
        role: message.role,
        content: message.content.map((block) => {
            switch (block.type) {
                case 'text':
                    return { type: 'text' as const, text: block.text };
                case 'tool_use':
                    return {
                        type: 'tool_use' as const,
                        id: block.id,
                        name: block.name,
                        input: block.input
                    };
                case 'tool_result':
                    return {
                        type: 'tool_result' as const,
                        tool_use_id: block.toolUseId,
                        content: block.content,
                        ...(block.isError ? { is_error: true } : {})
                    };
            }
        })
    }));
}

/** Returns `block` with a cache breakpoint on it. Never mutates the input. */
function markCache<T extends ContentBlockParam | Tool>(block: T): T {
    return { ...block, cache_control: EPHEMERAL };
}

/**
 * Places rolling cache breakpoints through the conversation, newest first.
 *
 * The newest turn always gets one, so the *next* step reads everything this
 * step sent rather than re-prefilling it. Older turns get one only when enough
 * blocks have accumulated to threaten {@link CACHE_LOOKBACK_MARGIN} — an extra
 * breakpoint is a cache *write*, so they are placed to keep the chain
 * reachable, not on every turn.
 *
 * Returns a new array; `messages` is left alone.
 */
function withCacheBreakpoints(
    messages: MessageParam[],
    budget: number
): MessageParam[] {
    const marked = new Set<number>();
    let sinceLast = 0;

    for (let i = messages.length - 1; i >= 0 && marked.size < budget; i -= 1) {
        const content = messages[i].content;
        // Always an array out of `toAnthropicMessages`, but the SDK's own type
        // allows a bare string, and there is no block on a string to mark.
        if (!Array.isArray(content) || content.length === 0) {
            continue;
        }
        const isNewest = marked.size === 0;
        if (isNewest || sinceLast + content.length >= CACHE_LOOKBACK_MARGIN) {
            marked.add(i);
            // The blocks of this message that sit *before* the one just marked
            // still count toward the next breakpoint's walk back.
            sinceLast = content.length - 1;
        } else {
            sinceLast += content.length;
        }
    }

    if (marked.size === 0) {
        return messages;
    }
    return messages.map((message, index) => {
        if (!marked.has(index) || !Array.isArray(message.content)) {
            return message;
        }
        const content = [...message.content];
        content[content.length - 1] = markCache(
            content[content.length - 1] as ContentBlockParam
        );
        return { ...message, content };
    });
}

/**
 * Builds the streaming request body for an already-resolved `model`.
 *
 * **No `thinking` configuration is sent**, deliberately. On current models
 * thinking is on by default, and turning it off makes them occasionally write
 * a tool call into the *visible text* instead of emitting a tool-use block —
 * the call then silently never runs, which for a tool-driven copilot is the
 * worst available failure mode. The lever for cheaper runs is `config.effort`.
 *
 * No sampling parameters either: current models reject `temperature`, `top_p`
 * and `top_k` outright, which is why the port never carried them.
 *
 * **Prompt caching is on unless the host turns it off.** A run is a loop, and
 * the API is stateless, so step _n_ resends everything steps 1…_n_−1 already
 * sent — the prompt grows every step while the *new* content is one tool
 * result. Uncached, a run's billed input is roughly quadratic in its step
 * count, which is what made the step ceiling behave like a cost ceiling. Cache
 * reads are ~0.1x base input, so the resent prefix stops dominating and
 * `maxTotalTokens` goes back to measuring new work.
 *
 * Placement follows the API's render order — `tools` → `system` → `messages` —
 * so a single breakpoint at the end of `system` covers the tools with it. That
 * one is the whole static prefix of every step in the run; the rest roll
 * through the conversation ({@link withCacheBreakpoints}).
 */
export function toStreamParams(
    request: ModelRequest,
    config: AnthropicProviderConfig,
    model: string
): StreamParams {
    const tools = request.tools ?? [];
    const anthropicTools = toAnthropicTools(tools);
    const messages = toAnthropicMessages(request.messages);
    // Off only by explicit opt-out: a `baseUrl` gateway that rejects the field
    // is the case this exists for, and it is rarer than the loop it pays for.
    const caching = config.promptCaching !== false;

    // The breakpoint that matters most, on whichever block ends the static
    // prefix. With a system prompt that is its last block — tools render ahead
    // of it and are covered by the same entry. Without one, the last tool is
    // the end of the prefix, and marking it is the only way to cache the tools
    // at all. (Below the model's minimum cacheable prefix nothing is written;
    // that is silent by design and costs nothing.)
    const cacheSystem = caching && Boolean(request.system);
    const cacheTools = caching && !cacheSystem && anthropicTools.length > 0;
    if (cacheTools) {
        anthropicTools[anthropicTools.length - 1] = markCache(
            anthropicTools[anthropicTools.length - 1]
        );
    }

    return {
        model,
        max_tokens: request.maxOutputTokens,
        ...(request.system
            ? {
                  system: cacheSystem
                      ? [
                            {
                                type: 'text' as const,
                                text: request.system,
                                cache_control: EPHEMERAL
                            }
                        ]
                      : request.system
              }
            : {}),
        messages: caching
            ? withCacheBreakpoints(messages, MAX_CACHE_BREAKPOINTS - 1)
            : messages,
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
        ...(config.effort ? { output_config: { effort: config.effort } } : {})
    };
}
