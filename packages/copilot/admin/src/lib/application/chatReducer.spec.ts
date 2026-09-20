import type { CopilotRunEvent } from '@orthacms/copilot-domain';
import { chatReducer, initialChatState, type ChatAction } from './chatReducer';
import type {
    ChatMessage,
    ChatProposal,
    ChatState,
    ChatToolStep
} from '../domain/types/chat';

/**
 * A `ChatAction` already narrowed to a proposal frame. `ChatAction` is a union,
 * so a helper typed as the whole union hands back something with no `.event` to
 * spread — which is what the change-card tests need.
 */
type ProposalAction = {
    type: 'event';
    event: Extract<CopilotRunEvent, { type: 'proposal' }>;
};

/** Applies a sequence of actions, so a test reads as a run's timeline. */
function play(...actions: ChatAction[]): ChatState {
    return actions.reduce(chatReducer, initialChatState);
}

const submit: ChatAction = { type: 'submit', text: 'find posts', localId: '1' };

const started: ChatAction = {
    type: 'event',
    event: {
        type: 'run-started',
        conversationId: 'c1',
        runId: 'r1',
        messageId: 'm1'
    }
};

const done: ChatAction = {
    type: 'event',
    event: {
        type: 'done',
        stopReason: 'end',
        usage: { inputTokens: 1, outputTokens: 2 },
        messageId: 'm2'
    }
};

/** The prose of an assistant turn, in order — what `text` used to hold. */
function prose(message: ChatMessage): string {
    return message.blocks
        .filter((block) => block.kind === 'text')
        .map((block) => (block.kind === 'text' ? block.text : ''))
        .join('');
}

/** Its tool steps, in order — what `steps` used to hold. */
function steps(message: ChatMessage): ChatToolStep[] {
    return message.blocks.flatMap((block) =>
        block.kind === 'step' ? [block.step] : []
    );
}

/** Its change cards, in order — what `proposals` used to hold. */
function proposals(message: ChatMessage): ChatProposal[] {
    return message.blocks.flatMap((block) =>
        block.kind === 'proposal' ? [block.proposal] : []
    );
}

describe('chatReducer', () => {
    describe('the order things happened in', () => {
        /** The kinds of a turn's blocks, in order — the shape of the answer. */
        const shape = (state: ChatState) =>
            state.messages[1].blocks.map((block) => block.kind);

        const delta = (text: string): ChatAction => ({
            type: 'event',
            event: { type: 'text-delta', text }
        });

        const call: ChatAction = {
            type: 'event',
            event: {
                type: 'tool-call',
                id: 'call-1',
                name: 'content_propose_update',
                input: {}
            }
        };

        const result: ChatAction = {
            type: 'event',
            event: {
                type: 'tool-result',
                id: 'call-1',
                name: 'content_propose_update',
                ok: true,
                summary: 'Applied',
                durationMs: 12
            }
        };

        const card: ChatAction = {
            type: 'event',
            event: {
                type: 'proposal',
                id: 'p-1',
                toolCallId: 'call-1',
                toolName: 'content_propose_update',
                kind: 'content.entry.update',
                summary: 'Set a summary',
                target: {},
                status: 'accepted'
            }
        };

        it('keeps a change card where the change happened', () => {
            // The reported bug: the model explains, saves, and keeps writing —
            // and the card was pinned below the sentences written after it,
            // because the turn was three buckets rather than a sequence.
            const state = play(
                submit,
                started,
                delta('I will set it. '),
                call,
                result,
                card,
                delta('Done — the summary is in.')
            );

            expect(shape(state)).toEqual(['text', 'step', 'proposal', 'text']);
        });

        it('starts a new paragraph after a step rather than growing the old one', () => {
            // What puts the later prose *below* the card: deltas merge into the
            // newest block only while it is still text.
            const state = play(
                submit,
                started,
                delta('before '),
                delta('the call. '),
                call,
                delta('after '),
                delta('the call.')
            );

            const text = state.messages[1].blocks.flatMap((block) =>
                block.kind === 'text' ? [block.text] : []
            );
            expect(text).toEqual(['before the call. ', 'after the call.']);
        });

        it('resolves a step in place, without shuffling what came after it', () => {
            const state = play(
                submit,
                started,
                call,
                delta('meanwhile'),
                result
            );

            expect(shape(state)).toEqual(['step', 'text']);
            const [step] = state.messages[1].blocks;
            expect(step.kind === 'step' && step.step.status).toBe('ok');
        });

        it('keeps two changes in the order they were made', () => {
            const second: ChatAction = {
                type: 'event',
                event: {
                    type: 'proposal',
                    id: 'p-2',
                    toolCallId: 'call-1',
                    toolName: 'content_propose_update',
                    kind: 'content.entry.update',
                    summary: 'And another',
                    target: {},
                    status: 'accepted'
                }
            };
            const state = play(submit, started, call, result, card, second);
            const ids = state.messages[1].blocks.flatMap((block) =>
                block.kind === 'proposal' ? [block.proposal.id] : []
            );
            expect(ids).toEqual(['p-1', 'p-2']);
        });
    });

    it('appends the user turn and a pending assistant turn on submit', () => {
        const state = play(submit);

        expect(state.busy).toBe(true);
        expect(state.messages).toHaveLength(2);
        expect(state.messages[0]).toMatchObject({
            role: 'user',
            text: 'find posts'
        });
        expect(state.messages[1]).toMatchObject({
            role: 'assistant',
            text: '',
            streaming: true
        });
    });

    it('adopts the conversation id from run-started', () => {
        expect(play(submit, started).conversationId).toBe('c1');
    });

    it('concatenates text deltas in order', () => {
        const state = play(
            submit,
            started,
            { type: 'event', event: { type: 'text-delta', text: 'Hel' } },
            { type: 'event', event: { type: 'text-delta', text: 'lo ' } },
            { type: 'event', event: { type: 'text-delta', text: 'there' } }
        );

        expect(prose(state.messages[1])).toBe('Hello there');
    });

    it('adds a running step on tool-call and resolves it on tool-result', () => {
        const state = play(
            submit,
            started,
            {
                type: 'event',
                event: {
                    type: 'tool-call',
                    id: 't1',
                    name: 'admin_content_search',
                    input: { q: 'x' }
                }
            },
            {
                type: 'event',
                event: {
                    type: 'tool-result',
                    id: 't1',
                    name: 'admin_content_search',
                    ok: true,
                    durationMs: 12,
                    summary: '3 results',
                    output: { total: 3 }
                }
            }
        );

        expect(steps(state.messages[1])).toEqual([
            {
                id: 't1',
                name: 'admin_content_search',
                input: { q: 'x' },
                status: 'ok',
                summary: '3 results',
                output: { total: 3 },
                error: undefined,
                durationMs: 12
            }
        ]);
    });

    it('resolves the matching step only, leaving others running', () => {
        const state = play(
            submit,
            started,
            {
                type: 'event',
                event: { type: 'tool-call', id: 'a', name: 'a', input: {} }
            },
            {
                type: 'event',
                event: { type: 'tool-call', id: 'b', name: 'b', input: {} }
            },
            {
                type: 'event',
                event: {
                    type: 'tool-result',
                    id: 'b',
                    name: 'b',
                    ok: false,
                    durationMs: 1,
                    summary: 'failed',
                    error: 'nope'
                }
            }
        );

        expect(steps(state.messages[1]).map((s) => s.status)).toEqual([
            'running',
            'error'
        ]);
    });

    it('clears busy and adopts the server message id on done', () => {
        const state = play(submit, started, done);

        expect(state.busy).toBe(false);
        expect(state.messages[1].id).toBe('m2');
        expect(state.messages[1].streaming).toBe(false);
        expect(state.messages[1].stopReason).toBe('end');
    });

    it('ends the turn when the user stops it, keeping what arrived', () => {
        const state = play(
            submit,
            started,
            { type: 'event', event: { type: 'text-delta', text: 'partial' } },
            { type: 'cancelled' }
        );

        // Cancelling closes the connection, so the server's own
        // `stopReason: 'aborted'` can never reach the client — this is the one
        // ending the reducer has to write itself, or the turn streams forever.
        expect(state.busy).toBe(false);
        expect(state.messages[1].streaming).toBe(false);
        expect(state.messages[1].stopReason).toBe('aborted');
        expect(state.messages[1].error).toBeUndefined();
        expect(state.messages[1].blocks).toEqual([
            { kind: 'text', id: expect.any(String), text: 'partial' }
        ]);
    });

    it('keeps the local id when done carries none', () => {
        const state = play(submit, started, {
            type: 'event',
            event: {
                type: 'done',
                stopReason: 'aborted',
                usage: { inputTokens: 0, outputTokens: 0 }
            }
        });

        expect(state.messages[1].id).toBe('local-assistant-1');
        expect(state.messages[1].stopReason).toBe('aborted');
    });

    it('records an error frame without discarding streamed text', () => {
        const state = play(
            submit,
            started,
            { type: 'event', event: { type: 'text-delta', text: 'partial' } },
            { type: 'event', event: { type: 'error', message: 'boom' } }
        );

        expect(prose(state.messages[1])).toBe('partial');
        expect(state.messages[1].error).toBe('boom');
    });

    it('ends the turn on a transport failure', () => {
        const state = play(submit, { type: 'failed', message: 'offline' });

        expect(state.busy).toBe(false);
        expect(state.messages[1].streaming).toBe(false);
        expect(state.messages[1].error).toBe('offline');
    });

    // A frame arriving with no assistant turn to attach to must not throw.
    it('ignores an event with no assistant turn present', () => {
        const state = chatReducer(initialChatState, {
            type: 'event',
            event: { type: 'text-delta', text: 'stray' }
        });

        expect(state.messages).toEqual([]);
    });

    it('replaces the transcript on load and clears busy', () => {
        const loaded = play(submit, {
            type: 'load',
            conversationId: 'c9',
            messages: [{ id: 'm', role: 'user', text: 'old', blocks: [] }]
        });

        expect(loaded.conversationId).toBe('c9');
        expect(loaded.messages).toHaveLength(1);
        expect(loaded.busy).toBe(false);
    });

    it('resets to an empty new chat', () => {
        expect(play(submit, { type: 'reset' })).toEqual(initialChatState);
    });

    describe('permission prompts', () => {
        const asks: ChatAction = {
            type: 'event',
            event: {
                type: 'tool-permission-request',
                id: 'call-1',
                runId: 'run-1',
                name: 'content_propose_update',
                input: { typeName: 'article', id: 'e1' },
                expiresAt: '2026-03-15T09:00:30.000Z'
            }
        };
        const result = (ok: boolean): ChatAction => ({
            type: 'event',
            event: {
                type: 'tool-result',
                id: 'call-1',
                name: 'content_propose_update',
                ok,
                durationMs: 1,
                summary: ok ? 'applied' : 'not allowed'
            }
        });

        it('attaches the request to the assistant turn', () => {
            const state = play(submit, started, asks);
            expect(state.messages[1].permissions).toEqual([
                expect.objectContaining({
                    id: 'call-1',
                    runId: 'run-1',
                    name: 'content_propose_update'
                })
            ]);
        });

        it('flags an answer in flight and clears any previous failure', () => {
            const state = play(
                submit,
                started,
                asks,
                { type: 'answered', callId: 'call-1', error: 'not-delivered' },
                { type: 'answering', callId: 'call-1' }
            );
            expect(state.messages[1].permissions?.[0]).toMatchObject({
                deciding: true,
                error: undefined
            });
        });

        it('retires the prompt once the answer lands', () => {
            const state = play(
                submit,
                started,
                asks,
                { type: 'answering', callId: 'call-1' },
                { type: 'answered', callId: 'call-1' }
            );
            expect(state.messages[1].permissions?.[0]).toMatchObject({
                deciding: false,
                answered: true
            });
        });

        it('keeps the prompt answerable when the answer did not reach the run', () => {
            // A 404 means the run had already moved on — but it might not have,
            // and taking the buttons away would strand a still-parked run with
            // no way to answer it.
            const state = play(submit, started, asks, {
                type: 'answered',
                callId: 'call-1',
                error: 'not-delivered'
            });
            expect(state.messages[1].permissions?.[0]).toMatchObject({
                deciding: false,
                error: 'not-delivered'
            });
            expect(state.messages[1].permissions?.[0].answered).toBeUndefined();
        });

        it('retires the prompt when the call produces a result', () => {
            // The server timing out, or another window answering: either way
            // the run moved on, and live buttons that answer nothing are worse
            // than no buttons.
            const state = play(submit, started, asks, result(true));
            expect(state.messages[1].permissions?.[0].answered).toBe(true);
        });

        it('retires it on a refused result too', () => {
            const state = play(submit, started, asks, result(false));
            expect(state.messages[1].permissions?.[0].answered).toBe(true);
            expect(steps(state.messages[1])).toEqual([]);
        });

        it('ignores an answer for a request it does not have', () => {
            const before = play(submit, started, asks);
            expect(
                chatReducer(before, { type: 'answered', callId: 'nope' })
            ).toEqual(before);
        });
    });

    describe('proposals', () => {
        const proposed = (
            status: 'pending' | 'accepted' = 'accepted',
            error?: string
        ): ProposalAction => ({
            type: 'event',
            event: {
                type: 'proposal',
                id: 'p1',
                toolCallId: 'call-1',
                toolName: 'content_propose_update',
                kind: 'content.entry.update',
                summary: 'Fix the headline',
                target: { typeName: 'article', entryId: 'e1' },
                changes: [{ field: 'title', before: 'Old', after: 'New' }],
                status,
                ...(error ? { error } : {})
            }
        });

        it('attaches a change to the assistant turn', () => {
            const state = play(submit, started, proposed());

            expect(proposals(state.messages[1])).toEqual([
                expect.objectContaining({
                    id: 'p1',
                    summary: 'Fix the headline',
                    status: 'accepted'
                })
            ]);
        });

        it('carries the entity the change landed on', () => {
            const state = play(submit, started, {
                type: 'event',
                event: {
                    ...proposed().event,
                    entityId: 'e1'
                }
            });

            expect(proposals(state.messages[1])[0]).toMatchObject({
                status: 'accepted',
                entityId: 'e1'
            });
        });

        // Since ADR-0009 the engine applies as it drafts, so `pending` on an
        // arriving frame does not mean "waiting" — it means the write failed.
        // The reason has to survive onto the card, because this frame is the
        // only place the user will ever be told.
        it('keeps the failure reason on a change that did not apply', () => {
            const state = play(
                submit,
                started,
                proposed('pending', 'Entry validation failed')
            );

            expect(proposals(state.messages[1])[0]).toMatchObject({
                status: 'pending',
                error: 'Entry validation failed'
            });
        });

        it('leaves the error unset when the change applied', () => {
            const state = play(submit, started, proposed());
            expect(proposals(state.messages[1])[0].error).toBeUndefined();
        });

        it('appends several changes from one turn in order', () => {
            const second: ChatAction = {
                type: 'event',
                event: {
                    ...proposed().event,
                    id: 'p2',
                    summary: 'Fix the standfirst'
                }
            };
            const state = play(submit, started, proposed(), second);

            expect(proposals(state.messages[1]).map((p) => p.id)).toEqual([
                'p1',
                'p2'
            ]);
        });
    });
});

describe('attachments on a user turn', () => {
    // `delta` is scoped to the block-order describe above; this suite needs
    // only the one frame, so it declares its own rather than hoisting that.
    const delta = (text: string): ChatAction => ({
        type: 'event',
        event: { type: 'text-delta', text }
    });

    const file = {
        assetId: 'a1',
        name: 'notes.md',
        mimeType: 'text/markdown',
        kind: 'document',
        size: 42,
        readable: true
    };

    // Rendered from what the composer staged rather than waiting for the
    // server to echo them back: the chips were on screen a moment ago, and
    // having them disappear until the first frame lands reads as a failed send.
    it('puts staged files on the optimistic turn immediately', () => {
        const state = play({
            type: 'submit',
            text: 'what is in this file?',
            localId: '1',
            attachments: [file]
        });

        expect(state.messages[0].attachments).toEqual([file]);
    });

    it('leaves the key off entirely when nothing was attached', () => {
        const state = play(submit);

        expect(state.messages[0]).not.toHaveProperty('attachments');
    });

    it('never puts them on the assistant turn', () => {
        const state = play({
            type: 'submit',
            text: 'read it',
            localId: '1',
            attachments: [file]
        });

        expect(state.messages[1].role).toBe('assistant');
        expect(state.messages[1].attachments).toBeUndefined();
    });

    // The turn keeps its own files as the answer streams in: an attachment
    // belongs to the message it was sent with, not to the run.
    it('survives the run that follows', () => {
        const state = play(
            {
                type: 'submit',
                text: 'summarise it',
                localId: '1',
                attachments: [file]
            },
            started,
            delta('Reading the file. '),
            done
        );

        expect(state.messages[0].attachments).toEqual([file]);
    });
});
