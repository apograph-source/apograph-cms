import { useState, type UIEvent } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Plus } from 'lucide-react';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type Announcements,
    type DragEndEvent,
    type ScreenReaderInstructions
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { Button, Spinner } from '@orthacms/design-system';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import type {
    ContentField,
    RelationRef,
    StagedRelation
} from '../../../../../domain/types/contentType';
import { useContentSchema } from '../../../../../application/useContentSchema';
import { useRelationFieldLinks } from '../../../../../application/useRelationFieldLinks';
import type { RelationCandidate } from '../../../../../application/useRelationCandidates';
import {
    applyStaged,
    reconcileStaged
} from '../../../../../domain/stagedRelation';
import { contentEntryPath } from '../../../../../domain/contentEntryPath';
import {
    handleFor,
    slugFromValues
} from '../../../../../domain/relationHandle';
import { RelationItemRow } from '../RelationField/RelationItemRow';
import { RelationIndex } from '../RelationField/RelationIndex';
import { SortableRelationItem } from '../RelationField/SortableRelationItem';
import { RelationPickerDialog } from '../RelationField/RelationPickerDialog';
import { useEntryReadOnly } from '../../../../hooks/useEntryReadOnly';

const messages = defineMessages({
    assign: {
        id: 'content.relations.live.assign',
        defaultMessage: 'Select {label}'
    },
    add: { id: 'content.relations.live.add', defaultMessage: 'Add related' },
    empty: {
        id: 'content.relations.live.empty',
        defaultMessage: 'Nothing linked yet.'
    },
    remove: {
        id: 'content.relations.live.remove',
        defaultMessage: 'Remove {title}'
    },
    open: {
        id: 'content.relations.live.open',
        defaultMessage: 'Open {title} in a new tab'
    },
    moveUp: {
        id: 'content.relations.live.moveUp',
        defaultMessage: 'Move {title} up'
    },
    moveDown: {
        id: 'content.relations.live.moveDown',
        defaultMessage: 'Move {title} down'
    },
    loadError: {
        id: 'content.relations.live.loadError',
        defaultMessage: 'Couldn’t load linked records.'
    },
    // Drag-and-drop reorder announcements — same copy as RelationField, kept
    // co-located here (messages are per-component) so keyboard reorder is spoken.
    dndInstructions: {
        id: 'content.relations.live.dnd.instructions',
        defaultMessage:
            'To reorder, press Space or Enter to pick up, use the arrow keys to move, then press Space or Enter to drop, or Escape to cancel.'
    },
    dndPickedUp: {
        id: 'content.relations.live.dnd.pickedUp',
        defaultMessage: 'Picked up {title}.'
    },
    dndOver: {
        id: 'content.relations.live.dnd.over',
        defaultMessage: '{title} was moved over {target}.'
    },
    dndDropped: {
        id: 'content.relations.live.dnd.dropped',
        defaultMessage: '{title} was dropped over {target}.'
    },
    dndCancelled: {
        id: 'content.relations.live.dnd.cancelled',
        defaultMessage:
            'Reordering cancelled. {title} returned to its position.'
    }
});

/**
 * The relation editor for one **many/inverse** relation field. It shows the
 * assigned records — the server set (infinite-scroll paginated via
 * {@link useRelationFieldLinks} on an existing entry; empty while creating) with
 * the user's **local staging** overlaid — and every assign / unassign / reorder
 * updates that staging **only** (`onStagedChange`): nothing is sent until the
 * user hits Save, which submits the whole document plus the relation deltas in
 * one request. Fully controlled: `staged` is owned by the editor so edits
 * survive collapsing the section or switching tabs. Owning many-relations
 * reorder (persisted via `position`); the inverse reads order but isn't sortable.
 */
export function RelationFieldLive({
    field,
    typeName,
    entryId,
    staged,
    onStagedChange,
    error
}: {
    field: ContentField;
    typeName: string;
    /** The existing entry's id, or undefined while creating (no server set). */
    entryId?: string;
    /** The field's pending link/unlink/reorder (editor-owned). */
    staged: StagedRelation;
    onStagedChange: (next: StagedRelation) => void;
    /** A server/validation error for this field (e.g. a save 422), shown as text. */
    error?: string;
}) {
    const intl = useIntl();
    const workspace = useCurrentWorkspace();
    const readOnly = useEntryReadOnly();
    const [open, setOpen] = useState(false);
    const [preparing, setPreparing] = useState(false);
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates
        })
    );

    const many = field.relation?.many ?? false;
    const targetName = field.relation?.to ?? '';
    // Owning many-relations own their order; an inverse reads it but can't set
    // it — and neither can a reader in preview, so the whole dnd context is left
    // unmounted rather than mounted with every drag rejected.
    const reorderable = many && !field.relation?.inverse && !readOnly;

    const { data: targetSchema } = useContentSchema(targetName, !!targetName);
    const targetLabel = targetSchema?.label ?? targetName;
    const targetFields = targetSchema?.fields ?? [];

    const links = useRelationFieldLinks(
        typeName,
        entryId,
        field.name,
        !!entryId
    );
    const serverItems = entryId ? links.items : [];

    const displayed = applyStaged(serverItems, staged);
    const ids = displayed.map((item) => item.id);
    const removeLabelFor = (title: string) =>
        intl.formatMessage(messages.remove, { title });
    const openLabelFor = (title: string) =>
        intl.formatMessage(messages.open, { title });
    const moveUpLabelFor = (title: string) =>
        intl.formatMessage(messages.moveUp, { title });
    const moveDownLabelFor = (title: string) =>
        intl.formatMessage(messages.moveDown, { title });
    // Deep link to the related record's own editor (open-in-new-tab), when the
    // target type is known.
    const hrefFor = (id: string) =>
        targetName ? contentEntryPath(workspace.id, targetName, id) : undefined;

    // Title lookup for the drag announcements, keyed off the displayed set.
    const titleById = new Map(displayed.map((item) => [item.id, item.title]));
    const titleFor = (id: string) => titleById.get(id) ?? id;

    // Spoken feedback for keyboard reordering, by record title — mirrors
    // RelationField so the live editor announces the same way.
    const announcements: Announcements = {
        onDragStart: ({ active }) =>
            intl.formatMessage(messages.dndPickedUp, {
                title: titleFor(String(active.id))
            }),
        onDragOver: ({ active, over }) =>
            over
                ? intl.formatMessage(messages.dndOver, {
                      title: titleFor(String(active.id)),
                      target: titleFor(String(over.id))
                  })
                : undefined,
        onDragEnd: ({ active, over }) =>
            over
                ? intl.formatMessage(messages.dndDropped, {
                      title: titleFor(String(active.id)),
                      target: titleFor(String(over.id))
                  })
                : undefined,
        onDragCancel: ({ active }) =>
            intl.formatMessage(messages.dndCancelled, {
                title: titleFor(String(active.id))
            })
    };
    const screenReaderInstructions: ScreenReaderInstructions = {
        draggable: intl.formatMessage(messages.dndInstructions)
    };

    // Reconcile the picker's chosen set against what's displayed: link the new
    // ones (remembering their title, slug, and status), unlink the ones it
    // dropped — all into the staged diff, no request. The picked candidates are
    // enriched to RelationRefs with a derived slug so a freshly-added row shows
    // its `/handle` immediately (mirroring a server-loaded ref).
    const confirm = (chosenIds: string[], picked: RelationCandidate[]) => {
        const refs: RelationRef[] = picked.map((c) => {
            const slug = slugFromValues(c.values, targetFields);
            return {
                id: c.id,
                title: c.title,
                ...(slug ? { slug } : {}),
                ...(c.status ? { status: c.status } : {})
            };
        });
        onStagedChange(
            reconcileStaged(staged, ids, serverItems, chosenIds, refs)
        );
    };

    const removeId = (id: string) =>
        confirm(
            ids.filter((x) => x !== id),
            []
        );

    // Move a row one place up/down — same staged `order` path as a drag, so the
    // arrows and drag stay a single source of order (owning many-relations only).
    const move = (id: string, delta: number) => {
        const from = ids.indexOf(id);
        const to = from + delta;
        if (from === -1 || to < 0 || to >= ids.length) return;
        onStagedChange({ ...staged, order: arrayMove(ids, from, to) });
    };

    // Open the picker against the **full** linked set, not just the pages loaded
    // so far: pull any unfetched link pages first, so an already-linked record on
    // an unloaded page is shown pre-checked (and reconciled as such) rather than
    // offered as a brand-new add — which would double-count in the header. Only
    // this explicit action loads the rest; entry load stays first-page-only.
    //
    // The drain must terminate even when a page fetch fails or page one is still
    // pending. On a failed page `fetchNextPage` resolves without adding a page,
    // yet `getNextPageParam` still reports another page (loaded < total), so a
    // naive `while (hasNextPage)` spins forever and hammers the endpoint (#2).
    // And while page one is still loading, `hasNextPage` is deceptively false, so
    // keying the pre-load on it alone skips the drain and treats linked records
    // as brand-new adds (#4). We therefore drain whenever the query isn't fully
    // settled and stop the instant a fetch stops making progress (or throws).
    const openPicker = async () => {
        const settled =
            !entryId ||
            (!!links.data && !links.hasNextPage && !links.isFetching);
        if (!settled && !preparing) {
            setPreparing(true);
            try {
                let loaded = links.items.length;
                let more = true;
                while (more) {
                    const result = await links
                        .fetchNextPage()
                        .catch(() => null);
                    // A failed fetch — open with whatever loaded; the load-error
                    // state still surfaces below.
                    if (!result) break;
                    const next =
                        result.data?.pages.reduce(
                            (sum, page) => sum + page.items.length,
                            0
                        ) ?? 0;
                    // No new items → an errored/empty page; stop rather than spin.
                    if (next <= loaded) break;
                    loaded = next;
                    more = result.hasNextPage;
                }
            } finally {
                setPreparing(false);
            }
        }
        setOpen(true);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from === -1 || to === -1) return;
        onStagedChange({ ...staged, order: arrayMove(ids, from, to) });
    };

    // Near the bottom → pull the next server page (edit mode only).
    const onScroll = (event: UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;
        if (
            el.scrollHeight - el.scrollTop - el.clientHeight <= 120 &&
            links.hasNextPage &&
            !links.isFetchingNextPage
        ) {
            links.fetchNextPage();
        }
    };

    const triggerLabel = many ? messages.add : messages.assign;

    return (
        <div className="flex flex-col gap-3">
            {error ? (
                <p role="alert" className="text-sm text-destructive">
                    {error}
                </p>
            ) : null}
            {links.isError ? (
                <p className="text-sm text-destructive">
                    {intl.formatMessage(messages.loadError)}
                </p>
            ) : links.isLoading ? (
                <div className="flex justify-center py-4">
                    <Spinner aria-hidden />
                </div>
            ) : ids.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                    {intl.formatMessage(messages.empty)}
                </p>
            ) : (
                <div
                    className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1"
                    onScroll={onScroll}
                >
                    {reorderable ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                            accessibility={{
                                announcements,
                                screenReaderInstructions
                            }}
                        >
                            <SortableContext
                                items={ids}
                                strategy={verticalListSortingStrategy}
                            >
                                {displayed.map((item, i) => (
                                    <SortableRelationItem
                                        key={item.id}
                                        id={item.id}
                                        title={item.title}
                                        handle={handleFor(
                                            item.title,
                                            item.slug
                                        )}
                                        status={item.status}
                                        leading={<RelationIndex position={i} />}
                                        onRemove={() => removeId(item.id)}
                                        removeLabel={removeLabelFor(item.title)}
                                        href={hrefFor(item.id)}
                                        openLabel={openLabelFor(item.title)}
                                        onMoveUp={() => move(item.id, -1)}
                                        moveUpLabel={moveUpLabelFor(item.title)}
                                        moveUpDisabled={i === 0}
                                        onMoveDown={() => move(item.id, 1)}
                                        moveDownLabel={moveDownLabelFor(
                                            item.title
                                        )}
                                        moveDownDisabled={
                                            i === displayed.length - 1
                                        }
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>
                    ) : (
                        displayed.map((item, i) => (
                            <RelationItemRow
                                key={item.id}
                                title={item.title}
                                handle={handleFor(item.title, item.slug)}
                                status={item.status}
                                leading={<RelationIndex position={i} />}
                                onRemove={() => removeId(item.id)}
                                removeLabel={removeLabelFor(item.title)}
                                href={hrefFor(item.id)}
                                openLabel={openLabelFor(item.title)}
                                readOnly={readOnly}
                            />
                        ))
                    )}

                    {links.isFetchingNextPage ? (
                        <div className="flex justify-center py-2">
                            <Spinner aria-hidden />
                        </div>
                    ) : null}
                </div>
            )}

            {/* The Add trigger and the picker behind it are dropped whole in
                preview: the trigger has no enabled state for this reader, and
                mounting the dialog would register the target type's candidate
                queries for a pick that can never happen. */}
            {readOnly ? null : (
                <>
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-center border-dashed shadow-none"
                        onClick={openPicker}
                        disabled={preparing}
                    >
                        {preparing ? (
                            <Spinner className="size-4" aria-hidden />
                        ) : (
                            <Plus className="size-4" />
                        )}
                        {intl.formatMessage(triggerLabel, {
                            label: targetLabel
                        })}
                    </Button>

                    <RelationPickerDialog
                        open={open}
                        onOpenChange={setOpen}
                        targetName={targetName}
                        targetLabel={targetLabel}
                        many={many}
                        selectedIds={ids}
                        onConfirm={confirm}
                    />
                </>
            )}
        </div>
    );
}
