import type { Response } from 'express';
import type { CopilotRunEvent } from '@orthacms/copilot-domain';

/**
 * How often to send a comment frame while nothing else is happening. A model
 * can think for a while before its first token, and an idle connection is
 * exactly what an intermediary decides to reap.
 */
const HEARTBEAT_MS = 15_000;

/**
 * Writes a run's events to an Express response as Server-Sent Events.
 *
 * **Verified through the admin's Vite dev proxy** (`^/api/` → `:3000`), for
 * both GET and POST: frames arrive one at a time with the same timing as a
 * direct connection, so nothing here is working around a buffering proxy. The
 * headers below still matter for whatever fronts production — `no-transform`
 * stops a compressing proxy from buffering to gzip, and `X-Accel-Buffering: no`
 * is nginx's opt-out.
 */
export class SseStream {
    private heartbeat: ReturnType<typeof setInterval> | null = null;
    private closed = false;

    constructor(private readonly res: Response) {}

    /** Sends the headers and starts the heartbeat. */
    open(): void {
        this.res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            // `no-transform` is the load-bearing half: without it a
            // compressing intermediary may buffer the whole body to compress it.
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        // `writeHead` alone sends nothing — Node buffers until the first write.
        // Flush a comment now so the client's `fetch` resolves and the UI can
        // render a pending state instead of waiting on the first token.
        this.res.write(': open\n\n');
        this.res.flushHeaders?.();

        this.heartbeat = setInterval(() => {
            if (!this.closed) {
                this.res.write(': ping\n\n');
            }
        }, HEARTBEAT_MS);
    }

    /**
     * Sends one event. The event's `type` becomes the SSE event name, so a
     * client can listen per kind, and the whole event is the JSON payload.
     */
    send(event: CopilotRunEvent): void {
        if (this.closed) {
            return;
        }
        // JSON.stringify cannot emit a raw newline inside a string, so a single
        // `data:` line is always well-formed — no need to split the payload.
        this.res.write(
            `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
        );
    }

    /** Stops the heartbeat and ends the response. Safe to call twice. */
    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
        }
        this.res.end();
    }

    /**
     * Aborts `controller` when the client goes away.
     *
     * **This hangs off the *response*, not the request** — a distinction that
     * costs a whole afternoon if you get it wrong. Express has already consumed
     * the request body by the time a handler runs, and a fully-consumed
     * `IncomingMessage` emits `'close'` immediately, while the client is still
     * connected and waiting. Wiring the abort to `req.on('close')` therefore
     * cancels every run the instant it starts — and because `writeHead` hasn't
     * flushed yet, it presents as a request that hangs with no response at all
     * rather than as an error. Verified directly on Node 22.
     */
    onClientDisconnect(controller: AbortController): void {
        this.res.on('close', () => {
            this.closed = true;
            if (this.heartbeat) {
                clearInterval(this.heartbeat);
                this.heartbeat = null;
            }
            controller.abort();
        });
    }
}
