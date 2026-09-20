import {
    CONTENT_FIELD_TYPE,
    type AnyContentType,
    type EntryTransaction
} from '@orthacms/content-server';
import { EntryLocaleExtensionService } from './entry-locale-extension.service';

/**
 * The **lock-avoidance guard** at the top of `propagateToSiblings`.
 *
 * The sibling read takes `FOR UPDATE` on every other row of the translation
 * group, so running it unconditionally would make each save of a localized type
 * lock rows it has no intention of writing — on a type with no shared field and
 * no syncing relation, permanently and for nothing. The guard answers "can
 * anything travel?" from two free inputs (the save's own values bag and the
 * schema) *before* touching the database.
 *
 * That is invisible over HTTP: the save succeeds either way and the siblings
 * come back identical. What distinguishes the two implementations is whether a
 * statement was issued at all, so the assertion has to be made against the
 * transaction itself.
 */
describe('EntryLocaleExtensionService sibling locking', () => {
    /**
     * A transaction that fails loudly the moment the sync reads anything. Every
     * database path in `afterUpdate` starts at `tx.select(…)`.
     */
    function throwingTx() {
        return {
            select: jest.fn(() => {
                throw new Error('SIBLING_READ');
            }),
            update: jest.fn(() => {
                throw new Error('SIBLING_WRITE');
            })
        };
    }

    /** The relation storage the sync would reach for, if it got that far. */
    function throwingRelations() {
        return {
            replaceLinks: jest.fn(() => {
                throw new Error('LINKS_TOUCHED');
            }),
            linkIdsOf: jest.fn(() => {
                throw new Error('LINKS_READ');
            }),
            equivalentIdsByLocale: jest.fn(() => {
                throw new Error('EQUIVALENTS_READ');
            })
        };
    }

    function service(relations: unknown) {
        return new EntryLocaleExtensionService(
            {} as never, // `db` is only used by the read-only fanout query
            {} as never, // the locale registry is not consulted on this path
            {} as never, // nor is validation, which runs after the sync
            relations as never,
            {} as never // nor the unit of work, read only by the group check
        );
    }

    /** A localized field — per-locale by definition, so it never travels. */
    const title = { type: CONTENT_FIELD_TYPE.Text, localized: true };
    /**
     * The opt-out relation: same shape as one that syncs, with
     * `syncAcrossLocales` off. Spelled out rather than defaulted, because a
     * hand-built type gets no registry normalization.
     */
    const pinnedTag = {
        type: CONTENT_FIELD_TYPE.Relation,
        relation: { to: () => ({ i18n: false }), syncAcrossLocales: false }
    };
    /** A plain non-localized column: the same value in every language. */
    const number = { type: CONTENT_FIELD_TYPE.Number };
    /** A relation to a localized target: mirrored, so it travels. */
    const author = {
        type: CONTENT_FIELD_TYPE.Relation,
        relation: { to: () => ({ i18n: true }), syncAcrossLocales: true }
    };

    function type(fields: Record<string, unknown>): AnyContentType {
        return {
            name: 'test_article',
            i18n: true,
            fields,
            // Never dereferenced on the paths below: the guard returns before
            // the query is built, and the control cases throw at `tx.select()`
            // before its arguments are evaluated.
            table: {}
        } as unknown as AnyContentType;
    }

    const row = { id: 'entry-de', locale: 'de', localeGroupId: 'group-1' };

    it('takes no sibling locks when nothing can travel [i18n:I-13]', async () => {
        const tx = throwingTx();
        const relations = throwingRelations();

        // Every field is per-locale: one localized text and one relation that
        // opted out of syncing. Nothing this save carries reaches a sibling, so
        // there is nothing to read and nothing to lock.
        await expect(
            service(relations).afterUpdate(
                tx as unknown as EntryTransaction,
                type({ title, pinnedTag }),
                row,
                { title: 'DE title', pinnedTag: 'tag-1' },
                'ws-1',
                { created: false }
            )
        ).resolves.toEqual([]);

        expect(tx.select).not.toHaveBeenCalled();
        expect(tx.update).not.toHaveBeenCalled();
        expect(relations.linkIdsOf).not.toHaveBeenCalled();
        expect(relations.equivalentIdsByLocale).not.toHaveBeenCalled();
        expect(relations.replaceLinks).not.toHaveBeenCalled();
    });

    /**
     * The controls. Without them the case above passes on a service that never
     * reads siblings at all — these show the same `tx` does get used the moment
     * either half of the guard's condition is true.
     */
    it('does read the siblings when a shared column travels', async () => {
        const tx = throwingTx();
        await expect(
            service(throwingRelations()).afterUpdate(
                tx as unknown as EntryTransaction,
                type({ title, number, pinnedTag }),
                row,
                { title: 'DE title', number: 7 },
                'ws-1',
                { created: false }
            )
        ).rejects.toThrow('SIBLING_READ');
        expect(tx.select).toHaveBeenCalled();
    });

    it('does read the siblings when a mirrored relation can travel', async () => {
        const tx = throwingTx();
        // No shared column at all — the relation alone is what makes the read
        // necessary, which is the half a values-bag-only guard would miss.
        await expect(
            service(throwingRelations()).afterUpdate(
                tx as unknown as EntryTransaction,
                type({ title, author }),
                row,
                { title: 'DE title' },
                'ws-1',
                { created: false }
            )
        ).rejects.toThrow('SIBLING_READ');
        expect(tx.select).toHaveBeenCalled();
    });
});
