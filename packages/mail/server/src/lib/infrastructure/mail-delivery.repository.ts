import { Injectable } from '@nestjs/common';
import { InjectDatabase, UnitOfWork, type Database } from '@orthacms/database';
import type { MailKind } from '@orthacms/mail-domain';
import { and, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { mailDeliveries } from './schema/mail-deliveries';

/** A message to queue, already rendered. */
export interface MailToQueue {
    kind: MailKind;
    toAddress: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string;
    /** The link on its own, for `reveal-link`. */
    link: string;
    userId: string;
    /** The token's expiry — past it the row is swept unsent. */
    expiresAt: Date;
}

/** A claimed row, as the worker needs it. */
export interface ClaimedMail {
    id: string;
    kind: string;
    toAddress: string;
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    attempts: number;
}

/** An undelivered message, as `reveal-link` reads it. */
export interface UndeliveredMail {
    kind: string;
    link: string | null;
    createdAt: Date;
    attempts: number;
    lastError: string | null;
}

/**
 * The queue and the dead-letter log, over one table.
 *
 * Two executors on purpose. {@link enqueue} runs on `UnitOfWork.current()`, so
 * it joins the caller's open transaction — that is the whole point of writing
 * the message inline. Everything the worker does runs on the base client,
 * because the worker must not be inside anybody's transaction when it opens a
 * socket.
 */
@Injectable()
export class MailDeliveryRepository {
    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly uow: UnitOfWork
    ) {}

    /**
     * Writes one message into the caller's open transaction.
     *
     * Refuses outside a unit of work for the reason `OutboxWriter.append`
     * documents, with a sharper edge: on the base pool this insert auto-commits
     * on its own connection, so a message carrying an account-takeover link
     * would survive an invite that rolled back — and be sent to somebody who
     * has no account.
     */
    async enqueue(mail: MailToQueue): Promise<void> {
        if (!this.uow.isActive()) {
            throw new Error(
                'MailDeliveryRepository.enqueue must be called inside UnitOfWork.run(...) — ' +
                    'queueing outside a unit of work commits the message on its own connection, ' +
                    'so a link can outlive the rolled-back write that issued it.'
            );
        }

        await this.uow
            .current()
            .insert(mailDeliveries)
            .values({
                kind: mail.kind,
                toAddress: mail.toAddress,
                subject: mail.subject,
                bodyText: mail.bodyText,
                bodyHtml: mail.bodyHtml ?? null,
                link: mail.link,
                userId: mail.userId,
                expiresAt: mail.expiresAt
            });
    }

    /**
     * Claims up to `limit` messages and leases them for `leaseMs`.
     *
     * The transaction covers **only the claim** (ADR-0016's rule, which this
     * plugin diverges from on the enqueue and not on the send): the hand-off
     * happens after this returns, with nothing open, so a relay that takes
     * thirty seconds cannot hold a database transaction or a pool client.
     *
     * The lease is `next_attempt_at` pushed forward rather than a `delivering`
     * status: it makes a concurrent worker skip the row, and it needs no reaper
     * — a process that dies mid-send simply lets the lease lapse.
     *
     * Expired messages are not claimed. They are the sweep's, and sending a
     * dead link is worse than sending nothing.
     */
    async claim(limit: number, leaseMs: number): Promise<ClaimedMail[]> {
        const now = new Date();
        const leaseUntil = new Date(now.getTime() + leaseMs);

        return this.db.transaction(async (tx) => {
            const rows = await tx
                .select({
                    id: mailDeliveries.id,
                    kind: mailDeliveries.kind,
                    toAddress: mailDeliveries.toAddress,
                    subject: mailDeliveries.subject,
                    bodyText: mailDeliveries.bodyText,
                    bodyHtml: mailDeliveries.bodyHtml,
                    attempts: mailDeliveries.attempts
                })
                .from(mailDeliveries)
                .where(
                    and(
                        isNull(mailDeliveries.deadAt),
                        lte(mailDeliveries.nextAttemptAt, now),
                        gt(mailDeliveries.expiresAt, now)
                    )
                )
                .orderBy(mailDeliveries.nextAttemptAt)
                .limit(limit)
                .for('update', { skipLocked: true });

            if (rows.length === 0) return [];

            await tx
                .update(mailDeliveries)
                .set({ nextAttemptAt: leaseUntil })
                .where(
                    inArray(
                        mailDeliveries.id,
                        rows.map((row) => row.id)
                    )
                );

            return rows;
        });
    }

    /**
     * Deletes a delivered message, secret and all.
     *
     * There is no `sent_at` to stamp: the row existed to survive a crash
     * between commit and send, and once the relay has it there is nothing left
     * to protect but the token it carries.
     */
    async markDelivered(id: string): Promise<void> {
        await this.db.delete(mailDeliveries).where(eq(mailDeliveries.id, id));
    }

    /** Records a failed attempt that will be tried again at `nextAttemptAt`. */
    async markRetrying(
        id: string,
        error: string,
        nextAttemptAt: Date,
        providerId: string
    ): Promise<void> {
        await this.db
            .update(mailDeliveries)
            .set({
                attempts: sql`${mailDeliveries.attempts} + 1`,
                nextAttemptAt,
                lastError: error,
                providerId
            })
            .where(eq(mailDeliveries.id, id));
    }

    /**
     * Gives up on a message — the budget spent, or a rejection that will not
     * change. The row stays: it is the dead-letter surface, and an
     * administrator who invited somebody needs to learn the message never left.
     */
    async markDead(
        id: string,
        error: string,
        providerId: string
    ): Promise<void> {
        await this.db
            .update(mailDeliveries)
            .set({
                attempts: sql`${mailDeliveries.attempts} + 1`,
                deadAt: new Date(),
                lastError: error,
                providerId
            })
            .where(eq(mailDeliveries.id, id));
    }

    /**
     * Deletes messages whose token has expired, sent or not.
     *
     * Both halves matter: an unsent one must never go out, and a dead one is a
     * stored secret that has outlived every use anybody had for it.
     */
    async sweepExpired(now: Date = new Date()): Promise<number> {
        const removed = await this.db
            .delete(mailDeliveries)
            .where(lte(mailDeliveries.expiresAt, now))
            .returning({ id: mailDeliveries.id });
        return removed.length;
    }

    /**
     * The newest message to this user that has not been handed over.
     *
     * Only an undelivered one exists to be found: a delivered row is deleted,
     * so once the relay has the message the link is gone from here too. That is
     * what makes `reveal-link` an answer to "it never arrived" rather than a
     * second copy of a message that did.
     */
    async newestUndeliveredFor(
        userId: string
    ): Promise<UndeliveredMail | null> {
        const [row] = await this.db
            .select({
                kind: mailDeliveries.kind,
                link: mailDeliveries.link,
                createdAt: mailDeliveries.createdAt,
                attempts: mailDeliveries.attempts,
                lastError: mailDeliveries.lastError
            })
            .from(mailDeliveries)
            .where(
                and(
                    eq(mailDeliveries.userId, userId),
                    gt(mailDeliveries.expiresAt, new Date())
                )
            )
            .orderBy(desc(mailDeliveries.createdAt))
            .limit(1);

        return row ?? null;
    }
}
