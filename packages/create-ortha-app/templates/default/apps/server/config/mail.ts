// ortha:if mail
/**
 * Mail — whether this app sends anything, and what it sends as.
 *
 * **Unset is a complete configuration.** Leave `MAIL_PROVIDER` empty and this
 * returns `undefined`: no plugin, no queue, no worker, and the invite and reset
 * routes keep returning the raw link for an administrator to pass on by hand,
 * exactly as the product behaves with no mail installed at all. That is the
 * state a freshly scaffolded app runs in, so `npm run dev` works before you
 * have a relay.
 *
 * Naming a backend makes two further variables **required**, and `requireEnv`
 * is what says so at boot rather than on somebody's first invitation:
 *
 * - `APP_URL`, because every link in every message is built from it. It is
 *   deliberately not derived from the `Host` header — the caller controls that,
 *   and an invitation is the one message a recipient is certain to click.
 * - `MAIL_FROM`, because a message with no sender is refused by every relay.
 *
 * The backend's own connection settings live **here**, not in
 * `MailPluginConfig`: the plugin names no backend, the same way media's and the
 * copilot's do not. `src/plugins.ts` already imports the adapter factory, so
 * importing its options type costs no new coupling.
 */
import type { MailPluginConfig } from '@orthacms/mail-server';
// ortha:if mail-smtp
import type { SmtpMailProviderOptions } from '@orthacms/mail-provider-smtp';
// ortha:end
import {
    defined,
    readEnv,
    readFlag,
    readOptionalPositiveInt,
    requireEnv,
    when
} from '@orthacms/utils-server';

// ortha:if mail-smtp
/**
 * The backend this app was scaffolded with — one string, because a deployment
 * hands its messages to exactly one relay. Scaffolding with a different adapter
 * writes a different literal here.
 */
export type MailBackend = 'smtp';
// ortha:end

/** Mail settings, plus the connection settings for the one backend it runs. */
export interface AppMailConfig extends MailPluginConfig {
    /** Which adapter `src/plugins.ts` constructs. */
    backend: MailBackend;
    // ortha:if mail-smtp
    /** Whatever the SMTP adapter needs to reach the relay. */
    smtp: SmtpMailProviderOptions;
    // ortha:end
}

/** The backend named by `MAIL_PROVIDER`, or `undefined` when it is unset. */
function backend(): MailBackend | undefined {
    const value = readEnv('MAIL_PROVIDER');
    if (!value) return undefined;
    // ortha:if mail-smtp
    if (value === 'smtp') return value;
    // ortha:end
    // A misspelling must not read as "send nothing": that is the failure this
    // whole file is arranged to avoid — mail that looks configured and reaches
    // nobody.
    throw new Error(
        `MAIL_PROVIDER must be "smtp" (got ${JSON.stringify(value)}). ` +
            'Leave it unset for an app that sends no mail.'
    );
}

// ortha:if mail-smtp
/**
 * How to reach the relay.
 *
 * One adapter covers the market — Resend, SES, Postmark, SendGrid, Mailgun,
 * Google Workspace, Microsoft 365 and anything inside your own perimeter all
 * speak SMTP — so the host is the only value with no sensible default.
 */
function smtpTransport(): SmtpMailProviderOptions {
    return defined({
        host: requireEnv(
            'SMTP_HOST',
            'MAIL_PROVIDER=smtp needs a relay to hand messages to — e.g. smtp.example.com.'
        ),
        port: readOptionalPositiveInt('SMTP_PORT'),
        // Implicit TLS is the exception (port 465); on 587 the connection is
        // upgraded with STARTTLS instead, which is what the adapter does when
        // this is unset. `when` is what keeps an untouched line out of the way:
        // passing `false` here would turn STARTTLS off on a relay that wanted it.
        secure: when(readEnv('SMTP_SECURE'), () =>
            readFlag('SMTP_SECURE', false)
        ),
        user: readEnv('SMTP_USER'),
        password: readEnv('SMTP_PASSWORD'),
        requireTls: when(readEnv('SMTP_REQUIRE_TLS'), () =>
            readFlag('SMTP_REQUIRE_TLS', false)
        ),
        connectionTimeoutMs: readOptionalPositiveInt(
            'SMTP_CONNECTION_TIMEOUT_MS'
        )
    });
}
// ortha:end

/** The mail settings, or `undefined` when this app sends nothing. */
export function mailConfig(): AppMailConfig | undefined {
    const selected = backend();
    if (!selected) return undefined;

    return defined({
        backend: selected,
        appUrl: requireEnv(
            'APP_URL',
            'Mail is configured (MAIL_PROVIDER is set), and every link in a message is built ' +
                'from this absolute URL — e.g. https://cms.example.com.'
        ),
        from: requireEnv(
            'MAIL_FROM',
            'Mail is configured (MAIL_PROVIDER is set), so messages need a sender — e.g. ' +
                '"My CMS <no-reply@example.com>".'
        ),
        replyTo: readEnv('MAIL_REPLY_TO'),
        productName: readEnv('MAIL_PRODUCT_NAME'),
        // A delivery-debugging mode, and named as one: it keeps the raw link in
        // the API response *as well as* sending the message. Off everywhere it
        // is not being used to chase a message that did not arrive.
        revealLinks: readFlag('MAIL_REVEAL_LINKS', false),
        deliveryIntervalMs: readOptionalPositiveInt(
            'MAIL_DELIVERY_INTERVAL_MS'
        ),
        maxAttempts: readOptionalPositiveInt('MAIL_MAX_ATTEMPTS'),
        // ortha:if mail-smtp
        smtp: smtpTransport()
        // ortha:end
    });
}
// ortha:end
