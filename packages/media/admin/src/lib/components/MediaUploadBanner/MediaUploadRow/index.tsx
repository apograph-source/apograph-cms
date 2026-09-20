import { defineMessages, useIntl } from 'react-intl';
import { Button, Progress, Spinner, cn } from '@orthacms/design-system';
import { AlertCircle, Check, RotateCcw, X } from 'lucide-react';
import { UPLOAD_STATUS } from '../../../constants';
import type { UploadItem } from '../../../types/upload';
import { formatBytes } from '../../../utils/formatBytes';

/** Intl descriptors for {@link MediaUploadRow}, co-located. */
const messages = defineMessages({
    waiting: { id: 'media.uploadRow.waiting', defaultMessage: 'Waiting…' },
    done: { id: 'media.uploadRow.done', defaultMessage: 'Uploaded' },
    cancelled: { id: 'media.uploadRow.cancelled', defaultMessage: 'Cancelled' },
    percent: { id: 'media.uploadRow.percent', defaultMessage: '{percent}%' },
    progressLabel: {
        id: 'media.uploadRow.progressLabel',
        defaultMessage: 'Upload progress for {name}'
    },
    retry: { id: 'media.uploadRow.retry', defaultMessage: 'Retry {name}' },
    cancel: { id: 'media.uploadRow.cancel', defaultMessage: 'Cancel {name}' }
});

/**
 * One file's row in the upload banner: its name and size, a right-hand status
 * (a live percentage, a tick, or the failure reason), and — while it is running
 * — a thin progress bar. A failed or cancelled row offers **Retry**; a pending
 * or in-flight one offers **Cancel**. A settled row offers neither, so the
 * control column doesn't flicker as the batch drains.
 */
export function MediaUploadRow({
    item,
    onRetry,
    onCancel
}: {
    item: UploadItem;
    onRetry: (id: string) => void;
    onCancel: (id: string) => void;
}) {
    const intl = useIntl();
    const isFailed = item.status === UPLOAD_STATUS.Failed;
    const isDone = item.status === UPLOAD_STATUS.Done;
    const isCancelled = item.status === UPLOAD_STATUS.Cancelled;
    const isUploading = item.status === UPLOAD_STATUS.Uploading;
    const isPending = item.status === UPLOAD_STATUS.Pending;

    return (
        <li className="flex flex-col gap-1 py-1.5">
            <div className="flex items-center gap-2 text-sm">
                {isDone ? (
                    <Check
                        className="size-4 shrink-0 text-primary"
                        aria-hidden
                    />
                ) : isFailed ? (
                    <AlertCircle
                        className="size-4 shrink-0 text-destructive"
                        aria-hidden
                    />
                ) : isUploading ? (
                    <Spinner className="size-4 shrink-0" aria-hidden />
                ) : (
                    <span className="size-4 shrink-0" aria-hidden />
                )}

                <span
                    className={cn(
                        'min-w-0 flex-1 truncate',
                        isCancelled && 'text-muted-foreground line-through'
                    )}
                >
                    {item.name}
                </span>

                <span
                    className={cn(
                        'shrink-0 text-xs tabular-nums text-muted-foreground',
                        isFailed && 'text-destructive'
                    )}
                >
                    {isFailed
                        ? (item.error ?? formatBytes(item.size))
                        : isDone
                          ? intl.formatMessage(messages.done)
                          : isCancelled
                            ? intl.formatMessage(messages.cancelled)
                            : isPending
                              ? intl.formatMessage(messages.waiting)
                              : intl.formatMessage(messages.percent, {
                                    percent: item.progress
                                })}
                </span>

                {isFailed || isCancelled ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 shadow-none"
                        aria-label={intl.formatMessage(messages.retry, {
                            name: item.name
                        })}
                        onClick={() => onRetry(item.id)}
                    >
                        <RotateCcw aria-hidden />
                    </Button>
                ) : isDone ? null : (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 shadow-none"
                        aria-label={intl.formatMessage(messages.cancel, {
                            name: item.name
                        })}
                        onClick={() => onCancel(item.id)}
                    >
                        <X aria-hidden />
                    </Button>
                )}
            </div>

            {isUploading ? (
                <Progress
                    value={item.progress}
                    className="h-1"
                    aria-label={intl.formatMessage(messages.progressLabel, {
                        name: item.name
                    })}
                />
            ) : null}
        </li>
    );
}
