import { defineMessages, useIntl } from 'react-intl';
import { Globe } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@orthacms/design-system';

const messages = defineMessages({
    localized: {
        id: 'content.form.localized',
        defaultMessage: 'Localized field'
    },
    localizedHint: {
        id: 'content.form.localizedHint',
        defaultMessage: 'This value can differ per locale.'
    }
});

/**
 * A small indicator that a field's value can differ per locale (rendered when
 * `field.localized`, only ever on i18n types), explaining itself on hover
 * **and on focus**.
 *
 * The trigger is a real `<button>` rather than the bare span it replaced: a
 * native `title` never surfaces for keyboard or touch users, and Radix needs a
 * focusable element to open on focus. It sits inside the field's `<label>`, so
 * it suppresses the label's activation behaviour — otherwise reading the hint
 * would also focus the control it describes (and on a toggle, flip it).
 *
 * Its caller (`EntryFieldInput`'s end-adornment) handles placement, so this is
 * just the mark.
 */
export function LocalizedFieldMark() {
    const intl = useIntl();
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={(event) => event.preventDefault()}
                    className="inline-flex shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Globe aria-hidden className="size-3.5" />
                    <span className="sr-only">
                        {intl.formatMessage(messages.localized)}
                    </span>
                </button>
            </TooltipTrigger>
            <TooltipContent>
                {intl.formatMessage(messages.localizedHint)}
            </TooltipContent>
        </Tooltip>
    );
}
