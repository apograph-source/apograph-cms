import { ApiError } from '@orthacms/utils-admin';

/** The error envelope Nest sends: `message` is a string, or an array for DTOs. */
type ErrorBody = { message?: unknown };

/**
 * The server's own explanation of a failure, or `undefined` when there isn't
 * one.
 *
 * `toApiError` puts the **transport's** description in `ApiError.message`
 * ("Request failed with status code 413") and the parsed **body** in
 * `details` — so a call site that reads `error.message` shows the user a status
 * code where the API sent a sentence ("File exceeds the maximum upload size.",
 * "Invalid file name: a/b.txt"). Everything media renders to a human goes
 * through here instead, falling back to its own copy when the body carries
 * nothing usable.
 *
 * A `ValidationPipe` rejection puts several strings in `message`; the first is
 * the one that names the offending field, so that is what is shown.
 */
export function apiMessage(error: unknown): string | undefined {
    if (!(error instanceof ApiError)) return undefined;
    const body = error.details as ErrorBody | undefined;
    const message = body?.message;
    if (typeof message === 'string' && message.trim() !== '') return message;
    if (Array.isArray(message)) {
        const first = message.find(
            (entry) => typeof entry === 'string' && entry.trim() !== ''
        );
        if (typeof first === 'string') return first;
    }
    return undefined;
}
