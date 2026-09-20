import { useEffect, useId, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    GripVertical,
    Maximize2,
    MessageSquarePlus,
    Minimize2,
    Minus,
    SquareArrowOutUpRight,
    X
} from 'lucide-react';
import { Button, cn } from '@orthacms/design-system';
import type { CopilotChat } from '../../application/useCopilotChat';
import {
    keyboardStep,
    panelFrameStorageKey,
    usePanelFrame,
    type PanelFrameControls
} from '../../application/usePanelFrame';
import { Composer } from '../Composer';
import { useHasPermission } from '@orthacms/identity-admin';
import { MEDIA_CREATE } from '../../domain/agentsRoute';
import { useComposerAttachments } from '../../application/useComposerAttachments';
import { useComposerSkills } from '../../application/useComposerSkills';
import { MessageList } from '../MessageList';
import { ConversationPicker } from '../ConversationPicker';
import { ModelPicker } from '../ModelPicker';
import { PanelResizeHandles } from '../PanelResizeHandles';
import {
    useEffectiveModelChoice,
    type CopilotModelChoice
} from '../../application/useCopilotModels';
import type { RouteContext } from '../../application/readRouteContext';
import { ContextChip } from '../ContextChip';

// Product name is **Ortha AI**; the code keeps `copilot`. See the naming note
// in `docs/design/copilot.md`.
const messages = defineMessages({
    openInAgents: {
        id: 'copilot.panel.openInAgents',
        defaultMessage: 'Open in Agents view'
    },
    title: {
        id: 'copilot.panel.title',
        defaultMessage: 'Ortha AI'
    },
    description: {
        id: 'copilot.panel.description',
        defaultMessage:
            'Ask about the content in this workspace. Ortha AI acts with your permissions.'
    },
    newChat: {
        id: 'copilot.panel.newChat',
        defaultMessage: 'New chat'
    },
    minimize: {
        id: 'copilot.panel.minimize',
        defaultMessage: 'Minimize'
    },
    restore: {
        id: 'copilot.panel.restore',
        defaultMessage: 'Restore'
    },
    expand: {
        id: 'copilot.panel.expand',
        defaultMessage: 'Expand'
    },
    collapse: {
        id: 'copilot.panel.collapse',
        defaultMessage: 'Shrink'
    },
    close: {
        id: 'copilot.panel.close',
        defaultMessage: 'Close'
    },
    move: {
        id: 'copilot.panel.move',
        defaultMessage: 'Move Ortha AI'
    },
    moveHint: {
        id: 'copilot.panel.moveHint',
        defaultMessage:
            'Drag to move. With this focused, arrow keys move; hold Shift for larger steps.'
    }
});

/** Which arrow key moves which way, as a `[dx, dy]` unit vector. */
const ARROWS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
};

/**
 * How much of the screen the panel takes.
 *
 * There is no `minimized` any more: collapsing a chat is now the **dock's** job
 * — it becomes a pill in the bottom bar and this component unmounts, while the
 * chat's state and its in-flight run live on in the session above. That is what
 * makes several background chats possible at all; a minimized-but-mounted panel
 * per chat would have meant N hidden transcripts in the tree.
 */
type PanelSize = 'docked' | 'expanded';

/**
 * Enter/exit duration, in ms. Must match the `duration-200` class below — the
 * timeout is what unmounts the panel after the exit transition, and unmounting
 * early would cut the animation off mid-way.
 */
const MOTION_MS = 200;

/**
 * How far above the viewport's bottom an un-dragged window sits — clear of the
 * dock, which is `bottom-3` and about `2.25rem` tall.
 */
const DOCK_CLEARANCE = '4rem';

/**
 * Horizontal step between un-dragged windows: the docked width plus a gutter.
 * Two chats opened back to back land side by side rather than one hiding the
 * other, and the user can still drag either anywhere.
 */
const SLOT_PITCH = '27.5rem';

export interface CopilotPanelProps {
    /**
     * The chat this window shows. Owned by the **session** above, not created
     * here: a chat that is collapsed to the dock must keep streaming, and a
     * hook inside an unmounted panel cannot.
     */
    chat: CopilotChat;
    /** The workspace runs are scoped to. */
    workspaceId: string;
    /**
     * Where the user is, from the URL. Sent with every turn so the model can
     * resolve "this entry" and "here", and shown above the composer so the user
     * can see what is being attached.
     */
    routeContext: RouteContext;
    /** What the header shows — the thread's title, or a placeholder. */
    title: string | null;
    /** Whether this window is on screen. */
    open: boolean;
    /**
     * Which visible window this is, counting from the right. Sets where an
     * un-dragged window sits, so opening a second chat does not stack it exactly
     * on the first.
     */
    slot: number;
    /** Collapses this chat to the dock. It keeps running. */
    onMinimize(): void;
    /** Closes this chat for good. */
    onClose(): void;
    /** Starts another chat alongside this one. */
    onNewChat(): void;
    /**
     * Takes this chat to the full-page Agents view, given the thread it is on.
     *
     * The panel only asks; the surface above does the navigating. Nothing is
     * closed or copied on the way — `useAgentThread` reads the thread out of
     * the URL and **presents the chat already on it**, so the same store entry
     * simply changes surface and leaves the dock of its own accord. A run
     * mid-flight carries over with it.
     *
     * Offered only once the chat has a thread id: an unsaved chat has no URL to
     * be opened at, and the Agents view's base path means "a fresh chat", which
     * would strand the draft rather than move it.
     */
    onOpenInAgents?(conversationId: string): void;
    /**
     * Asks the surface above whether this window may take `conversationId`,
     * before the history dropdown loads it.
     *
     * The sessions reducer's `open` already refuses to put one thread in two
     * windows, and the Agents rail goes through it — but this dropdown loads
     * straight into the chat, so it bypassed the guard entirely. Two windows on
     * one thread is two transcripts of one server-side conversation that
     * disagree from the next turn on. False means another window holds it and
     * has been focused instead, so this one leaves its own transcript alone.
     */
    onAdoptConversation?(conversationId: string, title: string | null): boolean;
    /**
     * Which backend the next turn runs on, or `null` until somebody picks —
     * which reads as the catalogue's first entry (`useEffectiveModelChoice`),
     * not as "let the server decide".
     *
     * A **prop, from the session** — it used to be `useState` in this file's
     * `PanelBody`, which unmounts the moment the panel collapses to the dock, so
     * minimizing a chat silently reset its model.
     */
    choice: CopilotModelChoice | null;
    /** Routes the next turn elsewhere. */
    onChoiceChange(choice: CopilotModelChoice | null): void;
    /**
     * The page attached to the next turn, from the session — a prop for the
     * same reason `choice` is, and it was the worse of the two: it was
     * `useState` in `PanelBody`, which unmounts the moment the window collapses,
     * so attaching an entry, collapsing the window to go and read it, and coming
     * back sent the question with **no** context and no chip left to say so.
     */
    context: RouteContext | null;
    /** Attaches a page to the next turn, or detaches it with `null`. */
    onContextChange(context: RouteContext | null): void;
    /**
     * Skills staged for this chat, from the session — a prop for the same
     * reason `choice` is: `PanelBody` unmounts when the window collapses, and
     * holding the selection there would silently drop it.
     */
    skills: readonly string[];
    /** Replaces the staged set. */
    onSkillsChange(names: readonly string[]): void;
    /** Focused when the panel closes, so keyboard focus doesn't fall to `<body>`. */
    returnFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * The chat panel — a **docked window** in the bottom-right corner, not a modal
 * drawer.
 *
 * That distinction is the whole point of the shape, not a cosmetic choice.
 * A `Sheet` is a modal dialog: it dims the page, traps focus, and blocks every
 * control behind it. But the useful thing to do with an answer about your
 * content is *act on it* — open the entry it named, check a field, run the
 * filter it suggested — and a modal makes you close the conversation to do any
 * of that. Docked and non-modal, the panel sits alongside the page: you can
 * scroll the records table, click into an entry, and keep the thread open
 * beside it.
 *
 * Consequences of being non-modal, all deliberate:
 * - **No focus trap.** Tab moves out of the panel and into the page, which is
 *   correct — the page is still live.
 * - **No overlay**, so nothing behind it is dimmed or click-blocked.
 * - Focus is still *managed*: the composer takes focus on open, and closing
 *   returns focus to whatever opened it rather than dropping it on `<body>`.
 * - Escape closes it, matching what every floating panel does.
 */
export function CopilotPanel({
    chat,
    workspaceId,
    routeContext,
    title,
    open,
    slot,
    onMinimize,
    onClose,
    onNewChat,
    onOpenInAgents,
    onAdoptConversation,
    choice,
    onChoiceChange,
    context,
    onContextChange,
    skills,
    onSkillsChange,
    returnFocusRef
}: CopilotPanelProps) {
    const intl = useIntl();
    // Per instance, so three open windows do not collide on one id — the same
    // discipline the honeycomb backdrop uses for its pattern ids.
    const headingId = useId();
    const [size, setSize] = useState<PanelSize>('docked');
    // Where the user dragged it to, if they have. `null` until then, which is
    // what keeps the docked/expanded classes below meaningful.
    const frame = usePanelFrame(panelFrameStorageKey(slot));
    // `rendered` keeps the panel in the tree long enough to play the exit
    // transition; `visible` drives the transition itself. Two states rather
    // than one because the element has to mount in its hidden position *first*,
    // then flip to visible on a later frame — set both at once and the browser
    // has nothing to transition from.
    const [rendered, setRendered] = useState(open);
    const [visible, setVisible] = useState(false);

    // Escape collapses to the dock rather than closing. Discarding a chat —
    // and cancelling whatever run is in flight — is too much to hang off a key
    // people press to dismiss things; the pill stays, and so does the thread.
    // Bound on the panel's own subtree rather than the window, so Escape inside
    // a page dialog behind us doesn't also touch the chat.
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onMinimize();
        }
    };

    useEffect(() => {
        if (open) {
            setRendered(true);
            // Two frames: the first commits the mounted-but-hidden element, the
            // second starts the transition. One frame is enough in most
            // browsers and flaky in the rest.
            let inner = 0;
            const outer = requestAnimationFrame(() => {
                inner = requestAnimationFrame(() => setVisible(true));
            });
            return () => {
                cancelAnimationFrame(outer);
                cancelAnimationFrame(inner);
            };
        }

        setVisible(false);
        // **Before** the exit transition, not after it. The window is already
        // non-interactive the moment it starts leaving, and waiting `MOTION_MS`
        // to hand focus back leaves a keyboard user on `<body>` — pressing Tab
        // in that gap restarts from the top of the document, which is the whole
        // failure this exists to prevent.
        returnFocusRef?.current?.focus();
        const timer = setTimeout(() => setRendered(false), MOTION_MS);
        return () => clearTimeout(timer);
    }, [open, returnFocusRef]);

    if (!rendered) {
        return null;
    }

    const expanded = size === 'expanded';
    const placed = frame.frame !== null;
    /** True only when the panel is sitting at the expanded preset, undragged. */
    const atExpandedPreset = expanded && !placed;

    /**
     * Returns the panel to a preset size **and** to its docked corner.
     *
     * Expand and Shrink double as the way out of a bad drag: a window dragged
     * mostly off the bottom of a short screen is awkward to retrieve with the
     * same gesture that put it there, and this is the control already in the
     * header. Nothing else clears the placement, so it survives close/reopen
     * and reload — which is the point of being able to move it at all.
     */
    const preset = (next: PanelSize) => {
        frame.reset();
        setSize(next);
    };

    return (
        <div
            role="dialog"
            // Deliberately no `aria-modal`: it defaults to false, which is
            // exactly right here. Setting it true would tell a screen reader
            // the rest of the page is inert when it isn't.
            //
            // Named by its own `<h2>`, which already carries the thread title.
            // A constant "Ortha AI" made all three windows one indistinguishable
            // name in a screen reader's dialog list, while the *visible* name
            // told them apart — the ambiguity this package already fixed for
            // dock pills ("Untitled chat", never "New chat").
            aria-labelledby={headingId}
            onKeyDown={onKeyDown}
            ref={frame.ref}
            // Only once the user has placed it. Until then the classes below
            // own the geometry, so the panel opens correctly on a viewport it
            // has never been opened in — and `left`/`top` from a previous,
            // larger monitor can never strand it off-screen.
            // Placed: the exact frame the user dragged. Unplaced: parked above
            // the dock, offset by slot so a second chat lands beside the first
            // rather than exactly on top of it. Expanded ignores the slot — a
            // full-height window has nowhere to go but the right-hand side.
            style={
                placed
                    ? frame.style
                    : {
                          bottom: DOCK_CLEARANCE,
                          right: expanded
                              ? '1rem'
                              : `calc(1rem + ${slot} * ${SLOT_PITCH})`
                      }
            }
            className={cn(
                // `text-foreground` is stated rather than inherited: the panel
                // paints its own surface, so it must own the colour that goes
                // on it. Inheriting is what produced near-white text on white
                // when this rendered inside the dark sidebar's subtree.
                'bg-background text-foreground fixed z-50 flex flex-col',
                'rounded-lg border shadow-lg',
                // Never taller or wider than the viewport allows, so the panel
                // stays usable on a laptop screen and on a short window. A
                // placed panel is clamped to the viewport in the frame itself,
                // and these would fight that clamp rather than back it up.
                !placed && 'max-h-[calc(100vh-5rem)] max-w-[calc(100vw-2rem)]',
                !placed && !expanded && 'h-[620px] w-[420px]',
                !placed &&
                    expanded &&
                    'h-[calc(100vh-5rem)] w-[min(820px,calc(100vw-2rem))]',
                // Text selection is suppressed for the whole panel while a
                // gesture runs, rather than the drag calling `preventDefault()`
                // — which would also swallow the focus a mousedown gives the
                // resize handle, and that focus is what makes it keyboard
                // operable.
                frame.interacting && 'select-none',
                // A **transition**, not an `animate-in` utility: those come from
                // tailwindcss-animate, which this workspace deliberately does
                // not install — the classes shadcn ships generate no CSS here
                // (see the note atop the design system's styles.css). A
                // transition is also the safer primitive: with motion disabled
                // the element simply lands on its visible state, where a
                // keyframe animation could leave it stuck invisible.
                // `translate` and `scale`, NOT `transform`: Tailwind v4 emits
                // those as standalone CSS properties rather than folding them
                // into the `transform` shorthand, so transitioning `transform`
                // fades the opacity while the movement snaps.
                'origin-bottom-right transition-[opacity,translate,scale] duration-200 ease-out',
                'motion-reduce:transition-none',
                visible
                    ? 'translate-y-0 scale-100 opacity-100'
                    : 'translate-y-2 scale-95 opacity-0'
            )}
        >
            <PanelResizeHandles controls={frame} />

            {/* A `div`, not a `header`. The panel is portalled to `<body>`, so a
                `<header>` here is not "this window's title bar" to assistive
                tech — with no sectioning ancestor it maps to the **banner**
                landmark, the one reserved for the site header. Open two chats
                and the document has two banners; open three and a screen-reader
                user cycling landmarks lands in a chat window each time. The
                window is already named by `aria-labelledby` on its container,
                which is what actually carries the title. Caught by
                `landmark-no-duplicate-banner` once admin-e2e's axe fixture
                stopped omitting the whole `best-practice` ruleset. */}
            <div
                className="flex shrink-0 cursor-move touch-none items-center gap-1 border-b px-3 py-2 select-none"
                onPointerDown={(event) => {
                    // The header's own controls are buttons, not a grab
                    // surface — starting a drag from Close would mean the panel
                    // walks across the screen on the way to being dismissed.
                    if ((event.target as HTMLElement).closest('button')) return;
                    frame.startMove(event);
                }}
                {...frame.handleProps}
            >
                <MoveHandle controls={frame} />

                <h2
                    id={headingId}
                    className="flex-1 truncate text-sm font-semibold"
                >
                    {title ?? intl.formatMessage(messages.title)}
                </h2>

                {/* Only with a thread to open — see `onOpenInAgents`. */}
                {onOpenInAgents && chat.conversationId ? (
                    <IconButton
                        icon={SquareArrowOutUpRight}
                        label={intl.formatMessage(messages.openInAgents)}
                        onClick={() =>
                            onOpenInAgents(chat.conversationId as string)
                        }
                    />
                ) : null}
                <IconButton
                    icon={MessageSquarePlus}
                    label={intl.formatMessage(messages.newChat)}
                    onClick={onNewChat}
                />
                <IconButton
                    icon={Minus}
                    label={intl.formatMessage(messages.minimize)}
                    onClick={onMinimize}
                />
                {/* Reads its label off the *preset*, not off `size` alone: a
                    panel the user has dragged is at no preset, so the button
                    offers Expand — "Shrink" on a window that is currently 400px
                    wide because someone resized it would be nonsense. */}
                <IconButton
                    icon={atExpandedPreset ? Minimize2 : Maximize2}
                    label={intl.formatMessage(
                        atExpandedPreset ? messages.collapse : messages.expand
                    )}
                    onClick={() =>
                        preset(atExpandedPreset ? 'docked' : 'expanded')
                    }
                />
                <IconButton
                    icon={X}
                    label={intl.formatMessage(messages.close)}
                    onClick={onClose}
                />
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
                <PanelBody
                    chat={chat}
                    workspaceId={workspaceId}
                    routeContext={routeContext}
                    choice={choice}
                    onChoiceChange={onChoiceChange}
                    context={context}
                    onContextChange={onContextChange}
                    skills={skills}
                    onSkillsChange={onSkillsChange}
                    {...(onAdoptConversation ? { onAdoptConversation } : {})}
                />
            </div>
        </div>
    );
}

/**
 * The grip at the left of the header.
 *
 * The whole header is already draggable, so this is not the pointer
 * affordance — it is the **keyboard** one, and the reason it is a `<button>`
 * rather than a decorative icon. A window a mouse user can move and a keyboard
 * user cannot is a window whose position is a mouse-only setting; arrow keys
 * move it, `Shift` moves it faster, and the header's Expand button puts it
 * back.
 *
 * It doubles as the visual cue that the header is grabbable, which the cursor
 * alone only tells you after you have already hovered it.
 */
function MoveHandle({ controls }: { controls: PanelFrameControls }) {
    const intl = useIntl();
    return (
        <button
            type="button"
            aria-label={intl.formatMessage(messages.move)}
            title={intl.formatMessage(messages.moveHint)}
            className="text-muted-foreground focus-visible:ring-ring -ml-1 shrink-0 cursor-move touch-none rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none"
            onPointerDown={(event) => controls.startMove(event)}
            onKeyDown={(event) => {
                const arrow = ARROWS[event.key];
                if (!arrow) return;
                // Or the page behind this non-modal panel scrolls under the
                // window being moved across it.
                event.preventDefault();
                const step = keyboardStep(event);
                controls.nudgeMove(arrow[0] * step, arrow[1] * step);
            }}
            {...controls.handleProps}
        >
            <GripVertical className="size-4" />
        </button>
    );
}

/** A small square header control. */
function IconButton({
    icon: Icon,
    label,
    onClick
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    onClick(): void;
}) {
    return (
        <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-7 shrink-0"
            onClick={onClick}
            aria-label={label}
            title={label}
        >
            <Icon className="size-4" />
        </Button>
    );
}

function PanelBody({
    chat,
    workspaceId,
    routeContext,
    choice,
    onChoiceChange,
    context: attached,
    onContextChange: setAttached,
    skills: stagedSkills,
    onSkillsChange,
    onAdoptConversation
}: {
    chat: CopilotChat;
    workspaceId: string;
    routeContext: RouteContext;
    choice: CopilotModelChoice | null;
    onChoiceChange(choice: CopilotModelChoice | null): void;
    context: RouteContext | null;
    onContextChange(context: RouteContext | null): void;
    skills: readonly string[];
    onSkillsChange(names: readonly string[]): void;
    onAdoptConversation?(conversationId: string, title: string | null): boolean;
}) {
    const composerRef = useRef<HTMLTextAreaElement>(null);
    // Opt-in, and a snapshot rather than a live mirror of the URL: an attached
    // context should not silently change under the user as they navigate. From
    // the **session**, not this component's state — see `CopilotPanelProps`.
    // Files staged for the next turn. Lives in the body, which unmounts when
    // the window collapses to the dock — deliberately: a half-written turn's
    // attachments are part of that draft, and the draft text goes with it too.
    const files = useComposerAttachments();
    // Attaching a file is an ordinary `POST /api/media/assets` on the user's
    // own session, so the permission that matters is `media:create` — which
    // `viewer` does not hold. Without the gate the paperclip is offered to
    // someone whose every upload 403s, against the composer's own rule that a
    // surface with no library "renders no attach control at all … rather than
    // offering a button that fails".
    const canAttach = useHasPermission(MEDIA_CREATE);

    // What the picker shows and what the turn is sent with, and they are the
    // same value on purpose: an unpicked chat runs on the catalogue's first
    // entry, so the picker names the backend that is about to answer instead of
    // the "Default" that named nothing.
    const model = useEffectiveModelChoice(choice);

    // Skills, unlike files, come from the session — collapsing the window must
    // not silently change what the next turn runs under.
    const skills = useComposerSkills(workspaceId, stagedSkills, onSkillsChange);

    // The panel is opened to type into, so put the cursor where it is needed.
    useEffect(() => {
        composerRef.current?.focus();
    }, []);

    return (
        <>
            {/* Threads only. The model picker used to sit here too, which
                stated it as a property of the conversation — it is not, it
                applies to the turn being written, so it now rides in the
                composer where the Agents view already keeps it. */}
            <div className="flex shrink-0 items-center justify-end gap-1 border-b px-3 py-1.5">
                <ConversationPicker
                    workspaceId={workspaceId}
                    onOpen={(conversationId, threadTitle, loaded) => {
                        // Refused when another window already holds this
                        // thread; that one is focused instead of a second copy
                        // appearing here.
                        if (
                            onAdoptConversation?.(
                                conversationId,
                                threadTitle
                            ) === false
                        ) {
                            return;
                        }
                        chat.load(conversationId, loaded);
                    }}
                />
            </div>

            <MessageList
                messages={chat.messages}
                onAnswer={chat.answer}
                onExtend={chat.extendAnswer}
            />

            {/* "Your message, plus where you are" (design §2) — but only when
                the user asked for it. See ContextChip for why this is opt-in. */}
            <ContextChip
                current={routeContext}
                attached={attached}
                onAttach={() => setAttached(routeContext)}
                onDetach={() => setAttached(null)}
            />

            <Composer
                busy={chat.busy}
                inputRef={composerRef}
                onSend={(text) => {
                    chat.sendWith({
                        text,
                        context: {
                            // Nothing attached means a plain chat turn — the
                            // model is told where the user is only when they
                            // said so.
                            surface: attached?.surface ?? 'chat',
                            ...(attached?.contentType
                                ? { contentType: attached.contentType }
                                : {}),
                            ...(attached?.entryId
                                ? { entryId: attached.entryId }
                                : {}),
                            ...(attached?.locale
                                ? { locale: attached.locale }
                                : {})
                        },
                        options: {
                            provider: model?.provider ?? null,
                            model: model?.model ?? null
                        },
                        attachments: files.sent,
                        skills: skills.inForce,
                        chosenSkills: skills.chosen
                    });
                    // Cleared on send, not on the run finishing: the files
                    // belong to the turn just sent. Skills are not cleared —
                    // they are the mode the chat is working in, and the chips
                    // keep saying so.
                    files.clear();
                }}
                onStop={chat.stop}
                // In the box, bottom-left — the same place the Agents view puts
                // it, so the two surfaces read as one product.
                controls={
                    <ModelPicker value={model} onChange={onChoiceChange} />
                }
                {...(canAttach ? { attachments: files } : {})}
                skills={skills}
            />
        </>
    );
}
