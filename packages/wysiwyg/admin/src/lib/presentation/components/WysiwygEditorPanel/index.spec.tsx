import { act, render, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { RichTextDocument } from '@orthacms/content-domain';
import { TooltipProvider } from '@orthacms/design-system';
import { WysiwygEditorPanel } from '.';

/**
 * Two things about the panel that a browser suite cannot see, for opposite
 * reasons.
 *
 * **Where the caret starts** (`autofocus: readOnly ? false : 'end'`) looks like
 * a focus question, and as a focus question it is unobservable: a read-only
 * ProseMirror renders `contenteditable="false"` with no `tabindex`, so
 * `view.focus()` is a no-op and flipping the guard changes nothing a browser
 * can be asked about. But focus is not what the option does first — TipTap
 * resolves it to a **selection** and puts it in the editor's state, whether or
 * not the DOM can take focus. That selection is a document fact, readable off
 * the live editor, and it differs by the whole document's length between the
 * two modes. So this is a state assertion that happens to be about the caret,
 * not a caret test in jsdom.
 *
 * **The image with no alt** is the reverse: the browser can see the rendered
 * `alt`, but the rule is a *pair* of opposite requirements — the author's own
 * screen reader must not meet an unnamed graphic while they work, and the
 * stored HTML must carry the real value, empty included. A test that checked
 * only one of them would pass for a build that satisfied it by breaking the
 * other, which is the likelier mistake of the two.
 *
 * The editor is reached through `.tiptap`'s `editor` back-reference — the one
 * TipTap itself puts on the view's DOM node — so what is asserted is the
 * instance the component built, not one this file configured to match.
 */

/** Two paragraphs: long enough that "start" and "end" are different positions. */
const DOC: RichTextDocument = {
    type: 'doc',
    content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }
    ]
} as RichTextDocument;

/** A named image beside an un-named one — the pair that discriminates. */
const IMAGES: RichTextDocument = {
    type: 'doc',
    content: [
        {
            type: 'image',
            attrs: { src: '/api/media/assets/a1/raw', alt: 'A chart' }
        },
        { type: 'image', attrs: { src: '/api/media/assets/a2/raw', alt: '' } }
    ]
} as RichTextDocument;

const EMPTY_RECT = {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({})
};

const NO_RECTS = {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {
        // Intentionally empty: jsdom has no layout, so there are no rects.
    }
};

beforeAll(() => {
    // `autofocus` ends in ProseMirror's `scrollIntoView`, which measures the
    // selection. jsdom has no layout and no `Range.getClientRects` at all, so
    // without these the measurement throws asynchronously, outside any test.
    Range.prototype.getClientRects = () => NO_RECTS as never;
    Range.prototype.getBoundingClientRect = () => EMPTY_RECT as never;
    Element.prototype.getClientRects = () => NO_RECTS as never;
});

/** The mounted panel, plus the editor instance it created. */
function open({
    readOnly = false,
    content = DOC
}: { readOnly?: boolean; content?: RichTextDocument } = {}) {
    const view = render(
        <IntlProvider locale="en">
            <TooltipProvider>
                <WysiwygEditorPanel
                    fieldLabel="Body"
                    initialContent={content}
                    placeholder=""
                    readOnly={readOnly}
                    onChange={vi.fn()}
                    onDone={vi.fn()}
                />
            </TooltipProvider>
        </IntlProvider>
    );

    const surface = view.container.querySelector('.tiptap') as HTMLElement & {
        editor?: Editor;
    };

    return { view, surface, editor: () => surface.editor as Editor };
}

/** Resolves once TipTap's deferred `autofocus` has had its turn. */
const settled = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

describe('where the caret starts [wysiwyg:I-31]', () => {
    it('drops the author at the end of what they were writing', async () => {
        const { editor } = open({ readOnly: false });
        await settled();

        const state = editor().state;
        // The end of the document, not merely "somewhere past the start": an
        // autofocus resolved to the wrong position would still beat `1`.
        await waitFor(() =>
            expect(state.selection.from).toBe(state.doc.content.size - 1)
        );
    });

    it('sets no caret at all in a reading surface', async () => {
        // The clause the guard exists for. A reader has nothing to type into,
        // and being dropped at the *end* of a passage they came to read is the
        // opposite of useful — so `autofocus` is `false` and the selection
        // stays where a fresh state puts it.
        const { editor } = open({ readOnly: true });
        await settled();

        const state = editor().state;
        expect(state.selection.from).toBe(1);
        expect(state.selection.from).not.toBe(state.doc.content.size - 1);
        // And the surface really is the read-only one, so the assertion above
        // is about the guard rather than about an editor that failed to mount.
        expect(editor().isEditable).toBe(false);
    });
});

describe('an image with no alt, inside the editor [wysiwyg:I-26]', () => {
    it('is named for the author without inventing one for the reader', async () => {
        const { view, editor } = open({ content: IMAGES });
        await settled();

        const [described, bare] = [...view.container.querySelectorAll('img')];

        // The author's own description is never replaced by the fallback.
        expect(described.getAttribute('alt')).toBe('A chart');
        // …and the one with nothing written gets *a* name, so it does not read
        // as an unlabelled graphic to the author while they work.
        expect(bare.getAttribute('alt')).toBe('Embedded image');

        // The other half, which is the requirement the fallback must not
        // satisfy: what gets published still carries the real value. Inventing
        // alt for a published image is worse than having none — a screen-reader
        // user is told "Embedded image" about a picture nobody described.
        const html = editor().getHTML();
        expect(html).toContain('alt="A chart"');
        expect(html).toContain('alt=""');
        expect(html).not.toContain('alt="Embedded image"');
    });
});
