import type { ContentTypeDescriptor } from './content-type-descriptor';

/**
 * The read-side port over the host's content catalogue: every content type a
 * workspace can be granted access to. `@orthacms/content-server` implements it
 * over its code-defined registry and binds it to {@link CONTENT_CATALOG}; the
 * workspaces context injects the **token**, never the content package (which
 * depends back on this package for its route guards), keeping the graph acyclic.
 *
 * Inject it with `@Optional()` and fall back to the built-in mock so the
 * workspace flow still works when no content plugin is present.
 */
export interface ContentCatalog {
    /** Every content type a workspace can be granted access to. */
    list(): readonly ContentTypeDescriptor[];
}

/** DI token the content plugin binds to the concrete {@link ContentCatalog}. */
export const CONTENT_CATALOG = Symbol('CONTENT_CATALOG');
