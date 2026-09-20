import type { CopilotRunEvent } from '@orthacms/copilot-domain';
import type { Test } from 'supertest';

/**
 * Turns one `data:`-carrying SSE block into a frame.
 *
 * Comment frames (`: open`, `: ping`) yield nothing: they carry no data and
 * exist only to flush headers and keep an idle connection alive.
 *
 * The prefix match is `data:` with the space **optional**, matching both the
 * SSE grammar (a single leading space after the colon is stripped, and is not
 * required) and the admin client's own parser
 * (`packages/copilot/admin/src/lib/application/runStream.ts`). Requiring the
 * space would make this harness blind to a frame the shipped client reads
 * perfectly well: `find` would return `undefined`, the frame would be dropped
 * silently, and the failure would present as a missing event rather than as a
 * parser disagreement.
 */
function parseBlock(block: string): CopilotRunEvent | undefined {
    const trimmed = block.trim();
    if (trimmed.length === 0 || trimmed.startsWith(':')) return undefined;
    const data = trimmed.split('\n').find((line) => line.startsWith('data:'));
    // `JSON.parse` tolerates the leading space, so one slice serves both forms.
    return data
        ? (JSON.parse(data.slice('data:'.length)) as CopilotRunEvent)
        : undefined;
}

/**
 * Parses a **buffered** `text/event-stream` body into its frames.
 *
 * Most suites assert on the *sequence and content* of frames, not on their
 * arrival timing, and for those supertest's buffered `response.text` is all
 * that is needed. That it genuinely streams (and survives the admin's Vite dev
 * proxy unbuffered, on POST as well as GET) was proven separately with a live
 * client. A run that must be *answered while it is still open* is the one case
 * buffering cannot serve — see {@link streamSse}.
 */
export function parseSse(body: string): CopilotRunEvent[] {
    return body.split('\n\n').flatMap((block) => {
        const event = parseBlock(block);
        return event ? [event] : [];
    });
}

/**
 * Drives a run **frame by frame, as they arrive**, and resolves with all of
 * them once the stream ends.
 *
 * This exists for exactly one shape: ADR-0009 §1b parks a run on a
 * `tool-permission-request` and waits for `POST /runs/:runId/permission`. The
 * answer therefore has to be sent *while the response is still open* — a
 * buffered read deadlocks, because the body only completes once the run does
 * and the run only continues once it is answered. `onFrame` is where that
 * second request is fired from; it is called synchronously, so an async answer
 * should be started (not awaited) inside it.
 *
 * The incremental parse splits on the `\n\n` frame boundary rather than trusting
 * chunk edges — a frame can arrive in two TCP reads, and two frames can arrive
 * in one.
 */
export function streamSse(
    req: Test,
    onFrame: (event: CopilotRunEvent) => void
): Promise<CopilotRunEvent[]> {
    const frames: CopilotRunEvent[] = [];
    let pending = '';

    const take = (block: string) => {
        const event = parseBlock(block);
        if (!event) return;
        frames.push(event);
        onFrame(event);
    };

    req.parse((res, done) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
            pending += chunk;
            let boundary = pending.indexOf('\n\n');
            while (boundary !== -1) {
                take(pending.slice(0, boundary));
                pending = pending.slice(boundary + 2);
                boundary = pending.indexOf('\n\n');
            }
        });
        res.on('end', () => {
            take(pending);
            // `res.text` is what supertest prints when an `.expect()` fails;
            // without it a bad status reports an empty body.
            (res as { text?: string }).text = frames
                .map((frame) => JSON.stringify(frame))
                .join('\n');
            done(null, frames);
        });
        res.on('error', (error: Error) => done(error, frames));
    });

    return req.then(() => frames);
}

/** Every frame of one kind, narrowed. */
export function framesOfType<T extends CopilotRunEvent['type']>(
    events: CopilotRunEvent[],
    type: T
): Extract<CopilotRunEvent, { type: T }>[] {
    return events.filter(
        (event): event is Extract<CopilotRunEvent, { type: T }> =>
            event.type === type
    );
}

/** The concatenated assistant answer — every `text-delta`, in order. */
export function assembledText(events: CopilotRunEvent[]): string {
    return framesOfType(events, 'text-delta')
        .map((event) => event.text)
        .join('');
}
