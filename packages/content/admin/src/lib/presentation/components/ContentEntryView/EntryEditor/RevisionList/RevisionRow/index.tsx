import { defineMessages, useIntl } from 'react-intl';
import { GitCompare, Rocket } from 'lucide-react';
import { Badge, Button } from '@orthacms/design-system';
import type {
    RevisionStatus,
    RevisionSummary
} from '../../../../../../domain/types/contentType';

const messages = defineMessages({
    version: { id: 'content.revisions.version', defaultMessage: 'v{n}' },
    live: { id: 'content.revisions.live', defaultMessage: 'Live' },
    draft: { id: 'content.revisions.draft', defaultMessage: 'Draft' },
    superseded: {
        id: 'content.revisions.superseded',
        defaultMessage: 'Superseded'
    },
    current: { id: 'content.revisions.current', defaultMessage: 'Current' },
    restore: { id: 'content.revisions.restore', defaultMessage: 'Restore' },
    restoreLabel: {
        id: 'content.revisions.restoreLabel',
        defaultMessage: 'Restore version {n}'
    },
    preview: { id: 'content.revisions.preview', defaultMessage: 'Preview' },
    previewLabel: {
        id: 'content.revisions.previewLabel',
        defaultMessage: 'Preview version {n}'
    },
    publish: {
        id: 'content.revisions.publishAction',
        defaultMessage: 'Publish'
    },
    publishLabel: {
        id: 'content.revisions.publishActionLabel',
        defaultMessage: 'Publish version {n}'
    }
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
 * One revision in the timeline: its version number, a status badge (Live / Draft
 * / Superseded), the capture time, and its actions. **Preview** and **Restore**
 * apply to any earlier version (the newest is `Current`, nothing to compare/apply
 * against). **Publish** appears on any version that isn't already the live one
 * (publishable types, with permission) — it makes that version live.
 */
export function RevisionRow({
    revision,
    canUpdate,
    canPublish,
    publishable,
    busy,
    onRestore,
    onPublish,
    onPreview
}: {
    revision: RevisionSummary;
    canUpdate: boolean;
    canPublish: boolean;
    /** Whether the content type is publishable (else there's no publish action). */
    publishable: boolean;
    busy: boolean;
    onRestore: (number: number) => void;
    /** Publish this version live. */
    onPublish: (number: number) => void;
    /** Open the compare-against-current preview for this version. */
    onPreview: (number: number) => void;
}) {
    const intl = useIntl();
    // Preview / Restore compare/apply against the current (latest) version, so a
    // no-op on the newest row. Publish is offered on any version that isn't the
    // live one — including the latest draft (make it live).
    const showPreview = !revision.isLatest;
    const showRestore = canUpdate && !revision.isLatest;
    const showPublish = publishable && canPublish && !revision.isPublished;
    const showCluster = showPreview || showRestore || showPublish;
    const previewLabel = intl.formatMessage(messages.previewLabel, {
        n: revision.number
    });
    const restoreLabel = intl.formatMessage(messages.restoreLabel, {
        n: revision.number
    });
    const publishLabel = intl.formatMessage(messages.publishLabel, {
        n: revision.number
    });

    return (
        <div className="flex items-center gap-3 py-2">
            <span className="w-10 shrink-0 font-mono text-sm font-semibold tabular-nums">
                {intl.formatMessage(messages.version, { n: revision.number })}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                    {/* Live / Draft / Superseded describe a publish workflow.
                        On an always-live type there isn't one — every version
                        was simply saved — so the badge would label a state the
                        type doesn't have. "Current" still means something and
                        stays. */}
                    {publishable && (
                        <Badge variant={STATUS_VARIANT[revision.status]}>
                            {intl.formatMessage(STATUS_LABEL[revision.status])}
                        </Badge>
                    )}
                    {revision.isLatest && (
                        <span className="text-xs text-muted-foreground">
                            {intl.formatMessage(messages.current)}
                        </span>
                    )}
                </div>
                <time
                    dateTime={revision.createdAt}
                    className="text-xs text-muted-foreground"
                >
                    {intl.formatDate(revision.createdAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                    })}
                </time>
            </div>
            {showCluster && (
                <div className="flex shrink-0 items-center gap-1">
                    {showPreview && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={previewLabel}
                            onClick={() => onPreview(revision.number)}
                        >
                            <GitCompare aria-hidden />
                            {intl.formatMessage(messages.preview)}
                        </Button>
                    )}
                    {showPublish && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label={publishLabel}
                            onClick={() => onPublish(revision.number)}
                        >
                            <Rocket aria-hidden />
                            {intl.formatMessage(messages.publish)}
                        </Button>
                    )}
                    {showRestore && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            aria-label={restoreLabel}
                            onClick={() => onRestore(revision.number)}
                        >
                            {intl.formatMessage(messages.restore)}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
