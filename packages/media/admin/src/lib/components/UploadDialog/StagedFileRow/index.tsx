import { useEffect, useId, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Button, InputField } from '@orthacms/design-system';
import { FileText, Film, Music, Package, X } from 'lucide-react';
import { formatBytes } from '../../../utils/formatBytes';

/** Intl descriptors for {@link StagedFileRow}, co-located. */
const messages = defineMessages({
    remove: { id: 'media.upload.removeFile', defaultMessage: 'Remove {name}' },
    altLabel: { id: 'media.upload.altLabel', defaultMessage: 'Alt text' },
    /**
     * The accessible name, which repeats the file so a run of staged rows isn't
     * five identically-named inputs. It **contains** the visible label, which is
     * what WCAG 2.5.3 (Label in Name) asks for.
     */
    altLabelFor: {
        id: 'media.upload.altLabelFor',
        defaultMessage: 'Alt text for {name}'
    },
    altPlaceholder: {
        id: 'media.upload.altPlaceholder',
        defaultMessage: 'Describe this image'
    },
    altHint: {
        id: 'media.upload.altHint',
        defaultMessage:
            'Optional. Leave blank only if the image is decorative — you can add it later from the asset’s details.'
    }
});

/**
 * The glyph shown for a non-image file, chosen from its MIME type. Deliberately
 * a **local** coarse mapping and not a shared `kindFromMime`: the server owns
 * the real classification (it's what ends up on the row), and this only has to
 * pick an icon for a file that hasn't been uploaded yet.
 */
function glyphFor(type: string) {
    if (type.startsWith('video/')) return Film;
    if (type.startsWith('audio/')) return Music;
    if (
        type === 'application/zip' ||
        type === 'application/x-tar' ||
        type === 'application/gzip'
    ) {
        return Package;
    }
    return FileText;
}

/**
 * One staged (not yet uploaded) file in the upload dialog: a real thumbnail for
 * an image, a kind glyph for anything else, the name + size, a remove button,
 * and — when the caller collects it — an **Alt text** input for an image.
 *
 * Alt is asked for *here* rather than left to a later edit because this is the
 * one moment the author is looking at the picture. The field is optional and
 * never blocks the upload: an author who skips it lands where they landed
 * before, and can still describe the asset from its detail drawer.
 *
 * The thumbnail is an **object URL** over the local `File` — no upload, no
 * network. It is revoked when the row unmounts or the file changes; skipping
 * that leaks the whole blob for the tab's lifetime, which matters when someone
 * stages a few hundred megabytes of video and then removes it.
 */
export function StagedFileRow({
    file,
    alt = '',
    collectAlt = false,
    onAltChange,
    onRemove
}: {
    file: File;
    /** Current alt text for this staged file. */
    alt?: string;
    /** Renders the alt input (images only); off for callers that drop it. */
    collectAlt?: boolean;
    onAltChange?: (alt: string) => void;
    onRemove: () => void;
}) {
    const intl = useIntl();
    const altId = useId();
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const isImage = file.type.startsWith('image/');

    useEffect(() => {
        if (!isImage) {
            setPreviewUrl(null);
            return;
        }
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file, isImage]);

    const Glyph = glyphFor(file.type);

    return (
        <li className="flex flex-col gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
            <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            alt=""
                            className="size-full object-cover"
                        />
                    ) : (
                        <Glyph
                            className="size-4 text-muted-foreground"
                            aria-hidden
                        />
                    )}
                </span>

                <span className="min-w-0 flex-1 truncate">{file.name}</span>

                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatBytes(file.size)}
                </span>

                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 shadow-none"
                    aria-label={intl.formatMessage(messages.remove, {
                        name: file.name
                    })}
                    onClick={onRemove}
                >
                    <X aria-hidden />
                </Button>
            </div>

            {collectAlt && isImage ? (
                <InputField
                    id={`staged-alt-${altId}`}
                    label={intl.formatMessage(messages.altLabel)}
                    aria-label={intl.formatMessage(messages.altLabelFor, {
                        name: file.name
                    })}
                    description={intl.formatMessage(messages.altHint)}
                    placeholder={intl.formatMessage(messages.altPlaceholder)}
                    value={alt}
                    maxLength={1000}
                    onChange={(event) => onAltChange?.(event.target.value)}
                    fieldClassName="gap-1"
                    className="h-8 text-sm"
                />
            ) : null}
        </li>
    );
}
