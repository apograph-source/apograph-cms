import { Injectable } from '@nestjs/common';
import {
    InjectRevisionStore,
    type RevisionStore
} from '@orthacms/content-server';

/** The entry's current version — everything a protection decision needs of it. */
export interface HeadRevision {
    /** The revision row id. What an approval is bound to. */
    id: string;
    /** Its 1-based version number, for the audit trail and the interface. */
    number: number;
    /** Who wrote it, or `null` when that cannot be named (a token, an import). */
    authorId: string | null;
}

/**
 * Which version of an entry is currently the head, and who wrote it.
 *
 * **Asked of content, not read out of its table.** `content_entry_revisions` is
 * host-owned and modelled by `content-server`; this package owns none of it,
 * cannot declare a foreign key into it, and has no business knowing its column
 * names. Going through `RevisionStore` means protection's correctness depends
 * on a contract content maintains rather than on a schema it might change — and
 * that port already scopes every read by content type **and** workspace, which
 * is exactly the check an entry route needs before it records anything.
 *
 * The alternative considered was declaring a new narrow port in `content-server`
 * (`CONTENT_HEAD_REVISION`, say). Rejected: `RevisionStore.list` already answers
 * this question, newest-first, and a second port over the same table would be a
 * second thing to keep in step for no gain. Exporting the existing one is the
 * whole change to content in this PR.
 *
 * Reading page 1 of size 1 is deliberate rather than lazy: the timeline read is
 * already ordered newest-first and indexed on `(entry_id, revision_number)`, so
 * this is an index scan returning one row, and it borrows the pagination that
 * read already has rather than adding a bespoke query beside it.
 */
@Injectable()
export class HeadRevisionQuery {
    constructor(
        @InjectRevisionStore() private readonly revisions: RevisionStore
    ) {}

    /**
     * The entry's newest revision, or `null` when it has none — which for an
     * entry written by the current writer means the entry is not reachable from
     * this workspace under this content type at all, since every save appends
     * one. The caller turns that into a 404 without saying which of the two it
     * was.
     */
    async find(
        contentType: string,
        entryId: string,
        workspaceId: string
    ): Promise<HeadRevision | null> {
        const { items } = await this.revisions.list(
            contentType,
            entryId,
            workspaceId,
            1,
            1
        );
        const head = items[0];
        if (!head) return null;
        return {
            id: head.id,
            number: head.number,
            // `RevisionSummary.authorId` is absent for a write with no user
            // behind it — a bearer token, an import, a migration. Absent means
            // "nobody to exclude", which is what `evaluateProtection` reads
            // `null` as.
            authorId: head.authorId ?? null
        };
    }

    /**
     * Every revision of the entry, newest first — used only to put a **version
     * number** beside a stale vote.
     *
     * One read rather than one per stale vote. The alternative would be storing
     * the number on the approval row, which would be a second copy of a fact
     * content owns and would go wrong the day a revision is restored.
     *
     * Capped: the panel needs the versions people actually voted on, and a vote
     * older than the last hundred saves is one nobody is going to recognise
     * from its number anyway. A vote whose revision falls outside the window
     * reports `null` rather than failing the read.
     */
    async timeline(
        contentType: string,
        entryId: string,
        workspaceId: string
    ): Promise<{ id: string; number: number }[]> {
        const { items } = await this.revisions.list(
            contentType,
            entryId,
            workspaceId,
            1,
            TIMELINE_LOOKUP_CAP
        );
        return items.map((item) => ({ id: item.id, number: item.number }));
    }
}

/** How far back a stale vote's version number is looked up. */
const TIMELINE_LOOKUP_CAP = 100;
