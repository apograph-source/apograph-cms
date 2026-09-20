/**
 * The lifecycle state of a single revision. Distinct from an entry's
 * `draft ↔ published` status (`@orthacms/content-domain`): that describes the
 * live row, this describes one version in its history.
 *
 * - `draft` — a saved version that is not (yet) live.
 * - `published` — the version currently promoted to the live row. At most one
 *   per `entry_id`.
 * - `superseded` — a previously-published version that a later publish replaced.
 */
export const REVISION_STATUS = {
    Draft: 'draft',
    Published: 'published',
    Superseded: 'superseded'
} as const;

/** A revision's lifecycle state. */
export type RevisionStatus =
    (typeof REVISION_STATUS)[keyof typeof REVISION_STATUS];
