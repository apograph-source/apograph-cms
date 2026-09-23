import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { PanelLeftIcon } from 'lucide-react';
import { Slot } from '@radix-ui/react-slot';

import { useIsMobile } from '../../hooks/use-mobile';
import { cn } from '../../utils';
import { Button } from './button';
import { Input } from './input';
import { Separator } from './separator';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle
} from './sheet';
import { Skeleton } from './skeleton';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from './tooltip';

const SIDEBAR_COOKIE_NAME = 'sidebar_state';
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = '16rem';
const SIDEBAR_WIDTH_MOBILE = '18rem';
const SIDEBAR_WIDTH_ICON = '3rem';
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

/** Reads the persisted open state, tolerating an unreadable or absent cookie. */
function readStoredOpen(): boolean | undefined {
    if (typeof document === 'undefined') {
        return undefined;
    }
    try {
        const match = document.cookie.match(
            new RegExp(`(?:^|; )${SIDEBAR_COOKIE_NAME}=([^;]*)`)
        );
        if (!match) {
            return undefined;
        }
        return match[1] === 'true'
            ? true
            : match[1] === 'false'
              ? false
              : undefined;
    } catch {
        // A sandboxed iframe without `allow-same-origin` throws on access.
        return undefined;
    }
}

/** Persists the open state. Best-effort — an unwritable jar is not fatal. */
function writeStoredOpen(open: boolean): void {
    if (typeof document === 'undefined') {
        return;
    }
    try {
        document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax`;
    } catch {
        // Losing the preference is survivable; losing the toggle is not.
    }
}

/**
 * True for a target that owns `Ctrl/⌘+B` itself — a text field, or anything
 * inside a rich-text editor, where the chord means **bold**. The shortcut used
 * to `preventDefault()` on every keystroke that reached the window, so typing
 * `Ctrl+B` in a body field collapsed the sidebar *and* left the text unbolded.
 */
function ownsBoldShortcut(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    // `isContentEditable` covers a caret anywhere inside an editor in a real
    // browser; the attribute check is what makes it observable in jsdom.
    if (
        target.isContentEditable ||
        target.closest('[contenteditable=""], [contenteditable="true"]')
    ) {
        return true;
    }
    const tag = target.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') {
        return true;
    }
    if (tag === 'INPUT') {
        // Only the textual inputs; a checkbox has no use for bold.
        const type = (target as HTMLInputElement).type;
        return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(
            type
        );
    }
    return false;
}

type SidebarContextProps = {
    state: 'expanded' | 'collapsed';
    open: boolean;
    setOpen: (open: boolean) => void;
    openMobile: boolean;
    setOpenMobile: (open: boolean) => void;
    isMobile: boolean;
    toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

/** Reads the surrounding {@link SidebarProvider} state; throws outside one. */
function useSidebar() {
    const context = React.useContext(SidebarContext);
    if (!context) {
        throw new Error('useSidebar must be used within a SidebarProvider.');
    }

    return context;
}

/**
 * Like {@link useSidebar}, but returns `null` outside a `SidebarProvider` —
 * for components that adapt to the sidebar when present without requiring it
 * (e.g. `TopBar`'s inline reveal trigger).
 */
function useOptionalSidebar() {
    return React.useContext(SidebarContext);
}

/**
 * Provides sidebar open/collapsed state (persisted to a cookie) and the
 * mobile-sheet toggle. Wrap the app chrome in this once; `Sidebar` and
 * `SidebarInset` read it via {@link useSidebar}.
 */
function SidebarProvider({
    defaultOpen: defaultOpenProp,
    open: openProp,
    onOpenChange: setOpenProp,
    className,
    style,
    children,
    ...props
}: React.ComponentProps<'div'> & {
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const isMobile = useIsMobile();
    const [openMobile, setOpenMobile] = React.useState(false);

    // This is the internal state of the sidebar.
    // We use openProp and setOpenProp for control from outside the component.
    // The cookie is the *fallback*, not an override: a caller that states a
    // `defaultOpen` means it. Written on every toggle since the component was
    // written, and — until this was fixed — read by nobody, so collapsing the
    // sidebar never survived a reload.
    const [_open, _setOpen] = React.useState(
        () => defaultOpenProp ?? readStoredOpen() ?? true
    );
    const open = openProp ?? _open;
    const setOpen = React.useCallback(
        (value: boolean | ((value: boolean) => boolean)) => {
            const openState = typeof value === 'function' ? value(open) : value;
            if (setOpenProp) {
                setOpenProp(openState);
            } else {
                _setOpen(openState);
            }

            writeStoredOpen(openState);
        },
        [setOpenProp, open]
    );

    // Helper to toggle the sidebar.
    const toggleSidebar = React.useCallback(() => {
        return isMobile
            ? setOpenMobile((open) => !open)
            : setOpen((open) => !open);
    }, [isMobile, setOpen, setOpenMobile]);

    // Adds a keyboard shortcut to toggle the sidebar.
    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
                (event.metaKey || event.ctrlKey) &&
                // A text field and the rich-text editor own this chord — it is
                // *bold* there. Yield rather than swallow it.
                !ownsBoldShortcut(event.target)
            ) {
                event.preventDefault();
                toggleSidebar();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [toggleSidebar]);

    // We add a state so that we can do data-state="expanded" or "collapsed".
    // This makes it easier to style the sidebar with Tailwind classes.
    const state = open ? 'expanded' : 'collapsed';

    // Collapsing hides the region the collapse control itself lives in, so
    // activating it from the keyboard used to leave the user on `<body>` with
    // nothing focused, no announcement, and no way back but Tab-from-the-top
    // (WCAG 2.4.3 / 3.2.2). Hand focus to the trigger that replaced it — the
    // one the `TopBar` reveals inline, or the shell's floating toggle.
    const previousState = React.useRef(state);
    React.useEffect(() => {
        const wasExpanded = previousState.current === 'expanded';
        previousState.current = state;
        if (!wasExpanded || state !== 'collapsed') {
            return;
        }

        const active = document.activeElement as HTMLElement | null;
        const stranded =
            !active ||
            active === document.body ||
            !!active.closest?.('[inert]');
        if (!stranded) {
            return;
        }

        const reveal = Array.from(
            document.querySelectorAll<HTMLElement>('[data-sidebar="trigger"]')
        ).find(
            (trigger) =>
                !trigger.closest('[inert]') &&
                trigger.getAttribute('tabindex') !== '-1'
        );
        reveal?.focus();
    }, [state]);

    const contextValue = React.useMemo<SidebarContextProps>(
        () => ({
            state,
            open,
            setOpen,
            isMobile,
            openMobile,
            setOpenMobile,
            toggleSidebar
        }),
        [
            state,
            open,
            setOpen,
            isMobile,
            openMobile,
            setOpenMobile,
            toggleSidebar
        ]
    );

    return (
        <SidebarContext.Provider value={contextValue}>
            <TooltipProvider delayDuration={0}>
                <div
                    data-slot="sidebar-wrapper"
                    style={
                        {
                            '--sidebar-width': SIDEBAR_WIDTH,
                            '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
                            ...style
                        } as React.CSSProperties
                    }
                    className={cn(
                        // Bounded to the viewport, not `min-h-svh`: the document
                        // itself never scrolls, so the page chrome (the sidebar,
                        // the top bar, the right panel) stays put and only the
                        // inset's content moves. `SidebarInset` is the scrollport.
                        'group/sidebar-wrapper flex h-svh w-full overflow-hidden has-data-[variant=inset]:bg-sidebar',
                        className
                    )}
                    {...props}
                >
                    {children}
                </div>
            </TooltipProvider>
        </SidebarContext.Provider>
    );
}

/** The sidebar surface: a fixed left panel on desktop, a Sheet on mobile. */
function Sidebar({
    side = 'left',
    variant = 'sidebar',
    collapsible = 'offcanvas',
    className,
    children,
    mobileTitle = 'Sidebar',
    mobileDescription = 'Displays the mobile sidebar.',
    label,
    ...props
}: React.ComponentProps<'div'> & {
    side?: 'left' | 'right';
    variant?: 'sidebar' | 'floating' | 'inset';
    collapsible?: 'offcanvas' | 'icon' | 'none';
    /**
     * Accessible name for the mobile overlay, which is a dialog. Defaults to
     * the English `'Sidebar'`; pass a localized string.
     */
    mobileTitle?: string;
    /** Accessible description for the mobile overlay. */
    mobileDescription?: string;
    /**
     * Accessible name for the sidebar panel, which makes it a `complementary`
     * landmark. Omitted by default, so nothing changes for a consumer that has
     * not thought about it.
     *
     * Without it the panel is a plain `div`, and everything in it that is not
     * inside the consumer's own `<nav>` — a brand label, a slot-contributed
     * group, a view switcher — sits outside every landmark, which is content a
     * screen-reader user cannot reach by landmark and must tab through
     * (`ORT-170`). `complementary` rather than `navigation`: consumers put a
     * real `<nav>` inside this for the links, and a second navigation landmark
     * wrapping it would say the whole panel is nothing but links.
     *
     * On mobile the panel is a Radix dialog, which is already a container in its
     * own right — {@link mobileTitle} names that.
     */
    label?: string;
}) {
    const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

    // When collapsed in offcanvas mode the panel is only translated off the
    // left edge — it stays rendered. Mark it `inert` so its controls (search,
    // nav links, footer) leave the tab order and accessibility tree while
    // hidden, and rejoin them when expanded. `icon` collapse keeps the panel
    // visible, so it must stay interactive.
    const isOffcanvasCollapsed =
        collapsible === 'offcanvas' && state === 'collapsed';

    if (collapsible === 'none') {
        return (
            <div
                data-slot="sidebar"
                className={cn(
                    'flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground',
                    className
                )}
                {...props}
            >
                {children}
            </div>
        );
    }

    if (isMobile) {
        return (
            <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
                <SheetContent
                    data-sidebar="sidebar"
                    data-slot="sidebar"
                    data-mobile="true"
                    className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
                    style={
                        {
                            '--sidebar-width': SIDEBAR_WIDTH_MOBILE
                        } as React.CSSProperties
                    }
                    side={side}
                >
                    <SheetHeader className="sr-only">
                        <SheetTitle>{mobileTitle}</SheetTitle>
                        <SheetDescription>{mobileDescription}</SheetDescription>
                    </SheetHeader>
                    <div className="flex h-full w-full flex-col">
                        {children}
                    </div>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <div
            className="group peer hidden text-sidebar-foreground md:block"
            data-state={state}
            data-collapsible={state === 'collapsed' ? collapsible : ''}
            data-variant={variant}
            data-side={side}
            data-slot="sidebar"
        >
            {/* This is what handles the sidebar gap on desktop */}
            <div
                data-slot="sidebar-gap"
                className={cn(
                    'relative w-(--sidebar-width) bg-transparent transition-[width] duration-300 ease-in-out',
                    'group-data-[collapsible=offcanvas]:w-0',
                    'group-data-[side=right]:rotate-180',
                    variant === 'floating' || variant === 'inset'
                        ? 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]'
                        : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon)'
                )}
            />
            <div
                data-slot="sidebar-container"
                className={cn(
                    'fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-300 ease-in-out md:flex',
                    side === 'left'
                        ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'
                        : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
                    // Adjust the padding for floating and inset variants.
                    variant === 'floating' || variant === 'inset'
                        ? 'p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]'
                        : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l',
                    className
                )}
                inert={isOffcanvasCollapsed}
                aria-hidden={isOffcanvasCollapsed || undefined}
                {...props}
            >
                <div
                    data-sidebar="sidebar"
                    data-slot="sidebar-inner"
                    // Conditional on a name: a `complementary` with no
                    // accessible name is a landmark a screen-reader user cannot
                    // tell from any other, which is worse than the generic it
                    // replaced.
                    role={label ? 'complementary' : undefined}
                    aria-label={label}
                    className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm"
                >
                    {children}
                </div>
            </div>
        </div>
    );
}

/** The button that toggles the sidebar open/collapsed. */
function SidebarTrigger({
    className,
    onClick,
    label = 'Toggle Sidebar',
    ...props
}: React.ComponentProps<typeof Button> & {
    /**
     * Accessible name. Defaults to the English `'Toggle Sidebar'`; pass a
     * localized string. The button is icon-only, so this *is* its whole name.
     */
    label?: string;
}) {
    const { toggleSidebar } = useSidebar();

    return (
        <Button
            data-sidebar="trigger"
            data-slot="sidebar-trigger"
            variant="ghost"
            size="icon"
            className={cn('size-7', className)}
            onClick={(event) => {
                onClick?.(event);
                toggleSidebar();
            }}
            {...props}
        >
            <PanelLeftIcon />
            <span className="sr-only">{label}</span>
        </Button>
    );
}

/** A thin drag-rail on the sidebar edge that also toggles it. */
function SidebarRail({
    className,
    label = 'Toggle Sidebar',
    ...props
}: React.ComponentProps<'button'> & {
    /** Accessible name; defaults to the English `'Toggle Sidebar'`. */
    label?: string;
}) {
    const { toggleSidebar } = useSidebar();

    return (
        <button
            data-sidebar="rail"
            data-slot="sidebar-rail"
            aria-label={label}
            tabIndex={-1}
            onClick={toggleSidebar}
            title={label}
            className={cn(
                'absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex',
                'in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize',
                '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
                'group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar',
                '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
                '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
                className
            )}
            {...props}
        />
    );
}

/**
 * Where a page's {@link TopBar} is hoisted to — the fixed strip above the
 * inset's scrollport. `undefined` means there is no {@link SidebarInset} above
 * (a public page), so the bar renders in place; `null` means the host hasn't
 * mounted yet, one commit away.
 */
const InsetTopBarContext = React.createContext<HTMLElement | null | undefined>(
    undefined
);

/** The inset's top-bar host. See {@link InsetTopBarContext}. */
function useInsetTopBarHost() {
    return React.useContext(InsetTopBarContext);
}

/**
 * The main content region beside the sidebar, split into a **fixed bar strip**
 * and a **scrollport** below it. The page's `TopBar` hoists itself into the
 * strip (by portal, so it keeps the page's React context), which is what makes
 * the scrollbar start *under* the bar instead of running the full height beside
 * it — the bar is chrome and shouldn't sit in a scrolling region at all.
 *
 * The wrapper is viewport-bounded, so the scrollport has a definite height and
 * both page shapes work: an ordinary page (a `Container` of content) simply
 * scrolls in it, while a page that wants an island (the Content Library, the
 * Media Library) resolves `flex-1 min-h-0` against that height and runs its own
 * inner scroll.
 */
function SidebarInset({
    className,
    children,
    scrollLabel,
    ...props
}: React.ComponentProps<'main'> & {
    /**
     * Accessible name for the scrollport tab stop. Omitted by default, so
     * nothing changes for a consumer that has not thought about it.
     *
     * The scrollport is focusable on purpose (see below) and had no name and no
     * role, so a screen-reader user reaching that stop was told nothing about
     * what they had landed on or that arrow keys would now scroll (`ORT-150`).
     * Naming it costs a role, and `region` would make it a **landmark** — a
     * second one beside the `<main>` it sits inside, which is exactly the noise
     * this component declines elsewhere. `group` names it without joining the
     * landmark list. The design system carries no `react-intl`, so the string
     * comes from the caller.
     */
    scrollLabel?: string;
}) {
    const [barHost, setBarHost] = React.useState<HTMLElement | null>(null);

    return (
        <main
            data-slot="sidebar-inset"
            className={cn(
                'relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-background',
                'md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2',
                className
            )}
            {...props}
        >
            <div data-slot="sidebar-inset-bar" ref={setBarHost} />
            <InsetTopBarContext.Provider value={barHost}>
                {/* `tabIndex={0}` because this is the app's scroll container:
                    a region that scrolls must be reachable by keyboard (WCAG
                    2.1.1), and a mouse user's wheel is not a substitute. It
                    matters most exactly when the page has nothing else to focus
                    — every page is a wall of skeletons while it loads, and
                    without this a keyboard user cannot scroll it at all. Not a
                    landmark role: `<main>` above already is one, and a second
                    would just add noise to the landmark list.

                    A tab stop has to be *visible* when it is reached (WCAG
                    2.4.7), and for a long time this one was not: it carried
                    `focus-visible:outline-none` with no replacement, so on every
                    private route in the admin there was one press of Tab — stop
                    18 of 32 on the Workspaces page, measured — where nothing
                    appeared to happen, and arrow keys then scrolled instead of
                    moving. Sighted keyboard users read that as the app having
                    lost focus and press Tab again, skipping the scrollport they
                    were being handed. The ring is `inset` because the parent
                    `<main>` clips overflow, so an outset one is drawn outside its
                    own box and never seen. */}
                <div
                    data-slot="sidebar-inset-scroll"
                    tabIndex={0}
                    // `group`, not `region`: naming it must not add a second
                    // landmark (see `scrollLabel`). Both are conditional on a
                    // name existing — a bare `aria-label` with no role names an
                    // element assistive tech has no role to announce it with,
                    // and a `group` with no name is worse than the generic it
                    // replaced.
                    role={scrollLabel ? 'group' : undefined}
                    aria-label={scrollLabel}
                    // The bottom gutter is reserved by whatever fixed chrome
                    // the app floats over this scrollport — the copilot dock
                    // sets it while it is mounted. Unset it is `0px`, which is
                    // the layout an app without such chrome has: a scrollport
                    // whose last row cannot be scrolled clear of a bar covering
                    // it is a control a pointer cannot reach.
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[var(--orthacms-fixed-bottom-gutter,0px)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                >
                    {children}
                </div>
            </InsetTopBarContext.Provider>
        </main>
    );
}

/** A search-style input styled to sit inside the sidebar. */
function SidebarInput({
    className,
    ...props
}: React.ComponentProps<typeof Input>) {
    return (
        <Input
            data-slot="sidebar-input"
            data-sidebar="input"
            className={cn('h-8 w-full bg-background shadow-none', className)}
            {...props}
        />
    );
}

/** The sidebar's top region (brand, switcher). */
function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="sidebar-header"
            data-sidebar="header"
            className={cn('flex flex-col gap-2 p-2', className)}
            {...props}
        />
    );
}

/** The sidebar's bottom region (account, actions). */
function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="sidebar-footer"
            data-sidebar="footer"
            className={cn('flex flex-col gap-2 p-2', className)}
            {...props}
        />
    );
}

/** A divider styled for the sidebar. */
function SidebarSeparator({
    className,
    ...props
}: React.ComponentProps<typeof Separator>) {
    return (
        <Separator
            data-slot="sidebar-separator"
            data-sidebar="separator"
            className={cn('mx-2 w-auto bg-sidebar-border', className)}
            {...props}
        />
    );
}

/** The scrollable middle region between header and footer. */
function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="sidebar-content"
            data-sidebar="content"
            className={cn(
                'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
                className
            )}
            {...props}
        />
    );
}

/** A titled section within the sidebar content. */
function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="sidebar-group"
            data-sidebar="group"
            className={cn(
                'relative flex w-full min-w-0 flex-col p-2',
                className
            )}
            {...props}
        />
    );
}

/** The heading of a {@link SidebarGroup}. */
function SidebarGroupLabel({
    className,
    asChild = false,
    ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }) {
    const Comp = asChild ? Slot : 'div';

    return (
        <Comp
            data-slot="sidebar-group-label"
            data-sidebar="group-label"
            className={cn(
                'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
                'group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
                className
            )}
            {...props}
        />
    );
}

/** A trailing action button on a {@link SidebarGroup} header. */
function SidebarGroupAction({
    className,
    asChild = false,
    ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
    const Comp = asChild ? Slot : 'button';

    return (
        <Comp
            data-slot="sidebar-group-action"
            data-sidebar="group-action"
            className={cn(
                'absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
                // Increases the hit area of the button on mobile.
                'after:absolute after:-inset-2 md:after:hidden',
                'group-data-[collapsible=icon]:hidden',
                className
            )}
            {...props}
        />
    );
}

/** The body of a {@link SidebarGroup}. */
function SidebarGroupContent({
    className,
    ...props
}: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="sidebar-group-content"
            data-sidebar="group-content"
            className={cn('w-full text-sm', className)}
            {...props}
        />
    );
}

/** A vertical list of {@link SidebarMenuItem}s. */
function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
    return (
        <ul
            data-slot="sidebar-menu"
            data-sidebar="menu"
            className={cn('flex w-full min-w-0 flex-col gap-1', className)}
            {...props}
        />
    );
}

/** One row in a {@link SidebarMenu}. */
function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
    return (
        <li
            data-slot="sidebar-menu-item"
            data-sidebar="menu-item"
            className={cn('group/menu-item relative', className)}
            {...props}
        />
    );
}

const sidebarMenuButtonVariants = cva(
    'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
    {
        variants: {
            variant: {
                default:
                    'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                outline:
                    'bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]'
            },
            size: {
                default: 'h-8 text-sm',
                sm: 'h-7 text-xs',
                lg: 'h-12 text-sm group-data-[collapsible=icon]:p-0!'
            }
        },
        defaultVariants: {
            variant: 'default',
            size: 'default'
        }
    }
);

/** A clickable sidebar nav row. Pass `asChild` to render a router link. */
function SidebarMenuButton({
    asChild = false,
    isActive = false,
    variant = 'default',
    size = 'default',
    tooltip,
    className,
    ...props
}: React.ComponentProps<'button'> & {
    asChild?: boolean;
    isActive?: boolean;
    tooltip?: string | React.ComponentProps<typeof TooltipContent>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
    const Comp = asChild ? Slot : 'button';
    const { isMobile, state } = useSidebar();

    const button = (
        <Comp
            data-slot="sidebar-menu-button"
            data-sidebar="menu-button"
            data-size={size}
            data-active={isActive}
            className={cn(
                sidebarMenuButtonVariants({ variant, size }),
                className
            )}
            {...props}
        />
    );

    // The tooltip exists to name a row that has shrunk to an icon, so it is
    // only built when the row *is* an icon. It used to be mounted always and
    // suppressed with Radix's `hidden`, which hides the panel visually but
    // leaves the trigger carrying `aria-describedby` — and a referenced hidden
    // node still contributes to the accessible description. Every expanded
    // sidebar row therefore announced as "Members, button, Members": a
    // description echoing the name, which a screen-reader user cannot skip.
    if (!tooltip || state !== 'collapsed' || isMobile) {
        return button;
    }

    if (typeof tooltip === 'string') {
        tooltip = {
            children: tooltip
        };
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="right" align="center" {...tooltip} />
        </Tooltip>
    );
}

/** A trailing action button on a {@link SidebarMenuItem}. */
function SidebarMenuAction({
    className,
    asChild = false,
    showOnHover = false,
    ...props
}: React.ComponentProps<'button'> & {
    asChild?: boolean;
    showOnHover?: boolean;
}) {
    const Comp = asChild ? Slot : 'button';

    return (
        <Comp
            data-slot="sidebar-menu-action"
            data-sidebar="menu-action"
            className={cn(
                'absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform peer-hover/menu-button:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
                // Increases the hit area of the button on mobile.
                'after:absolute after:-inset-2 md:after:hidden',
                'peer-data-[size=sm]/menu-button:top-1',
                'peer-data-[size=default]/menu-button:top-1.5',
                'peer-data-[size=lg]/menu-button:top-2.5',
                'group-data-[collapsible=icon]:hidden',
                showOnHover &&
                    'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground data-[state=open]:opacity-100 md:opacity-0',
                className
            )}
            {...props}
        />
    );
}

/** A count/badge pinned to the end of a {@link SidebarMenuItem}. */
function SidebarMenuBadge({
    className,
    ...props
}: React.ComponentProps<'div'>) {
    return (
        <div
            data-slot="sidebar-menu-badge"
            data-sidebar="menu-badge"
            className={cn(
                'pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none',
                'peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground',
                'peer-data-[size=sm]/menu-button:top-1',
                'peer-data-[size=default]/menu-button:top-1.5',
                'peer-data-[size=lg]/menu-button:top-2.5',
                'group-data-[collapsible=icon]:hidden',
                className
            )}
            {...props}
        />
    );
}

/** A loading placeholder shaped like a menu row. */
function SidebarMenuSkeleton({
    className,
    showIcon = false,
    ...props
}: React.ComponentProps<'div'> & {
    showIcon?: boolean;
}) {
    // Random width between 50 to 90%.
    const width = React.useMemo(() => {
        return `${Math.floor(Math.random() * 40) + 50}%`;
    }, []);

    return (
        <div
            data-slot="sidebar-menu-skeleton"
            data-sidebar="menu-skeleton"
            className={cn(
                'flex h-8 items-center gap-2 rounded-md px-2',
                className
            )}
            {...props}
        >
            {showIcon && (
                <Skeleton
                    className="size-4 rounded-md"
                    data-sidebar="menu-skeleton-icon"
                />
            )}
            <Skeleton
                className="h-4 max-w-(--skeleton-width) flex-1"
                data-sidebar="menu-skeleton-text"
                style={
                    {
                        '--skeleton-width': width
                    } as React.CSSProperties
                }
            />
        </div>
    );
}

/** A nested list under a {@link SidebarMenuItem}. */
function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>) {
    return (
        <ul
            data-slot="sidebar-menu-sub"
            data-sidebar="menu-sub"
            className={cn(
                'mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5',
                'group-data-[collapsible=icon]:hidden',
                className
            )}
            {...props}
        />
    );
}

/** One row in a {@link SidebarMenuSub}. */
function SidebarMenuSubItem({
    className,
    ...props
}: React.ComponentProps<'li'>) {
    return (
        <li
            data-slot="sidebar-menu-sub-item"
            data-sidebar="menu-sub-item"
            className={cn('group/menu-sub-item relative', className)}
            {...props}
        />
    );
}

/** A clickable row in a {@link SidebarMenuSub}. Pass `asChild` for a link. */
function SidebarMenuSubButton({
    asChild = false,
    size = 'md',
    isActive = false,
    className,
    ...props
}: React.ComponentProps<'a'> & {
    asChild?: boolean;
    size?: 'sm' | 'md';
    isActive?: boolean;
}) {
    const Comp = asChild ? Slot : 'a';

    return (
        <Comp
            data-slot="sidebar-menu-sub-button"
            data-sidebar="menu-sub-button"
            data-size={size}
            data-active={isActive}
            className={cn(
                'flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground',
                'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground',
                size === 'sm' && 'text-xs',
                size === 'md' && 'text-sm',
                'group-data-[collapsible=icon]:hidden',
                className
            )}
            {...props}
        />
    );
}

export {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupAction,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInput,
    SidebarInset,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSkeleton,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarProvider,
    SidebarRail,
    SidebarSeparator,
    SidebarTrigger,
    useSidebar,
    useOptionalSidebar,
    useInsetTopBarHost
};
