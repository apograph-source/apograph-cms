import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useHasPermission } from '@orthacms/identity-admin';
import { isComposingText } from '@orthacms/utils-admin';
import { useCopilotAvailable } from '../../application/useCopilotModels';
import { useCopilotSessions } from '../../application/useCopilotSessions';
import { useRouteContext } from '../../application/useRouteContext';
import { badgeCount } from '../../application/tabBadge';
import { useTabBadge } from '../../application/useTabBadge';
import {
    COPILOT_USE,
    agentThreadPath,
    isAgentsPath
} from '../../domain/agentsRoute';
import { CopilotDock } from '../CopilotDock';
import { CopilotSession } from '../CopilotSession';

/**
 * The entry points, the chats they start, and the dock that lists them.
 *
 * Contributed to `SIDEBAR_FOOTER_SLOT`, so it is present across the global and
 * per-workspace sidebars — but it renders **nothing outside a workspace**, and
 * nothing for a user without `copilot:use`. Runs are workspace-scoped
 * (`X-Workspace-Id` is required by `WorkspaceGuard`), so offering a chat where
 * there is no open workspace would only produce a 400.
 *
 * **The dock is the only entry point.** There was a floating button, and then
 * a sidebar row beside it; both are gone. A round button could only ever mean
 * "the panel", singular, and a sidebar row duplicated what the dock already
 * says while spending a permanent slot in navigation on it. With no chats open
 * the dock *is* a labelled Ortha AI button in the corner, and as soon as there
 * are chats it becomes the bar listing them — one control that grows into the
 * thing it opens.
 *
 * `⌘J` is still the shortcut. Its discoverability moved onto the dock's own
 * button, which shows the hint while it is the only thing there.
 *
 * **Every chat stays mounted for as long as its pill exists**, collapsed or
 * not. That is what lets three answers stream while you read a fourth, and it
 * is why closing a pill — not collapsing it — is the thing that cancels a run.
 *
 * The permission check mirrors the server's gate rather than replacing it: the
 * route enforces `copilot:use` regardless, and `useHasPermission` is
 * fail-closed, so a user whose permissions haven't loaded sees nothing rather
 * than a button that 403s.
 */
export function CopilotLauncher() {
    const sessions = useCopilotSessions();
    const newChatRef = useRef<HTMLButtonElement>(null);
    const { pathname } = useLocation();
    const navigate = useNavigate();

    const canUse = useHasPermission(COPILOT_USE);
    const routeContext = useRouteContext();
    const { workspaceId } = routeContext;
    // The deployment's own switch, asked of the routes rather than of a
    // capability endpoint: an operator who turned the copilot off unregisters
    // every controller, so there is nothing here to open. Probed only for a
    // user who could use it anyway, so the check costs a request per session
    // and only for the people it can be true for.
    const deploymentRunsCopilot = useCopilotAvailable({ enabled: canUse });
    const available = canUse && deploymentRunsCopilot && !!workspaceId;

    // On the Agents view the whole dock stands down — the bar *and* the windows.
    // The page is already the chat surface, so a floating window over it is a
    // second one saying the same thing, and the dock's own button would offer to
    // open the page the user is standing on.
    //
    // Hidden, **not unmounted**. The chats keep running either way (they live in
    // `copilotStore`, not here), but the mounted `CopilotSession`s are what
    // report a finished answer, a parked permission prompt and a derived title
    // back to the session store — which is what keeps the browser tab's badge
    // truthful while the dock is out of sight, and what has the pills already
    // correct the moment the user navigates away again.
    const dockStandsDown = isAgentsPath(pathname);

    // The tab badge lives here for the same reason the dock does: this is the
    // one copilot component mounted for the whole session, so it can count
    // chats that want the user back no matter which page is open. It counts
    // **every** chat, not just the dock's — a page-presented one cannot be
    // awaiting and unseen, but it costs nothing to be right about it.
    useTabBadge(badgeCount(sessions.all));

    const { start, visible } = sessions;
    // ⌘J / Ctrl+J starts a chat (design §2). Registered only while the launcher
    // is actually available, so the shortcut can't open a chat the user isn't
    // allowed to have or that has no workspace to run against.
    useEffect(() => {
        if (!available) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== 'j') return;
            if (!event.metaKey && !event.ctrlKey) return;
            // Yield while the user is writing. The binding is on `window`, so it
            // fired wherever focus was: putting the caret in a rich-text body
            // and pressing ⌘J took focus out of the document and opened the dock
            // — a change of context in response to input into a different
            // control (WCAG 3.2.2), with the keystroke destroyed by the
            // `preventDefault` below (`ORT-163`). ⌘B and ⌘K already yield this
            // way; no editor binds ⌘J, so nothing is lost by being consistent.
            if (isComposingText(event.target)) return;
            event.preventDefault();
            start();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [available, start]);

    const slotOf = useCallback(
        (id: string) => visible.findIndex((s) => s.id === id),
        [visible]
    );

    // The panel's history dropdown loads a thread into the window it was opened
    // from, and — unlike the Agents rail, which goes through the sessions
    // reducer's `open` guard — nothing stopped it landing on a thread another
    // window already holds. Two windows on one `conversationId` is two
    // transcripts of one server-side conversation, and they disagree from the
    // next turn onwards: the one that sent it grows, the other silently goes
    // stale while still offering a composer that appends to the same thread.
    //
    // Returns false when the pick was adopted elsewhere, so the calling window
    // leaves its own transcript alone.
    const { all, describe, focus } = sessions;
    const adoptConversation = useCallback(
        (sessionId: string, conversationId: string, title: string | null) => {
            const existing = all.find(
                (s) => s.conversationId === conversationId && s.id !== sessionId
            );
            if (existing) {
                focus(existing.id);
                return false;
            }
            // The thread's own name, recorded before the transcript lands.
            // `CopilotSession` derives a title from the first message only when
            // the session has none, so this wins — which is why a thread opened
            // from the dropdown used to be labelled with its opening question
            // instead of the name the rail shows for it.
            // Only when there is one: an untitled thread must fall through to
            // the derived title, and writing `''` here would leave the pill
            // with a blank name instead of "Untitled chat".
            describe(sessionId, {
                conversationId,
                ...(title ? { title } : {})
            });
            return true;
        },
        [all, describe, focus]
    );

    if (!available) {
        return null;
    }

    // Nothing is rendered into the sidebar slot itself any more — only the
    // portalled dock and its windows. The slot contribution stays because it is
    // what mounts this component at all.
    return (
        <>
            {/* Portalled to `<body>`. This component is contributed to the
                sidebar's footer slot, so without a portal the fixed-position
                chrome below stays a DOM *descendant of the sidebar* — and
                inherits its styling. That is not hypothetical: the sidebar sets
                `text-sidebar-foreground` (a near-white, for its dark
                background), so the panel rendered near-white text on its own
                white surface at a 2.86:1 contrast ratio, well under the 4.5:1
                WCAG AA needs. A portal fixes the whole class of problem —
                colour, font, letter-spacing — rather than just the one symptom,
                and also protects the `position: fixed` from ever being trapped
                by a transform on an ancestor. React context still flows through
                portals, so the permission and workspace hooks are unaffected. */}
            {createPortal(
                // `hidden` rather than an unmount — see `dockStandsDown`. The
                // attribute's `display: none` also takes the windows out of the
                // tab order and the accessibility tree, which a visibility trick
                // would not: a dock nobody can see must not still be reachable
                // by Tab from the page it is hiding behind.
                <div hidden={dockStandsDown}>
                    {/* Keyed by session **and** workspace: navigating to another
                        workspace must not hand an in-flight run a new
                        `X-Workspace-Id` half way through. */}
                    {sessions.dock.map((session) => (
                        <CopilotSession
                            key={`${workspaceId}:${session.id}`}
                            session={session}
                            workspaceId={workspaceId}
                            routeContext={routeContext}
                            slot={slotOf(session.id)}
                            // Focus has to land somewhere when a window goes
                            // away, and the dock's new-chat button is the one
                            // control guaranteed to still be there. The panel
                            // has always had the machinery; it was never handed
                            // the ref, so collapsing a window (with the button
                            // or with Escape) dropped focus on `<body>` and
                            // sent a keyboard user back to the top of the page.
                            returnFocusRef={newChatRef}
                            onMinimize={() => sessions.minimize(session.id)}
                            onClose={() => {
                                sessions.close(session.id);
                                newChatRef.current?.focus();
                            }}
                            onAdoptConversation={(conversationId, title) =>
                                adoptConversation(
                                    session.id,
                                    conversationId,
                                    title
                                )
                            }
                            onNewChat={() => sessions.start()}
                            // Navigate and nothing else: the Agents page
                            // presents the chat already on that thread, so the
                            // session changes surface and leaves the dock by
                            // itself. Closing it here would race that handover.
                            onOpenInAgents={(conversationId) =>
                                navigate(
                                    agentThreadPath(workspaceId, conversationId)
                                )
                            }
                            onDescribe={(meta) =>
                                sessions.describe(session.id, meta)
                            }
                            onActivity={() => sessions.noteActivity(session.id)}
                            onAwaiting={(value) =>
                                sessions.setAwaiting(session.id, value)
                            }
                            onChoiceChange={(choice) =>
                                sessions.setModel(session.id, choice)
                            }
                            onContextChange={(context) =>
                                sessions.setContext(session.id, context)
                            }
                            onSkillsChange={(names) =>
                                sessions.setSkills(session.id, names)
                            }
                        />
                    ))}

                    <CopilotDock
                        sessions={sessions.dock}
                        onToggle={sessions.toggle}
                        onClose={sessions.close}
                        onNewChat={() => sessions.start()}
                        newChatRef={newChatRef}
                    />
                </div>,
                document.body
            )}
        </>
    );
}
