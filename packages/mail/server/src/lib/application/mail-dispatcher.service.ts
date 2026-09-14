import { Injectable } from '@nestjs/common';
import {
    MAIL_KINDS,
    inviteLink,
    passwordResetLink,
    type MailDispatcher,
    type MailKind,
    type RevealableLink,
    type TransactionalMail
} from '@apograph/mail-domain';
import { InjectMailConfig } from '../mail.tokens';
import type { ResolvedMailConfig } from '../types/mail-config';
import { MailDeliveryRepository } from '../infrastructure/mail-delivery.repository';

/**
 * Renders a transactional message and queues it in the caller's transaction.
 *
 * This is the adapter behind `MAIL_DISPATCHER`, the port `users-server` injects
 * optionally. Rendering happens here rather than at the call site for two
 * reasons: the copy and the `appUrl` it needs are this plugin's configuration,
 * and a caller that assembled its own body would be a second place the product
 * decides what an invitation says.
 */
@Injectable()
export class MailDispatcherService implements MailDispatcher {
    constructor(
        private readonly deliveries: MailDeliveryRepository,
        @InjectMailConfig() private readonly config: ResolvedMailConfig
    ) {}

    /** Whether the deployment is in link-revealing (delivery-debugging) mode. */
    get revealsLinks(): boolean {
        return this.config.revealLinks;
    }

    /**
     * Renders `mail` and writes it to the queue.
     *
     * The write joins the caller's open transaction — the repository refuses
     * otherwise — so the message commits with the token it carries, or neither
     * of them does.
     */
    async enqueue(mail: TransactionalMail): Promise<void> {
        const link = this.linkFor(mail.kind, mail.token);
        const rendered = this.config.templates[mail.kind]({
            recipientName: mail.recipientName ?? null,
            recipientEmail: mail.to,
            actorName: mail.actorName ?? null,
            link,
            expiresAt: mail.expiresAt,
            productName: this.config.productName
        });

        await this.deliveries.enqueue({
            kind: mail.kind,
            toAddress: mail.to,
            subject: rendered.subject,
            bodyText: rendered.text,
            ...(rendered.html ? { bodyHtml: rendered.html } : {}),
            link,
            userId: mail.userId,
            expiresAt: mail.expiresAt
        });
    }

    /** The link of the newest message to this user that never got out. */
    async revealableLink(userId: string): Promise<RevealableLink | null> {
        const row = await this.deliveries.newestUndeliveredFor(userId);
        if (!row?.link) return null;

        return {
            kind: row.kind as MailKind,
            link: row.link,
            queuedAt: row.createdAt,
            attempts: row.attempts,
            lastError: row.lastError
        };
    }

    /** Which admin route this kind of message points at. */
    private linkFor(kind: MailKind, token: string): string {
        return kind === MAIL_KINDS.PASSWORD_RESET
            ? passwordResetLink(this.config.appUrl, token)
            : inviteLink(this.config.appUrl, token);
    }
}
