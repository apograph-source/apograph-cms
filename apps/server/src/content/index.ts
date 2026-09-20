/**
 * The host's code-defined content types — one aggregation point for two
 * consumers:
 *
 * - `plugins.ts` reads `contentTypes` to register them with `ContentPlugin`.
 * - drizzle-kit reads this file (`drizzle.config.ts → schema`) and diffs the
 *   re-exported tables into migrations. drizzle-kit only diffs **top-level
 *   table exports**, so every generated table — including many-relation join
 *   tables (via `joinTableOf`, which throws if a relation was renamed rather
 *   than silently dropping it from the diff) — must be surfaced below.
 *
 * Add a type by creating a file under `./collections` or `./pages`, then
 * register it in `contentTypes` and re-export its table(s) here — and run
 * `npx nx run server:db:generate --name=<change>`, committing the SQL.
 */

import {
    contentEntryRevisions,
    joinTableOf,
    type AnyContentType
} from '@orthacms/content-server/define';

import { article } from './collections/article';
import { author } from './collections/author';
import { category } from './collections/category';
import { comment } from './collections/comment';
import { master_collection } from './collections/master_collection';
import { seo_meta } from './collections/seo_meta';
import { tag } from './collections/tag';
import { home_page } from './pages/home_page';
import { master_single } from './pages/master_single';
import { site_settings } from './pages/site_settings';

/** Every content type registered with ContentPlugin, in one place. */
export const contentTypes: readonly AnyContentType[] = [
    author,
    tag,
    category,
    seo_meta,
    article,
    comment,
    master_collection,
    home_page,
    site_settings,
    master_single
];

/* -------------------------------------------------------------------------- */
/* Main tables — one `content_<name>` per type, re-exported for drizzle-kit.  */
/* -------------------------------------------------------------------------- */

export const authorTable = author.table;
export const tagTable = tag.table;
export const categoryTable = category.table;
export const seoMetaTable = seo_meta.table;
export const articleTable = article.table;
export const commentTable = comment.table;
export const masterCollectionTable = master_collection.table;
export const homePageTable = home_page.table;
export const siteSettingsTable = site_settings.table;
export const masterSingleTable = master_single.table;

/* -------------------------------------------------------------------------- */
/* Join tables — one per many-relation. `joinTableOf` throws if the named     */
/* relation is missing/renamed, so a dropped join table fails loudly here     */
/* instead of vanishing silently from the migration diff.                     */
/* -------------------------------------------------------------------------- */

// article: `tags` (→ tag) and `related` (→ article, self).
export const articleTagsJoinTable = joinTableOf(article, 'tags');
export const articleRelatedJoinTable = joinTableOf(article, 'related');

// master_collection: `tags` (→ tag) and `related` (→ self).
export const masterCollectionTagsJoinTable = joinTableOf(
    master_collection,
    'tags'
);
export const masterCollectionRelatedJoinTable = joinTableOf(
    master_collection,
    'related'
);

// master_single: `tags` (→ tag).
export const masterSingleTagsJoinTable = joinTableOf(master_single, 'tags');

/* -------------------------------------------------------------------------- */
/* Revision store — one fixed table (not per-type), defined by content-server  */
/* and re-exported here so drizzle-kit diffs it like any content table.        */
/* -------------------------------------------------------------------------- */

export const contentEntryRevisionsTable = contentEntryRevisions;
