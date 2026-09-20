/**
 * Pure rules about a `richtext` field's stored value, as this plugin needs
 * them. No TipTap, no DOM — the control needs these *before* an editor exists
 * (to decide whether to show its empty state) and *after* one closes (to decide
 * what to store).
 *
 * The rules themselves live in the shared kernel
 * (`@orthacms/content-domain`'s rich-text module), because emptiness is the
 * same question the server's `required` and the publish gate ask. What is here
 * is the editor-facing half: what to seed TipTap with, and what a closed editor
 * hands back to the form.
 */

import {
    isEmptyRichText,
    isRichTextDocument,
    type RichTextDocument
} from '@orthacms/content-domain';

export { isEmptyRichText } from '@orthacms/content-domain';

/**
 * A rich-text value normalized for storage: an empty document collapses to
 * `null`, so `required`, the publish gate, and the "Changed" badge all agree
 * with what the author sees. Anything with content is stored **verbatim** —
 * this never rewrites a real document.
 *
 * `null` and not `''`: the value is a document now, and an empty *string* would
 * be a legacy body of zero length rather than the absence of one. `null` is
 * what the column holds and what every other field type collapses to.
 */
export function normalizeRichText(
    document: RichTextDocument
): RichTextDocument | null {
    return isEmptyRichText(document) ? null : document;
}

/**
 * What the editor is seeded with: the stored document, or — for a body written
 * before rich text became structured — the HTML string it is still stored as,
 * which TipTap parses through its own schema. Anything else (a `null` field, a
 * value of the wrong shape) starts an empty document.
 *
 * This is where a legacy body is converted, and deliberately the only place:
 * TipTap's parse is the editor's own schema, so it keeps everything this editor
 * can represent and nothing it cannot. The conversion is committed the first
 * time the record is saved, so content upgrades as it is edited rather than in
 * one migration that has to guess.
 */
export function asEditorContent(value: unknown): RichTextDocument | string {
    if (isRichTextDocument(value)) return value;
    return typeof value === 'string' ? value : '';
}
