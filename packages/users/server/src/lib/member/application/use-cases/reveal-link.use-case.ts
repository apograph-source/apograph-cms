import { Inject, Injectable, Optional } from '@nestjs/common';
import { attachActor, OutboxWriter, UnitOfWork } from '@apograph/database';
import type { PublicUser } from '@apograph/identity-server';
import { MemberId } from '../../domain/value-objects/member-id';
import {
    MailNotConfiguredError,
    MemberNotFoundError,
    NoRevealableLinkError
} from '../../domain/errors';
import {
    MEMBER_EVENT_KINDS,
    memberEvent
} from '../../domain/events/member-events';
import {
    MEMBER_REPOSITORY,
    type MemberRepository
} from '../../domain/member.repository';
import {
    MAIL_DISPATCHER,
    type MailDispatcher
} from '../ports/mail-notifier.port';

/** The link of a message that never left, plus why it did not. */
export interface RevealedLink {
    /** Which message it belongs to — `invite`, `invite_resent`, `password_reset`. */
    kind: string;
    /** The link itself. The secret. */
    link: string;
    /** When the message was queued. */
    queuedAt: Date;
    /** How many hand-off attempts have failed. */
    attempts: number;
    /** What the provider said last, when it said anything. */
    lastError: string | null;
}

/**
 * Hands an administrator the link of a message that has not been delivered.
 *
 * **The exception, and shaped as one.** Once a provider is configured no route
 * returns a raw token any more (ADR-0018 §4) — this is the single way to see
 * one, it is gated on `users:manage`, and every use writes
 * `user.invite_link_revealed` to the audit trail. That is the same operation
 * that happens silently today, made visible.
 *
 * It can only ever produce an **undelivered** message's link: a delivered row
 * is deleted the moment the relay accepts it, secret and all. So a message that
 * arrived has nothing to reveal, which is the point — the answer there is to
 * resend, which rotates the token and invalidates whatever is in the recipient's
 * inbox.
 */
@Injectable()
export class RevealLinkUseCase {
    constructor(
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        @Inject(MEMBER_REPOSITORY)
        private readonly members: MemberRepository,
        @Optional()
        @Inject(MAIL_DISPATCHER)
        private readonly mail?: MailDispatcher
    ) {}

    /**
     * Returns the outstanding link for `id`. 404s an unknown member; 409s a
     * deployment that sends no mail, and one with nothing left to reveal.
     */
    async execute(actor: PublicUser, id: string): Promise<RevealedLink> {
        const memberId = MemberId.create(id);

        return this.uow.run(async () => {
            const member = await this.members.findById(memberId);
            if (!member) {
                throw new MemberNotFoundError(id);
            }
            if (!this.mail) {
                throw new MailNotConfiguredError();
            }

            const revealed = await this.mail.revealableLink(id);
            if (!revealed) {
                throw new NoRevealableLinkError(id);
            }

            // Audited in the same transaction as the read, so the record of who
            // saw the secret cannot be lost to a failure after it was handed
            // over. The event carries the kind and the address — never the
            // link, which would put the secret in a table that is stamped and
            // never pruned.
            await this.outbox.append(
                attachActor(
                    [
                        memberEvent(
                            MEMBER_EVENT_KINDS.INVITE_LINK_REVEALED,
                            id,
                            { email: member.email, mailKind: revealed.kind }
                        )
                    ],
                    actor
                )
            );

            return {
                kind: revealed.kind,
                link: revealed.link,
                queuedAt: revealed.queuedAt,
                attempts: revealed.attempts,
                lastError: revealed.lastError
            };
        });
    }
}
