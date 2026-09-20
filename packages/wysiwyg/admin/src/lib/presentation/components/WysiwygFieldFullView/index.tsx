import { useId } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@orthacms/design-system';
import type { EntryFieldControlContext } from '@orthacms/content-admin';
import { asEditorContent } from '../../../domain/richTextValue';
import { WysiwygEditorPanel } from '../WysiwygEditorPanel';

const messages = defineMessages({
    back: {
        id: 'wysiwyg.fullView.back',
        defaultMessage: 'Back to fields'
    },
    required: {
        id: 'wysiwyg.fullView.required',
        defaultMessage: 'Required'
    }
});

/**
 * The rich-text editor as a **view**, filling the entry editor's work area.
 *
 * Rendered by content-admin in place of the tab strip once the field is
 * expanded (`ENTRY_FIELD_CONTROL_SLOT`'s `FullView`), which is what keeps
 * everything around it alive: the app sidebar, the record's title, the top
 * bar's Save / Publish, and the Properties rail — whose publish gate ticks over
 * live as the body is written, because this is still the record's own form.
 *
 * A dialog could do none of that. It would cover the rail it should be
 * updating, hide the record it belongs to, and put Save behind an overlay.
 *
 * Leaving is explicit — **Back to fields** above, **Done** in the footer — and
 * both are safe, because edits are already in the form by the time either is
 * pressed. There is deliberately no Escape shortcut: the toolbar's menus and
 * popovers each answer Escape themselves, and a second handler on the view
 * would race them into closing the whole editor out from under an open menu.
 */
export function WysiwygFieldFullView({
    field,
    id,
    label,
    value,
    error,
    readOnly,
    contentLocale,
    onChange,
    onBlur,
    setExpanded
}: EntryFieldControlContext) {
    const intl = useIntl();
    const headingId = useId();
    const errorId = useId();
    const placeholder = field.admin['placeholder'];

    // Collapsing is when the author is done with this field, which is what
    // `touch` means to the form — the point a required field may complain.
    const collapse = () => {
        setExpanded(false);
        onBlur?.();
        // Focus does not follow a removed active element: the browser drops it
        // on `<body>`, so an author who pressed **Done** from the keyboard lands
        // nowhere and has to Tab from the top of the page to get back into the
        // form (WCAG 2.4.3). Hand it to the control they came from — the button
        // carries this field's `id`, and content-admin re-renders the form row
        // on the next commit, so it only exists a frame later — the same
        // deferred `getElementById` restore `EntryEditor` uses when a blocked
        // save sends the author to the offending field.
        requestAnimationFrame(() => {
            document.getElementById(id)?.focus();
        });
    };

    return (
        <section
            aria-labelledby={headingId}
            className="flex min-h-0 flex-1 flex-col"
            // The row's own language, on a **localized** field: by definition it
            // holds this locale's text, and without it a German or Arabic body
            // is announced with English pronunciation rules under the admin's
            // hardcoded `<html lang="en">` (WCAG 3.1.2). The collapsed preview
            // already gets this from content-admin's Translated group — but the
            // expanded view is rendered in place of the tab strip, *outside*
            // that group, so the chain ended here. A shared field holds one
            // value for every locale, usually still in the language it was first
            // written in, so claiming this locale for it would be a worse
            // assertion than making none.
            //
            // `dir="auto"` rather than the locale's own direction, matching the
            // form: it orders the body from the body's first strong character,
            // which is right for an RTL locale and stays right for an RTL
            // quotation inside an LTR one.
            lang={field.localized ? contentLocale : undefined}
            dir="auto"
        >
            {/* Two rows, not one. A `Button` is a flex box with its own icon
                and line-height; baseline-aligning it against an `<h2>` lines up
                the two texts' baselines but leaves the button's box sitting
                visibly low against the heading. Giving the back link its own
                row — the same shape the record's own "Back to records" link
                uses — sidesteps the mismatch and reads as a hierarchy: leave,
                then what you're in. */}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mb-3 -ml-2 h-7 w-fit gap-1.5 px-2 text-muted-foreground"
                onClick={collapse}
            >
                <ArrowLeft />
                {intl.formatMessage(messages.back)}
            </Button>

            <div className="mb-3 flex items-center gap-2">
                <h2
                    id={headingId}
                    className="text-base font-semibold tracking-[-0.01em]"
                >
                    {label}
                </h2>
                {field.required ? (
                    <span className="text-xs text-muted-foreground">
                        {intl.formatMessage(messages.required)}
                    </span>
                ) : null}
            </div>

            {/* The field's `<FieldError>` lives on the form row, which is not on
                screen while this view is — so the error is surfaced here, or it
                would be surfaced nowhere. */}
            {error ? (
                <p
                    id={errorId}
                    role="alert"
                    className="mb-3 text-sm text-destructive"
                >
                    {error}
                </p>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-input bg-card">
                <WysiwygEditorPanel
                    fieldLabel={label}
                    initialContent={asEditorContent(value)}
                    placeholder={
                        typeof placeholder === 'string' ? placeholder : ''
                    }
                    required={field.required}
                    readOnly={readOnly}
                    onChange={onChange}
                    onDone={collapse}
                />
            </div>
        </section>
    );
}
