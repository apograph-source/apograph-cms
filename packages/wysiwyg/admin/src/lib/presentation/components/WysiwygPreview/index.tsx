import { useMemo } from 'react';
import { cn } from '@orthacms/design-system';
import { WYSIWYG_PROSE_CLASS } from '../../../domain/constants';
import { renderRichText } from '../../../infrastructure/renderRichText';

/**
 * Renders a rich-text value as formatted content rather than markup.
 *
 * The HTML is never used as given: `renderRichText` re-parses it through the
 * editor's schema first, which is what makes `dangerouslySetInnerHTML` sound
 * here — see that module for the reasoning. The result carries no focusable
 * elements, so this can sit under a full-bleed button.
 *
 * The memo is on the raw value, so re-rendering the surrounding form (which
 * happens on every keystroke in any other field) doesn't re-parse a document
 * that hasn't changed.
 */
export function WysiwygPreview({
    value,
    className
}: {
    /** The stored rich-text value, in whatever shape the form holds it. */
    value: unknown;
    className?: string;
}) {
    const html = useMemo(() => renderRichText(value), [value]);
    return (
        <div
            className={cn(WYSIWYG_PROSE_CLASS, className)}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
