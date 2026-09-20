import { useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Button, Progress } from '@orthacms/design-system';
import { UploadCloud, X } from 'lucide-react';
import { UPLOAD_STATUS } from '../../constants';
import type { UploadItem, UploadSummary } from '../../types/upload';
import { MediaUploadRow } from './MediaUploadRow';

/** Intl descriptors for {@link MediaUploadBanner}, co-located. */
const messages = defineMessages({
    region: { id: 'media.uploadBanner.region', defaultMessage: 'Uploads' },
    uploading: {
        id: 'media.uploadBanner.uploading',
        defaultMessage: 'Uploading {done} of {total} · {percent}%'
    },
    complete: {
        id: 'media.uploadBanner.complete',
        defaultMessage:
            '{count, plural, one {# file uploaded} other {# files uploaded}}'
    },
    someFailed: {
        id: 'media.uploadBanner.someFailed',
        defaultMessage:
            '{done, plural, one {# file uploaded} other {# files uploaded}}, {failed} failed'
    },
    allFailed: {
        id: 'media.uploadBanner.allFailed',
        defaultMessage:
            '{failed, plural, one {# upload failed} other {# uploads failed}}'
    },
    overall: {
        id: 'media.uploadBanner.overall',
        defaultMessage: 'Overall upload progress'
    },
    dismiss: { id: 'media.uploadBanner.dismiss', defaultMessage: 'Dismiss' },
    /** Announced when one file in a batch fails — the row itself is silent. */
    failureAnnouncement: {
        id: 'media.uploadBanner.failureAnnouncement',
        defaultMessage: '{name} failed to upload. {reason}'
    }
});

/**
 * The upload progress banner — the batch headline ("Uploading 3 of 5 · 47%"), an
 * overall size-weighted bar while anything is running, and one
 * {@link MediaUploadRow} per file. It sits above the browser rather than inside
 * the upload dialog, so the dialog can close on submit and the user keeps
 * browsing (and can queue more) while bytes move.
 *
 * `role="status"` sits on the **headline alone**, not the whole banner: a polite
 * live region re-announces its entire contents on every change, so wrapping the
 * file list would read all N rows aloud on each progress tick. Scoped to the
 * headline, a screen-reader user hears "Uploading 3 of 5 · 47%" and then the
 * completion, while per-file detail stays available to read on demand.
 *
 * Renders nothing when the queue is empty.
 */
export function MediaUploadBanner({
    items,
    summary,
    onRetry,
    onCancel,
    onDismiss
}: {
    items: UploadItem[];
    summary: UploadSummary;
    onRetry: (id: string) => void;
    onCancel: (id: string) => void;
    onDismiss: () => void;
}) {
    const intl = useIntl();

    // Failures are announced from their own region. The headline's counts move
    // when a file fails, but "3 of 5" never says *which* file or why — and the
    // rows carrying that sentence sit outside the live region on purpose (a
    // polite region over the list would re-read all N rows on every progress
    // tick). One line per newly-failed file is the middle ground.
    const announcedRef = useRef(new Set<string>());
    const [failureNotice, setFailureNotice] = useState('');
    useEffect(() => {
        const announced = announcedRef.current;
        const fresh = items.filter(
            (item) =>
                item.status === UPLOAD_STATUS.Failed && !announced.has(item.id)
        );
        // A retry can fail again, so a row leaving `Failed` becomes announceable
        // once more.
        for (const item of items) {
            if (item.status !== UPLOAD_STATUS.Failed) announced.delete(item.id);
        }
        if (fresh.length === 0) return;
        for (const item of fresh) announced.add(item.id);
        setFailureNotice(
            fresh
                .map((item) =>
                    intl.formatMessage(messages.failureAnnouncement, {
                        name: item.name,
                        reason: item.error ?? ''
                    })
                )
                .join(' ')
        );
    }, [items, intl]);

    if (items.length === 0) return null;

    const headline = summary.active
        ? intl.formatMessage(messages.uploading, {
              done: summary.done,
              total: summary.total,
              percent: summary.percent
          })
        : summary.failed > 0 && summary.done > 0
          ? intl.formatMessage(messages.someFailed, {
                done: summary.done,
                failed: summary.failed
            })
          : summary.failed > 0
            ? intl.formatMessage(messages.allFailed, { failed: summary.failed })
            : intl.formatMessage(messages.complete, { count: summary.done });

    return (
        <section
            aria-label={intl.formatMessage(messages.region)}
            className="mb-4 rounded-xl border bg-muted/40 px-4 py-3"
        >
            <div className="flex items-center gap-2">
                <UploadCloud
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                />
                <p className="min-w-0 flex-1 text-sm font-medium" role="status">
                    {headline}
                </p>
                {/* Dismiss only once the batch is over — clearing mid-flight
                    would hide rows that are still uploading. */}
                {summary.active ? null : (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 shadow-none"
                        aria-label={intl.formatMessage(messages.dismiss)}
                        onClick={onDismiss}
                    >
                        <X aria-hidden />
                    </Button>
                )}
            </div>

            {summary.active ? (
                <Progress
                    value={summary.percent}
                    className="mt-2 h-1.5"
                    aria-label={intl.formatMessage(messages.overall)}
                />
            ) : null}

            <p className="sr-only" role="status">
                {failureNotice}
            </p>

            <ul className="mt-1 max-h-48 divide-y overflow-auto">
                {items.map((item) => (
                    <MediaUploadRow
                        key={item.id}
                        item={item}
                        onRetry={onRetry}
                        onCancel={onCancel}
                    />
                ))}
            </ul>
        </section>
    );
}
