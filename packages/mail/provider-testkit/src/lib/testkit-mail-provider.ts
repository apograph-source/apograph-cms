import {
    MailPermanentError,
    type MailMessage,
    type MailProvider,
    type MailReceipt
} from '@orthacms/mail-domain';

/** A message the provider was handed, with the attempt it arrived on. */
export interface CapturedMail extends MailMessage {
    /** When it was captured, so a test can assert ordering. */
    capturedAt: Date;
}

/** The capturing provider, plus the handles a test drives it by. */
export interface TestkitMailProvider extends MailProvider {
    /** Everything handed over so far, oldest first. */
    readonly sent: readonly CapturedMail[];
    /** The most recent message, or `undefined`. */
    last(): CapturedMail | undefined;
    /** Forgets everything captured. */
    reset(): void;
    /**
     * Fails the next `times` hand-offs with a **retryable** error, so a test can
     * watch the worker back off and come back.
     */
    failNext(times?: number, message?: string): void;
    /**
     * Fails every hand-off from now on with a **permanent** error, so a test can
     * watch a row stop at once instead of spending its budget.
     */
    failPermanently(message?: string): void;
    /** Stops failing. */
    succeed(): void;
}

/** Options for {@link createTestkitMailProvider}. */
export interface TestkitMailProviderOptions {
    /** The id recorded on rows this provider handled. Defaults to `testkit`. */
    id?: string;
    /** Whether it hands back a provider message id. Defaults to `true`. */
    messageId?: boolean;
}

/**
 * Captures messages in memory instead of sending them.
 *
 * The counterpart of `@orthacms/media-provider-testkit`, and installed under
 * the same rule as the console adapter: shipped with every app, offered by no
 * picker, registered by no template. A test asserts on `sent`; a suite that
 * needs to watch the retry path drives `failNext` / `failPermanently`.
 */
export function createTestkitMailProvider(
    options: TestkitMailProviderOptions = {}
): TestkitMailProvider {
    const captured: CapturedMail[] = [];
    let retryableFailures = 0;
    let retryableMessage = 'testkit: the mail server is unavailable.';
    let permanentMessage: string | null = null;
    let counter = 0;

    return {
        id: options.id ?? 'testkit',
        capabilities: {
            messageId: options.messageId ?? true,
            verifiable: true
        },
        get sent(): readonly CapturedMail[] {
            return captured;
        },
        last(): CapturedMail | undefined {
            return captured[captured.length - 1];
        },
        reset(): void {
            captured.length = 0;
            retryableFailures = 0;
            permanentMessage = null;
        },
        failNext(times = 1, message?: string): void {
            retryableFailures = times;
            if (message) retryableMessage = message;
        },
        failPermanently(message = 'testkit: the address was rejected.'): void {
            permanentMessage = message;
        },
        succeed(): void {
            retryableFailures = 0;
            permanentMessage = null;
        },
        async verify(): Promise<void> {
            if (permanentMessage) {
                throw new MailPermanentError(permanentMessage);
            }
        },
        async send(message: MailMessage): Promise<MailReceipt> {
            if (permanentMessage) {
                // Nothing is captured: a permanent rejection means the message
                // was never handed over, and a test that asserted on `sent`
                // would otherwise see one that does not exist.
                throw new MailPermanentError(permanentMessage);
            }
            if (retryableFailures > 0) {
                retryableFailures -= 1;
                throw new Error(retryableMessage);
            }
            captured.push({ ...message, capturedAt: new Date() });
            counter += 1;
            return (options.messageId ?? true)
                ? { providerMessageId: `testkit-${counter}` }
                : {};
        }
    };
}
