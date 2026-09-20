import { useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { defineMessages, useIntl, type MessageDescriptor } from 'react-intl';
import {
    Archive,
    ArrowLeft,
    BookOpen,
    MessageSquarePlus,
    Search
} from 'lucide-react';
import { Button, Input, Skeleton, toast } from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import { useAgentNavigation } from '../../../application/useAgentThread';
import {
    useConversations,
    type CopilotConversation
} from '../../../application/useConversations';
import { useUpdateConversation } from '../../../application/useUpdateConversation';
import {
    filterConversations,
    groupConversations,
    type ConversationGroupId
} from '../../../application/groupConversations';
import {
    COPILOT_SKILLS_MANAGE,
    agentSkillsPath,
    readAgentThreadId
} from '../../../domain/agentsRoute';
import { AgentsRailRow } from './AgentsRailRow';
import { RenameChatDialog } from './RenameChatDialog';

const messages = defineMessages({
    newChat: {
        id: 'copilot.agents.rail.newChat',
        defaultMessage: 'New chat'
    },
    skills: {
        id: 'copilot.agents.rail.skills',
        defaultMessage: 'Skills'
    },
    search: {
        id: 'copilot.agents.rail.search',
        defaultMessage: 'Search chats'
    },
    list: {
        id: 'copilot.agents.rail.list',
        defaultMessage: 'Chats'
    },
    empty: {
        id: 'copilot.agents.rail.empty',
        defaultMessage: 'No chats yet. Ask something to start one.'
    },
    emptyArchived: {
        id: 'copilot.agents.rail.emptyArchived',
        defaultMessage: 'Nothing archived.'
    },
    showArchived: {
        id: 'copilot.agents.rail.showArchived',
        defaultMessage: 'Archived'
    },
    backToChats: {
        id: 'copilot.agents.rail.backToChats',
        defaultMessage: 'Back to chats'
    },
    archivedList: {
        id: 'copilot.agents.rail.archivedList',
        defaultMessage: 'Archived chats'
    },
    archived: {
        id: 'copilot.agents.rail.archivedToast',
        defaultMessage: 'Chat archived.'
    },
    unarchived: {
        id: 'copilot.agents.rail.unarchivedToast',
        defaultMessage: 'Chat restored.'
    },
    renamed: {
        id: 'copilot.agents.rail.renamedToast',
        defaultMessage: 'Chat renamed.'
    },
    updateFailed: {
        id: 'copilot.agents.rail.updateFailed',
        defaultMessage: 'Could not update the chat. Please try again.'
    },
    noMatches: {
        id: 'copilot.agents.rail.noMatches',
        defaultMessage: 'No chats match “{query}”.'
    },
    failed: {
        id: 'copilot.agents.rail.failed',
        defaultMessage: 'Could not load your chats.'
    },
    retry: {
        id: 'copilot.agents.rail.retry',
        defaultMessage: 'Try again'
    },
    today: {
        id: 'copilot.agents.rail.group.today',
        defaultMessage: 'Today'
    },
    yesterday: {
        id: 'copilot.agents.rail.group.yesterday',
        defaultMessage: 'Yesterday'
    },
    week: {
        id: 'copilot.agents.rail.group.week',
        defaultMessage: 'Previous 7 days'
    },
    month: {
        id: 'copilot.agents.rail.group.month',
        defaultMessage: 'Previous 30 days'
    },
    older: {
        id: 'copilot.agents.rail.group.older',
        defaultMessage: 'Older'
    }
});

/** The heading each recency bucket renders under. */
const GROUP_LABELS: Record<ConversationGroupId, MessageDescriptor> = {
    today: messages.today,
    yesterday: messages.yesterday,
    week: messages.week,
    month: messages.month,
    older: messages.older
};

export interface AgentsRailListProps {
    /** The workspace whose threads are listed. */
    workspaceId: string;
    /**
     * Called after the user picks a thread or starts a new one. The desktop
     * rail ignores it; the mobile sheet uses it to close itself, since the list
     * it was opened from is now behind the answer it navigated to.
     */
    onNavigate?(): void;
}

/**
 * The thread list — New chat, a filter, and every conversation grouped by when
 * it was last used.
 *
 * **It navigates; it holds no chat state.** Which thread is open is a fact about
 * the URL (`useAgentThread` is what binds that to a transcript), so this list
 * needs nothing from the page it sits beside — which is exactly what lets the
 * same component serve both the desktop rail and the mobile sheet.
 */
export function AgentsRailList({
    workspaceId,
    onNavigate
}: AgentsRailListProps) {
    const intl = useIntl();
    const { pathname } = useLocation();
    const { startNew, select } = useAgentNavigation(workspaceId);
    const [query, setQuery] = useState('');
    // Which of the two disjoint lists is on screen. Local state rather than a
    // URL param: it is a way of looking at the rail, not a place — and putting
    // it in the URL would make Back step through it, competing with the Back
    // that moves between threads.
    const [showArchived, setShowArchived] = useState(false);
    const [renaming, setRenaming] = useState<CopilotConversation | null>(null);
    /**
     * How to give the renamed row's menu button focus back.
     *
     * A **ref, not state**: closing the dialog clears `renaming` in the same
     * commit that unmounts it, so a callback held in state is already gone by
     * the time Radix fires `onCloseAutoFocus` — and focus lands on `<body>`,
     * which is the exact bug this exists to prevent.
     */
    const returnFocusRef = useRef<(() => void) | null>(null);
    const {
        data: conversations,
        isPending,
        isError,
        refetch
    } = useConversations(workspaceId, showArchived);
    const update = useUpdateConversation(workspaceId);

    const activeId = readAgentThreadId(pathname);

    /** Files a thread away, or brings it back — with a line saying which. */
    const toggleArchived = (conversation: CopilotConversation) =>
        update.mutate(
            {
                conversationId: conversation.id,
                patch: { archived: !conversation.archived }
            },
            {
                onSuccess: () => {
                    toast.success(
                        intl.formatMessage(
                            conversation.archived
                                ? messages.unarchived
                                : messages.archived
                        )
                    );
                    // Archiving what you are reading leaves you on a thread that
                    // is in no visible list. Start a new chat instead — the
                    // thread is filed, not lost, and the archived list has it.
                    if (conversation.id === activeId) {
                        startNew();
                        onNavigate?.();
                    }
                },
                onError: () =>
                    toast.error(intl.formatMessage(messages.updateFailed))
            }
        );

    const groups = useMemo(
        () =>
            groupConversations(
                filterConversations(conversations ?? [], query),
                new Date()
            ),
        [conversations, query]
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-col gap-2 p-2">
                {/* One button, two jobs — because they are the same job: "get me
                    out of here and back to chatting". Offering New chat *and* a
                    way back from the archive would put two escapes side by side
                    in an 18rem column. */}
                {showArchived ? (
                    <Button
                        variant="outline"
                        className="justify-start gap-2"
                        onClick={() => {
                            setShowArchived(false);
                            setQuery('');
                        }}
                    >
                        <ArrowLeft className="size-4" />
                        {intl.formatMessage(messages.backToChats)}
                    </Button>
                ) : (
                    <Button
                        variant="outline"
                        className="justify-start gap-2"
                        onClick={() => {
                            startNew();
                            onNavigate?.();
                        }}
                    >
                        <MessageSquarePlus className="size-4" />
                        {intl.formatMessage(messages.newChat)}
                    </Button>
                )}

                {/* The filter appears once there is enough history for it to be
                    worth typing into. A search box over three rows is furniture
                    that pushes the rows it searches further down the rail. */}
                {(conversations?.length ?? 0) > 5 && (
                    <div className="relative">
                        <Search
                            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
                            aria-hidden
                        />
                        <Input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder={intl.formatMessage(messages.search)}
                            aria-label={intl.formatMessage(messages.search)}
                            className="h-8 pl-7 text-sm"
                        />
                    </div>
                )}
            </div>

            <nav
                aria-label={intl.formatMessage(
                    showArchived ? messages.archivedList : messages.list
                )}
                className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
            >
                {isPending && (
                    <div className="space-y-2 px-2 py-1" aria-hidden>
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-4 w-4/5" />
                        <Skeleton className="h-4 w-1/2" />
                    </div>
                )}

                {/* A failed list is not an empty list. Saying "no chats yet"
                    when the request 500'd would tell the user their history is
                    gone. */}
                {isError && (
                    <div
                        role="alert"
                        className="text-muted-foreground space-y-2 px-2 py-1 text-xs"
                    >
                        <p>{intl.formatMessage(messages.failed)}</p>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void refetch()}
                        >
                            {intl.formatMessage(messages.retry)}
                        </Button>
                    </div>
                )}

                {!isPending && !isError && groups.length === 0 && (
                    <p className="text-muted-foreground px-2 py-1 text-xs">
                        {query.trim()
                            ? intl.formatMessage(messages.noMatches, {
                                  query: query.trim()
                              })
                            : intl.formatMessage(
                                  showArchived
                                      ? messages.emptyArchived
                                      : messages.empty
                              )}
                    </p>
                )}

                {groups.map((group) => (
                    <section key={group.id} className="mb-4">
                        <h3 className="text-muted-foreground px-2.5 pb-1 text-[10px] font-semibold tracking-[0.08em] uppercase">
                            {intl.formatMessage(GROUP_LABELS[group.id])}
                        </h3>
                        <ul className="space-y-0.5">
                            {group.conversations.map((conversation) => (
                                <AgentsRailRow
                                    key={conversation.id}
                                    conversation={conversation}
                                    active={conversation.id === activeId}
                                    onSelect={() => {
                                        select(conversation.id);
                                        onNavigate?.();
                                    }}
                                    onRename={(returnFocus) => {
                                        returnFocusRef.current = returnFocus;
                                        setRenaming(conversation);
                                    }}
                                    onToggleArchived={() =>
                                        toggleArchived(conversation)
                                    }
                                />
                            ))}
                        </ul>
                    </section>
                ))}
            </nav>

            {/* Only on the active list, and only once something has been filed:
                a permanent "Archived (0)" link is a door to an empty room. */}
            {!showArchived && (
                <ArchiveLink
                    workspaceId={workspaceId}
                    onOpen={() => {
                        setShowArchived(true);
                        setQuery('');
                    }}
                />
            )}

            {/* The way to the workspace's skills, and the only one — the page
                is admin-only, so it is not in the nav where everyone would see
                a door they cannot open. Fail-closed, like every other
                permission check on this surface. */}
            <SkillsLink workspaceId={workspaceId} />

            <RenameChatDialog
                conversation={renaming}
                saving={update.isPending}
                failed={update.isError}
                onClose={() => setRenaming(null)}
                onReturnFocus={() => returnFocusRef.current?.()}
                onSave={(title) => {
                    if (!renaming) return;
                    update.mutate(
                        { conversationId: renaming.id, patch: { title } },
                        {
                            onSuccess: () => {
                                setRenaming(null);
                                toast.success(
                                    intl.formatMessage(messages.renamed)
                                );
                            }
                            // No `onError`: the dialog stays open and says so
                            // itself, which is where the user's typing is.
                        }
                    );
                }}
            />
        </div>
    );
}

/**
 * The link to the workspace's skills, under the archive link.
 *
 * Rendered only for someone who may actually write one. Skills are visible to
 * everybody in the composer's picker; this page is where they are *authored*,
 * which is admin-only, so a contributor gets no link rather than a page that
 * greets them with "no access".
 */
function SkillsLink({ workspaceId }: { workspaceId: string }) {
    const intl = useIntl();
    const canManage = useHasPermission(COPILOT_SKILLS_MANAGE);

    if (!canManage) {
        return null;
    }

    return (
        <div className="border-t p-2">
            <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-muted-foreground w-full justify-start gap-2"
            >
                <Link to={agentSkillsPath(workspaceId)}>
                    <BookOpen className="size-3.5" />
                    {intl.formatMessage(messages.skills)}
                </Link>
            </Button>
        </div>
    );
}

/**
 * The way into the archive, at the foot of the rail.
 *
 * It runs its **own** query for the archived list rather than taking a count
 * from above, so the link can hide itself when there is nothing archived. The
 * cost is one cached request per workspace, and the alternative — a count
 * endpoint, or listing both sets to size one — is more server for less.
 */
function ArchiveLink({
    workspaceId,
    onOpen
}: {
    workspaceId: string;
    onOpen(): void;
}) {
    const intl = useIntl();
    const { data } = useConversations(workspaceId, true);

    if (!data || data.length === 0) {
        return null;
    }

    return (
        <div className="border-t p-2">
            <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground w-full justify-start gap-2"
                onClick={onOpen}
            >
                <Archive className="size-3.5" />
                {intl.formatMessage(messages.showArchived)}
                <span className="ml-auto text-[11px] tabular-nums">
                    {data.length}
                </span>
            </Button>
        </div>
    );
}
