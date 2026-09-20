import { BadRequestException } from '@nestjs/common';
import { PgDialect, pgTable, uuid } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { AnyContentType } from '@orthacms/content-server';
import type { Segment } from '@orthacms/segments-domain';
import { entryAccess } from '../schema/entry-access';
import { EntryAccessService } from './entry-access.service';
import { SegmentCatalogService } from './segment-catalog.service';

const HERE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ELSEWHERE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** An audience offered only in `workspaceIds` — empty meaning everywhere. */
function segment(id: string, workspaceIds: string[] = []): Segment {
    return { id, key: id, label: id, tags: [id], workspaceIds };
}

/** A catalogue holding exactly these audiences. */
function catalogue(...all: Segment[]): SegmentCatalogService {
    return { all: () => all } as unknown as SegmentCatalogService;
}

/**
 * A recording executor over one stored row.
 *
 * `set` reads the entry's current lists through the executor it was handed, so
 * "what the entry already holds" has to come from here rather than from a
 * constructor argument — which is the point: on the entry-save path this
 * executor is the save's own transaction.
 */
function executor(stored?: { allow: string[]; deny: string[] }) {
    const writes: {
        op: 'insert' | 'delete';
        values?: Record<string, unknown>;
    }[] = [];
    const handle = {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () =>
                        stored
                            ? [{ ...stored, entryId: 'e1', workspaceId: HERE }]
                            : []
                })
            })
        }),
        delete: () => ({
            where: async () => {
                writes.push({ op: 'delete' });
            }
        }),
        insert: (table: unknown) => ({
            values: (values: Record<string, unknown>) => ({
                onConflictDoUpdate: async () => {
                    expect(table).toBe(entryAccess);
                    writes.push({ op: 'insert', values });
                }
            })
        })
    };
    return { handle, writes };
}

/** The service, with only the collaborators `set` actually reaches. */
function service(catalog: SegmentCatalogService): EntryAccessService {
    return new EntryAccessService(
        undefined as never,
        undefined as never,
        undefined as never,
        catalog
    );
}

describe('EntryAccessService.set — the workspace-scope check', () => {
    /**
     * The rule this exists to protect.
     *
     * An administrator narrowing an audience to a couple of workspaces is
     * saying where it may be *chosen*, on a screen that says nothing about
     * published content. If that check also applied to ids an entry already
     * holds, every entry outside the new scope would become **unsavable** —
     * an editor fixing a typo in the headline would get "Segment(s) not offered
     * in this workspace" and no way past it — and any path that dropped the id
     * instead would silently publish restricted content to everyone.
     */
    it('keeps an audience the entry already holds after its scope was narrowed away [segments:I-11]', async () => {
        const narrowed = segment('11111111-1111-4111-8111-111111111111', [
            ELSEWHERE
        ]);
        const { handle, writes } = executor({ allow: [narrowed.id], deny: [] });

        const result = await service(catalogue(narrowed)).set({
            workspaceId: HERE,
            typeSlug: 'article',
            entryId: 'e1',
            allow: [narrowed.id],
            deny: [],
            executor: handle as never
        });

        expect(result).toEqual({ allow: [narrowed.id], deny: [] });
        expect(writes).toEqual([
            {
                op: 'insert',
                values: expect.objectContaining({ allow: [narrowed.id] })
            }
        ]);
    });

    it('exempts an audience only a locale sibling still holds [segments:I-11]', async () => {
        // The group is written as one, so a sibling that had not caught up
        // would otherwise fail the whole save half-way through — leaving the
        // record restricted in one language and open in another.
        const narrowed = segment('22222222-2222-4222-8222-222222222222', [
            ELSEWHERE
        ]);
        const { handle, writes } = executor();

        await service(catalogue(narrowed)).set({
            workspaceId: HERE,
            typeSlug: 'article',
            entryId: 'e1',
            allow: [narrowed.id],
            deny: [],
            executor: handle as never,
            heldInGroup: [narrowed.id]
        });

        expect(writes).toHaveLength(1);
    });

    it('exempts an id held on the other side of the entry’s own lists [segments:I-11]', async () => {
        // "Already holds" is both lists, not the one being written: moving an
        // audience from deny to allow is a rewrite of a decision that exists,
        // not a new one.
        const narrowed = segment('33333333-3333-4333-8333-333333333333', [
            ELSEWHERE
        ]);
        const { handle } = executor({ allow: [], deny: [narrowed.id] });

        await expect(
            service(catalogue(narrowed)).set({
                workspaceId: HERE,
                typeSlug: 'article',
                entryId: 'e1',
                allow: [narrowed.id],
                deny: [],
                executor: handle as never
            })
        ).resolves.toEqual({ allow: [narrowed.id], deny: [] });
    });

    /**
     * The refusal side, kept beside the exemption so neither can be satisfied
     * by deleting the other. Without this the exemption could be "the check
     * never runs".
     */
    it('still refuses an out-of-scope audience the entry does not hold', async () => {
        const narrowed = segment('44444444-4444-4444-8444-444444444444', [
            ELSEWHERE
        ]);
        const { handle, writes } = executor();

        await expect(
            service(catalogue(narrowed)).set({
                workspaceId: HERE,
                typeSlug: 'article',
                entryId: 'e1',
                allow: [narrowed.id],
                deny: [],
                executor: handle as never
            })
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(writes).toEqual([]);
    });

    it('refuses an id the entry holds that is no longer a segment at all', async () => {
        // The exemption is from the *scope* check only. An id that names
        // nothing resolves to nobody — closing content on the allow side — so
        // holding it is not a reason to keep writing it.
        const gone = '55555555-5555-4555-8555-555555555555';
        const { handle } = executor({ allow: [gone], deny: [] });

        await expect(
            service(catalogue()).set({
                workspaceId: HERE,
                typeSlug: 'article',
                entryId: 'e1',
                allow: [gone],
                deny: [],
                executor: handle as never
            })
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});

/** A localized content table, as content's builder produces one. */
const articles = pgTable('test_article', {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    localeGroupId: uuid('locale_group_id')
});

const ENGLISH = 'e1111111-1111-4111-8111-111111111111';
const GERMAN = 'e2222222-2222-4222-8222-222222222222';

/** The first bind of a `where`, which is the entry id every access read keys on. */
function firstParam(where: SQL): unknown {
    return new PgDialect().sqlToQuery(where).params[0];
}

/**
 * An executor over a locale group: `entry_access` rows keyed by entry id, and
 * the content table answering the two queries `localeGroupIds` makes.
 */
function groupExecutor(
    rows: Record<string, { allow: string[]; deny: string[] }>
) {
    const inserted: Record<string, unknown>[] = [];
    let contentCall = 0;
    const handle = {
        select: () => ({
            from: (table: unknown) => ({
                where: (where: SQL) => {
                    if (table === entryAccess) {
                        const id = firstParam(where) as string;
                        const row = rows[id];
                        return {
                            limit: async () =>
                                row ? [{ ...row, entryId: id }] : []
                        };
                    }
                    // `localeGroupIds`: the self lookup, then the group.
                    const answer =
                        contentCall++ === 0
                            ? [{ groupId: 'g1' }]
                            : [{ id: ENGLISH }, { id: GERMAN }];
                    const pending = Promise.resolve(answer);
                    return {
                        then: pending.then.bind(pending),
                        limit: async () => answer
                    };
                }
            })
        }),
        insert: () => ({
            values: async (values: Record<string, unknown>) => {
                inserted.push(values);
            }
        })
    };
    return { handle, inserted };
}

const LOCALIZED = {
    name: 'test_article',
    table: articles,
    i18n: true
} as unknown as AnyContentType;

describe('EntryAccessService.inheritFromGroup', () => {
    /**
     * The case the hook exists for: "create a translation" sends no `extensions`
     * bag, so `apply` never runs and the new German row would be born public
     * beside a restricted English one. A reader notices that; the editor never
     * does.
     *
     * It writes the sibling's lists **verbatim**, without the workspace-scope
     * check `set` applies, because nothing is being decided — the audiences were
     * chosen when they were chosen, and refusing one narrowed away since would
     * fail the translation rather than protect anybody.
     */
    it('copies the group’s audiences onto a new row, scope check and all [segments:I-23]', async () => {
        const narrowed = segment('99999999-9999-4999-8999-999999999999', [
            ELSEWHERE
        ]);
        const { handle, inserted } = groupExecutor({
            [GERMAN]: { allow: [narrowed.id], deny: [] }
        });

        await service(catalogue(narrowed)).inheritFromGroup(
            HERE,
            LOCALIZED,
            ENGLISH,
            handle as never
        );

        expect(inserted).toEqual([
            expect.objectContaining({
                entryId: ENGLISH,
                workspaceId: HERE,
                allow: [narrowed.id],
                deny: []
            })
        ]);
    });

    it('leaves a row the save has already answered alone [segments:I-23]', async () => {
        // The create's own `apply` ran first and stored the caller's decision.
        // Inheriting over it would replace what the editor just asked for with
        // whatever the rest of the group happens to hold.
        const { handle, inserted } = groupExecutor({
            [ENGLISH]: { allow: ['s-mine'], deny: [] },
            [GERMAN]: { allow: ['s-group'], deny: [] }
        });

        await service(catalogue()).inheritFromGroup(
            HERE,
            LOCALIZED,
            ENGLISH,
            handle as never
        );

        expect(inserted).toEqual([]);
    });

    it('does nothing on a type with no locales', async () => {
        const { handle, inserted } = groupExecutor({
            [GERMAN]: { allow: ['s1'], deny: [] }
        });

        await service(catalogue()).inheritFromGroup(
            HERE,
            { ...LOCALIZED, i18n: false } as AnyContentType,
            ENGLISH,
            handle as never
        );

        expect(inserted).toEqual([]);
    });
});
