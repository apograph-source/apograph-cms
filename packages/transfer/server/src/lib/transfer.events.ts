/**
 * The domain events a transfer raises.
 *
 * Export is a read, and a read that raises an audit event is unusual enough to
 * say why: this is the one operation that takes a workspace's content **out**
 * of the system in bulk, files included. Who did that, when, and how much left
 * is exactly the question an operator asks after the fact, and it cannot be
 * reconstructed from the content tables — nothing there changed.
 *
 * The event is written **before** the bytes stream, not after. A download that
 * is interrupted halfway still moved data; recording only completed transfers
 * would leave the most interesting case — the one that failed partway — with no
 * trace at all.
 */

import { createDomainEvent, type DomainEvent } from '@orthacms/database';

/** Transfer event kinds, as dotted names. */
export const TRANSFER_EVENT_KINDS = {
    /** Content left the system. */
    EXPORTED: 'transfer.content.exported',
    /** Content was written in from a file. */
    IMPORTED: 'transfer.content.imported'
} as const;

/** Builds a transfer {@link DomainEvent}, keyed to the content type involved. */
export function transferEvent(
    kind: string,
    typeName: string,
    payload: Record<string, unknown>
): DomainEvent {
    return createDomainEvent({
        kind,
        aggregateType: 'transfer.content',
        aggregateId: typeName,
        payload
    });
}
