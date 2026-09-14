import {
    DEFAULT_MAIL_TEMPLATES,
    DEFAULT_MAX_ATTEMPTS,
    type MailTemplates
} from '@apograph/mail-domain';

/**
 * Configuration for the mail plugin.
 *
 * Everything here is a deployment concern — the address messages come from, the
 * URL their links point at, how hard the worker pushes. **Provider credentials
 * are not here**: they belong to the factory the host imports, typed by it, the
 * same arrangement media and the copilot use.
 */
export interface MailPluginConfig {
    /**
     * The absolute URL the admin is served from — **required**, and new.
     *
     * The CMS has never needed an absolute URL. It is not derived from the
     * `Host` header, which the caller controls: an attacker-set `Host` turns an
     * invitation from your own domain into a phishing link, and an invitation
     * is the one message a recipient is certain to click (ADR-0018 §5).
     */
    appUrl: string;

    /**
     * The sender, as it appears to the recipient. A bare address or a
     * `Name <address>` pair, whichever the relay accepts.
     */
    from: string;

    /** Where replies should go, when it is not `from`. */
    replyTo?: string;

    /**
     * How the product refers to itself in the copy. A deployment that renamed
     * the CMS for its editors sets it here rather than overriding three
     * templates to change one word.
     */
    productName?: string;

    /**
     * Keep returning the raw token from the invite and reset routes **as well
     * as** sending the message.
     *
     * Off, and it should stay off outside of debugging a delivery problem: two
     * copies of an account-takeover secret are worse than one, and the second
     * lands in an administrator's clipboard, their terminal scrollback and
     * whatever logs the response passed through.
     */
    revealLinks?: boolean;

    /**
     * How often, in milliseconds, the worker looks for claimable messages. `0`
     * turns sending off in this process — rows still queue, so a deployment can
     * run the API without a sender and let one process do the sending.
     */
    deliveryIntervalMs?: number;

    /** How many messages one tick claims. */
    batchSize?: number;

    /** How many hand-off attempts a message gets before it is given up on. */
    maxAttempts?: number;

    /**
     * How long a claimed message is left alone before another worker may take
     * it, in milliseconds.
     *
     * This is the lease: claiming pushes `next_attempt_at` this far forward, so
     * a second process skips the row while the first is talking to the relay,
     * and a process that died mid-send releases it by timeout rather than
     * leaving it stuck. It must comfortably exceed however long a hand-off
     * takes, or a slow-but-live send is claimed twice and the message arrives
     * twice.
     */
    claimLeaseMs?: number;

    /** How often the worker sweeps messages whose token has expired. */
    sweepIntervalMs?: number;

    /**
     * Replacements for the shipped copy, by kind. The override hook: templates
     * are code, reviewed and in git, and this is where a host substitutes its
     * own — including as the answer to "the recipient does not read English",
     * which the first version does not otherwise have.
     */
    templates?: Partial<MailTemplates>;
}

/** Config with every optional filled in — what the services actually read. */
export interface ResolvedMailConfig {
    appUrl: string;
    from: string;
    replyTo?: string;
    productName: string;
    revealLinks: boolean;
    deliveryIntervalMs: number;
    batchSize: number;
    maxAttempts: number;
    claimLeaseMs: number;
    sweepIntervalMs: number;
    templates: MailTemplates;
}

/** Defaults chosen to be unsurprising next to somebody else's relay. */
export const MAIL_DEFAULTS = {
    productName: 'Apograph',
    revealLinks: false,
    deliveryIntervalMs: 2_000,
    batchSize: 20,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    // Twice the longest hand-off anybody should tolerate: long enough that a
    // slow relay is never claimed underneath a live send, short enough that a
    // crashed worker's messages move again within a minute.
    claimLeaseMs: 60_000,
    sweepIntervalMs: 5 * 60_000
} as const;

/** Fills the defaults in, so no service has to repeat a `??`. */
export function resolveMailConfig(
    config: MailPluginConfig
): ResolvedMailConfig {
    return {
        appUrl: config.appUrl,
        from: config.from,
        ...(config.replyTo ? { replyTo: config.replyTo } : {}),
        productName: config.productName ?? MAIL_DEFAULTS.productName,
        revealLinks: config.revealLinks ?? MAIL_DEFAULTS.revealLinks,
        deliveryIntervalMs:
            config.deliveryIntervalMs ?? MAIL_DEFAULTS.deliveryIntervalMs,
        batchSize: config.batchSize ?? MAIL_DEFAULTS.batchSize,
        maxAttempts: config.maxAttempts ?? MAIL_DEFAULTS.maxAttempts,
        claimLeaseMs: config.claimLeaseMs ?? MAIL_DEFAULTS.claimLeaseMs,
        sweepIntervalMs:
            config.sweepIntervalMs ?? MAIL_DEFAULTS.sweepIntervalMs,
        // A host overriding one template keeps the other two, rather than
        // having to restate copy it did not want to change.
        templates: { ...DEFAULT_MAIL_TEMPLATES, ...config.templates }
    };
}
