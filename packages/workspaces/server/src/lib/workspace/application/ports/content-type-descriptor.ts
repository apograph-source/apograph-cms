/**
 * A content type a workspace can be granted access to. The real source of truth
 * is the code-defined registry in `@orthacms/content-server`, surfaced to the
 * workspaces context through the {@link ContentCatalog} port; this descriptor is
 * the wire shape `GET /api/content-types` returns and the workspace create flow
 * expands an "all content" grant against.
 */
export interface ContentTypeDescriptor {
    /** Stable machine name / slug. */
    name: string;
    /** Multi-entry collection vs. standalone page. */
    kind: 'collection' | 'single';
    /** Human label; falls back to `name`. */
    label?: string;
    /** Short description shown under the label. */
    description?: string;
    /** Route path — pages only. */
    path?: string;
}
