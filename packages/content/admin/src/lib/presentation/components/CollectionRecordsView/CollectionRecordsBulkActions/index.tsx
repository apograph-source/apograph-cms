import { Fragment, useState, type ComponentType, type ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { MoreHorizontal, Send, Trash2, Undo2 } from 'lucide-react';
import { useHasPermission } from '@orthacms/identity-admin';
import {
    Button,
    ConfirmDialog,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Spinner,
    toast
} from '@orthacms/design-system';
import { CONTENT_DELETE, CONTENT_PUBLISH } from '../../../../domain/constants';
import { useBulkEntryActions } from '../../../../application/useBulkEntryActions';
import {
    RECORDS_BULK_ACTION_SLOT,
    type RecordsBulkContext
} from '../../../slots/contentSlots';
import type { ContentTypeDetail } from '../../../../domain/types/contentType';
import { BulkPublishDialog } from '../BulkPublishDialog';

const messages = defineMessages({
    trigger: { id: 'content.bulk.trigger', defaultMessage: 'Bulk actions' },
    publish: { id: 'content.bulk.publish', defaultMessage: 'Publish' },
    unpublish: { id: 'content.bulk.unpublish', defaultMessage: 'Unpublish' },
    deleteEntries: { id: 'content.bulk.delete', defaultMessage: 'Delete' },
    restore: { id: 'content.bulk.restore', defaultMessage: 'Restore' },
    deleteForever: {
        id: 'content.bulk.deleteForever',
        defaultMessage: 'Delete permanently'
    },
    unpublished: {
        id: 'content.bulk.unpublished.toast',
        defaultMessage:
            '{count, plural, one {# record unpublished} other {# records unpublished}}.'
    },
    deleted: {
        id: 'content.bulk.deleted.toast',
        defaultMessage:
            '{count, plural, one {# record deleted} other {# records deleted}}.'
    },
    restored: {
        id: 'content.bulk.restored.toast',
        defaultMessage:
            '{count, plural, one {# record restored} other {# records restored}}.'
    },
    failed: {
        id: 'content.bulk.failed.toast',
        defaultMessage: 'That action didn’t work. Please try again.'
    },
    noneAffected: {
        id: 'content.bulk.noneAffected.toast',
        defaultMessage:
            'No records were changed — they may have already been updated elsewhere.'
    },
    deleteTitle: {
        id: 'content.bulk.deleteTitle',
        defaultMessage:
            'Delete {count, plural, one {# record} other {# records}}?'
    },
    deleteBodySoft: {
        id: 'content.bulk.deleteBodySoft',
        defaultMessage:
            'They will be moved to the trash, where they can be restored.'
    },
    deleteBodyHard: {
        id: 'content.bulk.deleteBodyHard',
        defaultMessage:
            'This permanently removes the records and can’t be undone.'
    },
    purgeTitle: {
        id: 'content.bulk.purgeTitle',
        defaultMessage:
            'Permanently delete {count, plural, one {# record} other {# records}}?'
    },
    purgeBody: {
        id: 'content.bulk.purgeBody',
        defaultMessage: 'This empties them from the trash and can’t be undone.'
    },
    confirmDelete: {
        id: 'content.bulk.confirmDelete',
        defaultMessage: 'Delete'
    }
});

/** One resolved row of the menu, built-in or contributed. */
type Placed = {
    key: string;
    order: number;
    label: ReactNode;
    icon?: ComponentType;
    disabled?: boolean;
    destructive?: boolean;
    onSelect: () => void;
};

/**
 * The bulk actions for the current selection, in a **⋯ menu** at the end of the
 * selection bar. In the live view: **Publish** (opens the dry-run
 * {@link BulkPublishDialog}), **Unpublish**, and **Delete** (confirm). In the
 * **trash** view: **Restore** and **Delete permanently** (confirm). All gated
 * by permission and scoped to the current selection; each clears the selection
 * (`onDone`) after it succeeds.
 *
 * A menu rather than a row of buttons because the row grew with every
 * contribution and pushed the count off the other side of the bar. The one
 * control that stays outside it is **Clear**, which the selection bar renders
 * itself — see its JSDoc for why.
 *
 * The dialogs are rendered **outside** `DropdownMenuContent`, which unmounts
 * the moment the menu closes — exactly when a dialog opened from an item is
 * meant to appear. Contributions' overlays are kept outside for the same
 * reason.
 */
export function CollectionRecordsBulkActions({
    typeName,
    schema,
    workspaceId,
    ids,
    publishable,
    paranoid,
    trashed = false,
    onDone
}: {
    typeName: string;
    /** The open collection's schema, handed to slot contributions. */
    schema: ContentTypeDetail;
    /** The open workspace's id, handed to slot contributions. */
    workspaceId: string;
    /** The selected entry ids. */
    ids: string[];
    publishable: boolean;
    paranoid: boolean;
    trashed?: boolean;
    /** Clears the selection after a successful action. */
    onDone: () => void;
}) {
    const intl = useIntl();
    const bulk = useBulkEntryActions(typeName);
    const [publishOpen, setPublishOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmPurge, setConfirmPurge] = useState(false);

    const canPublish = useHasPermission(CONTENT_PUBLISH);
    const canDelete = useHasPermission(CONTENT_DELETE);

    // Hooks first, unconditionally, over the full registered list — and above
    // the `trashed` branch, or the trash and live views would run different
    // numbers of hooks and React would tear on the switch between them.
    // `appliesTo` filters the *result*, never the call.
    const slotContext: RecordsBulkContext = {
        schema,
        workspaceId,
        ids,
        trashed,
        onDone
    };
    const contributed = RECORDS_BULK_ACTION_SLOT.getItems().map((item) => ({
        item,
        entry: item.useItem(slotContext)
    }));
    // Flattened to `{ key, order, …entry }` before rendering, the way
    // `EntryMenu` builds its `Placed` rows — it is what lets the JSX read the
    // resolved entry directly instead of re-proving it is non-null on each use.
    const extras: Placed[] = contributed
        .flatMap(({ item, entry }) =>
            entry && (!item.appliesTo || item.appliesTo(schema))
                ? [{ ...entry, key: item.id, order: item.order }]
                : []
        )
        .sort((a, b) => a.order - b.order);

    // Every contribution's overlay, including the ones `appliesTo` filtered out
    // of the menu — an overlay that is mid-animation when its item stops
    // applying should still finish rather than vanish.
    const extraOverlays = contributed
        .filter((row) => row.entry?.overlay)
        .map((row) => (
            <Fragment key={row.item.id}>{row.entry?.overlay}</Fragment>
        ));

    const run = (
        mutateAsync: (ids: string[]) => Promise<{ count: number }>,
        messageId: 'unpublished' | 'deleted' | 'restored'
    ) => {
        mutateAsync(ids)
            .then((result) =>
                // A 0 count means nothing matched (e.g. the rows changed in
                // another tab) — don't report "0 records …" as a success.
                result.count === 0
                    ? toast.info(intl.formatMessage(messages.noneAffected))
                    : toast.success(
                          intl.formatMessage(messages[messageId], {
                              count: result.count
                          })
                      )
            )
            .catch(() => toast.error(intl.formatMessage(messages.failed)))
            .finally(onDone);
    };

    // The built-ins, in two groups the menu separates: what the action does to
    // the records, then what removes them. Contributions join the first group,
    // so a contributed Export never lands under the same rule as Delete.
    const primary: Placed[] = [];
    const danger: Placed[] = [];

    if (trashed) {
        if (canDelete) {
            primary.push({
                key: 'restore',
                order: -1,
                label: intl.formatMessage(messages.restore),
                icon: bulk.restore.isPending ? Spinner : Undo2,
                disabled: bulk.restore.isPending,
                onSelect: () => run(bulk.restore.mutateAsync, 'restored')
            });
            danger.push({
                key: 'purge',
                order: -1,
                label: intl.formatMessage(messages.deleteForever),
                icon: Trash2,
                destructive: true,
                disabled: bulk.purge.isPending,
                onSelect: () => setConfirmPurge(true)
            });
        }
    } else {
        if (publishable && canPublish) {
            primary.push(
                {
                    key: 'publish',
                    order: -2,
                    label: intl.formatMessage(messages.publish),
                    icon: Send,
                    onSelect: () => setPublishOpen(true)
                },
                {
                    key: 'unpublish',
                    order: -1,
                    label: intl.formatMessage(messages.unpublish),
                    icon: bulk.unpublish.isPending ? Spinner : Undo2,
                    disabled: bulk.unpublish.isPending,
                    onSelect: () =>
                        run(bulk.unpublish.mutateAsync, 'unpublished')
                }
            );
        }
        if (canDelete) {
            danger.push({
                key: 'delete',
                order: -1,
                label: intl.formatMessage(messages.deleteEntries),
                icon: Trash2,
                destructive: true,
                disabled: bulk.remove.isPending,
                onSelect: () => setConfirmDelete(true)
            });
        }
    }

    primary.push(...extras);
    const sections = [primary, danger].filter((rows) => rows.length > 0);

    // With no permission and no contribution there is nothing to open onto, so
    // the trigger goes too — but the overlays stay, as an array rather than a
    // lone-child fragment: an open dialog has to survive its item ceasing to
    // apply.
    if (sections.length === 0) return extraOverlays;

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8 shrink-0 shadow-none"
                        aria-label={intl.formatMessage(messages.trigger)}
                    >
                        <MoreHorizontal aria-hidden />
                    </Button>
                </DropdownMenuTrigger>
                {/* Aligned to the trigger's right edge — the bar puts it at the
                    end of the row, so a left-aligned panel would open off the
                    side. */}
                <DropdownMenuContent align="end" className="w-56">
                    {sections.map((rows, index) => (
                        <Fragment key={rows[0].key}>
                            {index > 0 && <DropdownMenuSeparator />}
                            {rows.map((row) => {
                                const Icon = row.icon;
                                return (
                                    <DropdownMenuItem
                                        key={row.key}
                                        disabled={row.disabled}
                                        className={
                                            row.destructive
                                                ? 'text-destructive focus:text-destructive'
                                                : undefined
                                        }
                                        onSelect={row.onSelect}
                                    >
                                        {Icon ? <Icon aria-hidden /> : null}
                                        {row.label}
                                    </DropdownMenuItem>
                                );
                            })}
                        </Fragment>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            {extraOverlays}

            {publishable && canPublish && !trashed ? (
                <BulkPublishDialog
                    open={publishOpen}
                    onOpenChange={setPublishOpen}
                    typeName={typeName}
                    ids={ids}
                    onPublished={onDone}
                />
            ) : null}

            <ConfirmDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={intl.formatMessage(messages.deleteTitle, {
                    count: ids.length
                })}
                description={intl.formatMessage(
                    paranoid ? messages.deleteBodySoft : messages.deleteBodyHard
                )}
                confirmLabel={intl.formatMessage(messages.confirmDelete)}
                confirmVariant="destructive"
                busy={bulk.remove.isPending}
                onConfirm={() => {
                    run(bulk.remove.mutateAsync, 'deleted');
                    setConfirmDelete(false);
                }}
            />

            <ConfirmDialog
                open={confirmPurge}
                onOpenChange={setConfirmPurge}
                title={intl.formatMessage(messages.purgeTitle, {
                    count: ids.length
                })}
                description={intl.formatMessage(messages.purgeBody)}
                confirmLabel={intl.formatMessage(messages.deleteForever)}
                confirmVariant="destructive"
                busy={bulk.purge.isPending}
                onConfirm={() => {
                    run(bulk.purge.mutateAsync, 'deleted');
                    setConfirmPurge(false);
                }}
            />
        </>
    );
}
