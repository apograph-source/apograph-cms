import { createTransport } from 'nodemailer';
import {
    MailPermanentError,
    type MailMessage,
    type MailProvider,
    type MailReceipt
} from '@apograph/mail-domain';
import { describeSmtpError, isPermanentSmtpError } from './smtp-error';

/** What this deployment's SMTP relay needs to be reached. */
export interface SmtpMailProviderOptions {
    /** Host name of the relay. */
    host: string;
    /** Port. Defaults to 587, the submission port. */
    port?: number;
    /**
     * Whether the connection is TLS from the first byte (port 465). Defaults to
     * `port === 465`; on 587 the connection is upgraded with STARTTLS instead,
     * which is what nodemailer does when this is false.
     */
    secure?: boolean;
    /** Username, when the relay authenticates. */
    user?: string;
    /** Password or API key, when the relay authenticates. */
    password?: string;
    /**
     * Refuse to continue on a relay that cannot do STARTTLS. Off by default
     * because a relay inside a perimeter often has no certificate at all, which
     * is a legitimate self-hosted arrangement; a relay on the public internet
     * should have this on.
     */
    requireTls?: boolean;
    /**
     * Accept a certificate that does not verify. **Off**, and worth leaving
     * off: the credentials for the sending domain go over this connection.
     */
    allowInvalidCertificate?: boolean;
    /** How long to wait for the connection, in milliseconds. */
    connectionTimeoutMs?: number;
    /**
     * A transport to use instead of building one. Only for tests — the suite
     * hands in a double rather than standing up an SMTP server.
     */
    transport?: SmtpTransport;
}

/**
 * The two methods this adapter uses, named structurally rather than as
 * `Pick<Transporter, …>`.
 *
 * nodemailer's own type is generic over the transport's result and carries a
 * dozen overloads, so a test double satisfying it is a page of casts — and this
 * is the seam a test *has* to replace, since the alternative is standing up an
 * SMTP server to assert that a subject line was passed through.
 */
export interface SmtpTransport {
    sendMail(
        message: Record<string, unknown>
    ): Promise<{ messageId?: string } | undefined>;
    verify?(): Promise<unknown>;
}

/**
 * The default answer, and not a fallback.
 *
 * SMTP is the market for a self-hosted product: Resend, SES, Postmark,
 * SendGrid, Mailgun, Google Workspace, Microsoft 365 and every relay inside a
 * perimeter all speak it. A vendor HTTP adapter earns its own package when the
 * wire genuinely differs (ADR-0018), not because SMTP is somehow lesser.
 */
export function createSmtpMailProvider(
    options: SmtpMailProviderOptions
): MailProvider {
    assertOptions(options);

    const port = options.port ?? 587;
    const transport: SmtpTransport =
        options.transport ??
        createTransport({
            host: options.host,
            port,
            secure: options.secure ?? port === 465,
            requireTLS: options.requireTls ?? false,
            ...(options.user
                ? { auth: { user: options.user, pass: options.password ?? '' } }
                : {}),
            ...(options.allowInvalidCertificate
                ? { tls: { rejectUnauthorized: false } }
                : {}),
            ...(options.connectionTimeoutMs
                ? { connectionTimeout: options.connectionTimeoutMs }
                : {})
        });

    return {
        id: 'smtp',
        capabilities: {
            // nodemailer returns the relay's queue id on every accepted
            // message, which is the string an operator greps the relay's log
            // for.
            messageId: true,
            verifiable: true
        },
        async send(message: MailMessage): Promise<MailReceipt> {
            try {
                const info = await transport.sendMail({
                    from: message.from,
                    to: message.to,
                    ...(message.replyTo ? { replyTo: message.replyTo } : {}),
                    subject: message.subject,
                    text: message.text,
                    ...(message.html ? { html: message.html } : {}),
                    ...(message.headers ? { headers: message.headers } : {})
                });
                return info?.messageId
                    ? { providerMessageId: info.messageId }
                    : {};
            } catch (error) {
                throw translate(error);
            }
        },
        async verify(): Promise<void> {
            try {
                await transport.verify?.();
            } catch (error) {
                // Boot-time: whatever went wrong, the deployment is not going
                // to send mail, so the distinction is only in the message.
                throw new Error(
                    `SMTP relay ${options.host}:${port} refused the connection — ${describeSmtpError(error)}`,
                    { cause: error }
                );
            }
        }
    };
}

/** Turns a nodemailer rejection into the port's retryable/permanent split. */
function translate(error: unknown): unknown {
    return isPermanentSmtpError(error)
        ? new MailPermanentError(describeSmtpError(error), error)
        : error;
}

/** Refuses a configuration that can only fail later, and says what is wrong. */
function assertOptions(options: SmtpMailProviderOptions): void {
    if (!options.host || !options.host.trim()) {
        throw new Error(
            'createSmtpMailProvider requires a `host` — the relay to hand messages to, e.g. ' +
                '`smtp.example.com`.'
        );
    }
    const port = options.port;
    if (
        port !== undefined &&
        (!Number.isInteger(port) || port < 1 || port > 65_535)
    ) {
        throw new Error(
            `createSmtpMailProvider: port must be a TCP port (got ${port}).`
        );
    }
    if (options.password && !options.user) {
        // Almost always a half-filled environment: the password reached the
        // config and the username did not, and the connection would go out
        // unauthenticated and be refused with no hint as to why.
        throw new Error(
            'createSmtpMailProvider was given a password but no user — the connection would be ' +
                'made unauthenticated. Set both, or neither.'
        );
    }
}
