/**
 * A `richtext` value's plain-text summary — what a table cell, a revision diff
 * row or a search result shows, where one line of text is all that fits.
 *
 * The reading itself lives in the shared kernel (`richTextPlainText`), because
 * it is the same reading a `maxLength` counts and the server applies: rich text
 * is a **document**, and a body written before it was one is HTML. Printing
 * either raw shows the reader their markup — or their JSON — instead of their
 * sentence. This module exists so the admin has one name for that, and so the
 * whitespace collapsing a single line needs happens in one place.
 */

import { richTextPlainText } from '@orthacms/content-domain';

/**
 * The readable text inside a rich-text value, collapsed to a single line.
 * Returns `''` for a value with no words (an empty document, `<p></p>`, or
 * anything that is not rich text at all), which is what lets a caller treat
 * "structure but no words" as empty rather than printing a blank cell's worth
 * of markup.
 */
export function richTextExcerpt(value: unknown): string {
    return richTextPlainText(value).replace(/\s+/g, ' ').trim();
}
