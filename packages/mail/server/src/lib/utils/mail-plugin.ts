import { join } from 'node:path';
import type { ServerPlugin } from '@orthacms/bootstrap-server';
import { assertAppUrl, type MailProvider } from '@orthacms/mail-domain';
import { MailModule } from '../mail.module';
import type { MailPluginConfig } from '../types/mail-config';

/** The mail plugin, carrying its config alongside the standard shape. */
export interface MailServerPluginType extends ServerPlugin {
    /** The configuration this plugin was constructed with. */
    mailConfig: MailPluginConfig;
}

/** Options the host passes to {@link MailServerPlugin}. */
export interface MailPluginOptions {
    /**
     * The one mail backend this deployment runs, already constructed with its
     * own settings — `createSmtpMailProvider(…)`, `createConsoleMailProvider()`,
     * or anything else implementing the port.
     *
     * One object, not a list: a message goes to a single relay, so there is
     * nothing to choose between and no name to register. Swapping backend is
     * swapping this expression.
     */
    provider: MailProvider;
    /** Host config — the sender, the app URL, the worker's pacing. */
    config: MailPluginConfig;
}

/**
 * Rejects a configuration that would misbehave rather than fail loudly.
 *
 * Everything here is cheaper to catch at construction than from a delivery log:
 * a missing `appUrl` produces links to nowhere, a `claimLeaseMs` under the time
 * a hand-off takes sends every slow message twice, and a zero `batchSize` is a
 * worker that claims nothing and looks exactly like a worker with nothing to
 * do.
 */
function assertOptions(options: MailPluginOptions): void {
    const provider = options.provider as MailProvider | undefined;
    if (!provider) {
        throw new Error(
            'MailServerPlugin requires a mail provider. Construct one at the composition root, ' +
                'e.g. `provider: createSmtpMailProvider(config.plugins.mail.smtp)`.'
        );
    }
    if (typeof provider.id !== 'string' || !provider.id.trim()) {
        throw new Error(
            "MailServerPlugin's provider must expose a non-empty `id` — it is stamped on every " +
                'delivery row, so an operator chasing a message can tell which backend had it.'
        );
    }
    if (!provider.capabilities) {
        throw new Error(
            `The mail provider "${provider.id}" declares no \`capabilities\`. Every provider must ` +
                'state what it supports; the core has no way to detect it.'
        );
    }
    if (provider.capabilities.verifiable && !provider.verify) {
        throw new Error(
            `The mail provider "${provider.id}" declares \`capabilities.verifiable\` but implements ` +
                'no `verify()`. Declare the capability only when the method exists.'
        );
    }

    // Required, and the reason the plugin is constructed with a config at all:
    // every link in every message is built from it.
    assertAppUrl(options.config.appUrl);

    if (!options.config.from || !options.config.from.trim()) {
        throw new Error(
            'MailServerPlugin requires a `from` address — a message with no sender is refused by ' +
                'every relay, and the refusal would only surface on somebody’s first invitation.'
        );
    }

    const positive: Array<[keyof MailPluginConfig, number | undefined]> = [
        ['batchSize', options.config.batchSize],
        ['maxAttempts', options.config.maxAttempts],
        ['claimLeaseMs', options.config.claimLeaseMs],
        ['sweepIntervalMs', options.config.sweepIntervalMs]
    ];
    for (const [key, value] of positive) {
        if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
            throw new Error(
                `MailServerPlugin: ${String(key)} must be a positive integer; got ${value}.`
            );
        }
    }

    // Zero is a real choice here — "do not send from this process" — so only a
    // negative value is refused.
    const interval = options.config.deliveryIntervalMs;
    if (
        interval !== undefined &&
        (!Number.isInteger(interval) || interval < 0)
    ) {
        throw new Error(
            `MailServerPlugin: deliveryIntervalMs must be a non-negative integer (0 disables sending ` +
                `in this process); got ${interval}.`
        );
    }
}

/**
 * Creates the mail plugin — the CMS's outgoing messages.
 *
 * Register it **after** `DatabasePlugin` (the client it injects and the unit of
 * work it joins) and **before** `UsersPlugin`, whose invite, resend and reset
 * use cases queue through the port this binds. It owns one table —
 * `mail_deliveries` — and ships its migrations under its own tracking table.
 *
 * **Registering it changes the API.** With a provider configured the invite and
 * reset routes stop returning the raw token, because two copies of an
 * account-takeover secret are worse than one (ADR-0018 §4). A deployment that
 * wants both during a delivery problem sets `revealLinks`, which is labelled as
 * the debugging mode it is; `POST /api/users/:id/reveal-link` is the audited
 * way to see one otherwise.
 *
 * @example
 * ```typescript
 * createServer({
 *   plugins: [
 *     DatabasePlugin({ connectionString: config.database.url }),
 *     IdentityPlugin(config.plugins.identity),
 *     MailServerPlugin({
 *       provider: createSmtpMailProvider(config.plugins.mail.smtp),
 *       config: config.plugins.mail
 *     }),
 *     UsersPlugin()
 *   ]
 * });
 * ```
 */
export function MailServerPlugin(
    options: MailPluginOptions
): MailServerPluginType {
    assertOptions(options);
    return {
        name: 'mail',
        module: MailModule.forRoot(options),
        mailConfig: options.config,
        migrations: {
            // Lazy — only called at migrate time. Source layout: src/lib/utils
            // → ../../../migrations = <pkg>/migrations.
            dir: () => join(__dirname, '../../../migrations'),
            table: '__drizzle_migrations_mail'
        }
    };
}
