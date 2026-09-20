import type {
    ModelMessage,
    ModelRequest,
    ModelTool
} from '@orthacms/copilot-domain';
import { DEFAULT_MAX_TOKENS_FIELD, type OpenAiProviderConfig } from '../config';
import type { ChatMessage } from './types';

/**
 * Flattens the port's block-structured turns onto OpenAI's flat message list.
 * One turn can become several messages: tool results ride on their own `tool`
 * messages after the assistant turn that requested them, rather than inside
 * the user turn that carried them.
 */
export function toChatMessages(
    messages: readonly ModelMessage[],
    system?: string
): ChatMessage[] {
    const chat: ChatMessage[] = system
        ? [{ role: 'system', content: system }]
        : [];

    for (const message of messages) {
        const text: string[] = [];
        const toolCalls: NonNullable<ChatMessage['tool_calls']> = [];
        const toolResults: ChatMessage[] = [];

        for (const block of message.content) {
            if (block.type === 'text') {
                text.push(block.text);
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    type: 'function',
                    function: {
                        name: block.name,
                        arguments: JSON.stringify(block.input ?? {})
                    }
                });
            } else {
                toolResults.push({
                    role: 'tool',
                    tool_call_id: block.toolUseId,
                    content: block.content
                });
            }
        }

        if (text.length > 0 || toolCalls.length > 0) {
            chat.push({
                role: message.role,
                content: text.join('\n'),
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
            });
        }
        chat.push(...toolResults);
    }

    return chat;
}

/** Maps the port's tool descriptors onto OpenAI function definitions. */
export function toChatTools(tools: readonly ModelTool[]): unknown[] {
    return tools.map((tool) => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
        }
    }));
}

/** Builds the streaming request body for an already-resolved `model`. */
export function toRequestBody(
    request: ModelRequest,
    config: OpenAiProviderConfig,
    model: string
): Record<string, unknown> {
    const tools = request.tools ?? [];
    return {
        model,
        messages: toChatMessages(request.messages, request.system),
        ...(tools.length > 0 ? { tools: toChatTools(tools) } : {}),
        [config.maxTokensField ?? DEFAULT_MAX_TOKENS_FIELD]:
            request.maxOutputTokens,
        stream: true,
        // Servers that don't know this field ignore it; the ones that do
        // return a final usage-only chunk.
        stream_options: { include_usage: true }
    };
}

/** Assembles the request headers, letting `config.headers` override the rest. */
export function toRequestHeaders(
    config: OpenAiProviderConfig
): Record<string, string> {
    return {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        ...config.headers
    };
}
