import { generateHTML, resolveExtensions } from '@tiptap/core';
import { renderRichText } from '../renderRichText';
import { editorExtensions } from '.';

/**
 * The resolved extension set — StarterKit flattened into the list beside it,
 * exactly as `getSchema` and the live editor resolve it.
 */
function resolvedNames(): string[] {
    return resolveExtensions(editorExtensions('')).map(
        (extension) => extension.name
    );
}

/** How many times `name` appears in the resolved set. */
function occurrences(name: string): number {
    return resolvedNames().filter((candidate) => candidate === name).length;
}

/** A stored document, serialized the way the save and the preview serialize it. */
function storedHtml(content: unknown[]): string {
    return generateHTML(
        { type: 'doc', content } as never,
        editorExtensions('')
    );
}

/** A paragraph holding `text`. */
const paragraph = (text: string) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }]
});

describe('editorExtensions', () => {
    describe('the extension set', () => {
        it('registers no name twice [wysiwyg:I-38]', () => {
            // TipTap does not refuse a duplicate — it `console.warn`s and
            // resolves the set in whatever order sorting happened to leave, so
            // the second copy's options may or may not be the ones that win.
            // The failure is silent at runtime and loud only here.
            const names = resolvedNames();
            const duplicated = [
                ...new Set(
                    names.filter((name, index) => names.indexOf(name) !== index)
                )
            ];

            expect(duplicated).toEqual([]);
        });

        it.each(['link', 'underline', 'trailingNode'])(
            // covers: wysiwyg:I-38
            'takes %s from StarterKit and does not add a second copy',
            (name) => {
                // Exactly one, in both directions: adding the standalone
                // extension beside StarterKit makes this 2, and a StarterKit
                // release that stops shipping it makes it 0 — which is the
                // moment to add it back rather than lose the guarantee (a
                // document ending in a table with no `trailingNode` after it is
                // a dead end the caret cannot get past).
                expect(occurrences(name)).toBe(1);
            }
        );
    });

    describe('what the schema serializes into stored content', () => {
        it('gives every header cell a scope [wysiwyg:I-16]', () => {
            const html = storedHtml([
                {
                    type: 'table',
                    content: [
                        {
                            type: 'tableRow',
                            content: [
                                {
                                    type: 'tableHeader',
                                    content: [paragraph('Year')]
                                },
                                {
                                    type: 'tableHeader',
                                    content: [paragraph('Revenue')]
                                }
                            ]
                        },
                        {
                            type: 'tableRow',
                            content: [
                                {
                                    type: 'tableCell',
                                    content: [paragraph('2019')]
                                },
                                {
                                    type: 'tableCell',
                                    content: [paragraph('7')]
                                }
                            ]
                        }
                    ]
                }
            ]);

            const parsed = new DOMParser().parseFromString(html, 'text/html');
            const headers = [...parsed.querySelectorAll('th')];

            // Two of them, so "the first one happened to get it" is not a
            // passing shape.
            expect(headers).toHaveLength(2);
            for (const header of headers) {
                expect(header.getAttribute('scope')).toBe('col');
            }
            // …and the ordinary cells do not claim to be headers.
            expect(
                [...parsed.querySelectorAll('td')].map((cell) =>
                    cell.getAttribute('scope')
                )
            ).toEqual([null, null]);
        });

        it('carries the same scope into the preview [wysiwyg:I-16]', () => {
            // The other half of the invariant: the attribute is set through
            // `HTMLAttributes` rather than a `renderHTML` override precisely so
            // that it rides the node's own serialization — and the preview
            // re-serializes through this same schema. A `renderHTML` override
            // on the editor's surface alone would pass the test above and fail
            // this one.
            const preview = renderRichText({
                type: 'doc',
                content: [
                    {
                        type: 'table',
                        content: [
                            {
                                type: 'tableRow',
                                content: [
                                    {
                                        type: 'tableHeader',
                                        content: [paragraph('Year')]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            });

            const parsed = new DOMParser().parseFromString(
                preview,
                'text/html'
            );
            const headers = [...parsed.querySelectorAll('th')];
            expect(headers).toHaveLength(1);
            expect(headers[0].getAttribute('scope')).toBe('col');
        });

        it('writes the custom nodes as data- attributes, never as class names [wysiwyg:I-35]', () => {
            const html = storedHtml([
                {
                    type: 'callout',
                    attrs: { tone: 'warning' },
                    content: [paragraph('Mind the gap')]
                },
                {
                    type: 'columnBlock',
                    attrs: { count: 3 },
                    content: [
                        { type: 'column', content: [paragraph('One')] },
                        { type: 'column', content: [paragraph('Two')] },
                        { type: 'column', content: [paragraph('Three')] }
                    ]
                },
                {
                    type: 'image',
                    attrs: {
                        src: '/api/media/assets/a1/raw',
                        alt: 'The revenue chart',
                        width: 320,
                        align: 'center'
                    }
                }
            ]);

            const parsed = new DOMParser().parseFromString(html, 'text/html');

            // The structure is in the markup and the look is in the consuming
            // site's stylesheet. An admin class name here would ship this app's
            // styling into a body that gets published somewhere else — and this
            // package's own rules all hang off `.ortha-wysiwyg`, which the
            // stored content never carries.
            expect([...parsed.body.querySelectorAll('[class]')]).toEqual([]);
            expect(html).not.toContain('ortha-wysiwyg');

            const callout = parsed.querySelector('aside');
            expect(callout?.hasAttribute('data-callout')).toBe(true);
            expect(callout?.getAttribute('data-tone')).toBe('warning');

            expect(
                parsed
                    .querySelector('[data-columns]')
                    ?.getAttribute('data-columns')
            ).toBe('3');
            expect(parsed.querySelectorAll('[data-column]')).toHaveLength(3);

            const image = parsed.querySelector('img');
            expect(image?.getAttribute('data-align')).toBe('center');
            expect(image?.getAttribute('width')).toBe('320');
            expect(image?.getAttribute('alt')).toBe('The revenue chart');
        });
    });
});
