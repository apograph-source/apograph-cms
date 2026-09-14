/**
 * `@apograph/mail-domain` — the framework-free kernel behind outgoing mail.
 *
 * Two seams and the copy between them: the **provider port** every adapter
 * implements, and the **dispatcher port** a use case that has just minted a
 * secret uses to get a message queued inside its own transaction. Neither
 * imports NestJS, Drizzle or a vendor SDK, so an adapter costs what an adapter
 * should — the same rule `@apograph/media-domain` documents, and the same
 * reason: installing a mail adapter should not install a web framework.
 *
 * The rule that keeps it true is in `package.json`: **no dependencies, of any
 * kind**, asserted by `package-manifest.spec.ts`.
 */

export {
    MAIL_PROVIDER,
    MailPermanentError,
    type MailCapabilities,
    type MailMessage,
    type MailProvider,
    type MailReceipt
} from './lib/mail-provider';

export {
    MAIL_DISPATCHER,
    MAIL_KINDS,
    type MailDispatcher,
    type MailKind,
    type RevealableLink,
    type TransactionalMail
} from './lib/mail-dispatcher';

export {
    ACCEPT_INVITE_PATH,
    RESET_PASSWORD_PATH,
    assertAppUrl,
    inviteLink,
    passwordResetLink
} from './lib/links';

export {
    DEFAULT_MAIL_TEMPLATES,
    escapeHtml,
    formatExpiry,
    type MailTemplate,
    type MailTemplateContext,
    type MailTemplates,
    type RenderedMail
} from './lib/templates';

export {
    DEFAULT_MAX_ATTEMPTS,
    JITTER_RATIO,
    RETRY_SCHEDULE_MS,
    isExhausted,
    nextAttemptDelayMs
} from './lib/retry-policy';
