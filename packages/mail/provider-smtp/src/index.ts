/**
 * `@orthacms/mail-provider-smtp` — the SMTP mail adapter, over `nodemailer`.
 *
 * The default answer for a self-hosted CMS: Resend, SES, Postmark, SendGrid,
 * Mailgun, Google Workspace, Microsoft 365 and any relay inside a perimeter are
 * all reachable through it, so one adapter covers the market. A vendor HTTP
 * adapter earns its own package when the wire genuinely differs, not because
 * SMTP is a fallback (ADR-0018).
 */

export {
    createSmtpMailProvider,
    type SmtpMailProviderOptions,
    type SmtpTransport
} from './lib/smtp-mail-provider';

export { describeSmtpError, isPermanentSmtpError } from './lib/smtp-error';
