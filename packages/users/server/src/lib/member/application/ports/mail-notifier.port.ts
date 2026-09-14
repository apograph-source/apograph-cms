import {
    MAIL_DISPATCHER,
    MAIL_KINDS,
    type MailDispatcher
} from '@apograph/mail-domain';

/**
 * How this context reaches the mailer, and the one decision that comes with it.
 *
 * The dispatcher is injected `@Optional()` everywhere it is used, because a
 * deployment that configured no mail provider registers no mail plugin and
 * binds nothing. That absence is not an error state — it is the product's
 * behaviour to date, and ADR-0018 §4 makes it the switch: with no dispatcher
 * the invite and reset routes hand the raw token back exactly as they always
 * have; with one they stop, because two copies of an account-takeover secret
 * are worse than one.
 *
 * `revealLinks` is the deliberate exception, for debugging a delivery problem —
 * it sends the message *and* returns the link, and says in its own name that it
 * is a mode rather than a default.
 */
export { MAIL_DISPATCHER, MAIL_KINDS, type MailDispatcher };

/**
 * Whether the raw token still belongs in the API response.
 *
 * `null` dispatcher → yes, nothing was sent and the administrator is the
 * delivery channel. A dispatcher in link-revealing mode → yes, alongside the
 * message. Otherwise → no, and the field is **absent** rather than empty, so a
 * client that reads it fails loudly instead of pasting `undefined` into a chat
 * window.
 */
export function shouldReturnToken(
    dispatcher: MailDispatcher | null | undefined
): boolean {
    return !dispatcher || dispatcher.revealsLinks;
}
