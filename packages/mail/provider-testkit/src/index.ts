/**
 * `@orthacms/mail-provider-testkit` — the capturing mail adapter.
 *
 * Holds every message in memory so a suite can assert on what the CMS tried to
 * send, and can be told to fail — retryably or permanently — so the worker's
 * backoff and its dead-letter path are exercisable without a mail server.
 * Installed unconditionally, offered by no picker, registered by no template.
 */

export {
    createTestkitMailProvider,
    type CapturedMail,
    type TestkitMailProvider,
    type TestkitMailProviderOptions
} from './lib/testkit-mail-provider';
