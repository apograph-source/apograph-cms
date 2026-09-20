/**
 * Public API of `@orthacms/protection-admin` — publication protection as the
 * person editing an entry meets it.
 *
 * Four contributions into other people's screens — a chip beside an entry's
 * title, a Review block in the properties rail, the verdict that decides what
 * the Publish button says, and a Protection tab in workspace settings — plus
 * one page of its own, the reviewer's queue. Every entry contribution is silent
 * on a type nobody protected; the settings tab and the queue are not, because
 * they are where a workspace with no rule goes to get one and where a reviewer
 * finds out an approval is wanted.
 */

export { ProtectionPlugin } from './lib/presentation/protectionPlugin';
export type { ProtectionAdminPlugin } from './lib/presentation/protectionPlugin';

// The review read, exported so a surface added later (the records column) reads
// the same endpoint through the same cache rather than a second copy of it.
export { useEntryReview, reviewScopeOf } from './lib/application/hooks';
export type { EntryReviewScope } from './lib/application/hooks';
export type {
    EntryReview,
    ReviewApproval,
    ReviewRequest,
    ReviewTone
} from './lib/domain/types';
export { toneOf } from './lib/domain/types';
