import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { Search } from 'lucide-react';
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandList,
    Kbd
} from '@orthacms/design-system';
import { byOrder, isComposingText } from '@orthacms/utils-admin';
import { SIDEBAR_NAV_SLOT } from '../../../slots/sidebarSlots';
import { COMMAND_SLOT } from '../../../slots/commandSlots';
import { SidebarCommandItem } from './SidebarCommandItem';

/** Intl descriptors for {@link SidebarSearch}, co-located here. */
const messages = defineMessages({
    search: {
        id: 'shell.sidebar.search',
        defaultMessage: 'Search'
    },
    title: {
        id: 'shell.search.title',
        defaultMessage: 'Search'
    },
    description: {
        id: 'shell.search.description',
        defaultMessage: 'Jump to a section.'
    },
    placeholder: {
        id: 'shell.search.placeholder',
        defaultMessage: 'Search or jump to…'
    },
    empty: {
        id: 'shell.search.empty',
        defaultMessage: 'No results.'
    },
    goTo: {
        id: 'shell.search.goTo',
        defaultMessage: 'Go to'
    },
    footerNavigate: {
        id: 'shell.search.footerNavigate',
        defaultMessage: 'to navigate'
    },
    footerOpen: {
        id: 'shell.search.footerOpen',
        defaultMessage: 'to open'
    },
    footerClose: {
        id: 'shell.search.footerClose',
        defaultMessage: 'to close'
    }
});

/**
 * The sidebar's search affordance and the ⌘K command palette behind it. The
 * trigger is styled like a search field; clicking it — or pressing ⌘K / Ctrl+K
 * — opens a `CommandDialog` whose suggestions are the primary-nav destinations
 * ({@link SIDEBAR_NAV_SLOT}, permission-gated), so you can filter and jump to
 * any section from the keyboard.
 *
 * Rendered only in the global sidebar (the per-workspace sidebar has its own
 * content ⌘K palette), so the shortcut never double-binds.
 */
export function SidebarSearch() {
    const intl = useIntl();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    /** Whatever held focus when the palette opened, so closing can give it back. */
    const restoreFocusRef = useRef<Element | null>(null);

    const openPalette = useCallback(() => {
        restoreFocusRef.current = document.activeElement;
        setOpen(true);
    }, []);

    /**
     * Closes the palette **and puts focus back**. Radix's own restore does not
     * fire here (the account menu's dropdown, same library, does restore), so a
     * keyboard user who opened the palette and changed their mind was dropped on
     * `<body>` and had to Tab through the whole chrome again — WCAG 2.4.3.
     *
     * Deferred a tick so it lands after the dialog's focus scope has finished
     * unmounting, and falls back to the trigger when the remembered element has
     * gone with the page that owned it.
     */
    const closePalette = useCallback(() => {
        setOpen(false);
        const previous = restoreFocusRef.current;
        restoreFocusRef.current = null;
        setTimeout(() => {
            const node =
                previous instanceof HTMLElement && previous.isConnected
                    ? previous
                    : triggerRef.current;
            node?.focus();
        }, 0);
    }, []);

    // ⌘K / Ctrl+K toggles the palette.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key !== 'k') return;
            // While the palette is open its own input is the editable target, so
            // the toggle-closed half must not be gated on that.
            if (!open && isComposingText(event.target)) return;
            event.preventDefault();
            if (open) {
                closePalette();
            } else {
                openPalette();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [open, openPalette, closePalette]);

    const items = byOrder(SIDEBAR_NAV_SLOT.getItems());
    const sections = byOrder(COMMAND_SLOT.getItems());

    // Choosing a result is not "changed my mind": the route is about to change, so
    // these deliberately skip the focus restore in `closePalette` — putting focus
    // back on the sidebar trigger would fight the incoming page.
    const go = (to: string) => {
        restoreFocusRef.current = null;
        setOpen(false);
        navigate(to);
    };
    const close = () => {
        restoreFocusRef.current = null;
        setOpen(false);
    };

    const label = intl.formatMessage(messages.search);

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-label={label}
                onClick={openPalette}
                className="flex h-9 w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/50 px-2.5 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="flex-1 text-left">{label}</span>
                <kbd className="pointer-events-none rounded border border-sidebar-border bg-sidebar px-1.5 font-mono text-xs">
                    ⌘K
                </kbd>
            </button>

            <CommandDialog
                open={open}
                onOpenChange={(next) => (next ? openPalette() : closePalette())}
                title={intl.formatMessage(messages.title)}
                description={intl.formatMessage(messages.description)}
            >
                <CommandInput
                    placeholder={intl.formatMessage(messages.placeholder)}
                />
                <CommandList>
                    <CommandEmpty>
                        {intl.formatMessage(messages.empty)}
                    </CommandEmpty>
                    <CommandGroup heading={intl.formatMessage(messages.goTo)}>
                        {items.map((item) => (
                            <SidebarCommandItem
                                key={item.to}
                                item={item}
                                onNavigate={go}
                            />
                        ))}
                    </CommandGroup>
                    {sections.map(({ id, Component }) => (
                        <Component key={id} close={close} />
                    ))}
                </CommandList>
                <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <Kbd>↑</Kbd>
                        <Kbd>↓</Kbd>
                        {intl.formatMessage(messages.footerNavigate)}
                    </span>
                    <span className="flex items-center gap-1">
                        <Kbd>↵</Kbd>
                        {intl.formatMessage(messages.footerOpen)}
                    </span>
                    <span className="flex items-center gap-1">
                        <Kbd>esc</Kbd>
                        {intl.formatMessage(messages.footerClose)}
                    </span>
                </div>
            </CommandDialog>
        </>
    );
}
