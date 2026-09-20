import type { CopilotRunEvent } from '@orthacms/copilot-domain';
import type {
    ChatAttachment,
    ChatBlock,
    ChatMessage,
    ChatPermissionRequest,
    ChatProposal,
    ChatSkill,
    ChatState
} from '../domain/types/chat';

/** Everything that can change the panel's state. */
export type ChatAction =
    /** The user submitted a message; an optimistic turn is appended. */
    | {
          type: 'submit';
          text: string;
          localId: string;
          attachments?: ChatAttachment[];
          skills?: ChatSkill[];
      }
    /** One frame arrived from the run stream. */
    | { type: 'event'; event: CopilotRunEvent }
    /** The run failed before or outside the stream. */
    | { type: 'failed'; message: string }
    /** The user pressed Stop; the turn ends where it got to. */
    | { type: 'cancelled' }
    /** Load a persisted transcript, replacing whatever is shown. */
    | { type: 'load'; conversationId: string | null; messages: ChatMessage[] }
    /** Start an empty new chat. */
    | { type: 'reset' }
    /** An answer to a permission request is in flight. */
    | { type: 'answering'; callId: string }
    /** The answer landed, or failed to reach the run. */
    | { type: 'answered'; callId: string; error?: string }
    /** The server granted the user more time to answer. */
    | { type: 'permission-extended'; callId: string; expiresAt: string };

/** The empty panel. */
export const initialChatState: ChatState = {
    conversationId: null,
    messages: [],
    busy: false
};

/**
 * Folds run events into the transcript.
 *
 * A **pure reducer** rather than a pile of `setState` calls in the streaming
 * loop, for one reason that matters: a `text-delta` arrives dozens of times per
 * answer, and each one has to append to the *current* last message without
 * reading stale closure state. Keeping it pure also makes the interesting
 * cases — a tool step resolving, a run erroring mid-answer — unit-testable
 * without a server or a socket.
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
    switch (action.type) {
        case 'reset':
            return initialChatState;

        case 'load':
            return {
                conversationId: action.conversationId,
                messages: action.messages,
                busy: false
            };

        case 'submit':
            return {
                ...state,
                busy: true,
                messages: [
                    ...state.messages,
                    {
                        id: `local-user-${action.localId}`,
                        role: 'user',
                        text: action.text,
                        blocks: [],
                        // Rendered from what the composer staged rather than
                        // waiting for the server to echo them back: the chips
                        // were on screen a moment ago, and having them vanish
                        // until the first frame lands reads as a failed send.
                        ...(action.attachments?.length
                            ? { attachments: action.attachments }
                            : {}),
                        // Optimistic like the attachment chips, and for the
                        // same reason — except these are also *incomplete*
                        // until the run lands: the workspace's always-on skills
                        // are added server-side, so a reopened thread can show
                        // more than the person picked. Showing what they picked
                        // now beats showing nothing until the first frame.
                        ...(action.skills?.length
                            ? { skills: action.skills }
                            : {})
                    },
                    // The assistant turn is created up front and empty, so the
                    // UI has something to show a pending state on before the
                    // first token arrives.
                    {
                        id: `local-assistant-${action.localId}`,
                        role: 'assistant',
                        text: '',
                        blocks: [],
                        streaming: true
                    }
                ]
            };

        case 'permission-extended':
            // The server granted more time; the prompt re-reads its deadline
            // from here rather than guessing one client-side, so the countdown
            // and the broker's timer cannot disagree (`ORT-118`).
            return {
                ...state,
                messages: state.messages.map((message) =>
                    message.permissions?.some(
                        (request) => request.id === action.callId
                    )
                        ? {
                              ...message,
                              permissions: message.permissions.map((request) =>
                                  request.id === action.callId
                                      ? {
                                            ...request,
                                            expiresAt: action.expiresAt
                                        }
                                      : request
                              )
                          }
                        : message
                )
            };

        case 'failed':
            return {
                ...state,
                busy: false,
                messages: mapLastAssistant(state.messages, (message) => ({
                    ...message,
                    streaming: false,
                    error: action.message
                }))
            };

        // Stop is the one ending the **client** has to write itself. Every
        // other one arrives as a frame, but cancelling closes the connection —
        // so the server's `stopReason: 'aborted'` is recorded on its side and
        // can never reach us. Without this the turn stayed `streaming`, the
        // composer's button stayed Stop, and pressing it again did nothing.
        case 'cancelled':
            return {
                ...state,
                busy: false,
                messages: mapLastAssistant(state.messages, (message) => ({
                    ...message,
                    streaming: false,
                    stopReason: 'aborted'
                }))
            };

        case 'answering':
            return mapPermission(state, action.callId, (request) => ({
                ...request,
                deciding: true,
                error: undefined
            }));

        case 'answered':
            return mapPermission(state, action.callId, (request) => ({
                ...request,
                deciding: false,
                // Only a delivered answer retires the prompt. One that failed
                // keeps its buttons: the run may still be parked, and taking
                // the controls away would strand it with no way to answer.
                ...(action.error ? { error: action.error } : { answered: true })
            }));

        case 'event':
            return applyEvent(state, action.event);

        default:
            return state;
    }
}

/** One run event, folded in. */
function applyEvent(state: ChatState, event: CopilotRunEvent): ChatState {
    switch (event.type) {
        case 'run-started':
            return { ...state, conversationId: event.conversationId };

        case 'text-delta':
            return {
                ...state,
                messages: mapLastAssistant(state.messages, (message) => ({
                    ...message,
                    blocks: appendText(message.blocks, event.text)
                }))
            };

        case 'tool-call':
            return {
                ...state,
                messages: mapLastAssistant(state.messages, (message) => ({
                    ...message,
                    blocks: [
                        ...message.blocks,
                        {
                            kind: 'step',
                            id: event.id,
                            step: {
                                id: event.id,
                                name: event.name,
                                input: event.input,
                                status: 'running'
                            }
                        }
                    ]
                }))
            };

        case 'tool-permission-request':
            return {
                ...state,
                messages: mapLastAssistant(state.messages, (message) => ({
                    ...message,
                    permissions: [
                        ...(message.permissions ?? []),
                        {
                            id: event.id,
                            runId: event.runId,
                            name: event.name,
                            ...(event.title ? { title: event.title } : {}),
                            input: event.input,
                            expiresAt: event.expiresAt
                        }
                    ]
                }))
            };

        case 'tool-result':
            // A result for a parked call means it stopped being parked — the
            // user answered, or nobody did and it timed out server-side. Either
            // way the prompt must go, or a run that moved on leaves live
            // buttons behind that answer nothing.
            return retirePermission(
                {
                    ...state,
                    messages: mapLastAssistant(state.messages, (message) => ({
                        ...message,
                        // **In place.** The step keeps the position it was
                        // called at, so a result landing does not shuffle the
                        // answer written since.
                        blocks: message.blocks.map((block) =>
                            block.kind === 'step' && block.id === event.id
                                ? {
                                      ...block,
                                      step: {
                                          ...block.step,
                                          status: event.ok ? 'ok' : 'error',
                                          summary: event.summary,
                                          output: event.output,
                                          error: event.error,
                                          durationMs: event.durationMs
                                      }
                                  }
                                : block
                        )
                    }))
                },
                event.id
            );

        case 'proposal':
            return {
                ...state,
                messages: mapLastAssistant(state.messages, (message) => ({
                    ...message,
                    // Appended where it happened — after the step that made the
                    // change, before whatever the model writes next.
                    blocks: [
                        ...message.blocks,
                        {
                            kind: 'proposal',
                            id: event.id,
                            proposal: {
                                id: event.id,
                                toolCallId: event.toolCallId,
                                toolName: event.toolName,
                                kind: event.kind,
                                summary: event.summary,
                                target: event.target as Record<string, unknown>,
                                ...(event.changes
                                    ? {
                                          changes:
                                              event.changes as ChatProposal['changes']
                                      }
                                    : {}),
                                status: event.status,
                                ...(event.entityId
                                    ? { entityId: event.entityId }
                                    : {}),
                                // `pending` now means the apply failed, so the
                                // reason travels with it — the card is a
                                // receipt, and a receipt that cannot say "this
                                // did not happen" is worse than none.
                                ...(event.error ? { error: event.error } : {})
                            }
                        }
                    ]
                }))
            };

        case 'error':
            return {
                ...state,
                messages: mapLastAssistant(state.messages, (message) => ({
                    ...message,
                    error: event.message
                }))
            };

        case 'done':
            return {
                ...state,
                busy: false,
                messages: mapLastAssistant(state.messages, (message) => ({
                    ...message,
                    // Adopt the server's id so a later transcript refetch
                    // reconciles onto the same row instead of duplicating it.
                    id: event.messageId ?? message.id,
                    streaming: false,
                    stopReason: event.stopReason
                }))
            };

        default:
            return state;
    }
}

/**
 * Appends prose, growing the newest block when it is already text.
 *
 * A `text-delta` arrives dozens of times per answer, and merging into the last
 * block is what keeps one sentence one paragraph instead of one block per
 * token — while still starting a *new* block after a tool step, which is what
 * puts the words written after a change below the card for it.
 */
function appendText(blocks: ChatBlock[], text: string): ChatBlock[] {
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'text') {
        return [...blocks.slice(0, -1), { ...last, text: last.text + text }];
    }
    return [...blocks, { kind: 'text', id: `text-${blocks.length}`, text }];
}

/** Applies `change` to one permission request, wherever it sits. */
function mapPermission(
    state: ChatState,
    callId: string,
    change: (request: ChatPermissionRequest) => ChatPermissionRequest
): ChatState {
    return {
        ...state,
        messages: state.messages.map((message) =>
            message.permissions?.some((request) => request.id === callId)
                ? {
                      ...message,
                      permissions: message.permissions.map((request) =>
                          request.id === callId ? change(request) : request
                      )
                  }
                : message
        )
    };
}

/** Marks a request answered once its call has produced a result. */
function retirePermission(state: ChatState, callId: string): ChatState {
    return mapPermission(state, callId, (request) => ({
        ...request,
        deciding: false,
        answered: true
    }));
}

/**
 * Applies `change` to the last assistant turn.
 *
 * Every streaming update targets it, and it is always the last element — the
 * reducer appends the placeholder on submit. Searching from the end (rather
 * than assuming `at(-1)`) keeps this correct if a future surface ever appends
 * something after it, and returns the list untouched when there is no
 * assistant turn at all, so a stray frame can't crash the panel.
 */
function mapLastAssistant(
    messages: ChatMessage[],
    change: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'assistant') {
            const next = [...messages];
            next[index] = change(messages[index]);
            return next;
        }
    }
    return messages;
}
