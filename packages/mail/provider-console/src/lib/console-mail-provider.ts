import type {
    MailMessage,
    MailProvider,
    MailReceipt
} from '@ortha/mail-domain';

/** Where the adapter writes. Injectable purely so a test can read it back. */
export type ConsoleMailSink = (line: string) => void;

/** Options for {@link createConsoleMailProvider}. */
export interface ConsoleMailProviderOptions {
    /** Where to write. Defaults to `console.info`. */
    sink?: ConsoleMailSink;
    /**
     * Whether to print the body as well as the headers. On by default: the
     * whole reason to run this adapter is to read the link during development,
     * and the link is in the body.
     */
    includeBody?: boolean;
}

/** Renders one message as something a person can read in a terminal. */
function format(message: MailMessage, includeBody: boolean): string {
    const header = [
        '--- mail (console provider) ---',
        `To:      ${message.to}`,
        `Subject: ${message.subject}`
    ];
    for (const [name, value] of Object.entries(message.headers ?? {})) {
        header.push(`${name}: ${value}`);
    }
    if (!includeBody) {
        return [...header, '---'].join('\n');
    }
    return [...header, '', message.text, '---'].join('\n');
}

/**
 * Writes every message to the log instead of sending it.
 *
 * **Ships with every app, is offered by no picker and is registered by no
 * template** — the `identity-provider-fake` pattern, and for a sharper reason
 * than usual. A scripted adapter that reached a deployment by accident would
 * not fail loudly: invitations would appear to be sent, the API would stop
 * returning the link because a provider *is* configured, and nobody would
 * receive anything. ORT-148 is the same mistake with a copilot attached.
 *
 * So this is a development and diagnostic tool: run it to read the link out of
 * the server log without standing up a mail server.
 */
export function createConsoleMailProvider(
    options: ConsoleMailProviderOptions = {}
): MailProvider {
    const sink = options.sink ?? ((line: string) => console.info(line));
    const includeBody = options.includeBody ?? true;

    return {
        id: 'console',
        capabilities: {
            // Nothing hands an id back; the worker records none.
            messageId: false,
            // There is nothing to check, and a boot check that always passes
            // proves nothing — so it declares that rather than pretending.
            verifiable: false
        },
        async send(message: MailMessage): Promise<MailReceipt> {
            sink(format(message, includeBody));
            return {};
        }
    };
}
