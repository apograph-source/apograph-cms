/**
 * Public API of `@orthacms/segments-domain` — who may **read** published
 * content, decided by one pure function over two lists.
 *
 * Deliberately small. A segment is a named set of reader tags; an entry names
 * the segments that may read it and the segments that may not; `canRead` is the
 * whole decision. There is no rule object, no inheritance and no resolution
 * step, because what an editor sets on the entry *is* what a reader gets.
 *
 * Not RBAC, and not `workspace_content`: those answer who may **touch**
 * content, and they already exist.
 */

export { isOfferedIn, segmentIdsForTags } from './lib/segment';
export type { Segment } from './lib/segment';

export {
    ACCESS_MODE,
    OPEN_ACCESS,
    canRead,
    isOpen,
    sameAccess
} from './lib/entry-access';
export type { AccessMode, EntryAccess } from './lib/entry-access';

// The field rules, read by both the admin's dialog and the server's DTO — two
// copies of a validation rule is two copies to drift.
export {
    isValidSegment,
    validateSegment,
    SEGMENT_ISSUE,
    SEGMENT_KEY_MAX,
    SEGMENT_KEY_PATTERN,
    SEGMENT_LABEL_MAX,
    SEGMENT_TAG_MAX,
    SEGMENT_TAGS_MAX
} from './lib/validation';
export type {
    SegmentDraft,
    SegmentIssue,
    SegmentIssues
} from './lib/validation';

export {
    anonymousSegmentResolver,
    staticSegmentResolver
} from './lib/segment-resolver.port';
export type { SegmentResolver } from './lib/segment-resolver.port';
