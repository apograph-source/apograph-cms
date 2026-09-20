import { useEffect, useId, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label
} from '@orthacms/design-system';
import {
    WYSIWYG_MEDIA_KIND,
    type WysiwygMediaKind
} from '../../../../domain/constants';
import { isSafeMediaSrc } from '../../../../domain/mediaSrc';
import type { WysiwygMediaEmbed } from '../../../slots/wysiwygSlots';

const messages = defineMessages({
    imageTitle: {
        id: 'wysiwyg.mediaUrl.imageTitle',
        defaultMessage: 'Image from a URL'
    },
    videoTitle: {
        id: 'wysiwyg.mediaUrl.videoTitle',
        defaultMessage: 'Video from a URL'
    },
    description: {
        id: 'wysiwyg.mediaUrl.description',
        defaultMessage:
            'The file stays where it is — nothing is copied into the Media Library.'
    },
    url: { id: 'wysiwyg.mediaUrl.url', defaultMessage: 'URL' },
    urlPlaceholder: {
        id: 'wysiwyg.mediaUrl.urlPlaceholder',
        defaultMessage: 'https://example.com/photo.jpg'
    },
    alt: { id: 'wysiwyg.mediaUrl.alt', defaultMessage: 'Alt text' },
    altHint: {
        id: 'wysiwyg.mediaUrl.altHint',
        defaultMessage: 'What the image shows, for readers who can’t see it.'
    },
    invalid: {
        id: 'wysiwyg.mediaUrl.invalid',
        defaultMessage: 'Enter an http(s) address or a path beginning with “/”.'
    },
    cancel: { id: 'wysiwyg.mediaUrl.cancel', defaultMessage: 'Cancel' },
    insert: { id: 'wysiwyg.mediaUrl.insert', defaultMessage: 'Insert' }
});

/**
 * The editor's own media source: name a file that already lives somewhere.
 *
 * Built in rather than contributed, because it needs nothing — no library, no
 * upload endpoint, no plugin. It is what keeps an install with no media plugin
 * able to put a picture in a body at all, and it is the honest answer for an
 * asset that genuinely lives elsewhere (a CDN, a partner's site).
 *
 * The URL is checked here **and** by the node on insert. This check exists to
 * tell the author *why* nothing happened; the node's is the one that protects
 * the stored content.
 */
export function MediaUrlDialog({
    open,
    onOpenChange,
    kind,
    onInsert
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Which node the dialog is naming a source for. */
    kind: WysiwygMediaKind;
    onInsert: (embeds: WysiwygMediaEmbed[]) => void;
}) {
    const intl = useIntl();
    const urlId = useId();
    const altId = useId();
    const [url, setUrl] = useState('');
    const [alt, setAlt] = useState('');
    const [touched, setTouched] = useState(false);

    const isImage = kind === WYSIWYG_MEDIA_KIND.Image;

    // Reset per opening: a dialog that reopens holding the last URL invites
    // inserting the same file twice by accident.
    useEffect(() => {
        if (open) {
            setUrl('');
            setAlt('');
            setTouched(false);
        }
    }, [open]);

    const valid = isSafeMediaSrc(url);

    const submit = () => {
        setTouched(true);
        if (!valid) return;
        onInsert([
            { kind, src: url.trim(), ...(isImage && alt ? { alt } : {}) }
        ]);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(
                            isImage ? messages.imageTitle : messages.videoTitle
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description)}
                    </DialogDescription>
                </DialogHeader>

                <form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        // Stop the submit here. This form is portalled in the
                        // DOM but still sits inside the entry editor's `<form>`
                        // in the **React tree**, and React bubbles synthetic
                        // events along that tree — so without this, saving a
                        // URL/alt submitted the whole record (publishing it, on
                        // a publishable type).
                        event.stopPropagation();
                        submit();
                    }}
                >
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={urlId}>
                            {intl.formatMessage(messages.url)}
                        </Label>
                        <Input
                            id={urlId}
                            value={url}
                            autoFocus
                            aria-invalid={touched && !valid}
                            aria-describedby={
                                touched && !valid ? `${urlId}-error` : undefined
                            }
                            placeholder={intl.formatMessage(
                                messages.urlPlaceholder
                            )}
                            onChange={(event) => setUrl(event.target.value)}
                        />
                        {touched && !valid ? (
                            <p
                                id={`${urlId}-error`}
                                role="alert"
                                className="text-sm text-destructive"
                            >
                                {intl.formatMessage(messages.invalid)}
                            </p>
                        ) : null}
                    </div>

                    {isImage ? (
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor={altId}>
                                {intl.formatMessage(messages.alt)}
                            </Label>
                            <Input
                                id={altId}
                                value={alt}
                                aria-describedby={`${altId}-hint`}
                                onChange={(event) => setAlt(event.target.value)}
                            />
                            <p
                                id={`${altId}-hint`}
                                className="text-xs text-muted-foreground"
                            >
                                {intl.formatMessage(messages.altHint)}
                            </p>
                        </div>
                    ) : null}

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                        >
                            {intl.formatMessage(messages.cancel)}
                        </Button>
                        <Button type="submit">
                            {intl.formatMessage(messages.insert)}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
