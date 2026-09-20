import type { CopilotRunEvent } from '@orthacms/copilot-domain';

/** What starting a run needs. Mirrors the server's `CreateRunDto` exactly. */
export interface StartRunRequest {
    /** What the user typed. */
    message: string;
    /** Continue this thread; omit to start a new one. */
    conversationId?: string;
    /** The admin UI's locale, so the model answers in the reader's language. */
    uiLocale?: string;
    /** The registered provider to run on. Omit to let the host's resolver pick. */
    provider?: string;
    /** The model id to run on. Omit for the provider's default. */
    model?: string;
    /** Where the user is. */
    context?: {
        surface?: 'chat' | 'palette' | 'entry' | 'records' | 'create';
        contentType?: string;
        entryId?: string;
        locale?: string;
    };
    /**
     * Media asset ids attached to this turn. Ids only — the server resolves the
     * name, kind and size from the row, because that is the only part it can
     * verify.
     */
    attachments?: { assetId: string }[];
    /**
     * Skills attached to this turn. **Names only** — the server resolves the
     * instructions from the catalogue, because a request that could carry them
     * would be a client writing its own system prompt.
     */
    skills?: { name: string }[];
}

/** Everything the transport needs beyond the request body. */
export interface StartRunOptions {
    /** The workspace the run is scoped to — sent as `X-Workspace-Id`. */
    workspaceId: string;
    /** Aborts the run. The server stops on client disconnect. */
    signal?: AbortSignal;
}

/**
 * Raised when the server answers a run with an error status instead of a
 * stream — a 400 from the strict validation pipe, a 403 from a guard, a 401
 * when the session died.
 */
export class CopilotRunError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
        this.name = 'CopilotRunError';
    }
}

/**
 * Starts a run and yields its events as they arrive.
 *
 * **Deliberately `fetch`, not the shared `apiClient`.** That client is axios,
 * and axios has no streaming response in the browser — `XMLHttpRequest` exposes
 * a growing string, and the `fetch` adapter buffers to a blob. So the copilot
 * replicates the two behaviours `apiClient` provides rather than changing it:
 * `credentials: 'include'` for the httpOnly session cookie, and the
 * `X-Workspace-Id` header the `WorkspaceGuard` reads. Everything else about
 * `apiClient` — its interceptors, its 401 handling — deliberately does not
 * apply here, because a run's errors arrive as frames rather than as rejected
 * promises once the stream is open.
 *
 * SSE over POST rather than `EventSource`: the turn has a body, and
 * `EventSource` can only issue a bodyless GET. Verified to stream unbuffered
 * through the admin's Vite dev proxy.
 */
export async function* streamRun(
    body: StartRunRequest,
    options: StartRunOptions
): AsyncGenerator<CopilotRunEvent> {
    const response = await fetch('/api/copilot/runs', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'X-Workspace-Id': options.workspaceId
        },
        body: JSON.stringify(body),
        signal: options.signal
    });

    if (!response.ok || !response.body) {
        throw new CopilotRunError(
            response.status,
            await errorMessage(response)
        );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    // Frames are split on a blank line, and a chunk can end mid-frame — so the
    // tail is carried into the next read rather than parsed early.
    let buffer = '';

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });

            let split = buffer.indexOf('\n\n');
            while (split !== -1) {
                const frame = buffer.slice(0, split);
                buffer = buffer.slice(split + 2);
                const event = parseFrame(frame);
                if (event) {
                    yield event;
                }
                split = buffer.indexOf('\n\n');
            }
        }
    } finally {
        // Releasing the lock lets the browser tear the connection down when the
        // caller abandons the generator early (component unmounted mid-answer).
        reader.releaseLock();
    }
}

/**
 * One SSE frame → one event, or `null` for a frame carrying no data.
 *
 * Comment frames (`: open`, `: ping`) are the expected `null` case: they exist
 * to flush headers and keep an idle connection alive, and carry nothing.
 */
function parseFrame(frame: string): CopilotRunEvent | null {
    const data = frame.split('\n').find((line) => line.startsWith('data:'));
    if (!data) {
        return null;
    }
    try {
        return JSON.parse(data.slice('data:'.length).trim()) as CopilotRunEvent;
    } catch {
        // A frame we can't parse is a bug, not a reason to kill a run that may
        // still be producing a usable answer. Drop it and keep reading.
        return null;
    }
}

/** The server's error message, when it sent a readable one. */
async function errorMessage(response: Response): Promise<string> {
    try {
        const body = await response.json();
        const message = (body as { message?: string | string[] }).message;
        if (Array.isArray(message)) {
            return message.join('; ');
        }
        if (typeof message === 'string') {
            return message;
        }
    } catch {
        // Not JSON — fall through to the generic message.
    }
    return `The copilot request failed (${response.status}).`;
}
