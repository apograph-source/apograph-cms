/** Mail — the one backend this deployment sends through, and what it sends as. */
import type { MailPluginConfig } from '@orthacms/mail-server';
import type { SmtpMailProviderOptions } from '@orthacms/mail-provider-smtp';

import {
    defined,
    readEnv,
    readFlag,
    readOptionalPositiveInt,
    requireEnv,
    when
} from '@orthacms/utils-server';

/**
 * Which backend `plugins.ts` constructs, or `undefined` for a deployment that
 * sends nothing.
 *
 * `console` is deliberately selectable here and nowhere else — it is not
 * offered by the scaffolder's picker and no template names it (ADR-0018 §6) —
 * because reading an invitation link out of the dev server's log is exactly
 * what it is for. It is never a production answer: with a provider configured
 * the API stops returning the link, so an install that "sends" to a log would
 * quietly deliver nothing to anyone.
 */
export type MailBackend = 'smtp' | 'console';

/**
 * Mail settings, plus the connection settings for the one backend this
 * deployment runs.
 *
 * The backend settings live **here**, not in `MailPluginConfig`, for the same
 * reason media's and the copilot's do: the plugin names no backend.
 * `plugins.ts` already imports the adapter factory, so importing its config
 * type costs no new coupling.
 */
export interface OrthaCmsMailConfig extends MailPluginConfig {
    /** Which adapter `plugins.ts` constructs. */
    backend: MailBackend;
    /** Whatever the SMTP adapter needs; absent on `console`. */
    smtp?: SmtpMailProviderOptions;
}

/** The backend named by `MAIL_PROVIDER`, or `undefined` when it is unset. */
function backend(): MailBackend | undefined {
    const value = readEnv('MAIL_PROVIDER');
    if (!value) return undefined;
    if (value === 'smtp' || value === 'console') return value;
    throw new Error(
        `MAIL_PROVIDER must be "smtp" or "console" (got ${JSON.stringify(value)}). ` +
            'Leave it unset for a deployment that sends no mail.'
    );
}

/**
 * The mail settings, or `undefined` when this deployment sends nothing.
 *
 * **Unset is a complete configuration**, and the one a fresh clone runs: no
 * queue, no worker, and the invite and reset routes keep returning the raw
 * token for an administrator to relay by hand, exactly as they always have.
 *
 * Setting `MAIL_PROVIDER` makes two further variables required rather than
 * optional, and `requireEnv` is what says so at boot:
 *
 * - `APP_URL`, because every link in every message is built from it and the CMS
 *   has never needed an absolute URL before. It is deliberately not derived
 *   from the `Host` header — the caller controls that, and an invitation is the
 *   one message a recipient is certain to click (ADR-0018 §5).
 * - `MAIL_FROM`, because a message with no sender is refused by every relay,
 *   and the refusal would otherwise surface on somebody's first invitation
 *   rather than at boot.
 */
export function mailConfig(): OrthaCmsMailConfig | undefined {
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
                '"Ortha CMS <no-reply@example.com>".'
        ),
        replyTo: readEnv('MAIL_REPLY_TO'),
        productName: readEnv('MAIL_PRODUCT_NAME'),
        // A delivery-debugging mode, and named as one: it keeps the raw token in
        // the API response *as well as* sending the message. Off everywhere it
        // is not being used to chase a message that did not arrive.
        revealLinks: readFlag('MAIL_REVEAL_LINKS', false),
        // `0` runs the API without a sender in this process — rows still queue,
        // which is how a deployment hands sending to one worker.
        deliveryIntervalMs: readOptionalPositiveInt(
            'MAIL_DELIVERY_INTERVAL_MS'
        ),
        maxAttempts: readOptionalPositiveInt('MAIL_MAX_ATTEMPTS'),
        smtp: when(selected === 'smtp', () =>
            defined({
                host: requireEnv(
                    'SMTP_HOST',
                    'MAIL_PROVIDER=smtp needs a relay to hand messages to — e.g. smtp.example.com.'
                ),
                port: readOptionalPositiveInt('SMTP_PORT'),
                // Implicit TLS is the exception (port 465); on 587 the
                // connection is upgraded with STARTTLS instead, which is what
                // the adapter does when this is unset.
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
            })
        )
    });
}
