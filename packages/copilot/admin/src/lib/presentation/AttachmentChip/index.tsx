import { defineMessages, useIntl } from 'react-intl';
import {
    FileArchive,
    FileAudio,
    FileText,
    FileVideo,
    Image as ImageIcon,
    Loader2,
    TriangleAlert,
    X
} from 'lucide-react';
import { Button, cn } from '@orthacms/design-system';

const messages = defineMessages({
    remove: {
        id: 'copilot.attachment.remove',
        defaultMessage: 'Remove {name}'
    },
    uploading: {
        id: 'copilot.attachment.uploading',
        defaultMessage: 'Uploading {name}, {progress}%'
    },
    failed: {
        id: 'copilot.attachment.failed',
        defaultMessage: 'Upload failed'
    }
});

/** Media kind → the icon that reads as that kind at 14px. */
const ICONS: Record<string, typeof FileText> = {
    image: ImageIcon,
    video: FileVideo,
    audio: FileAudio,
    archive: FileArchive,
    document: FileText
};

export interface AttachmentChipProps {
    /** The file's name. */
    name: string;
    /** Size in bytes, shown once the upload has landed. */
    size?: number;
    /** The media kind, choosing the icon. Defaults to the document icon. */
    kind?: string;
    /** Upload progress 0–100, while one is in flight. */
    progress?: number;
    /** Renders the spinner and the progress bar. */
    uploading?: boolean;
    /** Renders the failure state, with {@link error} as its title. */
    failed?: boolean;
    /** Why the upload failed. */
    error?: string;
    /** Shows a remove control. Omit in the transcript, where nothing is removable. */
    onRemove?(): void;
    /** Where the file lives, making the chip a link once it is uploaded. */
    href?: string;
}

/**
 * One attached file, in the composer while it uploads and in the transcript
 * afterwards.
 *
 * Deliberately the **same** component in both places. An attachment does not
 * change once sent — it is the same file, with the same name and the same
 * icon — and two components would be two chances for the staged chip and the
 * sent one to drift into looking like different things.
 */
export function AttachmentChip({
    name,
    size,
    kind,
    progress = 0,
    uploading,
    failed,
    error,
    onRemove,
    href
}: AttachmentChipProps) {
    const intl = useIntl();
    const Icon = (kind && ICONS[kind]) || FileText;

    const body = (
        <>
            {uploading ? (
                <Loader2 className="size-3.5 shrink-0 ds-spinner" />
            ) : failed ? (
                <TriangleAlert className="size-3.5 shrink-0" />
            ) : (
                <Icon className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 truncate">{name}</span>
            {failed ? (
                <span className="shrink-0 text-[11px]">
                    {intl.formatMessage(messages.failed)}
                </span>
            ) : size !== undefined && !uploading ? (
                <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                    {formatSize(size)}
                </span>
            ) : null}
        </>
    );

    return (
        <div
            className={cn(
                'bg-muted/60 border-border/60 relative flex max-w-56 items-center gap-1.5 overflow-hidden rounded-md border px-2 py-1 text-xs',
                failed && 'border-destructive/40 text-destructive'
            )}
            // The failure reason as a title rather than a second line: a chip
            // that grows when an upload fails reflows the whole composer.
            title={failed ? error : name}
        >
            {href && !uploading && !failed ? (
                <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 items-center gap-1.5 hover:underline"
                >
                    {body}
                </a>
            ) : (
                <span
                    className="flex min-w-0 items-center gap-1.5"
                    // The chip's own text already names the file; this makes a
                    // screen reader announce the state too, which the spinner
                    // and the bar convey only visually.
                    aria-label={
                        uploading
                            ? intl.formatMessage(messages.uploading, {
                                  name,
                                  progress
                              })
                            : undefined
                    }
                >
                    {body}
                </span>
            )}

            {onRemove ? (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-4 shrink-0 rounded-sm"
                    onClick={onRemove}
                    aria-label={intl.formatMessage(messages.remove, { name })}
                >
                    <X className="size-3" />
                </Button>
            ) : null}

            {uploading ? (
                // A hairline along the bottom edge rather than a separate bar:
                // the chip is 24px tall, and anything taller turns a row of
                // four staged files into a block that pushes the field around.
                <span
                    className="bg-primary absolute bottom-0 left-0 h-0.5 transition-[width]"
                    style={{ width: `${progress}%` }}
                    aria-hidden="true"
                />
            ) : null}
        </div>
    );
}

/** Bytes as something a person reads — 1 decimal place, no trailing `.0`. */
function formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
    return `${rounded}${units[unit]}`;
}
