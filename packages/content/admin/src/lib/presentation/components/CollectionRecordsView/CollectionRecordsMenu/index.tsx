import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@orthacms/design-system';
import {
    RECORDS_MENU_SLOT,
    type RecordsMenuContext
} from '../../../slots/contentSlots';
import type { ContentTypeDetail } from '../../../../domain/types/contentType';

const messages = defineMessages({
    trigger: {
        id: 'content.records.menu.trigger',
        defaultMessage: 'More actions'
    },
    trash: {
        id: 'content.records.menu.trash',
        defaultMessage: 'Trash'
    }
});

/**
 * The collection's **⋯ menu**, last in the header's action cluster beside
 * **Add record** — the whole-collection things that are not worth a button of
 * their own.
 *
 * Nearly everything it holds comes from `RECORDS_MENU_SLOT`. The one item this
 * package contributes is **Trash**, and it is here rather than in the header
 * for two reasons: it is a destination, not an action, so it read oddly among
 * buttons that do something; and the menu spent its life holding exactly one
 * contributed item (transfer's Import), which made the ⋯ a button that hid a
 * button. The trigger stays conditional either way — with nothing to show,
 * rendering it would be a control that opens onto nothing.
 *
 * It owns the contributions' hooks **and** their overlays, for the same reason
 * `EntryMenu` does — a dialog cannot live inside `DropdownMenuContent`, which
 * unmounts the moment the menu closes, which is exactly when the dialog is
 * meant to appear.
 */
export function CollectionRecordsMenu({
    schema,
    workspaceId,
    trashed,
    trashHref
}: {
    schema: ContentTypeDetail;
    workspaceId: string;
    trashed: boolean;
    /**
     * Where **Trash** links. Omitted — and the item left out — when the
     * collection does not soft-delete or the caller may not delete, which is
     * the same pair of conditions that used to gate the header button.
     */
    trashHref?: string;
}) {
    const intl = useIntl();

    // Hooks first, unconditionally, over the full registered list — the
    // rules-of-hooks contract every hook-style slot here relies on (slots are
    // boot-frozen). `appliesTo` filters the *result*, never the call.
    const context: RecordsMenuContext = { schema, workspaceId, trashed };
    const contributed = RECORDS_MENU_SLOT.getItems().map((item) => ({
        item,
        entry: item.useItem(context)
    }));

    const entries = contributed
        .flatMap(({ item, entry }) =>
            entry && (!item.appliesTo || item.appliesTo(schema))
                ? [{ ...entry, key: item.id, order: item.order }]
                : []
        )
        .sort((a, b) => a.order - b.order);

    // Every contribution's overlay, including one whose item `appliesTo`
    // filtered out — an overlay mid-animation should finish rather than vanish.
    const overlays = contributed
        .filter((row) => row.entry?.overlay)
        .map((row) => (
            <Fragment key={row.item.id}>{row.entry?.overlay}</Fragment>
        ));

    // The overlays alone, as an array rather than a lone-child fragment: an
    // open dialog has to survive its item ceasing to apply.
    if (entries.length === 0 && !trashHref) return overlays;

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shadow-none"
                        aria-label={intl.formatMessage(messages.trigger)}
                    >
                        <MoreHorizontal aria-hidden className="size-4" />
                    </Button>
                </DropdownMenuTrigger>
                {/* Aligned to the trigger's right edge — the button is last in
                    the row, so a left-aligned panel would open off the side. */}
                <DropdownMenuContent align="end" className="w-56">
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
                    {/* Last, under a rule: the contributed items act on this
                        collection where Trash leaves it for another page. */}
                    {trashHref ? (
                        <>
                            {entries.length > 0 ? (
                                <DropdownMenuSeparator />
                            ) : null}
                            <DropdownMenuItem asChild>
                                <Link to={trashHref}>
                                    <Trash2 aria-hidden />
                                    {intl.formatMessage(messages.trash)}
                                </Link>
                            </DropdownMenuItem>
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
            {overlays}
        </>
    );
}
