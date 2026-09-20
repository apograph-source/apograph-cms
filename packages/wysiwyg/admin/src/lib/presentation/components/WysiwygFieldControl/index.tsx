import { defineMessages, useIntl } from 'react-intl';
import { Eye, Pencil } from 'lucide-react';
import { cn } from '@orthacms/design-system';
import type { EntryFieldControlContext } from '@orthacms/content-admin';
import { isEmptyRichText } from '../../../domain/richTextValue';
import { WysiwygPreview } from '../WysiwygPreview';

const messages = defineMessages({
    edit: {
        id: 'wysiwyg.field.edit',
        defaultMessage: 'Edit {label}'
    },
    editChip: {
        id: 'wysiwyg.field.editChip',
        defaultMessage: 'Edit'
    },
    view: {
        id: 'wysiwyg.field.view',
        defaultMessage: 'View {label}'
    },
    viewChip: {
        id: 'wysiwyg.field.viewChip',
        defaultMessage: 'View'
    },
    empty: {
        id: 'wysiwyg.field.empty',
        defaultMessage: 'Nothing written yet — press Edit to start.'
    },
    emptyReadOnly: {
        id: 'wysiwyg.field.emptyReadOnly',
        defaultMessage: 'Nothing written yet.'
    }
});

/**
 * The collapsed field's height band.
 *
 * The floor matters as much as the ceiling. A body field that shrink-wraps a
 * one-line excerpt — or, empty, a single line of placeholder — reads as a minor
 * input squeezed between the record's text boxes, when it is the field the page
 * is actually about. The floor gives it the presence of a long-form control
 * (comfortably more than the `rows={4}` textarea it replaced) whether or not
 * anything is written yet; the ceiling stops a long body from pushing the rest
 * of the form off the screen.
 */
const PREVIEW_MIN = 'min-h-40';
const PREVIEW_CLAMP = 'max-h-72';

/**
 * A `richtext` field, in the entry form: what's been written, shown as it will
 * read, opening into the full editor when pressed.
 *
 * The preview is the control's whole point. A rich-text body rendered into a
 * `<textarea>` is a wall of tags nobody can proofread, so the field shows the
 * *content* and keeps the authoring surface behind a deliberate press.
 *
 * Pressing it **expands the field into the work area** (`WysiwygFieldFullView`)
 * rather than opening a dialog over the form — so the record, its Save action,
 * and the Properties rail all stay where they were. The control owns none of
 * that: it asks, `EntryEditor` swaps the view.
 *
 * ### Why the button overlays the preview instead of wrapping it
 *
 * Wrapping formatted content in a `<button>` puts headings, lists, and tables
 * inside a control — invalid, and it flattens the whole body into the button's
 * accessible name. Instead the preview renders as ordinary content and a
 * transparent button is laid over it, so the two are siblings: assistive tech
 * reads the content, then offers one clearly-named action, and a pointer
 * anywhere on the card still opens the editor. That only holds because
 * `renderRichText` leaves no focusable elements in the preview — otherwise the
 * links underneath would be tab stops hidden beneath a button.
 *
 * ### Read-only
 *
 * The expansion is kept, and only renamed — "View" rather than "Edit". A body
 * is the one field the collapsed row genuinely cannot show in full (the preview
 * is height-clamped, with a fade where it's cut), so removing the way in would
 * leave a reader with permission to read the record unable to read the part of
 * it that matters most. What it expands into is the same view with its toolbar
 * gone and its document inert (`WysiwygEditorPanel`'s `readOnly`).
 */
export function WysiwygFieldControl({
    field,
    id,
    label,
    value,
    error,
    describedBy,
    readOnly,
    setExpanded
}: EntryFieldControlContext) {
    const intl = useIntl();
    const placeholder = field.admin['placeholder'];
    const empty = isEmptyRichText(value);

    return (
        <div
            className={cn(
                'relative rounded-lg border border-input bg-card',
                PREVIEW_MIN,
                // The ring follows the overlay button, so the card reads as
                // one focusable control rather than the button reading as a
                // second thing floating on top of it.
                'has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring/40',
                error && 'border-destructive'
            )}
        >
            {empty ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                    {/* The placeholder is written *at an author* ("Tell the
                        story…"), so a reader who can't write gets the plain
                        statement of fact instead — and never the default's
                        "press Edit to start", which names an action they
                        don't have. */}
                    {readOnly
                        ? intl.formatMessage(messages.emptyReadOnly)
                        : typeof placeholder === 'string' && placeholder !== ''
                          ? placeholder
                          : intl.formatMessage(messages.empty)}
                </p>
            ) : (
                <div
                    className={cn(
                        'relative overflow-hidden px-4 py-3',
                        PREVIEW_CLAMP
                    )}
                >
                    <WysiwygPreview value={value} />
                    {/* Fades the clipped edge, so a body longer than the
                            clamp reads as continuing rather than as ending
                            mid-sentence. */}
                    <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent"
                    />
                </div>
            )}

            {/* The name is an `aria-label`, not `sr-only` text: this button
                    carries the field's `id`, so content-admin's `<label for>`
                    points at it — and a native label outranks a button's own
                    contents, which left it announcing "Body" with no hint that
                    pressing it opens anything. `aria-label` outranks the label
                    in turn, and still contains the visible label text, so the
                    name matches what a speech-input user would say (2.5.3).

                    No `aria-invalid`/`aria-required`: neither applies to a
                    button, and ARIA has no invalid state for one. The error
                    reaches assistive tech the way it can — `aria-describedby`
                    points at the message content-admin renders below, so it is
                    announced on focus and not only when it appears. The red
                    border above carries the same thing visually.

                    No `aria-haspopup` either: pressing this navigates the work
                    area to the editor, it does not open a popup over it. */}
            <button
                id={id}
                type="button"
                className="absolute inset-0 rounded-lg focus-visible:outline-none"
                aria-label={intl.formatMessage(
                    readOnly ? messages.view : messages.edit,
                    { label }
                )}
                aria-describedby={describedBy}
                onClick={() => setExpanded(true)}
            />

            <span
                aria-hidden
                className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-background/90 px-2 py-1 text-xs text-muted-foreground"
            >
                {readOnly ? (
                    <Eye className="size-3" />
                ) : (
                    <Pencil className="size-3" />
                )}
                {intl.formatMessage(
                    readOnly ? messages.viewChip : messages.editChip
                )}
            </span>
        </div>
    );
}
