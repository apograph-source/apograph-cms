import { ApiError } from '@orthacms/utils-admin';
import type { EntryValidationIssue } from '../../domain/types/contentType';

/**
 * Pull the per-field validation issues out of a write error. The entry-write API
 * returns 422 with a `{ message, issues: [{ field, message }] }` body on a
 * validation failure; everything else (404, 403, network) has no issues. Returns
 * `[]` for any non-422 / unshaped error so callers can branch on `length`.
 */
export function entryIssuesFrom(error: unknown): EntryValidationIssue[] {
    if (!(error instanceof ApiError) || error.status !== 422) return [];
    const issues = (error.details as { issues?: unknown })?.issues;
    if (!Array.isArray(issues)) return [];
    return issues.filter(
        (issue): issue is EntryValidationIssue =>
            typeof issue === 'object' &&
            issue !== null &&
            typeof (issue as EntryValidationIssue).field === 'string' &&
            typeof (issue as EntryValidationIssue).message === 'string'
    );
}
