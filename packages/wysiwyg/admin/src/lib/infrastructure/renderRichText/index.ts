/**
 * Turns a stored rich-text value into the HTML the **preview** renders.
 *
 * This is not a formatting pass — it is the plugin's trust boundary. A
 * `richtext` value is whatever some other CMS user typed (or pasted, or wrote
 * straight through the API), and a preview renders it as markup rather than
 * text. Handing it to `dangerouslySetInnerHTML` unchecked would make every
 * rich-text field a stored-XSS vector against anyone who opens the record —
 * `<img src=x onerror=…>` runs on `innerHTML` even though `<script>` doesn't,
 * and a contributor could aim it at an admin.
 *
 * So the value is round-tripped through the editor's own ProseMirror schema —
 * a **document** is rebuilt from its JSON, a legacy HTML string is parsed out
 * of an **inert** document (a `DOMParser` document loads no resources and runs
 * no scripts) — and re-serialized from the resulting nodes. Only what the
 * schema declares survives: every node, mark, and attribute the editor can't
 * produce is dropped, event handlers included, and the Link extension blanks
 * any href outside its protocol allowlist (`javascript:`). That makes the
 * allowlist the *same* definition as "what this editor can write", so the
 * preview is exactly what the author would see with the editor open. A
 * hand-kept tag list would be a second definition, free to drift.
 *
 * The one intentional difference from the editor: links are flattened to spans.
 * A preview sits under a full-bleed "edit" button, and a live `<a>` inside it
 * would be a tab stop that navigates the admin away from the record — so the
 * output is left with **no focusable elements at all**, which is what makes
 * that button safe to overlay.
 */

import { getSchema } from '@tiptap/core';
import {
    DOMParser as ProseMirrorDOMParser,
    DOMSerializer,
    Node as ProseMirrorNode,
    type Schema
} from '@tiptap/pm/model';
import { isRichTextDocument, richTextToHtml } from '@orthacms/content-domain';
import { editorExtensions } from '../editorExtensions';

/**
 * The schema, built once. It depends only on the nodes and marks in the
 * extension list — never on the per-field placeholder — so every field can
 * share it instead of paying for a schema build per render.
 */
let cached: Schema | null = null;

function schema(): Schema {
    if (!cached) cached = getSchema(editorExtensions(''));
    return cached;
}

/**
 * The sanitized HTML for a rich-text value, ready for `innerHTML`. Returns `''`
 * for a value that is neither a document nor a string, so a caller can treat
 * "nothing to render" uniformly.
 */
export function renderRichText(value: unknown): string {
    if (isRichTextDocument(value)) {
        const node = fromDocument(value);
        // A document carrying a node type this install's editor doesn't have —
        // written through the API, or by a deployment with an extension this
        // one lacks — cannot be rebuilt. Serializing it to HTML and taking the
        // string path below re-reads it through the schema, which keeps the
        // parts this editor *does* understand instead of showing the reader a
        // blank card. `richTextToHtml` escapes text and emits a fixed tag set,
        // so nothing is trusted that wasn't already.
        return node ? serialize(node) : renderRichText(richTextToHtml(value));
    }
    if (typeof value !== 'string' || value === '') return '';

    // Inert: this document is parsed, never loaded — no network, no scripts,
    // no `onerror` — which is what makes it safe to touch the input at all.
    const inert = new window.DOMParser().parseFromString(value, 'text/html');
    return serialize(
        ProseMirrorDOMParser.fromSchema(schema()).parse(inert.body)
    );
}

/** A stored document as a ProseMirror node, or `null` if the schema refuses it. */
function fromDocument(value: object): ProseMirrorNode | null {
    try {
        return ProseMirrorNode.fromJSON(schema(), value);
    } catch {
        return null;
    }
}

/** One parsed document, re-serialized to markup the preview can render. */
function serialize(doc: ProseMirrorNode): string {
    const target = document.createElement('div');
    target.appendChild(
        DOMSerializer.fromSchema(schema()).serializeFragment(doc.content, {
            document
        })
    );
    flattenLinks(target);
    return target.innerHTML;
}

/**
 * Replaces every `<a>` with a `<span data-link>` holding the same children.
 * The styling follows the attribute, so a link still *looks* like one; it just
 * stops being a tab stop the reader can fall into on their way to the edit
 * button.
 */
function flattenLinks(root: HTMLElement): void {
    root.querySelectorAll('a').forEach((anchor) => {
        const span = document.createElement('span');
        span.setAttribute('data-link', '');
        while (anchor.firstChild) span.appendChild(anchor.firstChild);
        anchor.replaceWith(span);
    });
}
