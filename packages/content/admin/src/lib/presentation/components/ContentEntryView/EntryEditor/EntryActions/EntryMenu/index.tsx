import { Fragment, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { MoreHorizontal, Save, Send, Trash2, Undo2 } from 'lucide-react';
import {
    Button,
    ConfirmDialog,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@orthacms/design-system';
import {
    ENTRY_MENU_GROUP,
    ENTRY_MENU_GROUP_ORDER,
    type EntryMenuGroup
} from '../../../../../../domain/constants';
import {
    ENTRY_MENU_SLOT,
    type EntryMenuEntry,
    type EntrySlotContext
} from '../../../../../slots/contentSlots';

const messages = defineMessages({
    actions: {
        id: 'content.sidebar.actions',
        defaultMessage: 'More actions'
    },
    saveDraft: { id: 'content.editor.saveDraft', defaultMessage: 'Save draft' },
    publishAndSave: {
        id: 'content.editor.publishAndSave',
        defaultMessage: 'Save & publish'
    },
    unpublish: { id: 'content.editor.unpublish', defaultMessage: 'Unpublish' },
    deleteEntry: { id: 'content.editor.delete', defaultMessage: 'Delete' },
    deleteTitle: {
        id: 'content.sidebar.deleteTitle',
        defaultMessage: 'Delete this entry?'
    },
    deleteBody: {
        id: 'content.sidebar.deleteBody',
        defaultMessage:
            'It will be moved to the trash, where it can be restored.'
    },
    deleteBodyHard: {
        id: 'content.sidebar.deleteBodyHard',
        defaultMessage:
            'This permanently removes the entry and can’t be undone.'
    },
    deleteConfirm: {
        id: 'content.sidebar.deleteConfirm',
        defaultMessage: 'Delete'
    }
});

/** A resolved entry plus what the menu needs to place it. */
type Placed = EntryMenuEntry & { key: string; order: number };

/**
 * The entry editor's **⋯ menu**: the built-in write actions plus whatever
 * `ENTRY_MENU_SLOT` contributes, laid out in {@link ENTRY_MENU_GROUP} sections
 * with a rule between them.
 *
 * It owns the contributions' hooks **and** their overlays, because those two
 * can't live apart: an item's dialog has to render *outside* `DropdownMenuContent`
 * — which unmounts the moment the menu closes, exactly when the dialog is meant
 * to appear — while its menu item has to render inside it. One component holding
 * both is what lets a contributed action open a dialog at all.
 *
 * Every registered item's `useItem` runs on every render, in registration order:
 * the rules-of-hooks contract every hook-style slot here relies on (slots are
 * boot-frozen). `appliesTo` filters the *result*, never the call, so the hook
 * count can't change when the open type does.
 */
export function EntryMenu({
    context,
    paranoid,
    busy,
    showSaveDraft,
    showPublish,
    publishBlocked = false,
    showUnpublish,
    showDelete,
    onSaveDraft,
    onPublish,
    onUnpublish,
    onDelete
}: {
    /** The open editor's slot context, handed to every contributed item. */
    context: EntrySlotContext;
    /** Whether delete is a soft delete (trash) vs a permanent removal. */
    paranoid: boolean;
    /** Any write in flight — disables the trigger. */
    busy: boolean;
    showSaveDraft: boolean;
    showPublish: boolean;
    /**
     * Whether a publish guard refused with no way through. The primary button
     * carries the reason; the menu item only must not be a second door past it.
     */
    publishBlocked?: boolean;
    showUnpublish: boolean;
    showDelete: boolean;
    onSaveDraft: () => void;
    onPublish: () => void;
    onUnpublish?: () => void;
    onDelete?: () => void;
}) {
    const intl = useIntl();
    const [confirmDelete, setConfirmDelete] = useState(false);

    // Hooks first, unconditionally, over the full registered list.
    const items = ENTRY_MENU_SLOT.getItems();
    const contributed = items.map((item) => ({
        item,
        entry: item.useItem(context)
    }));

    const groups: Record<EntryMenuGroup, Placed[]> = {
        [ENTRY_MENU_GROUP.Save]: [],
        [ENTRY_MENU_GROUP.Publish]: [],
        [ENTRY_MENU_GROUP.Extras]: [],
        [ENTRY_MENU_GROUP.Danger]: []
    };

    // Built-ins sort ahead of contributions in the same group (negative order).
    if (showSaveDraft)
        groups[ENTRY_MENU_GROUP.Save].push({
            key: 'save-draft',
            order: -2,
            label: intl.formatMessage(messages.saveDraft),
            icon: Save,
            onSelect: onSaveDraft
        });
    if (showPublish)
        groups[ENTRY_MENU_GROUP.Save].push({
            key: 'save-publish',
            order: -1,
            label: intl.formatMessage(messages.publishAndSave),
            icon: Send,
            disabled: publishBlocked,
            onSelect: () => onPublish()
        });
    if (showUnpublish && onUnpublish)
        groups[ENTRY_MENU_GROUP.Publish].push({
            key: 'unpublish',
            order: -1,
            label: intl.formatMessage(messages.unpublish),
            icon: Undo2,
            onSelect: onUnpublish
        });
    if (showDelete && onDelete)
        groups[ENTRY_MENU_GROUP.Danger].push({
            key: 'delete',
            order: -1,
            label: intl.formatMessage(messages.deleteEntry),
            icon: Trash2,
            destructive: true,
            onSelect: () => setConfirmDelete(true)
        });

    for (const { item, entry } of contributed) {
        if (!entry) continue;
        if (item.appliesTo && !item.appliesTo(context.schema)) continue;
        groups[item.group].push({ ...entry, key: item.id, order: item.order });
    }
    for (const group of ENTRY_MENU_GROUP_ORDER) {
        groups[group].sort((a, b) => a.order - b.order);
    }

    const sections = ENTRY_MENU_GROUP_ORDER.map(
        (group) => groups[group]
    ).filter((entries) => entries.length > 0);
    // Contributed overlays only — the built-in delete confirm is rendered below.
    const overlays = contributed
        .filter((row) => row.entry?.overlay)
        .map((row) => (
            <Fragment key={row.item.id}>{row.entry?.overlay}</Fragment>
        ));

    if (sections.length === 0) return <>{overlays}</>;

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8 shrink-0 shadow-none"
                        disabled={busy}
                        aria-label={intl.formatMessage(messages.actions)}
                    >
                        <MoreHorizontal aria-hidden />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    {sections.map((entries, index) => (
                        <Fragment key={entries[0].key}>
                            {index > 0 && <DropdownMenuSeparator />}
                            {entries.map((entry) => {
                                const Icon = entry.icon;
                                return (
                                    <DropdownMenuItem
                                        key={entry.key}
                                        disabled={entry.disabled}
                                        className={
                                            entry.destructive
                                                ? 'text-destructive focus:text-destructive'
                                                : undefined
                                        }
                                        onSelect={entry.onSelect}
                                    >
                                        {Icon ? <Icon aria-hidden /> : null}
                                        {entry.label}
                                    </DropdownMenuItem>
                                );
                            })}
                        </Fragment>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Outside the menu on purpose — see this component's JSDoc. */}
            {overlays}

            {showDelete && (
                <ConfirmDialog
                    open={confirmDelete}
                    onOpenChange={setConfirmDelete}
                    title={intl.formatMessage(messages.deleteTitle)}
                    description={intl.formatMessage(
                        paranoid ? messages.deleteBody : messages.deleteBodyHard
                    )}
                    confirmLabel={intl.formatMessage(messages.deleteConfirm)}
                    confirmVariant="destructive"
                    busy={busy}
                    onConfirm={() => {
                        onDelete?.();
                        setConfirmDelete(false);
                    }}
                />
            )}
        </>
    );
}
