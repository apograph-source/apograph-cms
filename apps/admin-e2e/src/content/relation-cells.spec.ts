import { test, expect } from '../support/fixtures';
import { mockSignedIn } from '../support/api/auth';
import { mockWorkspaces } from '../support/api/workspaces';
import {
    RELATIONS_WORKSPACE,
    RELATIONS_SCHEMA_SEED,
    RELATIONS_DETAIL_SEED,
    RELATIONS_ENTRIES_SEED,
    mockContentSchema,
    mockContentSchemaDetail,
    mockContentEntries,
    mockRelationFieldLinks,
    type RelationRefSeed
} from '../support/api/content';
import { expectNoA11yViolations } from '../support/a11y';

/** One field's preview, as the list serves it. */
type PreviewSeed = { items: RelationRefSeed[]; total: number };

/** Capped preview for the many-relation: 2 of 7 links, as the server sends it. */
const TAGS_PREVIEW: PreviewSeed = {
    items: [
        {
            id: 'tag-1',
            title: 'engineering',
            slug: 'engineering',
            status: 'published'
        },
        { id: 'tag-2', title: 'design', slug: 'design' }
    ],
    total: 7
};

/**
 * The full link set the paginated per-field route serves — the preview's two
 * plus five the dropdown only reaches by loading page 1 of the live query.
 */
const TAGS_LINKS: RelationRefSeed[] = [
    ...TAGS_PREVIEW.items,
    { id: 'tag-3', title: 'testing', slug: 'testing' },
    { id: 'tag-4', title: 'accessibility', slug: 'a11y' },
    { id: 'tag-5', title: 'performance', slug: 'perf' },
    { id: 'tag-6', title: 'security', slug: 'security' },
    { id: 'tag-7', title: 'tooling', slug: 'tooling' }
];

/** The single relation resolves to exactly one titled ref. */
const AUTHOR_PREVIEW: PreviewSeed = {
    items: [{ id: 'author-1', title: 'Ada Lovelace' }],
    total: 1
};

/** The records-table URL for the relations suite's `article` collection. */
const ARTICLES_URL = `/workspaces/${RELATIONS_WORKSPACE.id}/content/article`;

/**
 * Relation **columns in the records table** (from `@orthacms/content-admin`):
 * a relation cell renders its linked records as a titled dropdown of links to
 * those records, rather than the raw FK id the values bag carries.
 *
 * The rows' `relations` previews are served by the list mock exactly as the
 * server does — only when the request opts in with `?relations=preview` and
 * names the field — so these tests cover the opt-in wiring too, not just the
 * rendering.
 */
test.describe('Relation cells (records table)', () => {
    test.beforeEach(async ({ page }) => {
        await mockSignedIn(page);
        await mockWorkspaces(page, [RELATIONS_WORKSPACE]);
        await mockContentSchema(page, { types: RELATIONS_SCHEMA_SEED });
        await mockContentSchemaDetail(page, { details: RELATIONS_DETAIL_SEED });
        await mockContentEntries(page, {
            details: RELATIONS_DETAIL_SEED,
            entries: RELATIONS_ENTRIES_SEED,
            relationPreviews: {
                article: { tags: TAGS_PREVIEW, author: AUTHOR_PREVIEW }
            }
        });
        await mockRelationFieldLinks(page, {
            links: { 'article/tags': TAGS_LINKS }
        });
    });

    test('shows the first linked title with a +N overflow, not an id', async ({
        page
    }) => {
        await page.goto(ARTICLES_URL);

        const trigger = page
            .getByRole('button', { name: /Tags, show linked records/ })
            .first();
        await expect(trigger).toBeVisible();
        // The first ref's title, plus the remaining 6 as an overflow badge.
        await expect(trigger).toContainText('engineering');
        await expect(trigger).toContainText('+6');

        // A single relation renders its one title (never the FK uuid).
        await expect(
            page
                .getByRole('button', { name: /Author, show linked records/ })
                .first()
        ).toContainText('Ada Lovelace');
    });

    test('opens a dropdown of links to each related record', async ({
        page
    }) => {
        await page.goto(ARTICLES_URL);
        await page
            .getByRole('button', { name: /Tags, show linked records/ })
            .first()
            .click();

        const link = page.getByRole('link', {
            name: 'Open engineering in a new tab'
        });
        await expect(link).toBeVisible();
        // Deep-links to that record's own editor, in a new tab.
        await expect(link).toHaveAttribute(
            'href',
            `/workspaces/${RELATIONS_WORKSPACE.id}/content/tag/tag-1`
        );
        await expect(link).toHaveAttribute('target', '_blank');
        // The muted `/handle` comes from the target's slug.
        await expect(link).toContainText('/engineering');

        // The true total is surfaced whether the preview or the live page is
        // showing (both report 7).
        await expect(
            page.getByRole('link', { name: 'Open design in a new tab' })
        ).toBeVisible();
        await expect(page.getByText(/of 7/)).toBeVisible();
    });

    test('loads past the preview once opened', async ({ page }) => {
        await page.goto(ARTICLES_URL);
        await page
            .getByRole('button', { name: /Tags, show linked records/ })
            .first()
            .click();

        // `testing` is absent from the capped preview — it can only appear once
        // the dropdown's own paginated query has loaded, which is the second
        // tier doing its job.
        await expect(
            page.getByRole('link', { name: 'Open testing in a new tab' })
        ).toBeVisible();
        await expect(page.getByText('7 of 7')).toBeVisible();
    });

    test('opening the dropdown does not navigate the row', async ({ page }) => {
        await page.goto(ARTICLES_URL);
        await page
            .getByRole('button', { name: /Tags, show linked records/ })
            .first()
            .click();

        await expect(
            page.getByRole('link', { name: 'Open engineering in a new tab' })
        ).toBeVisible();
        // The row navigates to the entry editor on click — the cell's own
        // controls must not trigger it.
        await expect(page).toHaveURL(new RegExp(`${ARTICLES_URL}$`));
    });

    test('opening one dropdown closes the one already open', async ({
        page
    }) => {
        await page.goto(ARTICLES_URL);
        // Two relation cells in the SAME row (Author sits left of Tags), so
        // neither popover covers the other's trigger.
        const tags = page
            .getByRole('button', { name: /Tags, show linked records/ })
            .first();
        const author = page
            .getByRole('button', { name: /Author, show linked records/ })
            .first();
        // A Radix popover's content is a dialog, so this counts open dropdowns.
        const openDropdowns = page.getByRole('dialog');

        await tags.click();
        await expect(openDropdowns).toHaveCount(1);

        // Classic dropdown semantics: opening the second must close the first,
        // not leave both on screen.
        await author.click();
        await expect(openDropdowns).toHaveCount(1);
        await expect(
            page.getByRole('link', { name: 'Open Ada Lovelace in a new tab' })
        ).toBeVisible();
    });

    test('renders an em-dash when a relation holds nothing', async ({
        page
    }) => {
        await mockContentEntries(page, {
            details: RELATIONS_DETAIL_SEED,
            entries: RELATIONS_ENTRIES_SEED,
            // `author` gets no preview at all — the empty case.
            relationPreviews: { article: { tags: TAGS_PREVIEW } }
        });
        await page.goto(ARTICLES_URL);

        await expect(
            page
                .getByRole('button', { name: /Tags, show linked records/ })
                .first()
        ).toBeVisible();
        // No trigger is rendered for a relation with no links.
        await expect(
            page.getByRole('button', { name: /Author, show linked records/ })
        ).toHaveCount(0);
        // …and the cell is not merely blank: it renders the em-dash placeholder
        // with a screen-reader-only explanation, so the absence is announced
        // rather than silent. Without these the test would pass on an empty
        // `<td>` — i.e. on the cell failing to render at all.
        const emptyCell = page
            .getByRole('cell')
            .filter({ hasText: 'No linked records' })
            .first();
        await expect(emptyCell).toContainText('—');
        await expect(emptyCell).toContainText('No linked records');
    });

    test('the dropdown animates on open', async ({ page }) => {
        await page.goto(ARTICLES_URL);
        await page
            .getByRole('button', { name: /Tags, show linked records/ })
            .first()
            .click();

        // Guards the design-system's dropdown motion actually generating CSS:
        // the shadcn `animate-in` / `zoom-in-95` classes these overlays used to
        // carry produced nothing (no tailwindcss-animate installed), so the
        // animation was silently dead. A declared animation-name proves the
        // rule matched.
        const animation = await page.getByRole('dialog').evaluate((el) => {
            // Reached through the element's own view and typed inline: this
            // project's tsconfig ships no DOM lib, so neither the global
            // `getComputedStyle` nor `Element.ownerDocument` is declared.
            const node = el as unknown as {
                ownerDocument: {
                    defaultView: {
                        getComputedStyle: (target: unknown) => {
                            animationName: string;
                        };
                    } | null;
                };
            };
            return (
                node.ownerDocument.defaultView?.getComputedStyle(el)
                    .animationName ?? 'none'
            );
        });
        expect(animation).toBe('ds-dropdown-in');
    });

    test('the relation dropdown is accessible', async ({ page, makeAxe }) => {
        await page.goto(ARTICLES_URL);
        await page
            .getByRole('button', { name: /Tags, show linked records/ })
            .first()
            .click();
        await expect(
            page.getByRole('link', { name: 'Open engineering in a new tab' })
        ).toBeVisible();

        await expectNoA11yViolations(makeAxe());
    });
});
