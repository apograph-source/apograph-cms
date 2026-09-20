import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@orthacms/utils-admin';
import type { ModelContentBlock } from '@orthacms/copilot-domain';
import type {
    ChatAttachment,
    ChatBlock,
    ChatMessage,
    ChatProposal,
    ChatSkill
} from '../domain/types/chat';
import type { CopilotConversation } from './useConversations';

/** One persisted turn, as the transcript route serves it. */
interface PersistedMessage {
    id: string;
    runId: string;
    role: 'user' | 'assistant';
    content: ModelContentBlock[];
    /** Files attached to a user turn; null otherwise. */
    attachments: ChatAttachment[] | null;
    /** Skills in force for a user turn; null otherwise. */
    skills: ChatSkill[] | null;
    stopReason: string | null;
}

interface ConversationDetail {
    conversation: CopilotConversation;
    messages: PersistedMessage[];
}

/** One thread, in the shape the transcript renders. */
export interface OpenedConversation {
    conversation: CopilotConversation;
    messages: ChatMessage[];
}

/**
 * Reads one thread and the changes made in it, and maps both to the transcript.
 *
 * Two reads, concurrently. The proposals are a separate table and a separate
 * route, and a thread with no changes in it must not pay for a serial round trip
 * to learn that.
 */
async function fetchConversation(
    conversationId: string
): Promise<OpenedConversation> {
    const [detail, proposals] = await Promise.all([
        apiClient.get<ConversationDetail>(
            `/copilot/conversations/${conversationId}`
        ),
        apiClient.get<{ items: PersistedProposal[] }>('/copilot/proposals', {
            params: { conversationId }
        })
    ]);
    return {
        conversation: detail.data.conversation,
        messages: toChatMessages(detail.data.messages, proposals.data.items)
    };
}

/** Query key for one thread's transcript. */
export const conversationKey = (conversationId: string) =>
    ['copilot', 'conversation', conversationId] as const;

/**
 * Opens a persisted thread, as a **mutation** — the docked panel's history
 * dropdown, where opening a thread is an explicit click with a different target
 * each time and the result is folded straight into the panel's reducer.
 *
 * Prefer {@link useConversationDetail} anywhere the *URL* says which thread is
 * open. A mutation's per-call `onSuccess` only runs while the component that
 * called `mutate` is still mounted, which makes it the wrong tool for a load
 * kicked off by an effect — React's StrictMode remount alone is enough to
 * swallow the callback and strand the page on its skeleton.
 */
export function useOpenConversation() {
    return useMutation({ mutationFn: fetchConversation });
}

/**
 * The transcript of the thread the URL points at, as a **query**.
 *
 * Pass `null` to disable it — the Agents page does exactly that once its chat is
 * already on the thread, so the answer streaming into the reducer is never
 * fetched back out from under itself, and so returning to a thread you are
 * already reading costs nothing.
 *
 * Cached per thread, which is what makes flicking between two conversations
 * instant on the second visit. The cache is only ever *read* when arriving at a
 * thread the chat is not on; while you are in one, the reducer is the truth.
 */
export function useConversationDetail(conversationId: string | null) {
    return useQuery({
        queryKey: conversationKey(conversationId ?? ''),
        enabled: !!conversationId,
        queryFn: () => fetchConversation(conversationId as string)
    });
}

/** One proposal as the queue route serves it. */
interface PersistedProposal {
    id: string;
    toolCallId: string;
    toolName: string;
    kind: string;
    summary: string;
    target: Record<string, unknown>;
    changes: ChatProposal['changes'] | null;
    status: ChatProposal['status'];
    result: { entityId?: string } | null;
    /** Why the change did not apply, when it didn't. */
    error: string | null;
}

/**
 * Persisted turns → the panel's transcript shape.
 *
 * The stored form is the model port's content blocks, which is what makes a
 * transcript survive a provider switch — but it is not what the UI draws. The
 * mapping is one-way and lossy on purpose: `tool_result` blocks are folded onto
 * the `tool_use` step they answer, so a reopened thread renders the same
 * collapsed steps a live run does.
 */
function toChatMessages(
    messages: PersistedMessage[],
    proposals: PersistedProposal[] = []
): ChatMessage[] {
    // Proposals attach by the tool call that produced them, so a reopened
    // thread puts each card back on the turn it belongs to instead of
    // collecting them all at the bottom. `toolCallId` is exactly why the server
    // stores it.
    const proposalsByCall = new Map<string, ChatProposal[]>();
    for (const proposal of proposals) {
        const list = proposalsByCall.get(proposal.toolCallId) ?? [];
        list.push({
            id: proposal.id,
            toolCallId: proposal.toolCallId,
            toolName: proposal.toolName,
            kind: proposal.kind,
            summary: proposal.summary,
            target: proposal.target,
            ...(proposal.changes ? { changes: proposal.changes } : {}),
            status: proposal.status,
            ...(proposal.result?.entityId
                ? { entityId: proposal.result.entityId }
                : {}),
            // A reopened thread must still say a change failed. The card reads
            // `pending` as "did not apply" (ADR-0009), and without the reason
            // it could only say so generically.
            ...(proposal.error ? { error: proposal.error } : {})
        });
        proposalsByCall.set(proposal.toolCallId, list);
    }

    // Tool results ride on the *following* user turn, so collect them all first
    // and attach by id rather than trying to pair them positionally.
    const resultsById = new Map<
        string,
        { content: string; isError?: boolean }
    >();
    for (const message of messages) {
        for (const block of message.content) {
            if (block.type === 'tool_result') {
                resultsById.set(block.toolUseId, {
                    content: block.content,
                    isError: block.isError
                });
            }
        }
    }

    return messages.flatMap((message) => {
        // **The stored order is the order.** `content` is the model port's
        // block list exactly as the run produced it, so walking it rebuilds the
        // interleaving a live run shows — prose, the step that interrupted it,
        // the change that step made, then the prose written afterwards. Sorting
        // by kind here is what used to strand a card at the bottom of a
        // reopened thread.
        const blocks: ChatBlock[] = [];
        for (const part of message.content) {
            if (part.type === 'text') {
                if (part.text) {
                    blocks.push({
                        kind: 'text',
                        id: `text-${blocks.length}`,
                        text: part.text
                    });
                }
                continue;
            }
            if (part.type !== 'tool_use') {
                // `tool_result` rides on the *following* turn and is folded
                // onto the call it answers, below — it is not a block of its
                // own in the transcript.
                continue;
            }

            const result = resultsById.get(part.id);
            blocks.push({
                kind: 'step',
                id: part.id,
                step: {
                    id: part.id,
                    name: part.name,
                    input: part.input,
                    status: result ? (result.isError ? 'error' : 'ok') : 'ok',
                    ...(result?.isError
                        ? { error: result.content }
                        : { output: result?.content })
                }
            });

            // Directly after the call that produced it, which is where the run
            // emitted it and where the reader last saw the change discussed.
            for (const proposal of proposalsByCall.get(part.id) ?? []) {
                blocks.push({
                    kind: 'proposal',
                    id: proposal.id,
                    proposal
                });
            }
        }

        // A turn that carried only tool results (no prose, no calls) is
        // plumbing, not something a reader should see as an empty bubble.
        if (blocks.length === 0) {
            return [];
        }

        return [
            {
                id: message.id,
                role: message.role,
                // Assistant prose lives in `blocks`; a user turn's is one
                // string, and the persisted shape gives it as text parts.
                text:
                    message.role === 'user'
                        ? blocks
                              .filter((block) => block.kind === 'text')
                              .map((block) =>
                                  block.kind === 'text' ? block.text : ''
                              )
                              .join('')
                        : '',
                blocks: message.role === 'user' ? [] : blocks,
                // Its own column on the row rather than something recovered by
                // parsing a text block, which is what lets a reopened thread
                // render the same chips the live turn did.
                ...(message.attachments?.length
                    ? { attachments: message.attachments }
                    : {}),
                // Likewise its own column: the skills a turn ran under are the
                // only record of *why* an answer reads the way it does, and
                // rebuilding them from the prompt is not possible at all.
                ...(message.skills?.length ? { skills: message.skills } : {}),
                ...(message.stopReason
                    ? { stopReason: message.stopReason }
                    : {})
            }
        ];
    });
}
