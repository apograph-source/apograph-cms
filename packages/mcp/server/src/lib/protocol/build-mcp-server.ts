import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    McpError,
    ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolOutput, ToolRegistry } from '@orthacms/tools-server';
import { toToolError } from '@orthacms/tools-server';
import type { ToolContext, ToolError } from '@orthacms/tools-server';

/**
 * MCP's own code for "the resource you named is not there". It is in the
 * specification but not in the SDK's `ErrorCode` enum, so it is spelled out
 * here rather than approximated with `InternalError`.
 */
const RESOURCE_NOT_FOUND = -32002;

/** Identity this server reports to clients during `initialize`. */
export interface McpServerInfo {
    /** Server name shown in client UIs. */
    name: string;
    /** Server version. */
    version: string;
}

/** The transport's own ceilings on one exchange. See {@link McpPluginConfig}. */
export interface McpServerLimits {
    /** Ceiling on one `tools/call`, in milliseconds. */
    callTimeoutMs: number;
    /** Ceiling on the serialised size of one tool result, in bytes. */
    maxResultBytes: number;
}

/**
 * Raised when {@link callWithinDeadline} stops waiting on a handler — because
 * the deadline passed, or because the caller hung up.
 *
 * A class of its own so neither reaches {@link toToolError}, which would log it
 * as an unhandled error with a stack. A client disconnecting is routine, and a
 * deadline is this file's own decision; neither is a bug in a tool.
 */
class CallAbandoned extends Error {
    constructor(readonly reason: 'timeout' | 'disconnect') {
        super(`The tool call was abandoned (${reason}).`);
    }
}

/**
 * Build the MCP protocol server for **one** authenticated request.
 *
 * Per-request rather than one long-lived instance, because the tool list is a
 * function of the caller: `tools/list` must show a `read`-scoped token a
 * different set than a `full`-scoped one, and resources are pruned to the
 * workspace's content grants. Binding the context into the handlers at
 * construction is what makes that impossible to get wrong — there is no shared
 * server whose handlers must remember to re-derive who is asking.
 *
 * The low-level `Server` is used rather than the SDK's `McpServer` helper
 * deliberately: that helper takes Zod shapes, while every schema here is
 * **generated JSON Schema** produced from the content registry at runtime.
 * Converting generated JSON Schema into Zod purely to have the SDK convert it
 * back is a lossy round-trip in service of nothing.
 *
 * ## Two ways a failure leaves this file, and why
 *
 * A `tools/call` failure rides out as an **`isError` result**; a `resources/*`
 * failure rides out as a **JSON-RPC error**. That asymmetry is the protocol's,
 * not an accident. A tool failure is an *outcome* the model is meant to read
 * and act on ("title must be at most 200 characters"), so MCP models it as a
 * successful call carrying `isError`. A resource read has no model in the loop
 * — the client asked for bytes at a URI and either gets them or does not — so
 * MCP models its failures as protocol errors, with `-32002` reserved for a URI
 * that is not there.
 *
 * What both paths share is {@link toToolError}: whatever a handler throws is
 * flattened the same way, so an unexpected error is opaque on either path and
 * never puts a raw message on the wire.
 */
export function buildMcpServer(
    registry: ToolRegistry,
    context: ToolContext,
    info: McpServerInfo,
    limits: McpServerLimits
): Server {
    const server = new Server(info, {
        capabilities: { tools: {}, resources: {} }
    });

    server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: registry.visibleTo(context, 'mcp').map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema as { type: 'object' },
            annotations: {
                title: tool.title,
                readOnlyHint: tool.readOnly,
                destructiveHint: tool.destructive ?? false
            }
        }))
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const { name, arguments: args } = request.params;
        let result: ToolOutput;
        try {
            result = await callWithinDeadline(
                registry,
                name,
                args,
                context,
                // The SDK aborts this when the client cancels the request or
                // the exchange closes — the only cancellation signal this
                // surface has, and previously dropped on the floor.
                extra.signal,
                limits.callTimeoutMs
            );
        } catch (error) {
            // `isError` rather than a JSON-RPC error, and this is the whole
            // point: a protocol error aborts the client's call, while an
            // `isError` result is handed back to the *model*, which can read
            // "title must be at most 200 characters" and fix its next call.
            // Refusals land here too — a model that learns it lacks
            // `content:publish` stops trying, instead of retrying blind.
            if (error instanceof CallAbandoned) {
                return errorResult(
                    error.reason === 'timeout'
                        ? {
                              status: 504,
                              code: 'timeout',
                              message: `"${name}" did not finish within ${limits.callTimeoutMs}ms and was abandoned. Retry, or narrow the request.`
                          }
                        : // Nobody is reading this: the exchange is already
                          // closed. It exists so the handler chain unwinds
                          // through one shape rather than two.
                          {
                              status: 499,
                              code: 'client_closed_request',
                              message: `"${name}" was abandoned because the caller disconnected.`
                          }
                );
            }
            return errorResult(toToolError(error));
        }

        // Sized before either copy is handed to the transport, because the
        // response costs roughly three times this on the way out: the text
        // block, `structuredContent`, and the transport's own serialisation.
        const text = stringify(result);
        const bytes = Buffer.byteLength(text);
        if (bytes > limits.maxResultBytes) {
            return errorResult({
                status: 413,
                code: 'result_too_large',
                message: `"${name}" returned ${bytes} bytes, over this endpoint's ${limits.maxResultBytes}-byte limit. Ask for less — a smaller page size, fewer fields, or a narrower filter.`
            });
        }
        return {
            // Both spellings of the same value: `structuredContent` for
            // clients that parse it, and the text block for models that
            // only ever see `content`. Emitting one or the other would
            // make the tool useless to half the ecosystem.
            content: [{ type: 'text' as const, text }],
            structuredContent: asStructured(result)
        };
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        try {
            return { resources: [...(await registry.resources(context))] };
        } catch (error) {
            throw toMcpError(error);
        }
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        try {
            const contents = await registry.readResource(
                request.params.uri,
                context
            );
            return { contents: [contents] };
        } catch (error) {
            throw toMcpError(error);
        }
    });

    return server;
}

/**
 * Run one tool, giving up on it after `timeoutMs`.
 *
 * The handler is given a signal that fires for either reason — the deadline or
 * the caller going away — so a tool doing real I/O can stop. A tool that
 * ignores it keeps running: this bounds **the caller's wait**, which is the
 * guarantee a request/response transport owes, and deliberately not the work,
 * which nothing at this layer can end.
 */
async function callWithinDeadline(
    registry: ToolRegistry,
    name: string,
    args: Record<string, unknown> | undefined,
    context: ToolContext,
    callerSignal: AbortSignal | undefined,
    timeoutMs: number
): Promise<ToolOutput> {
    const controller = new AbortController();
    const relay = () => controller.abort();
    callerSignal?.addEventListener('abort', relay, { once: true });
    let expired = false;
    const timer = setTimeout(() => {
        // Set before aborting, so the listener that fires as a consequence can
        // tell a deadline from a caller who hung up.
        expired = true;
        controller.abort();
    }, timeoutMs);
    try {
        const pending = registry.call(
            name,
            args,
            { ...context, signal: controller.signal },
            'mcp'
        );
        // The loser of the race still settles. Without this, a handler that
        // fails *after* the deadline becomes an unhandled rejection and takes
        // the process down — the exact failure mode this timeout exists to
        // contain.
        pending.catch(() => undefined);
        return await Promise.race([
            pending,
            rejectWhenAborted(controller.signal, () => expired)
        ]);
    } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', relay);
    }
}

/** A promise that never resolves and rejects once `signal` aborts. */
function rejectWhenAborted(
    signal: AbortSignal,
    timedOut: () => boolean
): Promise<never> {
    return new Promise<never>((_, reject) => {
        const fail = () =>
            reject(new CallAbandoned(timedOut() ? 'timeout' : 'disconnect'));
        if (signal.aborted) {
            fail();
            return;
        }
        signal.addEventListener('abort', fail, { once: true });
    });
}

/** One tool failure, in the shape a model reads. */
function errorResult(failure: ToolError) {
    return {
        isError: true,
        content: [{ type: 'text' as const, text: stringify(failure) }]
    };
}

/**
 * Whatever a resource handler threw, as the JSON-RPC error the client gets.
 *
 * The flattened {@link ToolError} rides along as `data`, so a client reads the
 * same `status` / `code` / `issues` it would from a tool — and an *unexpected*
 * throw is reported opaquely, rather than putting a driver's message on the
 * wire under a code that calls it an internal error.
 */
function toMcpError(error: unknown): McpError {
    const failure = toToolError(error);
    return new McpError(
        jsonRpcCodeFor(failure.status),
        failure.message,
        failure
    );
}

/**
 * Status → JSON-RPC code. A refusal shares `-32002` with an absence on
 * purpose: for *data* the answer is deliberately uniform (an ungranted content
 * type reads exactly like one that does not exist), and `data.code` still says
 * `forbidden` for a client that wants to tell them apart.
 */
function jsonRpcCodeFor(status: number): number {
    if (status === 403 || status === 404) {
        return RESOURCE_NOT_FOUND;
    }
    if (status === 400 || status === 422) {
        return ErrorCode.InvalidParams;
    }
    return ErrorCode.InternalError;
}

/**
 * MCP's `structuredContent` must be a JSON **object**. Tool results are mostly
 * objects already (a list envelope, an entry); anything else is boxed under
 * `value` rather than dropped.
 */
function asStructured(result: unknown): Record<string, unknown> {
    return typeof result === 'object' &&
        result !== null &&
        !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : { value: result };
}

/** Pretty-printed JSON — the text rendering a model actually reads. */
function stringify(value: unknown): string {
    return JSON.stringify(value, null, 2) ?? 'null';
}
