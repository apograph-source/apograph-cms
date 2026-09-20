/**
 * **Language of parts** — a run of text marked as being in another language
 * (WCAG 3.1.2).
 *
 * The platform localises whole entries, which settles the *page's* language
 * (3.1.1). It says nothing about a French quotation inside an otherwise-English
 * body: a screen reader announces that passage with English phonemes, and the
 * result is unintelligible rather than merely accented. The only fix is a
 * `lang` on the passage itself, which means the body has to be able to carry
 * one — so this is a mark, stored on the run, travelling with the document.
 *
 * TipTap ships no such mark, and it is not `textStyle` with another attribute:
 * `textStyle` is a `<span style>` about appearance, and clearing formatting
 * should not silently strip a language. It is its own mark, so `Clear
 * formatting` leaves it alone.
 */

import { Mark, mergeAttributes } from '@tiptap/core';
import { RICH_TEXT_MARK } from '@orthacms/content-domain';

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        language: {
            /** Mark the selection as being written in `lang` (BCP-47). */
            setLanguage: (lang: string) => ReturnType;
            /** Drop the language marker from the selection. */
            unsetLanguage: () => ReturnType;
        };
    }
}

/**
 * The `language` mark: `<span lang="fr">…</span>` in the serialized body, and
 * `attrs.lang` on the text run in the stored document.
 *
 * `parseHTML` claims `span[lang]` — so a legacy body that already carried one
 * (typed by hand, or pasted out of a document that had it) keeps it when the
 * record is next opened, rather than losing it to the schema round-trip. That
 * is the 504.2.1 half of the criterion: a marker that does not survive editing
 * was never really preserved.
 */
export const Language = Mark.create({
    name: RICH_TEXT_MARK.Language,

    /**
     * **Clear formatting leaves it alone.**
     *
     * Being its own mark rather than a `textStyle` attribute is necessary for
     * that and not sufficient: `unsetAllMarks()` — what the toolbar's "Clear
     * formatting" runs — removes *every* mark in the schema unless the mark
     * says otherwise, so `language` was being stripped along with the bold the
     * author actually meant to clear. A language is not formatting. It is a
     * fact about the text (WCAG 3.1.2), invisible on screen, and losing it is
     * silent: the passage looks identical and is simply announced in the wrong
     * language from then on.
     *
     * Removing it deliberately is what `unsetLanguage` is for.
     */
    clearable: false,

    addAttributes() {
        return {
            lang: {
                default: null,
                parseHTML: (element) => element.getAttribute('lang'),
                renderHTML: (attributes) =>
                    attributes['lang'] ? { lang: attributes['lang'] } : {}
            }
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span[lang]',
                // Only claim a span that actually names a language: an
                // unqualified `span` rule would swallow every `textStyle` span
                // in the document and turn colours into empty language marks.
                getAttrs: (element) =>
                    (element as HTMLElement).getAttribute('lang') ? null : false
            }
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes), 0];
    },

    addCommands() {
        return {
            setLanguage:
                (lang: string) =>
                ({ chain }) =>
                    chain().setMark(this.name, { lang }).run(),
            unsetLanguage:
                () =>
                ({ chain }) =>
                    chain().unsetMark(this.name).run()
        };
    }
});
