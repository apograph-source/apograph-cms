/**
 * The server-e2e-owned content model — one aggregation point for two consumers,
 * exactly mirroring how `apps/server/src/content.ts` serves the app, but owned
 * by the e2e harness so that changing or dropping an app collection can never
 * break these tests:
 *
 * - `support/plugins.ts` reads `testContentTypes` to register them with
 *   `ContentPlugin`.
 * - drizzle-kit reads this file (`apps/server-e2e/drizzle.config.ts → schema`)
 *   and diffs the re-exported tables into `apps/server-e2e/migrations/content`.
 *   drizzle-kit only diffs **top-level table exports**, so every generated
 *   table — including the many-relation join table (via `joinTableOf`, which
 *   throws if the relation was renamed rather than silently dropping it) — is
 *   surfaced below.
 *
 * Add a type by creating a file here, registering it in `testContentTypes`, and
 * re-exporting its table(s) — then run
 * `npx nx run server-e2e:db:generate --name=<change>` and commit the SQL.
 */

import {
    contentEntryRevisions,
    joinTableOf,
    type AnyContentType
} from '@orthacms/content-server/define';
import { testArticle } from './test-article';
import { testAuthor } from './test-author';
import { testTag } from './test-tag';
import { testSeo } from './test-seo';
import { testComment } from './test-comment';
import { testLanding } from './test-landing';
import { testPage } from './test-page';

export {
    testArticle,
    testAuthor,
    testTag,
    testSeo,
    testComment,
    testLanding,
    testPage
};

/** Every content type the e2e harness registers with ContentPlugin. */
export const testContentTypes: readonly AnyContentType[] = [
    testArticle,
    testAuthor,
    testTag,
    testSeo,
    testComment,
    testLanding,
    testPage
];

// --- drizzle-kit schema: physical tables re-exported for migration diffing ---
export const testArticles = testArticle.table;
export const testAuthors = testAuthor.table;
export const testTags = testTag.table;
export const testSeos = testSeo.table;
export const testComments = testComment.table;
export const testLandingPage = testLanding.table;
export const testPages = testPage.table;
// Join table for the test_article ⇄ test_tag many-to-many. `joinTableOf` throws
// if the `tags` many-relation is renamed/removed, instead of silently dropping
// the table from the drizzle-kit diff.
export const testArticleTags = joinTableOf(testArticle, 'tags');
// Join table for the test_article ⇄ test_author many-to-many — the **mirrored**
// counterpart of `tags`, since test_author is localized.
export const testArticleContributors = joinTableOf(testArticle, 'contributors');

// The revision store — one fixed table (not per-type), defined by
// content-server and re-exported so drizzle-kit diffs it like any content
// table. Every entry save appends a revision inside its write transaction, so
// without this table every create/update 500s.
export const testContentEntryRevisions = contentEntryRevisions;
