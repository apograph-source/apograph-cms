import { useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Check,
    ChevronDown,
    LayoutList,
    Pin,
    PinOff,
    Trash2
} from 'lucide-react';
import {
    Button,
    ConfirmDialog,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Spinner,
    cn
} from '@orthacms/design-system';
import {
    VIEW_VISIBILITY,
    type SavedView
} from '../../../domain/types/savedView';
import { ViewRow } from './ViewRow';

/** Intl descriptors for {@link ViewSwitcher}, co-located. */
const messages = defineMessages({
    trigger: {
        id: 'content.views.switcher.trigger',
        defaultMessage: 'Saved views'
    },
    group: {
        id: 'content.views.switcher.group',
        defaultMessage: 'View controls'
    },
    personal: {
        id: 'content.views.switcher.personal',
        defaultMessage: 'Personal'
    },
    shared: {
        id: 'content.views.switcher.shared',
        defaultMessage: 'Shared'
    },
    all: {
        id: 'content.views.switcher.all',
        defaultMessage: 'All records'
    },
    allHint: {
        id: 'content.views.switcher.allHint',
        defaultMessage: 'No filters'
    },
    saveAs: {
        id: 'content.views.switcher.saveAs',
        defaultMessage: 'Save current as view…'
    },
    modified: {
        id: 'content.views.switcher.modified',
        defaultMessage: 'Modified'
    },
    save: { id: 'content.views.switcher.save', defaultMessage: 'Save' },
    saveNew: {
        id: 'content.views.switcher.saveNew',
        defaultMessage: 'Save as new'
    },
    reset: { id: 'content.views.switcher.reset', defaultMessage: 'Reset' },
    makeDefault: {
        id: 'content.views.switcher.makeDefault',
        defaultMessage: 'Set as my default'
    },
    clearDefault: {
        id: 'content.views.switcher.clearDefault',
        defaultMessage: 'Clear my default'
    },
    delete: {
        id: 'content.views.switcher.delete',
        defaultMessage: 'Delete view'
    },
    deleteTitle: {
        id: 'content.views.switcher.deleteTitle',
        defaultMessage: 'Delete this view?'
    },
    deleteBody: {
        id: 'content.views.switcher.deleteBody',
        defaultMessage:
            '“{name}” will be removed. The records it filtered are untouched, and the list falls back to All records.'
    },
    deleteBodyShared: {
        id: 'content.views.switcher.deleteBodyShared',
        defaultMessage:
            '“{name}” is shared with the workspace — deleting it removes it for everyone. The records it filtered are untouched.'
    },
    deleteConfirm: {
        id: 'content.views.switcher.deleteConfirm',
        defaultMessage: 'Delete view'
    },
    cancel: {
        id: 'content.views.switcher.cancel',
        defaultMessage: 'Cancel'
    }
});

/** Props for {@link ViewSwitcher}. */
export type ViewSwitcherProps = {
    /** Views the caller may see for this list. */
    views: SavedView[];
    /** The view currently applied, or null for the unfiltered list. */
    active: SavedView | null;
    /** Whether the live list state has drifted from the active view's payload. */
    isDirty: boolean;
    /** Whether a save/update is in flight. */
    isSaving: boolean;
    /** Applies a view, or clears back to the unfiltered list when null. */
    onSelect: (view: SavedView | null) => void;
    /** Opens the "Save current as view" dialog. */
    onSaveAs: () => void;
    /** Overwrites the active view with the live state. */
    onSaveChanges: () => void;
    /** Re-applies the active view, discarding the live changes. */
    onReset: () => void;
    /** Points the caller's default at a view, or clears it. */
    onSetDefault: (view: SavedView, isDefault: boolean) => void;
    /** Deletes a view the caller owns. */
    onDelete: (view: SavedView) => void;
};

/**
 * The saved-view picker, leading the records toolbar's action row — beside the
 * locale, column and filter controls, and above the table they all describe.
 *
 * It sits with those rather than in the header's action cluster because it
 * answers the same question they do: *which slice am I looking at*. The header
 * is left to the things you do **to** the collection (add a record, the ⋯).
 *
 * The trigger renders the same way whether or not anything is saved. It used to
 * collapse to a lone "Save current as view…" button when the list was empty,
 * which put the loudest secondary control on the page in service of an action
 * that is only useful *after* the reader has changed something — and gave the
 * control two shapes to learn instead of one. The save-as affordance is where
 * the rest of the view actions are: inside the menu.
 *
 * When the live state drifts from the saved payload the trigger says so and the
 * three resolutions appear inline beside it. Nothing autosaves: silently
 * rewriting a shared view would lose a colleague's work with no trace, and the
 * same rule for personal views keeps one mental model instead of two.
 */
export function ViewSwitcher({
    views,
    active,
    isDirty,
    isSaving,
    onSelect,
    onSaveAs,
    onSaveChanges,
    onReset,
    onSetDefault,
    onDelete
}: ViewSwitcherProps) {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    // The view the confirm dialog is asking about, held by value rather than by
    // a boolean: the menu that named it is gone by the time the dialog is up.
    const [pendingDelete, setPendingDelete] = useState<SavedView | null>(null);
    // Where focus goes when the dialog closes — see the dialog's own comment.
    // The trigger outlives every list change, deleting the last view included,
    // so it is always there to take focus back.
    const triggerRef = useRef<HTMLButtonElement>(null);
    // Set by the one menu item that opens a dialog on the way out. Radix runs
    // its close-autofocus *after* the dialog has mounted and taken its own
    // `autoFocus`, so the restore lands on the trigger and the reader's first
    // keystroke goes nowhere — the save dialog opened with its name field
    // unfocused. Yield the restore for that exit only; Escape and picking a
    // view still put focus back where it belongs.
    const openingDialog = useRef(false);

    const personal = views.filter(
        (view) => view.visibility === VIEW_VISIBILITY.Private
    );
    const shared = views.filter(
        (view) => view.visibility === VIEW_VISIBILITY.Workspace
    );

    return (
        // A labelled group: the trigger and the Save / Save as new / Reset
        // buttons beside it are one cluster, and the page has other buttons by
        // those names (the filter panel's own Reset). The name disambiguates
        // them for a screen reader the same way position does visually.
        <div
            role="group"
            aria-label={intl.formatMessage(messages.group)}
            className="flex flex-wrap items-center gap-2"
        >
            {/* `modal={false}`, like every other menu in the admin: a modal
                Radix menu `aria-hidden`s the page root, which holds focusable
                content, and axe's `aria-hidden-focus` fires on it (the whole
                page — the `<h1>` included — also drops out of the a11y tree). */}
            <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        ref={triggerRef}
                        variant="outline"
                        aria-label={intl.formatMessage(messages.trigger)}
                        className={cn(
                            'shadow-none',
                            isDirty &&
                                'border-amber-500/60 text-amber-700 dark:text-amber-400'
                        )}
                    >
                        <LayoutList aria-hidden />
                        <span className="max-w-[14rem] truncate">
                            {active
                                ? active.name
                                : intl.formatMessage(messages.all)}
                        </span>
                        {isDirty ? (
                            <>
                                <span aria-hidden className="opacity-50">
                                    ·
                                </span>
                                {intl.formatMessage(messages.modified)}
                            </>
                        ) : null}
                        <ChevronDown aria-hidden className="opacity-60" />
                    </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent
                    align="end"
                    className="w-72"
                    onCloseAutoFocus={(event) => {
                        if (!openingDialog.current) return;
                        openingDialog.current = false;
                        event.preventDefault();
                    }}
                >
                    {personal.length > 0 ? (
                        <>
                            <DropdownMenuLabel>
                                {intl.formatMessage(messages.personal)}
                            </DropdownMenuLabel>
                            {personal.map((view) => (
                                <ViewRow
                                    key={view.id}
                                    view={view}
                                    active={active?.id === view.id}
                                    onSelect={onSelect}
                                />
                            ))}
                        </>
                    ) : null}

                    {shared.length > 0 ? (
                        <>
                            <DropdownMenuLabel>
                                {intl.formatMessage(messages.shared)}
                            </DropdownMenuLabel>
                            {shared.map((view) => (
                                <ViewRow
                                    key={view.id}
                                    view={view}
                                    active={active?.id === view.id}
                                    onSelect={onSelect}
                                />
                            ))}
                        </>
                    ) : null}

                    {views.length > 0 ? <DropdownMenuSeparator /> : null}

                    {/* Not a view — the way back out of one. Kept as its own
                        row at the bottom because "clear everything" is the most
                        common move after "switch". */}
                    <DropdownMenuItem onSelect={() => onSelect(null)}>
                        <Check
                            aria-hidden
                            className={cn(
                                'size-3.5',
                                active ? 'invisible' : 'text-primary'
                            )}
                        />
                        <span className="flex-1">
                            {intl.formatMessage(messages.all)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {intl.formatMessage(messages.allHint)}
                        </span>
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onSelect={() => {
                            openingDialog.current = true;
                            onSaveAs();
                        }}
                    >
                        {intl.formatMessage(messages.saveAs)}
                    </DropdownMenuItem>

                    {active ? (
                        <>
                            <DropdownMenuItem
                                onSelect={() =>
                                    onSetDefault(active, !active.isDefault)
                                }
                            >
                                {active.isDefault ? (
                                    <PinOff aria-hidden className="size-3.5" />
                                ) : (
                                    <Pin aria-hidden className="size-3.5" />
                                )}
                                {intl.formatMessage(
                                    active.isDefault
                                        ? messages.clearDefault
                                        : messages.makeDefault
                                )}
                            </DropdownMenuItem>
                            {active.isOwn ? (
                                <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => setPendingDelete(active)}
                                >
                                    <Trash2 aria-hidden className="size-3.5" />
                                    {intl.formatMessage(messages.delete)}
                                </DropdownMenuItem>
                            ) : null}
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>

            {/* The three resolutions, inline rather than inside the menu: the
                reader is already looking at the trigger that says "Modified",
                and burying the fix one click deeper buys nothing. `Save` is
                absent on someone else's shared view — that one is theirs.
                None of them is `variant="default"`: the header's one primary
                button is "Add record", and a second would compete with it. */}
            {isDirty && active ? (
                <>
                    {active.isOwn ? (
                        <Button
                            variant="secondary"
                            className="shadow-none"
                            disabled={isSaving}
                            onClick={onSaveChanges}
                        >
                            {isSaving ? <Spinner aria-hidden /> : null}
                            {intl.formatMessage(messages.save)}
                        </Button>
                    ) : null}
                    <Button
                        variant="outline"
                        className="shadow-none"
                        onClick={onSaveAs}
                    >
                        {intl.formatMessage(messages.saveNew)}
                    </Button>
                    <Button variant="ghost" onClick={onReset}>
                        {intl.formatMessage(messages.reset)}
                    </Button>
                </>
            ) : null}

            {/* Outside `DropdownMenuContent`, which unmounts the instant the
                menu closes — precisely when this dialog is meant to appear.
                Same rule the entry editor's ⋯ menu follows.

                A view is a slice, not records, so deleting one destroys no
                content — but it is not undoable and a shared view is somebody
                else's tool too, which is what the confirm is for. The body says
                which of the two this is.

                `onCloseAutoFocus`: the control that opened this — a menu item —
                is long gone, so Radix's restore would target a detached node
                and drop focus on `<body>`. Put it back on the switcher. */}
            {pendingDelete ? (
                <ConfirmDialog
                    open
                    onOpenChange={(next) => {
                        if (!next) setPendingDelete(null);
                    }}
                    title={intl.formatMessage(messages.deleteTitle)}
                    description={intl.formatMessage(
                        pendingDelete.visibility === VIEW_VISIBILITY.Workspace
                            ? messages.deleteBodyShared
                            : messages.deleteBody,
                        { name: pendingDelete.name }
                    )}
                    confirmLabel={intl.formatMessage(messages.deleteConfirm)}
                    cancelLabel={intl.formatMessage(messages.cancel)}
                    confirmVariant="destructive"
                    onCloseAutoFocus={(event) => {
                        if (!triggerRef.current) return;
                        event.preventDefault();
                        triggerRef.current.focus();
                    }}
                    onConfirm={() => {
                        // Closed here rather than held open behind `busy`: the
                        // outcome lands as a toast either way, which is how the
                        // entry editor's delete behaves too.
                        onDelete(pendingDelete);
                        setPendingDelete(null);
                    }}
                />
            ) : null}
        </div>
    );
}
