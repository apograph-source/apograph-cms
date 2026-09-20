import type { ModelRequest, ModelStreamEvent } from '@orthacms/copilot-domain';
import { createFakeProvider } from './fake-provider';

const request: ModelRequest = {
    model: 'fake',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    maxOutputTokens: 1024
};

async function drain(
    events: AsyncIterable<ModelStreamEvent>
): Promise<ModelStreamEvent[]> {
    const collected: ModelStreamEvent[] = [];
    for await (const event of events) {
        collected.push(event);
    }
    return collected;
}

/**
 * The fake provider is what CI runs the copilot loop against, so its
 * determinism is load-bearing: a flaky fake would make every downstream
 * assertion flaky too.
 */
describe('createFakeProvider', () => {
    it('streams the canned reply when unscripted, repeatedly', async () => {
        const provider = createFakeProvider();

        const first = await drain(provider.stream(request));
        const second = await drain(provider.stream(request));

        expect(first).toEqual(second);
        expect(first.at(-1)).toMatchObject({ type: 'done', stopReason: 'end' });
        expect(provider.calls).toHaveLength(2);
    });

    it('reassembles to the scripted text exactly', async () => {
        const provider = createFakeProvider({
            script: [{ text: 'I found 3 matching articles.' }],
            chunkSize: 3
        });

        const events = await drain(provider.stream(request));
        const text = events
            .filter((event) => event.type === 'text-delta')
            .map((event) => event.text)
            .join('');

        expect(text).toBe('I found 3 matching articles.');
    });

    it('plays scripted turns in order and infers the stop reason', async () => {
        const provider = createFakeProvider({
            script: [
                {
                    toolCalls: [
                        {
                            name: 'admin_content_search',
                            input: { q: 'launch' }
                        }
                    ]
                },
                { text: 'Found it.' }
            ]
        });

        const turnOne = await drain(provider.stream(request));
        expect(turnOne).toContainEqual({
            type: 'tool-call',
            id: 'fake-tool-0-0',
            name: 'admin_content_search',
            input: { q: 'launch' }
        });
        expect(turnOne.at(-1)).toMatchObject({ stopReason: 'tool_use' });

        const turnTwo = await drain(provider.stream(request));
        expect(turnTwo.at(-1)).toMatchObject({ stopReason: 'end' });
    });

    it('throws once a supplied script runs out, rather than inventing a turn', async () => {
        const provider = createFakeProvider({ script: [{ text: 'once' }] });
        await drain(provider.stream(request));

        await expect(drain(provider.stream(request))).rejects.toThrow(
            /script exhausted/
        );
    });

    it('records every request it served, for negative-path assertions', async () => {
        const provider = createFakeProvider();

        await drain(
            provider.stream({
                ...request,
                tools: [
                    {
                        name: 'admin_content_search',
                        description: 'Search entries',
                        inputSchema: { type: 'object' }
                    }
                ]
            })
        );

        expect(provider.calls[0].tools?.map((tool) => tool.name)).toEqual([
            'admin_content_search'
        ]);
    });

    it('ends with `aborted` when the signal is already aborted', async () => {
        const provider = createFakeProvider({
            script: [{ text: 'never seen' }]
        });

        const events = await drain(
            provider.stream(request, AbortSignal.abort())
        );

        expect(events).toEqual([
            {
                type: 'done',
                stopReason: 'aborted',
                usage: { inputTokens: 0, outputTokens: 0 }
            }
        ]);
    });

    it('ends with `aborted` and zero usage when the signal trips mid-stream', async () => {
        const provider = createFakeProvider({
            script: [{ text: 'a long enough answer to abort inside' }],
            chunkSize: 4
        });
        const controller = new AbortController();

        const events: ModelStreamEvent[] = [];
        for await (const event of provider.stream(request, controller.signal)) {
            events.push(event);
            controller.abort();
        }

        // Zero, not the partial estimate this used to report: both production
        // adapters report zero here, and a fake that reported a guess made
        // every abort assertion downstream fake-only.
        expect(events.at(-1)).toEqual({
            type: 'done',
            stopReason: 'aborted',
            usage: { inputTokens: 0, outputTokens: 0 }
        });
        expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
        expect(events[0]).toEqual({ type: 'text-delta', text: 'a lo' });
    });

    it('emits no tool call once the signal has tripped', async () => {
        // A real adapter cannot emit anything after its transport is torn down.
        const provider = createFakeProvider({
            script: [
                {
                    text: 'looking',
                    toolCalls: [{ name: 'admin_content_search', input: {} }]
                }
            ],
            chunkSize: 100
        });
        const controller = new AbortController();

        const events: ModelStreamEvent[] = [];
        for await (const event of provider.stream(request, controller.signal)) {
            events.push(event);
            controller.abort();
        }

        expect(events.map((event) => event.type)).toEqual([
            'text-delta',
            'done'
        ]);
    });

    it('advances the script even when the call was aborted before it began', async () => {
        const provider = createFakeProvider({
            script: [{ text: 'first' }, { text: 'second' }]
        });

        await drain(provider.stream(request, AbortSignal.abort()));
        const events = await drain(provider.stream(request));

        // The run happened, it just didn't finish — so turn two is next.
        expect(
            events
                .filter((event) => event.type === 'text-delta')
                .map((event) => event.text)
                .join('')
        ).toBe('second');
    });

    it('snapshots the request it records, so `calls` is not a live view', async () => {
        // The engine appends to the array it passed as `messages` after the
        // call it passed it on, so an aliased record would report the whole
        // conversation as what the first call was shown.
        const provider = createFakeProvider();
        const messages = [...request.messages];

        await drain(provider.stream({ ...request, messages }));
        messages.push({
            role: 'assistant',
            content: [{ type: 'text', text: 'later' }]
        });

        expect(provider.calls[0].messages).toHaveLength(1);
    });

    it('lets a turn override the inferred stop reason and the usage', async () => {
        const provider = createFakeProvider({
            script: [
                {
                    toolCalls: [{ name: 'x', input: {} }],
                    stopReason: 'end',
                    usage: { inputTokens: 7, outputTokens: 9 }
                }
            ]
        });

        expect((await drain(provider.stream(request))).at(-1)).toEqual({
            type: 'done',
            stopReason: 'end',
            usage: { inputTokens: 7, outputTokens: 9 }
        });
    });

    it.each([0, -5])('floors a chunkSize of %s at 1', async (chunkSize) => {
        const provider = createFakeProvider({
            script: [{ text: 'abc' }],
            chunkSize
        });

        const events = await drain(provider.stream(request));

        // The point is that it terminates at all: a size of 0 would advance the
        // slice by nothing and stream for ever.
        expect(
            events
                .filter((event) => event.type === 'text-delta')
                .map((event) => event.text)
        ).toEqual(['a', 'b', 'c']);
    });

    it('treats an empty script as a script, naming the count and the call', async () => {
        const provider = createFakeProvider({ script: [] });

        // An author who wrote `scriptCopilot()` with no turns gets this rather
        // than the dev reply, and the numbers are what make it diagnosable.
        await expect(drain(provider.stream(request))).rejects.toThrow(
            '0 turn(s) scripted, call 1 requested'
        );
    });

    it('scripts "the model said nothing" as a turn with no content', async () => {
        const provider = createFakeProvider({ script: [{}] });

        expect(await drain(provider.stream(request))).toEqual([
            {
                type: 'done',
                stopReason: 'end',
                usage: { inputTokens: expect.any(Number), outputTokens: 0 }
            }
        ]);
    });

    it('reports overridable capabilities so degraded mode is testable', async () => {
        const provider = createFakeProvider({
            capabilities: { toolCalling: false, contextWindow: 4_096 }
        });

        await expect(provider.capabilities()).resolves.toMatchObject({
            toolCalling: false,
            streaming: true,
            contextWindow: 4_096
        });
    });

    it('rewinds the script and clears calls on reset', async () => {
        const provider = createFakeProvider({ script: [{ text: 'once' }] });
        await drain(provider.stream(request));

        provider.reset();

        expect(provider.calls).toHaveLength(0);
        await expect(drain(provider.stream(request))).resolves.toHaveLength(2);
    });

    it('advertises a single `fake` model by default', () => {
        expect(createFakeProvider().models()).toEqual(['fake']);
    });

    it('advertises declared models and rejects one it was not given', async () => {
        const provider = createFakeProvider({ models: ['small', 'large'] });

        expect(provider.models()).toEqual(['small', 'large']);
        await expect(provider.capabilities('large')).resolves.toMatchObject({
            model: 'large'
        });
        await expect(
            drain(provider.stream({ ...request, model: 'huge' }))
        ).rejects.toThrow(/not offered by this copilot provider/);
    });
});
