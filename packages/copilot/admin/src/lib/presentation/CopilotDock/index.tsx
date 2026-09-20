import { useLayoutEffect, useRef } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Plus, Sparkles, X } from 'lucide-react';
import { cn, Kbd } from '@ortha/design-system';
import type { CopilotSession } from '../../application/sessions';
import {
    NEW_CHAT_KEY_SHORTCUTS,
    shortcutModifierGlyph
} from '../../domain/shortcut';

// The product is **Ortha AI**; the code keeps `copilot`. See the naming note in
// `docs/design/copilot.md`.
const messages = defineMessages({
    label: {
        id: 'copilot.dock.label',
        defaultMessage: 'Ortha AI chats'
    },
    newChat: {
        id: 'copilot.dock.newChat',
        defaultMessage: 'New chat'
    },
    start: {
        id: 'copilot.dock.start',
        defaultMessage: 'Ortha AI'
    },
    // With nothing open this button *reads* "Ortha AI" and used to *announce*
    // "New chat", so its visible label was not in its accessible name at all —
    // WCAG 2.5.3, and the exact thing that stops "click Ortha AI" working for
    // anyone driving the admin by voice. Now the name contains the visible text.
    startFull: {
        id: 'copilot.dock.startFull',
        defaultMessage: 'Ortha AI — new chat'
    },
    // Deliberately not "New chat": that is the name of the button beside it,
    // and two controls in one toolbar answering to the same name is ambiguous
    // to anyone driving this by voice or by a screen reader's control list.
    untitled: {
        id: 'copilot.dock.untitled',
        defaultMessage: 'Untitled chat'
    },
    unread: {
        id: 'copilot.dock.unread',
        defaultMessage: '{title} — finished'
    },
    // Distinct from "finished" on purpose: this chat has not finished, it has
    // stopped and is blocked on you. Conflating the two would let the more
    // urgent state hide behind the routine one.
    awaiting: {
        id: 'copilot.dock.awaiting',
        defaultMessage: '{title} — waiting for you'
    },
    close: {
        id: 'copilot.dock.close',
        defaultMessage: 'Close {title}'
    }
});

/**
 * The bar along the bottom: one pill per chat, plus a way to start another.
 *
 * **It replaces the floating button**, and is the reason there can be more than
 * one chat at all. A single round button could only ever mean "the panel";
 * a bar of chats means the panel is one of several, and gives a collapsed chat
 * somewhere to live where you can still see it exists.
 *
 * Three things it has to get right:
 *
 * - **A pill for a chat you cannot see must say something happened in it.**
 *   That is the entire point of running several: you ask three questions and go
 *   back to work. The marker is a dot, and it is also in the pill's accessible
 *   name — a colour-only signal is no signal for a screen-reader user, and this
 *   one is load-bearing.
 * - **Clicking a pill toggles**, so the same control that shows a chat hides it
 *   again. `aria-pressed` says which state it is in rather than the styling
 *   alone.
 * - **Close is a separate control with its own name.** "Close Fix the headline"
 *   rather than an unlabelled ×, because closing ends a run and discards a
 *   window, and it sits a few pixels from the thing that merely hides it.
 *
 * Bottom-**right**, not full width: it sits where the floating button was, and
 * a bar spanning the viewport would cover page content across every screen for
 * the sake of at most a handful of chats.
 */
export function CopilotDock({
    sessions,
    onToggle,
    onClose,
    onNewChat,
    newChatRef
}: {
    sessions: readonly CopilotSession[];
    onToggle(id: string): void;
    onClose(id: string): void;
    onNewChat(): void;
    /** Focus lands here when a chat closes, so it never falls to `<body>`. */
    newChatRef?: React.RefObject<HTMLButtonElement | null>;
}) {
    const intl = useIntl();
    const empty = sessions.length === 0;
    const bar = useRef<HTMLDivElement | null>(null);

    /**
     * Publishes how much room this bar takes at the bottom of the viewport, so
     * the page's scroll containers can reserve it.
     *
     * The dock is `fixed` and portalled to `<body>`, so it covers whatever is
     * beneath it — and what is beneath it is the bottom of the page's
     * scrollport and the bottom of the properties rail, which is where a
     * records footer's pagination and the entry rail's own buttons sit. A
     * control under this bar cannot be clicked at all: it is not hidden, it is
     * *intercepted*, which reads to a mouse user as a button that does nothing.
     *
     * A variable rather than a constant in the shell, because the shell must
     * not know that a copilot exists — with no dock mounted the variable is
     * unset and every reader falls back to `0px`, which is the layout those
     * deployments have today. Measured rather than hard-coded so the pills'
     * own type scale cannot drift away from the gutter reserved for them.
     */
    useLayoutEffect(() => {
        const node = bar.current;
        if (!node) return;
        const root = document.documentElement;
        const publish = () => {
            // The bar's own height, plus the `bottom-3` it floats above the
            // edge, plus that much again so the last control clears it rather
            // than touching it.
            const gutter = node.offsetHeight + 12 * 2;
            root.style.setProperty(
                '--ortha-fixed-bottom-gutter',
                `${gutter}px`
            );
        };
        publish();
        const observer = new ResizeObserver(publish);
        observer.observe(node);
        return () => {
            observer.disconnect();
            root.style.removeProperty('--ortha-fixed-bottom-gutter');
        };
    }, []);

    return (
        <div
            ref={bar}
            // A **group**, not a `toolbar`. It was a toolbar, for the good
            // reason that a screen reader then announces one control group
            // rather than a loose row of buttons floating over the page — but
            // per the WAI-ARIA APG a toolbar is a *composite* widget: one tab
            // stop, arrow keys inside it. This has neither a roving tabindex
            // nor an `ArrowLeft`/`ArrowRight` handler, so the role promised a
            // keyboard model that does not exist, and a screen-reader user was
            // told to press arrows that do nothing. `group` is what it actually
            // is: every pill is its own tab stop, in DOM order, which is also
            // what the dock's own docs and e2e suite describe. (`complementary`
            // keeps that property — it is a landmark, not a composite widget, so
            // every pill is still its own tab stop.)
            //
            // …and a **landmark**, because it is portalled to `<body>`: it sits
            // outside the shell's `<main>` and outside its sidebar, so with a
            // plain `group` every pill on it was content a screen-reader user
            // could not reach by landmark and had to tab the whole page for
            // (`ORT-170`). `complementary` is the same call the app sidebar
            // makes — persistent chrome beside the page's content, related to it
            // but not part of it. The name is what makes it navigable rather
            // than one more unlabelled region.
            role="complementary"
            aria-label={intl.formatMessage(messages.label)}
            className={cn(
                'bg-background text-foreground fixed right-4 bottom-3 z-40',
                'flex max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto',
                'rounded-full border p-1 shadow-lg'
            )}
        >
            {sessions.map((session) => {
                const title =
                    session.title ?? intl.formatMessage(messages.untitled);
                return (
                    <div
                        key={session.id}
                        className="flex shrink-0 items-center"
                    >
                        <button
                            type="button"
                            onClick={() => onToggle(session.id)}
                            aria-pressed={!session.minimized}
                            // The marker is in the name, not only in the dot —
                            // and `awaiting` outranks `unread`, because a chat
                            // blocked on a question is the one to open first.
                            aria-label={
                                session.awaiting
                                    ? intl.formatMessage(messages.awaiting, {
                                          title
                                      })
                                    : session.unread
                                      ? intl.formatMessage(messages.unread, {
                                            title
                                        })
                                      : title
                            }
                            title={title}
                            className={cn(
                                'focus-visible:ring-ring flex max-w-[12rem] items-center gap-1.5 rounded-full py-1 pr-1 pl-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none',
                                session.minimized
                                    ? 'hover:bg-muted text-muted-foreground'
                                    : 'bg-secondary text-secondary-foreground'
                            )}
                        >
                            <Sparkles className="size-3.5 shrink-0" />
                            <span className="truncate">{title}</span>
                            {(session.awaiting || session.unread) && (
                                <span
                                    aria-hidden
                                    className={cn(
                                        'size-1.5 shrink-0 rounded-full',
                                        // Amber for "answer me", primary for
                                        // "there is something to read". Shape
                                        // and position are identical, so the
                                        // colour is a nicety on top of the
                                        // name — never the only signal.
                                        session.awaiting
                                            ? 'bg-warning'
                                            : 'bg-primary'
                                    )}
                                />
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={() => onClose(session.id)}
                            aria-label={intl.formatMessage(messages.close, {
                                title
                            })}
                            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring mr-0.5 rounded-full p-1 focus-visible:ring-2 focus-visible:outline-none"
                        >
                            <X className="size-3" />
                        </button>
                    </div>
                );
            })}

            <button
                ref={newChatRef}
                type="button"
                onClick={onNewChat}
                aria-label={intl.formatMessage(
                    empty ? messages.startFull : messages.newChat
                )}
                title={intl.formatMessage(
                    empty ? messages.startFull : messages.newChat
                )}
                // Both accepted chords, so assistive tech announces the one its
                // user can actually press rather than the glyph on the chip.
                aria-keyshortcuts={NEW_CHAT_KEY_SHORTCUTS}
                className={cn(
                    'bg-primary text-primary-foreground focus-visible:ring-ring flex shrink-0 items-center gap-1.5 rounded-full text-xs transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
                    // With no chats open this is the only thing on screen, so it
                    // names the product — it is the entry point the floating
                    // button used to be. Once there are pills it shrinks to a
                    // `+`, because the bar itself now says what this is about.
                    empty ? 'px-3 py-1.5' : 'size-7 justify-center'
                )}
            >
                {empty ? (
                    <>
                        <Sparkles className="size-3.5" />
                        {intl.formatMessage(messages.start)}
                        <Kbd className="hidden sm:inline-flex">
                            {`${shortcutModifierGlyph()}J`}
                        </Kbd>
                    </>
                ) : (
                    <Plus className="size-4" />
                )}
            </button>
        </div>
    );
}
