import type { ValidationIssue } from '@orthacms/content-domain';

/**
 * Raised by {@link Entry.publish} when the publish gate fails — the entry's
 * stored values (and/or its required link-managed relations) don't yet satisfy
 * the publish precondition. Transport-agnostic: it carries the {@link issues}
 * so the application layer can map it to the plugin's existing `422
 * { message, issues }` response without the domain knowing about HTTP.
 */
export class EntryPublishBlockedError extends Error {
    constructor(public readonly issues: ValidationIssue[]) {
        super('Entry validation failed');
        this.name = 'EntryPublishBlockedError';
    }
}
