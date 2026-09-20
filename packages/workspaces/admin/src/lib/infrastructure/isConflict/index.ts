import { ApiError } from '@orthacms/utils-admin';

/** HTTP 409 — the server's "still has content / entries" conflict response. */
const CONFLICT = 409;

/**
 * Whether an error is the server's `409 Conflict` — the shared signal that a
 * block-before-you-act guard (delete a non-empty workspace, revoke a non-empty
 * content type) rejected the mutation. Centralized so the status literal and the
 * `ApiError` narrowing live in one place across the settings dialogs.
 */
export function isConflict(error: unknown): boolean {
    return error instanceof ApiError && error.status === CONFLICT;
}
