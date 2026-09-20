import { useEffect, useId, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { TriangleAlert, Type } from 'lucide-react';
import {
    Button,
    Checkbox,
    Input,
    Label,
    Popover,
    PopoverContent,
    PopoverTrigger,
    cn
} from '@orthacms/design-system';

const messages = defineMessages({
    edit: { id: 'wysiwyg.alt.edit', defaultMessage: 'Alt text' },
    missing: { id: 'wysiwyg.alt.missing', defaultMessage: 'Add alt text' },
    missingTitle: {
        id: 'wysiwyg.alt.missingTitle',
        defaultMessage: 'This image has no alt text'
    },
    field: { id: 'wysiwyg.alt.field', defaultMessage: 'Describe this image' },
    hint: {
        id: 'wysiwyg.alt.hint',
        defaultMessage:
            'What the image shows, for readers who can’t see it. Skip “image of…” — it’s already announced as one.'
    },
    decorative: {
        id: 'wysiwyg.alt.decorative',
        defaultMessage: 'Decorative — it carries no information'
    },
    decorativeHint: {
        id: 'wysiwyg.alt.decorativeHint',
        defaultMessage:
            'Screen readers will skip it entirely. Use this for borders, spacers, and pure ornament.'
    },
    save: { id: 'wysiwyg.alt.save', defaultMessage: 'Save' }
});

/**
 * The alt-text editor for one image, opened from the image itself.
 *
 * Alt is a **content** decision — it is published, and it is the difference
 * between an image that works for a screen-reader user and one that doesn't —
 * so it can't live only on the insert dialogs. An uploaded file arrives with no
 * alt at all, and a library asset arrives with whatever alt the library had; in
 * both cases the place the author realises what the picture is *for* is here,
 * in the body, with the surrounding text on screen.
 *
 * The trigger doubles as the **prompt**: an image with neither alt nor a
 * decorative mark shows a warning-tinted "Add alt text" chip, so the defect is
 * visible while writing rather than discovered in an audit.
 *
 * ### Why "decorative" is a checkbox and not just an empty box
 *
 * `alt=""` is HTML's way of saying an image carries no information, but on its
 * own it is indistinguishable from "nobody has written this yet" — and those
 * want opposite treatment. Ticking the box records the decision (see the node's
 * `decorative` attribute) so the prompt stops asking, and empties the alt,
 * because a screen reader would otherwise announce the text sitting behind a
 * ticked box.
 */
export function AltTextPopover({
    alt,
    decorative,
    onSave
}: {
    alt: string;
    decorative: boolean;
    onSave: (next: { alt: string; decorative: boolean }) => void;
}) {
    const intl = useIntl();
    const inputId = useId();
    const hintId = useId();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(alt);
    const [isDecorative, setIsDecorative] = useState(decorative);

    // Reseed from the node each time it opens, so an abandoned edit doesn't
    // linger as the next opening's starting point.
    useEffect(() => {
        if (open) {
            setDraft(alt);
            setIsDecorative(decorative);
        }
    }, [open, alt, decorative]);

    const needsAlt = !alt && !decorative;

    const save = () => {
        onSave({ alt: draft.trim(), decorative: isDecorative });
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    title={
                        needsAlt
                            ? intl.formatMessage(messages.missingTitle)
                            : undefined
                    }
                    className={cn(
                        'h-6 gap-1 px-1.5 text-xs',
                        needsAlt &&
                            'border-warning bg-warning-soft text-warning-soft-foreground'
                    )}
                    // Keep the node selected: without this the mousedown moves
                    // focus out of ProseMirror and the image deselects, taking
                    // this control with it before the click lands.
                    onMouseDown={(event) => event.preventDefault()}
                >
                    {needsAlt ? (
                        <TriangleAlert className="size-3" />
                    ) : (
                        <Type className="size-3" />
                    )}
                    {intl.formatMessage(
                        needsAlt ? messages.missing : messages.edit
                    )}
                </Button>
            </PopoverTrigger>

            <PopoverContent align="start" className="w-80">
                <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        // Stop the submit here. This form is portalled in the
                        // DOM but still sits inside the entry editor's `<form>`
                        // in the **React tree**, and React bubbles synthetic
                        // events along that tree — so without this, saving a
                        // URL/alt submitted the whole record (publishing it, on
                        // a publishable type).
                        event.stopPropagation();
                        save();
                    }}
                >
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={inputId}>
                            {intl.formatMessage(messages.field)}
                        </Label>
                        <Input
                            id={inputId}
                            value={draft}
                            autoFocus
                            // A decorative image has nothing to describe; the
                            // box is disabled rather than hidden so the two
                            // choices stay visible as one decision.
                            disabled={isDecorative}
                            aria-describedby={hintId}
                            onChange={(event) => setDraft(event.target.value)}
                        />
                        <p
                            id={hintId}
                            className="text-xs text-muted-foreground"
                        >
                            {intl.formatMessage(messages.hint)}
                        </p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id={`${inputId}-decorative`}
                                checked={isDecorative}
                                onCheckedChange={(checked) =>
                                    setIsDecorative(checked === true)
                                }
                            />
                            <Label
                                htmlFor={`${inputId}-decorative`}
                                className="text-sm font-normal"
                            >
                                {intl.formatMessage(messages.decorative)}
                            </Label>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {intl.formatMessage(messages.decorativeHint)}
                        </p>
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" size="sm">
                            {intl.formatMessage(messages.save)}
                        </Button>
                    </div>
                </form>
            </PopoverContent>
        </Popover>
    );
}
