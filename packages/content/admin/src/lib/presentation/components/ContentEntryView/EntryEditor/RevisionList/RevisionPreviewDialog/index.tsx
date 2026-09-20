import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Spinner
} from '@orthacms/design-system';
import type {
    ContentTypeDetail,
    RevisionStatus,
    RevisionSummary
} from '../../../../../../domain/types/contentType';
import {
    countChanges,
    diffRevision
} from '../../../../../../domain/revisionDiff';
import { useRevisionDetail } from '../../../../../../application/useRevisionDetail';
import { REVISION_EXTRA_SLOT } from '../../../../../slots/contentSlots';
import {
    RevisionDiffRow,
    type DiffMediaRefs,
    type DiffRelationRefs
} from './RevisionDiffRow';
import { RevisionExtraRow } from './RevisionExtraRow';

const messages = defineMessages({
    title: {
        id: 'content.revisions.preview.title',
        defaultMessage: 'Version {n} preview'
    },
    subtitle: {
        id: 'content.revisions.preview.subtitle',
        defaultMessage: 'Compared against the current version.'
    },
    live: { id: 'content.revisions.live', defaultMessage: 'Live' },
    draft: { id: 'content.revisions.draft', defaultMessage: 'Draft' },
    superseded: {
        id: 'content.revisions.superseded',
        defaultMessage: 'Superseded'
    },
    loading: {
        id: 'content.revisions.preview.loading',
        defaultMessage: 'Loading this version…'
    },
    error: {
        id: 'content.revisions.preview.error',
        defaultMessage: 'Couldn’t load this version. Please try again.'
    },
    changedCount: {
        id: 'content.revisions.preview.changedCount',
        defaultMessage:
            '{count, plural, one {# field differs} other {# fields differ}} from the current version.'
    },
    identical: {
        id: 'content.revisions.preview.identical',
        defaultMessage: 'This version is identical to the current one.'
    },
    showUnchanged: {
        id: 'content.revisions.preview.showUnchanged',
        defaultMessage: 'Show {count} unchanged'
    },
    hideUnchanged: {
        id: 'content.revisions.preview.hideUnchanged',
        defaultMessage: 'Hide unchanged'
    },
    restore: {
        id: 'content.revisions.preview.restore',
        defaultMessage: 'Restore this version'
    },
    publish: {
        id: 'content.revisions.preview.publish',
        defaultMessage: 'Publish this version'
    },
    close: { id: 'content.revisions.preview.close', defaultMessage: 'Close' }
});

const STATUS_LABEL: Record<
    RevisionStatus,
    (typeof messages)[keyof typeof messages]
> = {
    published: messages.live,
    draft: messages.draft,
    superseded: messages.superseded
};

const STATUS_VARIANT: Record<
    RevisionStatus,
    'success' | 'secondary' | 'outline'
> = {
    published: 'success',
    draft: 'secondary',
    superseded: 'outline'
};

/**
 * The revision **preview / compare** dialog. Fetches the previewed version's
 * snapshot **and** the latest one (the live record — every save appends a
 * revision, so the newest snapshot equals the current content), diffs them field
 * by field, and shows what restoring this version would change: each changed
 * field as a Current → Version {n} pair, unchanged fields collapsed behind a
 * toggle. A **Restore this version** button hands back to the list's restore
 * flow (its own `ConfirmDialog`), so there's never a modal stacked on a modal.
 */
export function RevisionPreviewDialog({
    open,
    onOpenChange,
    typeName,
    entryId,
    schema,
    revision,
    latestNumber,
    canRestore,
    canPublish,
    onRestore,
    onPublish
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    typeName: string;
    entryId: string;
    schema: ContentTypeDetail;
    /** The version being previewed. */
    revision: RevisionSummary;
    /** The newest version's number — the diff baseline (the live record). */
    latestNumber: number;
    canRestore: boolean;
    /** Whether publishing is offered (publishable type + `content:publish`). */
    canPublish: boolean;
    /** Hand the restore back to the list (opens its confirm), then close. */
    onRestore: (number: number) => void;
    /** Hand the publish back to the list (opens its confirm), then close. */
    onPublish: (number: number) => void;
}) {
    const intl = useIntl();
    const [showUnchanged, setShowUnchanged] = useState(false);

    // Only fetch while the dialog is open (both hooks gate on a number).
    const selected = useRevisionDetail(
        typeName,
        open ? entryId : undefined,
        open ? revision.number : undefined
    );
    const latest = useRevisionDetail(
        typeName,
        open ? entryId : undefined,
        open ? latestNumber : undefined
    );

    const loading = selected.isLoading || latest.isLoading;
    const errored = selected.isError || latest.isError;
    const diff =
        selected.data && latest.data
            ? diffRevision(schema, latest.data.snapshot, selected.data.snapshot)
            : [];
    const changed = diff.filter((entry) => entry.changed);
    const unchanged = diff.filter((entry) => !entry.changed);

    // Plugin-owned state the two versions captured outside the values bag —
    // segments' audiences. A row is dropped only when **neither** side recorded
    // anything: with one side absent there is something to say, since restoring
    // the version that knows nothing leaves today's answer standing.
    const extras = REVISION_EXTRA_SLOT.getItems()
        .map((item) => {
            const current = latest.data?.snapshot.extra?.[item.key];
            const version = selected.data?.snapshot.extra?.[item.key];
            return {
                item,
                current,
                revision: version,
                // Structural, and decided here rather than by the item: a plugin
                // reporting its own row identical would let a restore change
                // something the dialog promised it would not.
                changed:
                    JSON.stringify(current ?? null) !==
                    JSON.stringify(version ?? null)
            };
        })
        .filter(
            (row) => row.current !== undefined || row.revision !== undefined
        );
    const changedExtras = extras.filter((row) => row.changed);
    const unchangedExtras = extras.filter((row) => !row.changed);
    const changedCount = countChanges(diff) + changedExtras.length;

    // A field's linked records per side: the baseline from the latest snapshot,
    // the previewed values from the selected one (both resolved server-side).
    const refsFor = (fieldName: string): DiffRelationRefs => ({
        current: latest.data?.relationRefs?.[fieldName],
        revision: selected.data?.relationRefs?.[fieldName],
        currentTotal: latest.data?.relationTotals?.[fieldName],
        revisionTotal: selected.data?.relationTotals?.[fieldName]
    });

    // The same, for media fields: each side's assets as the server resolved them
    // for that snapshot, so the row shows thumbnails and file names rather than
    // the asset uuids the values bag stores.
    const mediaFor = (fieldName: string): DiffMediaRefs => ({
        current: latest.data?.mediaRefs?.[fieldName],
        revision: selected.data?.mediaRefs?.[fieldName]
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {intl.formatMessage(messages.title, {
                            n: revision.number
                        })}
                        {/* Publishable types only — see `RevisionRow`. */}
                        {(schema.publishable ?? false) && (
                            <Badge variant={STATUS_VARIANT[revision.status]}>
                                {intl.formatMessage(
                                    STATUS_LABEL[revision.status]
                                )}
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.subtitle)}
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                        <Spinner />
                        {intl.formatMessage(messages.loading)}
                    </div>
                ) : errored ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                        {intl.formatMessage(messages.error)}
                    </p>
                ) : (
                    <div className="min-h-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-sm text-muted-foreground">
                                {changedCount === 0
                                    ? intl.formatMessage(messages.identical)
                                    : intl.formatMessage(
                                          messages.changedCount,
                                          {
                                              count: changedCount
                                          }
                                      )}
                            </p>
                            {unchanged.length + unchangedExtras.length > 0 && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                        setShowUnchanged((prev) => !prev)
                                    }
                                >
                                    {showUnchanged
                                        ? intl.formatMessage(
                                              messages.hideUnchanged
                                          )
                                        : intl.formatMessage(
                                              messages.showUnchanged,
                                              {
                                                  count:
                                                      unchanged.length +
                                                      unchangedExtras.length
                                              }
                                          )}
                                </Button>
                            )}
                        </div>
                        <div className="max-h-[55vh] divide-y divide-border/60 overflow-y-auto">
                            {changed.map((entry) => (
                                <RevisionDiffRow
                                    key={entry.field.name}
                                    diff={entry}
                                    revisionNumber={revision.number}
                                    refs={refsFor(entry.field.name)}
                                    media={mediaFor(entry.field.name)}
                                />
                            ))}
                            {changedExtras.map((row) => (
                                <RevisionExtraRow
                                    key={row.item.key}
                                    item={row.item}
                                    changed
                                    current={row.current}
                                    revision={row.revision}
                                    revisionNumber={revision.number}
                                />
                            ))}
                            {showUnchanged &&
                                unchanged.map((entry) => (
                                    <RevisionDiffRow
                                        key={entry.field.name}
                                        diff={entry}
                                        revisionNumber={revision.number}
                                        refs={refsFor(entry.field.name)}
                                        media={mediaFor(entry.field.name)}
                                    />
                                ))}
                            {showUnchanged &&
                                unchangedExtras.map((row) => (
                                    <RevisionExtraRow
                                        key={row.item.key}
                                        item={row.item}
                                        changed={false}
                                        current={row.current}
                                        revision={row.revision}
                                        revisionNumber={revision.number}
                                    />
                                ))}
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        {intl.formatMessage(messages.close)}
                    </Button>
                    {canRestore && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                                onRestore(revision.number);
                                onOpenChange(false);
                            }}
                        >
                            {intl.formatMessage(messages.restore)}
                        </Button>
                    )}
                    {canPublish && !revision.isPublished && (
                        <Button
                            type="button"
                            onClick={() => {
                                onPublish(revision.number);
                                onOpenChange(false);
                            }}
                        >
                            {intl.formatMessage(messages.publish)}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
