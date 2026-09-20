import {
    BadRequestException,
    Injectable,
    NotFoundException
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
    attachActor,
    InjectDatabase,
    OutboxWriter,
    UnitOfWork,
    type Database,
    type EventActor
} from '@orthacms/database';
import type { AnyContentType } from '@orthacms/content-server';
import {
    isOfferedIn,
    isOpen,
    sameAccess,
    type EntryAccess
} from '@orthacms/segments-domain';
import { entryAccess } from '../schema/entry-access';
import {
    entryBelongsTo,
    localeGroupIds
} from '../infrastructure/locale-group.query';
import { SegmentCatalogService } from './segment-catalog.service';
import { entryAccessEvent } from '../segments.events';

/** One entry's two lists, as the editor reads and writes them. */
export interface EntryAccessView extends EntryAccess {
    allow: string[];
    deny: string[];
}

/** Nothing set. */
const OPEN: EntryAccessView = { allow: [], deny: [] };

/**
 * Where a read or write runs.
 *
 * Ordinarily the plugin's own connection; on the entry-write path it is the
 * **entry save's transaction**, handed over by content's
 * `EntryWriteExtension` port so the access row, the entry row and the version
 * recording both commit together. Drizzle's transaction handle carries the same
 * query surface, which is what lets one method serve both.
 */
export type AccessExecutor = Pick<
    Database,
    'select' | 'insert' | 'delete' | 'update'
>;

/**
 * Reading and writing one entry's access.
 *
 * The whole write path, and it is a single upsert — there is nothing to
 * resolve, nothing to project and nothing else to re-derive, because the row an
 * editor saves is the row a reader is matched against. That is the property the
 * simple model buys, and it is why this file is the size it is.
 */
@Injectable()
export class EntryAccessService {
    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly uow: UnitOfWork,
        private readonly outbox: OutboxWriter,
        private readonly catalog: SegmentCatalogService
    ) {}

    /** One entry's lists. An entry nobody restricted reads as two empty ones. */
    async get(
        workspaceId: string,
        entryId: string,
        executor: AccessExecutor = this.db
    ): Promise<EntryAccessView> {
        const [row] = await executor
            .select()
            .from(entryAccess)
            .where(
                and(
                    eq(entryAccess.entryId, entryId),
                    eq(entryAccess.workspaceId, workspaceId)
                )
            )
            .limit(1);
        return row ? { allow: row.allow ?? [], deny: row.deny ?? [] } : OPEN;
    }

    /** Many entries' lists at once, for the records list. Omits open entries. */
    async getMany(
        workspaceId: string,
        entryIds: readonly string[]
    ): Promise<Map<string, EntryAccessView>> {
        if (!entryIds.length) return new Map();
        const rows = await this.db
            .select()
            .from(entryAccess)
            .where(
                and(
                    eq(entryAccess.workspaceId, workspaceId),
                    inArray(entryAccess.entryId, [...entryIds])
                )
            );
        return new Map(
            rows.map((row) => [
                row.entryId,
                { allow: row.allow ?? [], deny: row.deny ?? [] }
            ])
        );
    }

    /**
     * Replace one entry's lists.
     *
     * **Replace, not merge.** The editor submits the whole state of the two
     * lists, which is the only shape that can express a removal — a merge has
     * no spelling for "this segment is no longer mentioned".
     *
     * Two empty lists **delete the row** rather than storing it. An entry with
     * no row is unrestricted, which is what the read predicate's
     * `COALESCE(…, true)` relies on; storing empty arrays instead would work,
     * and would leave every entry anyone ever opened paying for a row.
     */
    async set(input: {
        workspaceId: string;
        typeSlug: string;
        entryId: string;
        allow: readonly string[];
        deny: readonly string[];
        /**
         * Where to write. Defaults to the plugin's own connection (the `PUT`
         * route); the entry-write extension passes the **entry save's**
         * transaction, so a restriction and the record it restricts commit as
         * one — and the version taken moments later reads back what committed.
         */
        executor?: AccessExecutor;
        /**
         * Ids some **other** row of this entry's locale group already holds.
         *
         * Merged into the exemption below, because the group is written as one:
         * a segment narrowed away from the workspace after the fact is still
         * held by the entry the editor is looking at, and refusing it on a
         * sibling that had not caught up yet would fail the whole save.
         */
        heldInGroup?: readonly string[];
    }): Promise<EntryAccessView> {
        const executor = input.executor ?? this.db;
        // What the entry already names, on either side. Ids it already holds
        // are exempt from the workspace-scope check below — see `validate`.
        const current = await this.get(
            input.workspaceId,
            input.entryId,
            executor
        );
        const held = new Set([
            ...current.allow,
            ...current.deny,
            ...(input.heldInGroup ?? [])
        ]);
        const allow = this.validate(input.allow, input.workspaceId, held);
        const deny = this.validate(input.deny, input.workspaceId, held);

        if (isOpen({ allow, deny })) {
            await executor
                .delete(entryAccess)
                // Both columns, matching the read above. `entry_id` is the
                // primary key, so the second is redundant as long as every
                // caller has already established that this entry is this
                // workspace's — which is exactly the assumption that was wrong,
                // and the one that made "open it back up" delete another
                // workspace's restriction. A method that reads scoped and writes
                // unscoped is one caller away from that again.
                .where(
                    and(
                        eq(entryAccess.entryId, input.entryId),
                        eq(entryAccess.workspaceId, input.workspaceId)
                    )
                );
            return OPEN;
        }

        await executor
            .insert(entryAccess)
            .values({
                entryId: input.entryId,
                workspaceId: input.workspaceId,
                typeSlug: input.typeSlug,
                allow,
                deny
            })
            .onConflictDoUpdate({
                target: entryAccess.entryId,
                set: {
                    workspaceId: input.workspaceId,
                    typeSlug: input.typeSlug,
                    allow,
                    deny,
                    updatedAt: new Date()
                }
            });
        return { allow, deny };
    }

    /**
     * Replace the lists of every row in an entry's **locale group**.
     *
     * This is the method every write path uses, and the per-entry {@link set} is
     * its building block rather than an alternative to it. Access is not a
     * translated field: "who may read this" is a fact about the record, not
     * about the German wording of it, so it travels like a non-localized field —
     * set on one locale, set on all of them. Left per-row, an editor who
     * restricted the English article published the German one to everyone
     * without ever seeing a screen that said so.
     *
     * On a type with no locales the group is the entry, and this is `set`.
     *
     * Returns the **named** entry's view — the caller asked about that row, and
     * every row now says the same thing anyway — alongside every id it wrote.
     * The entry-write extension hands those back to content, which appends a
     * revision for each: a sibling whose audiences moved while its timeline did
     * not is a history that hides the change and, on the next restore, undoes it.
     */
    async setForGroup(input: {
        workspaceId: string;
        type: AnyContentType;
        entryId: string;
        allow: readonly string[];
        deny: readonly string[];
        executor?: AccessExecutor;
        /**
         * The acting principal, stamped on the `segment.entry_access_changed`
         * event. Optional because a caller may genuinely have none; a change
         * with no actor is still recorded, as "System".
         */
        actor?: EventActor;
    }): Promise<{ access: EntryAccessView; entryIds: string[] }> {
        return this.uow.run(() => this.writeGroup(input));
    }

    /**
     * The body of {@link setForGroup}, inside its unit of work.
     *
     * Split out so the `uow.run` wrapper reads as one line. The run is what
     * lets the change and its audit event commit together on **both** paths:
     * the `PUT` route opens the transaction here, while the entry-write
     * extension is already inside the save's own — and a nested `run` joins
     * the outer one rather than opening a second.
     */
    private async writeGroup(input: {
        workspaceId: string;
        type: AnyContentType;
        entryId: string;
        allow: readonly string[];
        deny: readonly string[];
        executor?: AccessExecutor;
        actor?: EventActor;
    }): Promise<{ access: EntryAccessView; entryIds: string[] }> {
        const executor = input.executor ?? this.uow.current();
        // Before anything is written, and before the group is resolved: three of
        // the four write paths reach here with an id straight from the caller,
        // and only the entry save's had already resolved it inside the
        // workspace. See `entryBelongsTo` for why a foreign id is not merely
        // untidy here — the read predicate matches on `entry_id` alone, so a row
        // written against one restricts, or unrestricts, another workspace's
        // entry while its own editor sees nothing.
        //
        // The same refusal an id that exists nowhere gets, because telling those
        // two apart would make every write path an oracle for entry ids — the
        // flat answer the read side already gives by scoping its query.
        if (
            !(await entryBelongsTo(
                executor,
                input.type,
                input.entryId,
                input.workspaceId
            ))
        ) {
            throw new NotFoundException('Unknown entry.');
        }

        const ids = await localeGroupIds(
            executor,
            input.type,
            input.entryId,
            input.workspaceId
        );
        // The group's whole vocabulary, so a segment one locale still holds
        // exempts every locale from the workspace-scope check — see `validate`.
        const held = await this.heldInGroup(input.workspaceId, ids, executor);

        let view: EntryAccessView = { allow: [], deny: [] };
        for (const entryId of ids) {
            // Sequential, not `Promise.all`: on the entry-write path this is the
            // save's own transaction, and a pg transaction serves one query at a
            // time — concurrent ones interleave onto the same connection and
            // fail.
            const written = await this.set({
                workspaceId: input.workspaceId,
                typeSlug: input.type.name,
                entryId,
                allow: input.allow,
                deny: input.deny,
                executor,
                heldInGroup: held
            });
            if (entryId === input.entryId) view = written;
        }

        // One event for the **named** entry, not one per locale. The change is
        // a decision about the record, and a row per translation would report
        // one editorial act as four — the same rule the entry events follow
        // when a shared field fans out.
        const event = entryAccessEvent(input.entryId, {
            workspaceId: input.workspaceId,
            contentType: input.type.name,
            allow: view.allow,
            deny: view.deny,
            // What it reached, so a reader can see the fan-out without
            // reconstructing the locale group.
            entryIds: ids
        });
        await this.outbox.append(
            input.actor ? attachActor([event], input.actor) : [event]
        );

        return { access: view, entryIds: ids };
    }

    /**
     * Give a just-created row whatever the rest of its locale group holds.
     *
     * A no-op unless the row is joining a group that is already restricted, and
     * a no-op on a type with no locales — so nothing about an ordinary create
     * changes. It writes the group's lists **verbatim**, without the
     * workspace-scope check `set` applies, because nothing is being decided: the
     * audiences were chosen when they were chosen, and this row is joining a
     * record that already carries them.
     */
    async inheritFromGroup(
        workspaceId: string,
        type: AnyContentType,
        entryId: string,
        executor: AccessExecutor = this.db
    ): Promise<void> {
        if (!type.i18n) return;
        const own = await this.get(workspaceId, entryId, executor);
        // Already answered — by the same save's `apply`, most likely, and that
        // answer is the caller's rather than the group's.
        if (!isOpen(own)) return;

        const ids = await localeGroupIds(executor, type, entryId, workspaceId);
        for (const id of ids) {
            if (id === entryId) continue;
            const sibling = await this.get(workspaceId, id, executor);
            if (isOpen(sibling)) continue;
            await executor.insert(entryAccess).values({
                entryId,
                workspaceId,
                typeSlug: type.name,
                allow: sibling.allow,
                deny: sibling.deny
            });
            return;
        }
    }

    /** Whether every row of a group already says exactly this. */
    async groupHas(
        workspaceId: string,
        type: AnyContentType,
        entryId: string,
        wanted: EntryAccess,
        executor: AccessExecutor = this.db
    ): Promise<boolean> {
        const ids = await localeGroupIds(executor, type, entryId, workspaceId);
        for (const id of ids) {
            const current = await this.get(workspaceId, id, executor);
            if (!sameAccess(current, wanted)) return false;
        }
        return true;
    }

    /** Every segment id any row of the group currently names, on either side. */
    private async heldInGroup(
        workspaceId: string,
        entryIds: readonly string[],
        executor: AccessExecutor
    ): Promise<string[]> {
        const held = new Set<string>();
        for (const entryId of entryIds) {
            const current = await this.get(workspaceId, entryId, executor);
            for (const id of [...current.allow, ...current.deny]) {
                held.add(id);
            }
        }
        return [...held];
    }

    /**
     * Deduplicates, and checks that every id is a segment that exists **and is
     * offered in this workspace**.
     *
     * An unknown id is refused rather than stored. Kept, it would be a decision
     * that matches nobody — closing content on the allow side and doing nothing
     * on the deny side — with nothing on screen to say the entry is governed by
     * a segment that is not there.
     *
     * An out-of-scope id is refused for a plainer reason: the editor was never
     * offered it, so a request naming one did not come from the screen.
     *
     * That check applies only to ids the entry does **not already hold**. A
     * segment narrowed away from a workspace after the fact leaves the decisions
     * already made there exactly as their editors left them — re-deciding who
     * may read published content from a screen about where an audience is
     * *offered* is a change nobody would connect to what they did. It is also
     * what keeps a **restore** working: putting back a version that named an
     * audience the entry still holds is not a new decision, and refusing it
     * would block the restore of the entry's words along with it.
     */
    private validate(
        ids: readonly string[],
        workspaceId: string,
        held: ReadonlySet<string> = new Set()
    ): string[] {
        const unique = [...new Set(ids)];
        const catalogue = new Map(
            this.catalog.all().map((segment) => [segment.id, segment])
        );
        const unknown = unique.filter((id) => !catalogue.has(id));
        if (unknown.length) {
            throw new BadRequestException(
                `Unknown segment(s): ${unknown.join(', ')}.`
            );
        }
        const foreign = unique.filter((id) => {
            if (held.has(id)) return false;
            const segment = catalogue.get(id);
            return segment && !isOfferedIn(segment, workspaceId);
        });
        if (foreign.length) {
            throw new BadRequestException(
                `Segment(s) not offered in this workspace: ${foreign.join(', ')}.`
            );
        }
        return unique;
    }
}
