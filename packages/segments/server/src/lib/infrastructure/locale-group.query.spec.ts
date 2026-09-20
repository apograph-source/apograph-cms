import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SQL } from 'drizzle-orm';
import { PgDialect, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { AnyContentType } from '@orthacms/content-server';
import { entryBelongsTo, localeGroupIds } from './locale-group.query';

/** A localized content table, as content's builder produces one. */
const localized = pgTable('test_article', {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    locale: text('locale'),
    localeGroupId: uuid('locale_group_id'),
    deletedAt: timestamp('deleted_at')
});

/** The same type without `i18n`, where a record is one row. */
const plain = pgTable('test_page', {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull()
});

const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENGLISH = '11111111-1111-4111-8111-111111111111';
const GERMAN = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';

function typeOf(table: unknown, i18n: boolean): AnyContentType {
    return { name: 'test_article', table, i18n } as unknown as AnyContentType;
}

/**
 * An executor answering each `select` in turn and recording the `where` it was
 * narrowed by, so the emitted predicate can be read rather than inferred.
 */
function reader(...answers: Record<string, unknown>[][]) {
    const wheres: SQL[] = [];
    let call = 0;
    const handle = {
        select: () => ({
            from: () => ({
                where: (where: SQL) => {
                    wheres.push(where);
                    const rows = answers[call++] ?? [];
                    const pending = Promise.resolve(rows);
                    return {
                        then: pending.then.bind(pending),
                        limit: async () => rows
                    };
                }
            })
        })
    };
    return {
        handle,
        wheres,
        sqlOf: (index: number) => new PgDialect().sqlToQuery(wheres[index]).sql
    };
}

describe('localeGroupIds', () => {
    it('treats a non-localized record as one row, without asking', async () => {
        const source = reader();

        await expect(
            localeGroupIds(
                source.handle as never,
                typeOf(plain, false),
                ENGLISH,
                WORKSPACE
            )
        ).resolves.toEqual([ENGLISH]);
        expect(source.wheres).toHaveLength(0);
    });

    /**
     * The group is read from content's **own** `locale_group_id` column, and
     * every sibling is rewritten — a decision made on the English article has to
     * reach the German one, or an editor restricts one language and publishes
     * the other to everyone with no screen saying so.
     */
    it('reads the group from content’s own column, scoped to the workspace [segments:I-15]', async () => {
        const source = reader(
            [{ groupId: GROUP }],
            [{ id: ENGLISH }, { id: GERMAN }]
        );

        await expect(
            localeGroupIds(
                source.handle as never,
                typeOf(localized, true),
                ENGLISH,
                WORKSPACE
            )
        ).resolves.toEqual([ENGLISH, GERMAN]);

        expect(source.sqlOf(1)).toBe(
            '("test_article"."locale_group_id" = $1 and "test_article"."workspace_id" = $2)'
        );
    });

    /**
     * **Soft-deleted siblings are included on purpose.** A locale in the trash
     * comes back on restore, and it has to come back with the group's access
     * rather than with whatever it held on the day it was deleted — otherwise
     * restoring a translation republishes it to everyone.
     */
    it('does not filter the group by deletion [segments:I-15]', async () => {
        const source = reader([{ groupId: GROUP }], [{ id: ENGLISH }]);

        await localeGroupIds(
            source.handle as never,
            typeOf(localized, true),
            ENGLISH,
            WORKSPACE
        );

        expect(source.sqlOf(1)).not.toContain('deleted_at');
    });

    it('falls back to the entry alone when the group is unresolvable', async () => {
        // A row with no `locale_group_id` yet, and a type that claims `i18n`
        // without the columns. Both change only this entry rather than an
        // unknown set, which is the safe direction for a write about who reads.
        const noGroupId = reader([{ groupId: null }]);
        await expect(
            localeGroupIds(
                noGroupId.handle as never,
                typeOf(localized, true),
                ENGLISH,
                WORKSPACE
            )
        ).resolves.toEqual([ENGLISH]);

        const noColumns = reader();
        await expect(
            localeGroupIds(
                noColumns.handle as never,
                typeOf(plain, true),
                ENGLISH,
                WORKSPACE
            )
        ).resolves.toEqual([ENGLISH]);
        expect(noColumns.wheres).toHaveLength(0);
    });

    it('names the entry itself even when the group query cannot see it', async () => {
        // The create path: the row is visible on the save's transaction, but a
        // caller could still hand over an id the group query misses.
        const source = reader([{ groupId: GROUP }], [{ id: GERMAN }]);

        await expect(
            localeGroupIds(
                source.handle as never,
                typeOf(localized, true),
                ENGLISH,
                WORKSPACE
            )
        ).resolves.toEqual([ENGLISH, GERMAN]);
    });
});

describe('entryBelongsTo', () => {
    it('matches on the id and the workspace, and counts a soft-deleted row', async () => {
        const source = reader([{ id: ENGLISH }]);

        await expect(
            entryBelongsTo(
                source.handle as never,
                typeOf(localized, true),
                ENGLISH,
                WORKSPACE
            )
        ).resolves.toBe(true);

        expect(source.sqlOf(0)).toBe(
            '("test_article"."id" = $1 and "test_article"."workspace_id" = $2)'
        );
        // Same reason as the group query: a trashed locale comes back with the
        // group's access, so the boundary check has to be able to see it.
        expect(source.sqlOf(0)).not.toContain('deleted_at');
    });

    it('refuses a type missing either column rather than passing', async () => {
        const source = reader([{ id: ENGLISH }]);

        await expect(
            entryBelongsTo(
                source.handle as never,
                typeOf(pgTable('odd', { title: text('title') }), false),
                ENGLISH,
                WORKSPACE
            )
        ).resolves.toBe(false);
    });
});

describe('the locale group is answered without i18n', () => {
    /**
     * An entitlement rule must not depend on a plugin the deployment may not
     * have installed. If it did, an installation without `@orthacms/i18n-server`
     * would fail to resolve the group — and the failure would land on the write
     * that decides who may read published content.
     */
    it('needs no dependency on @orthacms/i18n-server [segments:I-15]', () => {
        const manifest = JSON.parse(
            readFileSync(
                join(__dirname, '..', '..', '..', 'package.json'),
                'utf-8'
            )
        );
        const declared = {
            ...manifest.dependencies,
            ...manifest.peerDependencies,
            ...manifest.devDependencies
        };

        expect(Object.keys(declared)).not.toContain('@orthacms/i18n-server');
        expect(
            readFileSync(join(__dirname, 'locale-group.query.ts'), 'utf-8')
        ).not.toContain("from '@orthacms/i18n-server'");
    });
});
