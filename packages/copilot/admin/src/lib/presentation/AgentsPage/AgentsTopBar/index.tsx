import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { PanelLeft, Sparkles } from 'lucide-react';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
    Button,
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
    TopBar,
    TopBarActions,
    TopBarIcon
} from '@orthacms/design-system';
import { useConversations } from '../../../application/useConversations';
import { readAgentThreadId } from '../../../domain/agentsRoute';
import { AgentsRailList } from '../AgentsRailList';

// The product is **Ortha AI**; the code keeps `copilot`. See the naming note in
// `docs/design/copilot.md`.
const messages = defineMessages({
    nav: {
        id: 'copilot.agents.topbar.nav',
        defaultMessage: 'Breadcrumb'
    },
    root: {
        id: 'copilot.agents.topbar.root',
        defaultMessage: 'Ortha AI'
    },
    newChat: {
        id: 'copilot.agents.topbar.newChat',
        defaultMessage: 'New chat'
    },
    untitled: {
        id: 'copilot.agents.topbar.untitled',
        defaultMessage: 'Untitled chat'
    },
    chats: {
        id: 'copilot.agents.topbar.chats',
        defaultMessage: 'Chats'
    }
});

export interface AgentsTopBarProps {
    /** The workspace whose threads this bar titles. */
    workspaceId: string;
    /** Where the "Ortha AI" crumb links — a new chat. */
    basePath: string;
}

/**
 * The Agents view's one bar: icon tile, breadcrumb, controls.
 *
 * **One bar, not two.** A `PageTopBar` for the breadcrumb plus a header of the
 * thread's own would spend 6rem of a chat surface on chrome, so this composes
 * the `TopBar` primitive directly — the same thing `ContentTopBar` does, and for
 * the same reason. Rendering a real `TopBar` also matters beyond looks: it is
 * what hosts the sidebar-reveal trigger when the app sidebar is collapsed, and
 * what makes the shell's floating fallback toggle stand down.
 *
 * The thread's title comes from the **list** query rather than from the open
 * chat, which is what lets the bar sit above the transcript instead of inside
 * it: the title is a property of the saved thread, and the list is already
 * invalidated as each turn lands.
 */
export function AgentsTopBar({ workspaceId, basePath }: AgentsTopBarProps) {
    const intl = useIntl();
    const { pathname } = useLocation();
    const { data: conversations } = useConversations(workspaceId);
    const [railOpen, setRailOpen] = useState(false);

    const conversationId = readAgentThreadId(pathname);
    const saved = conversations?.find((item) => item.id === conversationId);
    const leaf = conversationId
        ? (saved?.title ?? intl.formatMessage(messages.untitled))
        : intl.formatMessage(messages.newChat);

    return (
        <TopBar>
            <TopBarIcon className="bg-primary/10 text-primary">
                <Sparkles />
            </TopBarIcon>

            <Breadcrumb
                aria-label={intl.formatMessage(messages.nav)}
                className="min-w-0 overflow-hidden"
            >
                <BreadcrumbList className="flex-nowrap font-medium">
                    {/* Below `sm` only the open thread survives — the trail
                        would otherwise shrink past its own text. */}
                    <BreadcrumbItem className="hidden min-w-0 whitespace-nowrap sm:inline-flex">
                        <BreadcrumbLink asChild>
                            <Link to={basePath}>
                                {intl.formatMessage(messages.root)}
                            </Link>
                        </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden sm:flex" />
                    <BreadcrumbItem className="min-w-0 whitespace-nowrap">
                        <BreadcrumbPage className="flex min-w-0 items-center truncate font-medium">
                            {leaf}
                        </BreadcrumbPage>
                    </BreadcrumbItem>
                </BreadcrumbList>
            </Breadcrumb>

            {/* `ml-auto`, so nothing may follow it on the bar. */}
            <TopBarActions>
                {/* Below `md` the rail has no column of its own, so the thread
                    list lives behind this button. A sheet rather than a menu: it
                    is a whole navigation region, with its own search and its own
                    New chat. */}
                <Sheet open={railOpen} onOpenChange={setRailOpen}>
                    {/* Through `SheetTrigger`, not a bare `onClick`: the
                        trigger is what Radix returns focus to when the sheet
                        closes, and a controlled dialog with no trigger drops it
                        on `<body>`. */}
                    <SheetTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground gap-1.5 md:hidden"
                        >
                            <PanelLeft className="size-4" />
                            {intl.formatMessage(messages.chats)}
                        </Button>
                    </SheetTrigger>
                    <SheetContent
                        side="left"
                        className="flex w-80 flex-col gap-0 p-0"
                    >
                        <SheetHeader className="border-b px-4 py-3">
                            <SheetTitle className="text-base">
                                {intl.formatMessage(messages.chats)}
                            </SheetTitle>
                        </SheetHeader>
                        <AgentsRailList
                            workspaceId={workspaceId}
                            onNavigate={() => setRailOpen(false)}
                        />
                    </SheetContent>
                </Sheet>
            </TopBarActions>
        </TopBar>
    );
}
