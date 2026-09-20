import { collection, field } from '@orthacms/content-server/define';
import type { AnyContentType } from '@orthacms/content-server/define';
import { testAuthor } from './test-author';
import { testSeo } from './test-seo';

/**
 * `test_page` — the e2e-owned **self-referential** collection (a page tree).
 * The one cardinality no other test type covers, and the one the filter engine
 * has to handle specially: parent and child are the same physical table, so the
 * subquery aliases the target.
 *
 * It exists for the relation-filter suite. A relation nested under a self-hop
 * (`parent.owner.name`, `parent.parent.title`) is where the aliasing can go
 * wrong *silently* — an unaliased correlation still produces valid SQL, it just
 * answers about the ROOT row instead of the parent. Only a real database with
 * real rows proves which row was actually read, which is why this is an e2e
 * type and not another unit fixture.
 *
 * Deliberately **not** publishable / paranoid / i18n: the envelope flags are
 * exercised elsewhere, and keeping them off means a filter assertion here is
 * about the traversal and nothing else.
 *
 * The `parent` thunk needs the explicit `AnyContentType` annotation to break
 * the TS inference cycle a self-reference creates.
 */
export const testPage: AnyContentType = collection('test_page', {
    label: 'Test pages',
    description: 'A self-referencing page tree — parent/child on one table.',
    fields: {
        title: field.text({
            required: true,
            minLength: 1,
            maxLength: 200,
            admin: { label: 'Title', description: "The page's title." }
        }),
        // self-referential: a page's parent is another page in the same table.
        parent: field.relation({
            to: () => testPage,
            admin: {
                label: 'Parent',
                description: 'The page this one sits under (self-referential).'
            }
        }),
        // A plain many-to-one, so the suite can traverse a relation *through*
        // the self-hop (`parent.owner.name`).
        owner: field.relation({
            to: () => testAuthor,
            onDelete: 'set null',
            admin: {
                label: 'Owner',
                description: 'The author who owns this page (many-to-one).'
            }
        }),
        // One-to-one on a type with **no locales** — the counterpart of
        // `test_article.seo`, and the only fixture that reaches the plain,
        // column-wide `UNIQUE(seo_id)` branch. Without it the non-localized
        // half of the one-to-one rule (and its "already linked to another
        // entry" message, which says nothing about locales) is unreachable.
        seo: field.relation({
            to: () => testSeo,
            unique: true,
            admin: {
                label: 'SEO metadata',
                description: 'One-to-one, on a type with no locales.'
            }
        })
    }
});
