/**
 * Options for the generated OpenAPI document and the Scalar API reference
 * the host serves from it. Passed to {@link createServer} as `docs`.
 *
 * The reference is mounted **outside** the global API prefix (it is express
 * middleware, not a Nest route), so `path`/`jsonPath` are absolute.
 */
export interface ApiDocsOptions {
    /**
     * Whether to generate the document and mount the reference. Defaults to
     * `true` outside production — an internal CMS API's docs are a dev tool,
     * and a deployment opts in explicitly rather than leaking its surface by
     * accident.
     */
    enabled?: boolean;
    /** Where the Scalar UI is mounted. Defaults to `/reference`. */
    path?: string;
    /** Where the raw OpenAPI JSON is served. Defaults to `/reference/json`. */
    jsonPath?: string;
    /** Document title. Defaults to "Ortha CMS API". */
    title?: string;
    /** Document description (markdown). */
    description?: string;
    /** Document version. Defaults to "1.0.0". */
    version?: string;
    /**
     * URL of the Scalar standalone bundle. Defaults to Scalar's jsDelivr CDN —
     * point it at a self-hosted copy for an air-gapped deployment.
     */
    cdn?: string;
}
