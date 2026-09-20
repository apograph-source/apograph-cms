import { defineMessages, useIntl } from 'react-intl';
import { History } from 'lucide-react';
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger
} from '@orthacms/design-system';
import { useConversations } from '../../application/useConversations';
import { useOpenConversation } from '../../application/useConversation';
import type { ChatMessage } from '../../domain/types/chat';

const messages = defineMessages({
    history: {
        id: 'copilot.history.label',
        defaultMessage: 'Previous chats'
    },
    empty: {
        id: 'copilot.history.empty',
        defaultMessage: 'No previous chats'
    },
    untitled: {
        id: 'copilot.history.untitled',
        defaultMessage: 'Untitled chat'
    },
    failed: {
        id: 'copilot.history.failed',
        defaultMessage: 'Could not open that chat.'
    }
});

export interface ConversationPickerProps {
    /** The workspace whose threads are listed. */
    workspaceId: string;
    /**
     * Called with the loaded transcript when a thread is picked.
     *
     * The **stored title** rides along: without it the window that adopts the
     * thread has no name until `CopilotSession` derives one from the first
     * message, so the pill and the header showed the opening question rather
     * than the thread's actual name — the rail's `openThread` has always passed
     * it, and this path is the one that did not.
     */
    onOpen(
        conversationId: string,
        title: string | null,
        messages: ChatMessage[]
    ): void;
}

/**
 * The thread history — reopen a persisted conversation.
 *
 * The list is a query (it is cached and invalidated as turns land) while
 * opening one is a mutation, because it targets a different thread each time
 * and its result is folded into the panel's reducer rather than rendered from
 * cache.
 */
export function ConversationPicker({
    workspaceId,
    onOpen
}: ConversationPickerProps) {
    const intl = useIntl();
    const { data: conversations } = useConversations(workspaceId);
    const open = useOpenConversation();

    return (
        // `modal={false}`: the panel this sits in is non-modal by design, and a
        // modal menu `aria-hidden`s the page root — focusable content included,
        // which axe fails as `aria-hidden-focus`.
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={intl.formatMessage(messages.history)}
                    title={intl.formatMessage(messages.history)}
                >
                    <History className="size-4" />
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                    {intl.formatMessage(messages.history)}
                </DropdownMenuLabel>

                {open.isError && (
                    <p className="text-destructive px-2 py-1.5 text-xs">
                        {intl.formatMessage(messages.failed)}
                    </p>
                )}

                {!conversations || conversations.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-1.5 text-xs">
                        {intl.formatMessage(messages.empty)}
                    </p>
                ) : (
                    conversations.map((conversation) => (
                        <DropdownMenuItem
                            key={conversation.id}
                            className="flex-col items-start gap-0.5"
                            onSelect={() => {
                                open.mutate(conversation.id, {
                                    onSuccess: (detail) =>
                                        onOpen(
                                            conversation.id,
                                            conversation.title,
                                            detail.messages
                                        )
                                });
                            }}
                        >
                            <span className="w-full truncate text-sm">
                                {conversation.title ??
                                    intl.formatMessage(messages.untitled)}
                            </span>
                            <span className="text-muted-foreground text-[11px]">
                                {intl.formatDate(conversation.updatedAt, {
                                    dateStyle: 'medium',
                                    timeStyle: 'short'
                                })}
                            </span>
                        </DropdownMenuItem>
                    ))
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
