import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { afterEach } from 'vitest';
import { editorExtensions } from '../editorExtensions';
// Each of these declares its own commands by augmenting `@tiptap/core`'s
// `Commands` interface. `editorExtensions`' emitted declaration says only that
// it returns `AnyExtension[]`, so importing it alone elides them and
// `setColumns` and friends are invisible to the type checker here.
import './callout';
import './columns';
import './language';
import './media';

/**
 * The commands that reshape a document, driven headlessly.
 *
 * These are not browser cases — no pointer, no focus, no clipboard. They are
 * document transforms with a rule about what must survive them, and each one's
 * failure is **silent**: the text still reads the same, so the only place the
 * loss is visible is the stored document.
 */
let editor: Editor | null = null;

/** An editor over `html`, with the caret at the start of the document. */
function open(html: string): Editor {
    editor = new Editor({
        element: document.createElement('div'),
        extensions: editorExtensions(''),
        content: html
    });
    editor.commands.focus('start');
    return editor;
}

afterEach(() => {
    editor?.destroy();
    editor = null;
});

/** Every node of `type` anywhere in the document. */
function nodesOfType(document: JSONContent, type: string): JSONContent[] {
    const found: JSONContent[] = [];
    const visit = (node: JSONContent) => {
        if (node.type === type) found.push(node);
        node.content?.forEach(visit);
    };
    visit(document);
    return found;
}

/** Puts the selection on the first node of `type`, the way clicking it would. */
function selectNode(instance: Editor, type: string): void {
    let at: number | null = null;
    instance.state.doc.descendants((node, pos) => {
        if (at === null && node.type.name === type) at = pos;
        return at === null;
    });
    if (at === null) throw new Error(`no ${type} in the document`);
    instance.commands.setNodeSelection(at);
}

/** The text of a node and everything under it. */
function textOf(node: JSONContent): string {
    if (node.type === 'text') return node.text ?? '';
    return (node.content ?? []).map(textOf).join('');
}

/** `count` columns, the last `written.length` of them carrying text. */
function columnsHtml(count: number, written: Record<number, string>): string {
    const columns = Array.from(
        { length: count },
        (_, index) => `<div data-column><p>${written[index] ?? ''}</p></div>`
    ).join('');
    return `<div data-columns="${count}">${columns}</div>`;
}

describe('the language mark', () => {
    it('survives Clear formatting [wysiwyg:I-15]', () => {
        // "Clear formatting" is `unsetAllMarks()`, which removes **every** mark
        // in the schema unless the mark opts out — so being its own mark rather
        // than a `textStyle` attribute is necessary and not sufficient. A
        // language is not formatting: it is invisible on screen, so losing it
        // is silent and the passage is simply announced in the wrong language
        // from then on (WCAG 3.1.2).
        const open_ = open('<p>Bonjour le <span lang="fr">monde</span></p>');
        open_.commands.selectAll();
        // `setMark` rather than `setBold` — a core command, so the assertion
        // does not depend on StarterKit's own type augmentation.
        open_.commands.setMark('bold');

        expect(open_.getHTML()).toContain('<strong>');

        open_.chain().selectAll().unsetAllMarks().clearNodes().run();

        // The formatting is gone…
        expect(open_.getHTML()).not.toContain('<strong>');
        // …and the fact about the text is not.
        expect(open_.getHTML()).toContain('<span lang="fr">monde</span>');
    });

    it('is still removable on purpose', () => {
        // The other side: `clearable: false` must not make the marker
        // permanent, or an author who tagged the wrong run is stuck with it.
        const open_ = open('<p>Bonjour le <span lang="fr">monde</span></p>');
        open_.chain().selectAll().unsetLanguage().run();

        expect(open_.getHTML()).not.toContain('lang="fr"');
    });
});

describe('callouts', () => {
    it('re-tones the callout instead of nesting a second one [wysiwyg:I-20]', () => {
        const open_ = open('<p>Mind the gap</p>');
        open_.commands.setCallout('info');
        open_.commands.setCallout('warning');

        const callouts = nodesOfType(open_.getJSON(), 'callout');

        // One callout, not a callout inside a callout — which is never what
        // picking a second tone meant, and renders as two nested tinted boxes.
        expect(callouts).toHaveLength(1);
        expect(callouts[0].attrs?.['tone']).toBe('warning');
        expect(textOf(callouts[0])).toBe('Mind the gap');
    });
});

describe('inserting media', () => {
    it('skips an unsafe embed rather than storing a broken node [wysiwyg:I-22]', () => {
        // The parse side is covered in `renderRichText`'s spec; this is the
        // other writer. A source is a **contributed** component — a picker, an
        // upload, whatever a deployment adds — so what it hands over is not
        // this editor's to trust, and a `src` it will not publish must produce
        // no node rather than an `<img src="">`.
        const open_ = open('<p>Before</p>');
        const inserted = open_.commands.insertMedia([
            { kind: 'image', src: 'javascript:alert(1)' }
        ]);

        expect(inserted).toBe(false);
        expect(nodesOfType(open_.getJSON(), 'image')).toEqual([]);
    });

    it('places the admissible ones out of a mixed list [wysiwyg:I-21]', () => {
        // Both halves in one: the check is the node's, not only the dialog's,
        // and it is per embed rather than all-or-nothing — a picker returning
        // four assets of which one is unusable still places the other three.
        const open_ = open('<p>Before</p>');
        const inserted = open_.commands.insertMedia([
            { kind: 'image', src: '/api/media/assets/a1/raw', alt: 'A chart' },
            { kind: 'image', src: '//evil.example.com/a.png' },
            { kind: 'video', src: 'https://cdn.example.com/clip.mp4' }
        ]);

        expect(inserted).toBe(true);
        expect(
            nodesOfType(open_.getJSON(), 'image').map(
                (node) => node.attrs?.['src']
            )
        ).toEqual(['/api/media/assets/a1/raw']);
        expect(
            nodesOfType(open_.getJSON(), 'video').map(
                (node) => node.attrs?.['src']
            )
        ).toEqual(['https://cdn.example.com/clip.mp4']);
    });
});

describe('column layouts', () => {
    it('folds a dropped column’s blocks into the last one it keeps [wysiwyg:I-18]', () => {
        const open_ = open(
            columnsHtml(4, { 0: 'One', 1: 'Two', 2: 'Three', 3: 'Four' })
        );
        open_.commands.setColumns(2);

        const [block] = nodesOfType(open_.getJSON(), 'columnBlock');
        const columns = nodesOfType(open_.getJSON(), 'column');

        expect(block.attrs?.['count']).toBe(2);
        expect(columns).toHaveLength(2);
        // Nothing written is lost: the third and fourth columns' paragraphs
        // moved into the second rather than being deleted with the columns
        // that held them.
        expect(textOf(columns[0])).toBe('One');
        expect(textOf(columns[1])).toBe('TwoThreeFour');
    });

    it('grows with empty columns rather than redistributing what is written', () => {
        const open_ = open(columnsHtml(2, { 0: 'One', 1: 'Two' }));
        open_.commands.setColumns(4);

        const columns = nodesOfType(open_.getJSON(), 'column');

        expect(columns.map(textOf)).toEqual(['One', 'Two', '', '']);
    });

    it.each([
        [9, 4],
        [1, 2],
        [0, 2]
    ])('clamps a requested %i columns to %i [wysiwyg:I-19]', (asked, kept) => {
        const open_ = open('<p>Mind the gap</p>');
        open_.commands.setColumns(asked);

        const [block] = nodesOfType(open_.getJSON(), 'columnBlock');
        expect(block.attrs?.['count']).toBe(kept);
        expect(nodesOfType(open_.getJSON(), 'column')).toHaveLength(kept);
    });

    it('clamps a count parsed out of foreign markup [wysiwyg:I-19]', () => {
        // `data-columns="wide"` is `Number(…) === NaN`, and `Math.min/max` on a
        // NaN is NaN — which would ride into `grid-template-columns:
        // repeat(NaN, …)` and take the layout's rendering with it. It is the
        // reason `clampCount` tests for finiteness before clamping.
        const open_ = open(
            '<div data-columns="wide"><div data-column><p>One</p></div><div data-column><p>Two</p></div></div>'
        );

        const [block] = nodesOfType(open_.getJSON(), 'columnBlock');
        expect(block.attrs?.['count']).toBe(2);
    });
});

describe('the size media carries', () => {
    it('reads an embed narrower than the floor as no width chosen [wysiwyg:I-23]', () => {
        // Not clamped up to 64. A source that reports a tiny intrinsic width —
        // an icon, a spacer, a thumbnail whose metadata is wrong — has not
        // *chosen* a width, and storing 64 would publish a number the author
        // never picked and cannot tell apart from one they did. `null` means
        // "the media's own size", which is what a bare `<img>` does everywhere.
        //
        // The live drag handle does clamp, and that is a different rule: it
        // bounds a gesture in progress so the handle stays larger than the thing
        // it is dragging. This clause is about what a *width value* means.
        const open_ = open('<p>Before</p>');
        open_.commands.insertMedia([
            { kind: 'image', src: '/api/media/assets/a1/raw', width: 20 },
            { kind: 'image', src: '/api/media/assets/a2/raw', width: 320 }
        ]);

        expect(
            nodesOfType(open_.getJSON(), 'image').map(
                (node) => node.attrs?.['width']
            )
            // The second is the discriminator: a build that dropped every width
            // would satisfy the first on its own.
        ).toEqual([null, 320]);
    });
});

describe('where media sits across the measure', () => {
    it('stops writing data-align once the picture goes back to left [wysiwyg:I-24]', () => {
        // `left` is where a block already is, so the attribute would say
        // nothing — and an attribute that says nothing is one every consumer of
        // this HTML has to decide what to do about. The failure this guards is
        // subtle: choosing Alignment > Left on a centred picture *looks* right
        // in the editor (the stylesheet only reacts to center/right) while
        // leaving `data-align="left"` in the stored body forever.
        const open_ = open('<p>Before</p>');
        open_.commands.insertMedia([
            { kind: 'image', src: '/api/media/assets/a1/raw' }
        ]);
        selectNode(open_, 'image');

        open_.commands.setMediaAlign('center');
        expect(open_.getHTML()).toContain('data-align="center"');

        open_.commands.setMediaAlign('left');

        // The attribute is gone, not set to "left"…
        expect(open_.getHTML()).not.toContain('data-align');
        // …and the node still knows where it sits, so nothing was lost — the
        // default simply isn't serialized.
        expect(nodesOfType(open_.getJSON(), 'image')[0].attrs?.['align']).toBe(
            'left'
        );
    });

    it('reads a stored left back without writing it out again [wysiwyg:I-24]', () => {
        // The parse side of the same rule: a body that already carries
        // `data-align="left"` (written by an older build, or by hand) is
        // understood and then normalized away on the next save.
        const open_ = open(
            '<img src="/api/media/assets/a1/raw" data-align="left">'
        );

        expect(nodesOfType(open_.getJSON(), 'image')[0].attrs?.['align']).toBe(
            'left'
        );
        expect(open_.getHTML()).not.toContain('data-align');
    });
});

describe('media a document tries to arrive with', () => {
    it('is refused by the node, not only by the dialog [wysiwyg:I-21]', () => {
        // The dialog explains a bad URL to the author; it cannot be the check,
        // because a body can be written straight through the API, pasted from
        // another page, or seeded from a legacy HTML column. This is the same
        // `parseHTML` the editor runs when it opens such a body, so what it
        // refuses here never reaches the stored document either.
        const open_ = open(
            '<p>Before</p>' +
                '<img src="javascript:alert(1)">' +
                '<img src="//evil.example.com/a.png">' +
                '<img src="/api/media/assets/a1/raw">' +
                '<p>After</p>'
        );

        // Only the admissible one survives — and it does survive, so this is
        // not a parser that drops every image.
        expect(
            nodesOfType(open_.getJSON(), 'image').map(
                (node) => node.attrs?.['src']
            )
        ).toEqual(['/api/media/assets/a1/raw']);
        // Refused outright rather than imported with a blanked `src`: an
        // `<img src="">` is a broken-image icon in the body, which reads as
        // data loss to whoever opens the record next.
        expect(open_.getHTML()).not.toContain('src=""');
    });
});
