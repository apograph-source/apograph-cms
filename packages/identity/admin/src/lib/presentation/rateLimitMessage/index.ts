import { defineMessages, type IntlShape } from 'react-intl';
import { HTTP_STATUS, type ApiError } from '@orthacms/utils-admin';

/**
 * The rate-limit copy, in one place because three auth pages need the same
 * sentence: sign-in, the reset-password form, and accepting an invite all sit
 * behind `ThrottlerGuard`, and all three used to fold its answer into their
 * "Something went wrong" catch-all.
 */
const messages = defineMessages({
    rateLimited: {
        id: 'identity.error.rateLimited',
        defaultMessage:
            'Too many attempts from this device. Wait a moment, then try again.'
    },
    rateLimitedIn: {
        id: 'identity.error.rateLimitedIn',
        defaultMessage:
            'Too many attempts from this device. Try again in {seconds, plural, one {# second} other {# seconds}}.'
    }
});

/**
 * The message for a rate-limited request, or `undefined` when the failure is
 * something else and the caller's own mapping should decide.
 *
 * **A 429 is not "something went wrong".** The request was well formed, the
 * credentials may have been right, and the answer is temporary — so the generic
 * copy's advice ("please try again") is the one instruction guaranteed not to
 * work. Three of these pages sit behind `ThrottlerGuard` and every one of them
 * used to say it.
 *
 * The wait is named only when the server named it (`Retry-After`, which
 * `@nestjs/throttler` always sends). Inventing "about a minute" would be a
 * number the user watches expire and finds still wrong.
 *
 * It says nothing about whether the account exists. The limit is keyed on the
 * caller's address, not on the identity they claimed, so it is not an
 * enumeration signal the way a different answer per email would be — the
 * sign-in page's one message for a bad password and an unknown address is
 * untouched.
 */
export function rateLimitMessage(
    intl: IntlShape,
    error: ApiError | null | undefined
): string | undefined {
    if (error?.status !== HTTP_STATUS.TOO_MANY_REQUESTS) {
        return undefined;
    }
    return error.retryAfterSeconds
        ? intl.formatMessage(messages.rateLimitedIn, {
              seconds: error.retryAfterSeconds
          })
        : intl.formatMessage(messages.rateLimited);
}
