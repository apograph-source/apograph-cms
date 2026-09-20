/**
 * Reading a **saved rich-text body** in an assertion.
 *
 * A `richtext` value is a structured document — the editor's node tree — so a
 * spec that wants to know "did the table get a header row" asks the tree,
 * rather than grepping a serialized string for `<th`. That is the point of the
 * change these helpers came with: the semantics are modelled, so they can be
 * asserted directly instead of inferred from markup.
 *
 * The node and attribute names are the editor's own (`heading`, `tableHeader`,
 * `columnBlock`, `image`), which is what a stored document holds and what any
 * consumer of the API now reads.
 */

import { expect } from '@playwright/test';
import {
    isRichTextDocument,
    richTextPlainText,
    walkRichText,
    type RichTextNode
} from '@orthacms/content-domain';

/**
 * The saved value as a document, failing the test if it is not one — so a spec
 * that stops storing a document fails on that fact rather than on a confusing
 * downstream assertion.
 */
export function savedDocument(value: unknown): RichTextNode {
    expect(isRichTextDocument(value)).toBe(true);
    return value as RichTextNode;
}

/** Every node of the saved document, in document order. */
export function savedNodes(value: unknown): RichTextNode[] {
    return [...walkRichText(savedDocument(value))];
}

/** The saved document's nodes of one type. */
export function savedNodesOfType(value: unknown, type: string): RichTextNode[] {
    return savedNodes(value).filter((node) => node.type === type);
}

/** The saved document's readable text — markup contributes nothing. */
export function savedText(value: unknown): string {
    return richTextPlainText(savedDocument(value));
}

/** One node's attribute, for an assertion that names it. */
export function attr(node: RichTextNode | undefined, name: string): unknown {
    return node?.attrs?.[name];
}
