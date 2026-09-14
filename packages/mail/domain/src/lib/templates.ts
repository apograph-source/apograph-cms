/**
 * The copy.
 *
 * A template is a function from a typed payload to `{ subject, text, html }` —
 * code, reviewed, in git, on the same grounds the content model is. There is no
 * template editor in the admin and no plan for one; a deployment that wants
 * different words overrides the function in `MailPluginConfig.templates`.
 *
 * **English only, and said plainly.** `users` has no locale column and the
 * server has no i18n (ORT-113 records the same gap for the copilot's
 * user-facing text), so inventing server-side localisation here would be a
 * second feature wearing the first one's clothes. The override hook is what a
 * deployment needing another language uses meanwhile.
 */

import type { MailKind } from './mail-dispatcher';

/** What every template is handed. */
export interface MailTemplateContext {
    /** The recipient's name, when they have one. */
    recipientName?: string | null;
    /** Their address — the greeting falls back to it. */
    recipientEmail: string;
    /** Who performed the action, when it is known. */
    actorName?: string | null;
    /** The link, already absolute and carrying the token. */
    link: string;
    /** When the link stops working. */
    expiresAt: Date;
    /** How the product refers to itself in the copy. */
    productName: string;
}

/** A rendered message, short of its recipient. */
export interface RenderedMail {
    subject: string;
    text: string;
    html?: string;
}

/** A template: context in, rendered message out. Pure, and trivially testable. */
export type MailTemplate = (context: MailTemplateContext) => RenderedMail;

/** One template per kind. A host may override any subset. */
export type MailTemplates = Record<MailKind, MailTemplate>;

/**
 * The expiry, as a sentence a person can act on.
 *
 * UTC rather than the recipient's zone, because we do not know theirs: a time
 * silently rendered in the server's zone is worse than one that names the zone
 * it is in.
 */
export function formatExpiry(expiresAt: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'UTC'
    }).format(expiresAt);
}

/** How a message addresses its recipient. */
function greeting(context: MailTemplateContext): string {
    const name = context.recipientName?.trim();
    return name ? `Hello ${name},` : 'Hello,';
}

/** Who did the thing, for a sentence that reads either way. */
function actorClause(context: MailTemplateContext): string {
    const actor = context.actorName?.trim();
    return actor ? `${actor} has` : 'Somebody has';
}

/** Escapes the five characters that matter inside an HTML body. */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * The one HTML shape every message uses: a greeting, a sentence, the link as
 * both a button-ish anchor and its own text, and the expiry.
 *
 * The URL appears twice on purpose — a client that strips the anchor still
 * leaves something the recipient can copy.
 */
function htmlBody(lines: string[], link: string): string {
    const paragraphs = lines
        .map((line) => `        <p>${escapeHtml(line)}</p>`)
        .join('\n');
    const href = escapeHtml(link);
    return [
        '<!doctype html>',
        '<html lang="en">',
        '    <body style="font-family: system-ui, sans-serif; line-height: 1.5;">',
        paragraphs,
        `        <p><a href="${href}">${href}</a></p>`,
        '    </body>',
        '</html>',
        ''
    ].join('\n');
}

/** Assembles the text part from the same lines the HTML part uses. */
function textBody(lines: string[], link: string): string {
    return [...lines, '', link, ''].join('\n');
}

/** "You have been invited" — the first message the product ever sends. */
const invite: MailTemplate = (context) => {
    const lines = [
        greeting(context),
        `${actorClause(context)} invited you to ${context.productName}.`,
        'Follow the link below to accept the invitation and choose a password.',
        `The link expires on ${formatExpiry(context.expiresAt)} (UTC).`,
        'If you were not expecting this invitation you can ignore this message.'
    ];
    return {
        subject: `You have been invited to ${context.productName}`,
        text: textBody(lines, context.link),
        html: htmlBody(lines, context.link)
    };
};

/**
 * The same invitation again, said so.
 *
 * It is a separate template rather than a flag because the one thing the
 * recipient needs to know is that the *previous* link no longer works: a resend
 * rotates the token, so a copy still sitting in their inbox is dead.
 */
const inviteResent: MailTemplate = (context) => {
    const lines = [
        greeting(context),
        `Here is your invitation to ${context.productName} again.`,
        'Follow the link below to accept the invitation and choose a password. Any earlier ' +
            'invitation link has stopped working.',
        `The link expires on ${formatExpiry(context.expiresAt)} (UTC).`,
        'If you were not expecting this invitation you can ignore this message.'
    ];
    return {
        subject: `Your invitation to ${context.productName}`,
        text: textBody(lines, context.link),
        html: htmlBody(lines, context.link)
    };
};

/**
 * An administrator issued a reset.
 *
 * The last line is not filler: this message is not self-service, so a recipient
 * who did not ask for it is looking at somebody else resetting their password,
 * and the message should say who to talk to about that.
 */
const passwordReset: MailTemplate = (context) => {
    const lines = [
        greeting(context),
        `${actorClause(context)} started a password reset for your ${context.productName} account.`,
        'Follow the link below to choose a new password. Any earlier reset link has stopped working.',
        `The link expires on ${formatExpiry(context.expiresAt)} (UTC).`,
        'If you did not expect this, your password is unchanged — but tell your administrator ' +
            'that you received this message.'
    ];
    return {
        subject: `Reset your ${context.productName} password`,
        text: textBody(lines, context.link),
        html: htmlBody(lines, context.link)
    };
};

/** The shipped copy, one template per kind. */
export const DEFAULT_MAIL_TEMPLATES: MailTemplates = {
    invite,
    invite_resent: inviteResent,
    password_reset: passwordReset
};
