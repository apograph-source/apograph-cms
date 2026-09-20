import type { RichTextDocument } from '@orthacms/content-domain';
import { asEditorContent, normalizeRichText } from '.';

/** The document an editor that has been emptied leaves behind. */
const EMPTIED: RichTextDocument = {
    type: 'doc',
    content: [{ type: 'paragraph' }]
};

/** A document with something in it. */
const WRITTEN: RichTextDocument = {
    type: 'doc',
    content: [
        {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Mind the gap' }]
        }
    ]
};

/**
 * What a closed editor hands back to the form.
 *
 * This is the half of `wysiwyg:I-11` the browser suite cannot see: the e2e case
 * for an emptied `required` field asserts the validation error, and
 * content-admin's `required` check calls `isEmptyRichText` — which an
 * empty-paragraph document satisfies too. So the error appears whether the
 * value collapsed to `null` or stayed a document, and only the stored shape
 * tells the two apart.
 */
describe('normalizeRichText', () => {
    it('stores an emptied editor as null, not as an empty paragraph [wysiwyg:I-11]', () => {
        // `null` and not `''`: the value is a document now, and an empty string
        // would be a legacy body of zero length rather than the absence of one.
        expect(normalizeRichText(EMPTIED)).toBeNull();
    });

    it('hands a written document to the form verbatim [wysiwyg:I-11]', () => {
        // Identity, not equality: this must never rewrite a real document on
        // its way through.
        expect(normalizeRichText(WRITTEN)).toBe(WRITTEN);
    });
});

describe('asEditorContent', () => {
    it('seeds the editor with the stored document when there is one', () => {
        expect(asEditorContent(WRITTEN)).toBe(WRITTEN);
    });

    it('hands a legacy body to TipTap as the string it still is', () => {
        // The conversion point: a body written before rich text became
        // structured is parsed through this editor's own schema and committed
        // as a document the first time the record is saved.
        expect(asEditorContent('<p>Written in 2019</p>')).toBe(
            '<p>Written in 2019</p>'
        );
    });

    it.each([[null], [undefined], [42], [{ type: 'not-a-doc' }]])(
        'starts an empty document for %s',
        (value) => {
            expect(asEditorContent(value)).toBe('');
        }
    );
});
