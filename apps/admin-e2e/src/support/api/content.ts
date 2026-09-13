import { type Page } from '@playwright/test';
import { type WorkspaceView } from './workspaces';

/** A content-type summary as `GET /api/content-schema` returns it. */
interface ContentTypeSummary {
    name: string;
    kind: 'collection' | 'single';
    label: string;
    description?: string;
    path?: string;
    /** Has a draft/published `status` envelope column. */
    publishable?: boolean;
    /**
     * Row-per-locale, via `locale` + `localeGroupId`. What the editor reads to
     * decide whether a decision it is about to take covers every language of the
     * record — segments' Access tab says so on a localized type and stays quiet
     * on one with no translations.
     */
    i18n?: boolean;
}

/** One field as `GET /api/content-schema/:name` returns it. */
interface ContentFieldSchema {
    name: string;
    type: string;
    required: boolean;
    /**
     * The field holds a different value per locale. The editor splits the form
     * into Translated / Shared groups on it, and puts the row's language on the
     * translated run — a shared field holds one value for every locale, so
     * claiming a language for it would be a worse assertion than making none.
     */
    localized?: boolean;
    validation: Record<string, unknown>;
    admin: Record<string, unknown>;
    options?: string[];
    relation?: {
        to: string;
        many: boolean;
        onDelete?: string;
        unique?: boolean;
        inverse?: { field: string };
    };
    /** `media` fields: an ordered list of asset ids rather than one id. */
    multiple?: boolean;
    /** `media` fields: the asset restriction the picker filters by. */
    accept?: { kinds?: string[]; mimeTypes?: string[] };
}

/** A content type with its full field schema (the `:name` detail route). */
interface ContentTypeDetail extends ContentTypeSummary {
    fields: ContentFieldSchema[];
}

/**
 * The content-type catalogue the schema endpoint returns: two collections
 * (Blog posts, Products) and two pages (Home, About). Slugs line up with the
 * grants on {@link LIBRARY_WORKSPACE} / {@link SCOPED_WORKSPACE}.
 */
export const CONTENT_SCHEMA_SEED: ContentTypeSummary[] = [
    { name: 'blog_post', kind: 'collection', label: 'Blog posts' },
    { name: 'product', kind: 'collection', label: 'Products' },
    { name: 'home', kind: 'single', label: 'Home', path: '/' },
    { name: 'about', kind: 'single', label: 'About', path: '/about' }
];

/**
 * Full field schemas for the seed collections, returned by the
 * `GET /api/content-schema/:name` detail route the records table reads. The
 * field order drives the default columns (first four non-heavy fields + Status +
 * Updated), and `category`'s options drive the select filter + cell badge.
 */
export const CONTENT_DETAIL_SEED: Record<string, ContentTypeDetail> = {
    blog_post: {
        name: 'blog_post',
        kind: 'collection',
        label: 'Blog posts',
        publishable: true,
        fields: [
            {
                name: 'title',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Title' }
            },
            {
                name: 'excerpt',
                type: 'richtext',
                required: false,
                validation: {},
                admin: { label: 'Excerpt' }
            },
            {
                name: 'price',
                type: 'money',
                required: false,
                validation: {},
                admin: { label: 'Price' }
            },
            {
                name: 'published',
                type: 'boolean',
                required: false,
                validation: {},
                admin: { label: 'Published' }
            },
            {
                name: 'category',
                type: 'select',
                required: false,
                validation: {},
                admin: { label: 'Category' },
                options: ['news', 'guide', 'release']
            },
            {
                name: 'publishedAt',
                type: 'datetime',
                required: false,
                validation: {},
                admin: { label: 'Published at' }
            }
        ]
    },
    product: {
        name: 'product',
        kind: 'collection',
        label: 'Products',
        publishable: true,
        fields: [
            {
                name: 'name',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Name' }
            },
            {
                name: 'price',
                type: 'money',
                required: true,
                validation: {},
                admin: { label: 'Price' }
            }
        ]
    },
    home: {
        name: 'home',
        kind: 'single',
        label: 'Home',
        path: '/',
        fields: [
            {
                name: 'heading',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Heading' }
            }
        ]
    },
    about: {
        name: 'about',
        kind: 'single',
        label: 'About',
        path: '/about',
        fields: [
            {
                name: 'heading',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Heading' }
            }
        ]
    }
};

/**
 * Schema seed for the **relations** suite. `article` exercises every
 * cardinality: a single many-to-one (`author`), a unique one-to-one (`seo`), and
 * a many-to-many (`tags`); `tag.articles` is the inverse of `article.tags`. The
 * candidate rows for these targets are served by {@link mockContentEntries} from
 * {@link RELATIONS_ENTRIES_SEED} (the real `GET /api/content/:type` path).
 */
export const RELATIONS_SCHEMA_SEED: ContentTypeSummary[] = [
    {
        name: 'article',
        kind: 'collection',
        label: 'Articles',
        publishable: true
    },
    { name: 'author', kind: 'collection', label: 'Authors' },
    { name: 'tag', kind: 'collection', label: 'Tags' },
    { name: 'seo_meta', kind: 'collection', label: 'SEO metadata' }
];

/**
 * The media-fields suite's catalogue — one publishable collection whose schema
 * carries both media shapes, so the entry editor contributes its **Media** tab
 * (`appliesTo` checks for a media field).
 */
export const MEDIA_FIELDS_SCHEMA_SEED: ContentTypeSummary[] = [
    {
        name: 'article',
        kind: 'collection',
        label: 'Articles',
        publishable: true
    }
];

/**
 * Full field schema for the media-fields suite: a required title, a **single**
 * media field restricted to images (`Cover image`), and a **multiple** one
 * (`Gallery`) — the two shapes the field control renders differently (replace vs
 * append + reorder). Kept separate from {@link RELATIONS_DETAIL_SEED} so the
 * Media tab only appears where a suite asked for it.
 */
export const MEDIA_FIELDS_DETAIL_SEED: Record<string, ContentTypeDetail> = {
    article: {
        name: 'article',
        kind: 'collection',
        label: 'Articles',
        publishable: true,
        fields: [
            {
                name: 'text',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Title' }
            },
            {
                name: 'cover',
                type: 'media',
                required: false,
                validation: {},
                admin: { label: 'Cover image' },
                accept: { kinds: ['image'] }
            },
            {
                name: 'gallery',
                type: 'media',
                required: false,
                validation: {},
                admin: { label: 'Gallery' },
                multiple: true
            }
        ]
    }
};

/**
 * The rich-text suite's catalogue — one publishable collection whose schema
 * carries the `richtext` fields the WYSIWYG plugin claims.
 */
export const WYSIWYG_SCHEMA_SEED: ContentTypeSummary[] = [
    {
        name: 'article',
        kind: 'collection',
        label: 'Articles',
        publishable: true
    }
];

/**
 * Full field schema for the rich-text suite. Four fields, each pinning down a
 * different branch of the plugin's `appliesTo`:
 *
 * - `body` — a plain `richtext`, which the WYSIWYG claims by default.
 * - `summary` — **required**, so the suite can prove an emptied editor stores
 *   `''` (and trips the required rule) rather than a stray `<p></p>`.
 * - `notes` — a **shared** (`localized: false`) richtext, which is what makes
 *   "the expanded view claims the row's language" falsifiable: every other
 *   prose field here is localized, so a control that put `contentLocale` on
 *   the section unconditionally would look right on all of them.
 * - `rawHtml` — `widget: 'textarea'`, the documented opt-out, which must keep
 *   content-admin's plain textarea.
 */
export const WYSIWYG_DETAIL_SEED: Record<string, ContentTypeDetail> = {
    article: {
        name: 'article',
        kind: 'collection',
        label: 'Articles',
        publishable: true,
        fields: [
            {
                name: 'title',
                type: 'text',
                required: true,
                localized: true,
                validation: {},
                admin: { label: 'Title' }
            },
            {
                // The prose fields are `localized`, so the suite can prove the
                // row's language reaches the *body* — where it matters most, and
                // the one place the chain used to break. The flag also splits
                // the form into Translated / Shared groups, which is the layout
                // every localized type actually renders, so the rest of the
                // suite exercises the realistic one.
                //
                // Keep every field a save-from-an-**existing**-record test
                // touches on this side of the split: editing a *shared* field on
                // a saved row raises the "this also changes the other locales"
                // confirmation, which swallows the save before validation ever
                // runs.
                name: 'body',
                type: 'richtext',
                required: false,
                localized: true,
                validation: {},
                admin: { label: 'Body', placeholder: 'Tell the story…' }
            },
            {
                name: 'summary',
                type: 'richtext',
                required: true,
                localized: true,
                validation: {},
                admin: { label: 'Summary' }
            },
            {
                // Deliberately **not** localized: one value for every locale.
                // The expanded view must therefore claim no language of its
                // own here, because the text in it is whatever language it was
                // first written in — not the row's. Every read fixture gives it
                // a value, so it never reads back as dirty and never raises the
                // "this also changes the other locales" confirmation, which
                // would swallow a save before validation ran.
                name: 'notes',
                type: 'richtext',
                required: false,
                localized: false,
                validation: {},
                admin: { label: 'Notes' }
            },
            {
                name: 'rawHtml',
                type: 'richtext',
                required: false,
                validation: {},
                admin: { label: 'Raw HTML', widget: 'textarea' }
            }
        ]
    }
};

/** An existing article whose `body` already holds formatted HTML. */
export const WYSIWYG_ENTRY_ID = 'article-rich';

/**
 * The stored HTML {@link WYSIWYG_ENTRY_ID} comes back with. Deliberately mixed:
 * a heading, body text with a mark, and a list — enough that a preview showing
 * *tags* instead of *content* is obvious in an assertion.
 *
 * The **anchor is load-bearing**, not decoration. The collapsed preview sits
 * under a full-bleed button, which is only safe because `renderRichText`
 * flattens links to `<span data-link>`; a body with no `<a>` in it cannot tell
 * that flattening apart from its absence, so "the preview holds no link" would
 * pass with `flattenLinks` deleted. It is its own paragraph rather than a phrase
 * inside one so axe's `link-in-text-block` (which only applies to a link
 * embedded in surrounding text) stays out of the editor's a11y scan, and its
 * text names the destination so `inspectRichText`'s 2.4.4 rule has nothing to
 * say about it.
 */
export const WYSIWYG_ENTRY_BODY =
    '<h2>Release notes</h2><p>Shipped <strong>faster</strong> builds.</p>' +
    '<p><a href="https://example.com/changelog">the full changelog</a></p>' +
    '<ul><li>Cold start</li><li>Watch mode</li></ul>';

/**
 * A **German** article. The admin hardcodes `<html lang="en">`, so a body that
 * does not claim its own language is read out by a screen reader with English
 * pronunciation rules — which is the most audible failure a localization tool
 * can have. This row is what a spec points at to prove the body claims `de`.
 */
export const WYSIWYG_GERMAN_ENTRY_ID = 'article-de';

/** The German article's locale, as the read-one endpoint reports it. */
export const WYSIWYG_GERMAN_LOCALE = 'de';

/** The stored HTML {@link WYSIWYG_GERMAN_ENTRY_ID} comes back with. */
export const WYSIWYG_GERMAN_BODY =
    '<h2>Überschrift</h2><p>Der Fußgängerübergang wurde gestrichen.</p>';

/**
 * What the **shared** `notes` field holds on every row.
 *
 * English on a German row on purpose: a shared field is one value across every
 * locale, so the row's locale says nothing about the language its text is in.
 * That is the whole reason the expanded view claims a language for a localized
 * field and none for this one.
 */
export const WYSIWYG_SHARED_NOTES = '<p>Shared across every locale.</p>';

/**
 * An article whose stored body is the one ORT-84 reported as validating clean:
 * a heading level skipped over, an `<h1>` under an `<h4>`, and a table whose
 * cells no header governs. Legacy HTML on purpose — this is what the bodies
 * that already exist look like, and the rules have to reach them.
 */
export const WYSIWYG_INACCESSIBLE_ENTRY_ID = 'article-inaccessible';

/** The stored HTML {@link WYSIWYG_INACCESSIBLE_ENTRY_ID} comes back with. */
export const WYSIWYG_INACCESSIBLE_BODY =
    '<h4>Intro</h4><h1>Title</h1><table><tr><td>a</td></tr></table>';

/**
 * An article whose stored body trips a **warning** and nothing else — the other
 * half of the severity split, and the half no fixture had.
 *
 * `inspectRichText` reports two grades, and only one of them is a gate: an
 * `error` refuses the save, a `warning` is advice. With every fixture body
 * either clean or blocking, a regression that promoted every finding to `error`
 * would have left the whole suite green. This row is the one that notices.
 */
export const WYSIWYG_WARNING_ENTRY_ID = 'article-warned';

/**
 * The stored HTML {@link WYSIWYG_WARNING_ENTRY_ID} comes back with: a link whose
 * text is "click here" — 2.4.4's judgement call, and the checklist's own example
 * of a finding that must **not** block. Structurally the body is otherwise
 * clean, so nothing else can be what a refused save was about.
 */
export const WYSIWYG_WARNING_BODY =
    '<h2>Notes</h2><p>For the details, <a href="https://example.com/docs">' +
    'click here</a>.</p>';

/** An article whose `body` already embeds a picture. */
export const WYSIWYG_MEDIA_ENTRY_ID = 'article-with-media';

/**
 * The stored HTML {@link WYSIWYG_MEDIA_ENTRY_ID} comes back with. A relative
 * `src` on purpose — that is what the Media Library serves, and what an install
 * that changes hostname needs it to stay.
 */
export const WYSIWYG_MEDIA_ENTRY_BODY =
    '<p>Before</p><img src="/api/media/assets/hero/raw" alt="A hero shot" width="640"><p>After</p>';

/**
 * An article whose stored body is **hostile**. A `richtext` value is whatever
 * some other CMS user typed, pasted, or wrote straight through the API, and the
 * collapsed field renders it as markup — so this row is the trust boundary's
 * fixture, not a formatting one.
 */
export const WYSIWYG_HOSTILE_ENTRY_ID = 'article-hostile';

/**
 * Where {@link WYSIWYG_HOSTILE_BODY}'s image points. Root-relative on purpose:
 * `isSafeMediaSrc` admits a same-origin path, so the `<img>` is a node the
 * editor's schema genuinely keeps — which is what makes the *absence* of its
 * `onerror` a statement about the schema round-trip rather than about the tag
 * being dropped wholesale. The spec answers this path itself, so the error that
 * fires the handler is deterministic and needs no network.
 */
export const WYSIWYG_HOSTILE_IMAGE_SRC = '/wysiwyg-hostile-pixel.png';

/** The global {@link WYSIWYG_HOSTILE_BODY}'s payloads set if anything runs. */
export const WYSIWYG_HOSTILE_FLAG = '__apographWysiwygXss';

/**
 * The stored HTML {@link WYSIWYG_HOSTILE_ENTRY_ID} comes back with — the
 * dossier's own checklist case, written as a body rather than as a comment.
 *
 * Four vectors, each aimed at a different part of the round-trip:
 *
 * - `<img onerror>` — the one that actually runs on `innerHTML`. `<script>`
 *   does not, which is why an "it's only innerHTML" review keeps concluding
 *   this is fine.
 * - `<a href="javascript:…">` — the Link extension's protocol allowlist, which
 *   refuses the mark at parse time, so the words survive with no address on
 *   them. Its text is descriptive on purpose: `inspectRichText` warns about
 *   "read more" and friends, and this body is here for the renderer.
 * - `<iframe>` — an element no extension declares, so the schema has nowhere to
 *   put it.
 * - `<p onmouseover>` — an event handler on a tag the schema *does* keep, so
 *   dropping it can only be the attribute filter and not the tag filter.
 *
 * The two ordinary paragraphs are the control: a preview that rendered nothing
 * at all would satisfy every "is absent" assertion on its own.
 */
export const WYSIWYG_HOSTILE_BODY =
    '<p>Filed by a contributor.</p>' +
    `<img src="${WYSIWYG_HOSTILE_IMAGE_SRC}" alt="A chart" ` +
    `onerror="window.${WYSIWYG_HOSTILE_FLAG} = true">` +
    `<p onmouseover="window.${WYSIWYG_HOSTILE_FLAG} = true">Hover me.</p>` +
    `<p><a href="javascript:window.${WYSIWYG_HOSTILE_FLAG} = true">` +
    'the original report</a></p>' +
    '<iframe src="https://evil.example/panel"></iframe>';

/**
 * The read-only suite's catalogue — one **single** (a routed page), which is
 * where a reader most often lands: a page has no records table in front of it,
 * so opening the type *is* opening its editor.
 */
export const READ_ONLY_SCHEMA_SEED: ContentTypeSummary[] = [
    { name: 'landing', kind: 'single', label: 'Landing', path: '/' }
];

/**
 * The read-only suite's field schema. Deliberately one field per **control
 * shape**, because read-only is applied per shape and each has its own way of
 * going inert: a plain text input, a `color`-widget text input (an `admin.widget`
 * hint the built-in control renders as text — the field this whole suite was
 * written for), a select, a boolean segmented control, a date picker, a rich-text
 * body (a *contributed* control, `@apograph/wysiwyg-admin`), and a media field
 * (a *contributed tab*, `@apograph/media-admin`). A regression that reaches only
 * the built-ins would pass a single-field seed.
 */
export const READ_ONLY_DETAIL_SEED: Record<string, ContentTypeDetail> = {
    landing: {
        name: 'landing',
        kind: 'single',
        label: 'Landing',
        path: '/',
        publishable: true,
        fields: [
            {
                name: 'title',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Title' }
            },
            {
                name: 'subtitle',
                type: 'text',
                required: false,
                validation: {},
                admin: { label: 'Subtitle' }
            },
            {
                name: 'accentColor',
                type: 'text',
                required: false,
                validation: {},
                admin: { label: 'Accent color', widget: 'color' }
            },
            {
                name: 'variant',
                type: 'select',
                required: false,
                validation: {},
                admin: { label: 'Variant' },
                options: ['a', 'b', 'c']
            },
            {
                name: 'featured',
                type: 'boolean',
                required: false,
                validation: {},
                admin: { label: 'Featured' }
            },
            {
                name: 'goLiveOn',
                type: 'date',
                required: false,
                validation: {},
                admin: { label: 'Go live on' }
            },
            {
                name: 'body',
                type: 'richtext',
                required: false,
                validation: {},
                admin: { label: 'Body' }
            },
            {
                name: 'hero',
                type: 'media',
                required: false,
                validation: {},
                admin: { label: 'Hero image' },
                accept: { kinds: ['image'] }
            }
        ]
    }
};

/** The one stored row of {@link READ_ONLY_DETAIL_SEED}'s single. */
export const READ_ONLY_ENTRY_ID = 'landing-row';

/**
 * The permission set a reader holds: `content:read` (and the media/workspace
 * reads the shell needs) but **no** `content:create`/`update`/`publish`/`delete`.
 * Hand it to `mockSignedIn` to render the editor as a preview.
 */
export const READ_ONLY_PERMISSIONS = [
    'workspaces:read',
    'users:read',
    'content:read',
    'media:read'
];

/** Full field schemas for the relations suite (article + its three targets). */
export const RELATIONS_DETAIL_SEED: Record<string, ContentTypeDetail> = {
    article: {
        name: 'article',
        kind: 'collection',
        label: 'Articles',
        publishable: true,
        fields: [
            {
                // Named `text` to match the app's baked-in article candidate
                // values (`useRelationCandidates`), so an article's title
                // resolves when it's the *target* of the tag→articles inverse.
                name: 'text',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Title' }
            },
            {
                name: 'author',
                type: 'relation',
                required: false,
                validation: {},
                admin: { label: 'Author' },
                relation: { to: 'author', many: false, onDelete: 'set null' }
            },
            {
                name: 'seo',
                type: 'relation',
                required: false,
                validation: {},
                admin: { label: 'SEO metadata' },
                relation: {
                    to: 'seo_meta',
                    many: false,
                    onDelete: 'set null',
                    unique: true
                }
            },
            {
                name: 'tags',
                type: 'relation',
                required: false,
                validation: {},
                admin: { label: 'Tags' },
                relation: { to: 'tag', many: true }
            }
        ]
    },
    author: {
        name: 'author',
        kind: 'collection',
        label: 'Authors',
        fields: [
            {
                name: 'name',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Name' }
            },
            {
                name: 'email',
                type: 'text',
                required: false,
                validation: {},
                admin: { label: 'Email' }
            },
            {
                name: 'bio',
                type: 'richtext',
                required: false,
                validation: {},
                admin: { label: 'Bio' }
            }
        ]
    },
    tag: {
        name: 'tag',
        kind: 'collection',
        label: 'Tags',
        fields: [
            {
                name: 'name',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Name' }
            },
            {
                name: 'slug',
                type: 'text',
                required: false,
                validation: {},
                admin: { label: 'Slug' }
            },
            {
                // Inverse (two-way) of article.tags — editable from the tag side.
                name: 'articles',
                type: 'relation',
                required: false,
                validation: {},
                admin: { label: 'Articles' },
                relation: {
                    to: 'article',
                    many: true,
                    inverse: { field: 'tags' }
                }
            }
        ]
    },
    seo_meta: {
        name: 'seo_meta',
        kind: 'collection',
        label: 'SEO metadata',
        fields: [
            {
                name: 'metaTitle',
                type: 'text',
                required: false,
                validation: {},
                admin: { label: 'Meta title' }
            },
            {
                name: 'metaDescription',
                type: 'text',
                required: false,
                validation: {},
                admin: { label: 'Meta description' }
            }
        ]
    }
};

/** Build an entry row from an id + values (stable timestamps). */
function seedRow(
    id: string,
    values: Record<string, unknown>,
    status?: 'draft' | 'published'
): EntryRecord {
    const at = '2026-01-01T00:00:00.000Z';
    return {
        id,
        ...(status ? { status } : {}),
        createdAt: at,
        updatedAt: at,
        values
    };
}

/** The 32 tag names the lazy-scroll test pages through (window of 12). */
const RELATION_TAG_NAMES = [
    'engineering',
    'design',
    'product',
    'research',
    'announcement',
    'tutorial',
    'guide',
    'release',
    'security',
    'performance',
    'accessibility',
    'culture',
    'hiring',
    'remote',
    'open-source',
    'frontend',
    'backend',
    'database',
    'devops',
    'testing',
    'mobile',
    'ai',
    'data',
    'ux',
    'marketing',
    'support',
    'community',
    'roadmap',
    'changelog',
    'beta',
    'launch',
    'retro'
];

/**
 * Friendly candidate rows for the **relations** suite, keyed by target type and
 * served through {@link mockContentEntries} (the real `GET /api/content/:type`
 * path the picker now reads). Titles are recognizable (`author.name`, `tag.name`,
 * `article.text`) so the picker assertions read naturally; `tag` has 32 rows so
 * the lazy-scroll window (12) has something to page through.
 */
/**
 * Author ids for the relations suite. **Canonical UUIDs**, not readable slugs:
 * the query builder validates a relation-id rule against the 8-4-4-4-12 form
 * (Postgres' `uuid` rejects anything else), so a slug-shaped id would fail the
 * Apply gate here while working fine against the real API. Exported so a spec
 * can assert on the id a picker wrote.
 */
export const RELATION_AUTHOR_IDS = {
    ada: '11111111-1111-4111-8111-111111111111',
    grace: '22222222-2222-4222-8222-222222222222',
    alan: '33333333-3333-4333-8333-333333333333',
    katherine: '44444444-4444-4444-8444-444444444444',
    margaret: '55555555-5555-4555-8555-555555555555'
} as const;

export const RELATIONS_ENTRIES_SEED: Record<string, EntryRecord[]> = {
    author: [
        seedRow(RELATION_AUTHOR_IDS.ada, { name: 'Ada Lovelace' }),
        seedRow(RELATION_AUTHOR_IDS.grace, { name: 'Grace Hopper' }),
        seedRow(RELATION_AUTHOR_IDS.alan, { name: 'Alan Turing' }),
        seedRow(RELATION_AUTHOR_IDS.katherine, { name: 'Katherine Johnson' }),
        seedRow(RELATION_AUTHOR_IDS.margaret, { name: 'Margaret Hamilton' })
    ],
    tag: RELATION_TAG_NAMES.map((name, i) =>
        seedRow(`tag-${String(i + 1).padStart(2, '0')}`, { name, slug: name })
    ),
    article: [
        seedRow(
            'article-getting-started',
            { text: 'Getting started with Apograph' },
            'published'
        ),
        seedRow('article-scaling', { text: 'Scaling Postgres' }, 'draft'),
        seedRow('article-design', { text: 'Designing the CMS' }, 'published')
    ],
    seo_meta: [
        seedRow('seo-home', { metaTitle: 'Home — Apograph' }),
        seedRow('seo-blog', { metaTitle: 'Blog — Apograph' })
    ]
};

const ADA: WorkspaceView['members'][number] = {
    id: 'u_ada',
    name: 'Ada Lovelace',
    email: 'ada@apograph.dev'
};

/** A workspace granted every content type — the default Content Library seed. */
export const LIBRARY_WORKSPACE: WorkspaceView = {
    id: 'ws_lib',
    name: 'Library demo',
    slug: 'library-demo',
    description: 'Workspace used by the Content Library e2e suite.',
    color: 'violet',
    status: 'active',
    members: [ADA],
    content: ['blog_post', 'product', 'home', 'about']
};

/** A workspace granted the relations-suite types (article + its targets). */
export const RELATIONS_WORKSPACE: WorkspaceView = {
    ...LIBRARY_WORKSPACE,
    id: 'ws_rel',
    name: 'Relations demo',
    slug: 'relations-demo',
    content: ['article', 'author', 'tag', 'seo_meta']
};

/**
 * A relations workspace granted `article` + `author` + `seo_meta` but **not**
 * `tag` — so the editor must hide `article`'s `tags` relation (its target
 * collection isn't reachable here).
 */
export const RELATIONS_SCOPED_WORKSPACE: WorkspaceView = {
    ...RELATIONS_WORKSPACE,
    id: 'ws_rel_scoped',
    name: 'Relations scoped demo',
    slug: 'relations-scoped-demo',
    content: ['article', 'author', 'seo_meta']
};

/** A workspace granted the media-fields suite's one collection. */
export const MEDIA_FIELDS_WORKSPACE: WorkspaceView = {
    ...LIBRARY_WORKSPACE,
    id: 'ws_media',
    name: 'Media fields demo',
    slug: 'media-fields-demo',
    content: ['article']
};

/**
 * The read-only suite's one stored row — a landing page with **every** field
 * already filled. A preview that shows nothing proves nothing: the point of
 * these assertions is that the values are still legible while the controls that
 * would change them are not there.
 *
 * The `hero` id is `MEDIA_ASSET_IDS.hero` from `support/api/media` spelled out
 * rather than imported, so this module keeps its one dependency direction (the
 * media seed imports nothing from here and vice versa). The shared kernel
 * shape-checks a media value as a uuid, so it has to be a real one.
 */
export const READ_ONLY_ENTRIES_SEED: Record<string, EntryRecord[]> = {
    landing: [
        seedRow(
            READ_ONLY_ENTRY_ID,
            {
                title: 'Welcome to Apograph',
                subtitle: 'The CMS that gets out of the way',
                accentColor: '#4f46e5',
                variant: 'b',
                featured: true,
                goLiveOn: '2026-03-01',
                body: '<h2>What we ship</h2><p>Content, <strong>fast</strong>.</p>',
                hero: '11111111-1111-4111-8111-111111111111'
            },
            'published'
        )
    ]
};

/** A workspace granted the read-only suite's one page. */
export const READ_ONLY_WORKSPACE: WorkspaceView = {
    ...LIBRARY_WORKSPACE,
    id: 'ws_readonly',
    name: 'Read only demo',
    slug: 'read-only-demo',
    content: ['landing']
};

/** A workspace granted the rich-text suite's one collection. */
export const WYSIWYG_WORKSPACE: WorkspaceView = {
    ...LIBRARY_WORKSPACE,
    id: 'ws_wysiwyg',
    name: 'Rich text demo',
    slug: 'rich-text-demo',
    content: ['article']
};

/** A workspace granted only a subset — one collection + one page. */
export const SCOPED_WORKSPACE: WorkspaceView = {
    ...LIBRARY_WORKSPACE,
    id: 'ws_scoped',
    name: 'Scoped demo',
    slug: 'scoped-demo',
    content: ['blog_post', 'home']
};

/** A workspace granted no content — exercises the empty state. */
export const UNGRANTED_WORKSPACE: WorkspaceView = {
    ...LIBRARY_WORKSPACE,
    id: 'ws_empty',
    name: 'Empty demo',
    slug: 'empty-demo',
    content: []
};

interface ContentSchemaOptions {
    /** Types the endpoint returns. Defaults to {@link CONTENT_SCHEMA_SEED}. */
    types?: ContentTypeSummary[];
    /** Response status; use a 5xx to exercise the error state. */
    status?: number;
    /** Hold the response open this long, to observe the loading skeleton. */
    delayMs?: number;
}

/**
 * Stub `GET /api/content-schema` — the registry's source of truth the Content
 * Library reads via `useContentTypes`. Anchored so it doesn't also match the
 * (unused) `GET /api/content-schema/:name` detail route. Scoped to the test's
 * `page`, so it resets with the browser context.
 */
export async function mockContentSchema(
    page: Page,
    {
        types = CONTENT_SCHEMA_SEED,
        status = 200,
        delayMs
    }: ContentSchemaOptions = {}
): Promise<void> {
    await page.route(/\/api\/content-schema(\?.*)?$/, async (route) => {
        if (delayMs) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(
                status >= 400 ? { message: 'Server error' } : types
            )
        });
    });
}

interface ContentSchemaDetailOptions {
    /** Detail schemas keyed by type name. Defaults to {@link CONTENT_DETAIL_SEED}. */
    details?: Record<string, ContentTypeDetail>;
    /** Response status; use a 5xx to exercise the error state. */
    status?: number;
    /**
     * Status for the `/:name/filter-fields` sub-route only. Defaults to
     * {@link status}. Set it independently to fail *just* the filterable
     * surface: the page still renders (the detail schema loads), which is the
     * only way to reach the filter panel's own error state — the state that
     * distinguishes "filters failed to load" from "this type has no
     * filterable fields".
     */
    filterFieldsStatus?: number;
}

/** One filterable path, as `GET /api/content-schema/:name/filter-fields` returns it. */
interface WireFilterFieldSeed {
    path: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'uuid' | 'date' | 'enum';
    enumValues?: string[];
    group: string[];
    relationTarget?: string;
}

/** The wire scalar type for a content field, or `null` if unfilterable. */
function scalarWireType(
    field: ContentFieldSchema
): Pick<WireFilterFieldSeed, 'type' | 'enumValues'> | null {
    switch (field.type) {
        case 'text':
        case 'richtext':
            return { type: 'string' };
        case 'number':
        case 'money':
            return { type: 'number' };
        case 'boolean':
            return { type: 'boolean' };
        case 'date':
        case 'datetime':
            return { type: 'date' };
        case 'select':
            return { type: 'enum', enumValues: field.options ?? [] };
        default:
            // json / multiselect / relation have no scalar filter editor.
            return null;
    }
}

function fieldLabelOf(field: ContentFieldSchema): string {
    return typeof field.admin.label === 'string'
        ? field.admin.label
        : field.name;
}

/** Push one level's scalar wire fields (envelope status + user scalars). */
function pushScalarWire(
    detail: ContentTypeDetail,
    pathPrefix: string[],
    group: string[],
    out: WireFilterFieldSeed[]
): void {
    if (detail.publishable) {
        out.push({
            path: [...pathPrefix, 'status'].join('.'),
            label: 'Status',
            type: 'enum',
            enumValues: ['draft', 'published'],
            group
        });
    }
    for (const field of detail.fields) {
        const scalar = scalarWireType(field);
        if (!scalar) continue;
        out.push({
            path: [...pathPrefix, field.name].join('.'),
            label: fieldLabelOf(field),
            type: scalar.type,
            ...(scalar.enumValues ? { enumValues: scalar.enumValues } : {}),
            group
        });
    }
}

/**
 * Derive the wire filter surface for one type — its scalar fields plus **one
 * hop** of its relations' scalar fields (`author.name`) and each relation's
 * record-picker `id` entry — mirroring the server's `buildEntryFilterSurface`
 * (the mock does one hop; the server does two, which the records filter drawer
 * doesn't need to prove). Keeps the admin's `useFilterFields` fed with the
 * right SHAPE so the picker groups relation paths correctly.
 */
function filterFieldsFor(
    detail: ContentTypeDetail,
    details: Record<string, ContentTypeDetail>
): WireFilterFieldSeed[] {
    const out: WireFilterFieldSeed[] = [];
    pushScalarWire(detail, [], [], out);
    for (const field of detail.fields) {
        if (field.type !== 'relation' || !field.relation) continue;
        const target = details[field.relation.to];
        if (!target) continue;
        const relLabel = fieldLabelOf(field);
        out.push({
            path: `${field.name}.id`,
            label: relLabel,
            type: 'uuid',
            relationTarget: field.relation.to,
            group: [relLabel]
        });
        pushScalarWire(target, [field.name], [relLabel], out);
    }
    return out;
}

/**
 * Stub `GET /api/content-schema/:name` — the full field schema the records table
 * reads via `useContentSchema` — **and** its `/:name/filter-fields` sub-route
 * (`useFilterFields`, the query-builder's filterable surface). Both resolve
 * `:name` against {@link CONTENT_DETAIL_SEED}; an unknown name 404s. The detail
 * pattern is end-anchored so it no longer also swallows the `/filter-fields`
 * request (which would feed the field mapper the wrong shape). Register
 * alongside {@link mockContentSchema} for any test that opens a collection.
 */
export async function mockContentSchemaDetail(
    page: Page,
    {
        details = CONTENT_DETAIL_SEED,
        status = 200,
        filterFieldsStatus
    }: ContentSchemaDetailOptions = {}
): Promise<void> {
    const surfaceStatus = filterFieldsStatus ?? status;
    await page.route(
        /\/api\/content-schema\/([^/?]+)\/filter-fields(\?.*)?$/,
        async (route) => {
            if (surfaceStatus >= 400) {
                await route.fulfill({
                    status: surfaceStatus,
                    contentType: 'application/json',
                    body: JSON.stringify({ message: 'Server error' })
                });
                return;
            }
            const parts = new URL(route.request().url()).pathname.split('/');
            const name = decodeURIComponent(parts[parts.length - 2] ?? '');
            const detail = details[name];
            await route.fulfill({
                status: detail ? 200 : 404,
                contentType: 'application/json',
                body: JSON.stringify(
                    detail
                        ? { fields: filterFieldsFor(detail, details) }
                        : { message: 'Not found' }
                )
            });
        }
    );
    await page.route(
        /\/api\/content-schema\/([^/?]+)(\?.*)?$/,
        async (route) => {
            if (status >= 400) {
                await route.fulfill({
                    status,
                    contentType: 'application/json',
                    body: JSON.stringify({ message: 'Server error' })
                });
                return;
            }
            const name = decodeURIComponent(
                new URL(route.request().url()).pathname.split('/').pop() ?? ''
            );
            const detail = details[name];
            await route.fulfill({
                status: detail ? 200 : 404,
                contentType: 'application/json',
                body: JSON.stringify(detail ?? { message: 'Not found' })
            });
        }
    );
}

/** One fabricated entry row, as `GET /api/content/:name` returns it. */
interface EntryRecord {
    id: string;
    status?: 'draft' | 'published';
    createdAt: string;
    updatedAt: string;
    values: Record<string, unknown>;
}

/** Rows per page the records table requests by default. */
const ENTRY_PAGE_SIZE = 10;
/** How many rows each collection gets — enough to exceed one page. */
const ENTRY_COUNT = 23;

/** A deterministic value for one field at row `i` — type-shaped, stable per run. */
function valueFor(field: ContentFieldSchema, i: number): unknown {
    const label =
        typeof field.admin.label === 'string' ? field.admin.label : field.name;
    const day = new Date(Date.UTC(2026, 0, 1 + (i % 27)));
    switch (field.type) {
        case 'text':
            // Zero-padded ordinal so the rendered cells sort lexicographically.
            return `${label} ${String(i + 1).padStart(2, '0')}`;
        case 'richtext':
            return `Body copy for row ${i + 1}.`;
        case 'number':
            return (i * 7) % 100;
        case 'money':
            return ((i % 9) + 1) * 1000 - 1;
        case 'boolean':
            return i % 2 === 0;
        case 'date':
            return day.toISOString().slice(0, 10);
        case 'datetime':
            return day.toISOString();
        case 'select':
            return field.options?.length
                ? field.options[i % field.options.length]
                : null;
        case 'multiselect':
            return field.options?.length
                ? [field.options[i % field.options.length]]
                : [];
        case 'json':
            return { row: i + 1 };
        case 'relation':
            return field.relation?.many ? [`Ref ${i + 1}`] : `Ref ${i + 1}`;
        default:
            return null;
    }
}

/** Generate the deterministic entry list for a collection from its schema. */
function entriesFor(detail: ContentTypeDetail): EntryRecord[] {
    return Array.from({ length: ENTRY_COUNT }, (_, i) => {
        const values: Record<string, unknown> = {};
        for (const field of detail.fields)
            values[field.name] = valueFor(field, i);
        const day = new Date(Date.UTC(2026, 0, 1 + (i % 27))).toISOString();
        return {
            id: `${detail.name}-${String(i + 1).padStart(2, '0')}`,
            ...(detail.publishable
                ? { status: i % 3 === 0 ? 'draft' : 'published' }
                : {}),
            createdAt: day,
            updatedAt: day,
            values
        } as EntryRecord;
    });
}

/** True when any of a record's textual values (or status) contains the needle. */
function matchesSearch(record: EntryRecord, search: string): boolean {
    const needle = search.toLowerCase();
    if (record.status?.includes(needle)) return true;
    return Object.values(record.values).some((value) => {
        if (value == null) return false;
        const text = Array.isArray(value)
            ? value.join(' ')
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);
        return text.toLowerCase().includes(needle);
    });
}

/** The comparable value for a record under a sort column. */
function sortValue(record: EntryRecord, columnId: string): string | number {
    if (columnId === 'status') return record.status ?? '';
    if (columnId === 'updatedAt') return Date.parse(record.updatedAt);
    const value = record.values[columnId];
    if (value == null) return '';
    return typeof value === 'number' ? value : String(value);
}

/** Sort a copy of `rows` by a sort spec (`col` asc, `-col` desc). */
function applySort(rows: EntryRecord[], sort: string): EntryRecord[] {
    if (!sort) return rows;
    const desc = sort.startsWith('-');
    const columnId = desc ? sort.slice(1) : sort;
    if (!columnId) return rows;
    const factor = desc ? -1 : 1;
    return [...rows].sort((a, b) => {
        const av = sortValue(a, columnId);
        const bv = sortValue(b, columnId);
        const cmp =
            typeof av === 'number' && typeof bv === 'number'
                ? av - bv
                : String(av).localeCompare(String(bv));
        return cmp * factor;
    });
}

interface ContentEntriesOptions {
    /** Detail schemas to fabricate rows from. Defaults to {@link CONTENT_DETAIL_SEED}. */
    details?: Record<string, ContentTypeDetail>;
    /**
     * Explicit row sets per type name — used verbatim (still searched/sorted/
     * paginated) instead of the schema-fabricated rows. Lets the relations suite
     * serve recognizable candidate titles (see {@link RELATIONS_ENTRIES_SEED}).
     */
    entries?: Record<string, EntryRecord[]>;
    /**
     * Capped relation previews per type, keyed `typeName → fieldName →
     * { items, total }`, applied to every row of that type. Served **only** when
     * the request opts in with `?relations=preview`, and narrowed to the
     * `?relationFields=` list — mirroring the server, so a suite can assert the
     * opt-in and the visible-columns scoping, not just the happy path.
     */
    relationPreviews?: Record<
        string,
        Record<string, { items: RelationRefSeed[]; total: number }>
    >;
    /** Response status; use a 5xx to exercise the error state. */
    status?: number;
}

/** Options for the write/bulk mocks — the read options plus the bulk gate. */
interface ContentEntryWriteOptions extends ContentEntriesOptions {
    /**
     * Entry ids the publish gate rejects, each mapped to the **required field
     * names** it fails on. An id left out passes every check.
     *
     * Without this the bulk dialog could only ever be driven down its happy
     * path: the mock declared every row `publishable` with an empty checklist,
     * which is the one combination that renders neither a failure icon nor the
     * "Show field checks" trigger.
     */
    blocked?: Record<string, string[]>;
}

/**
 * Stub `GET /api/content/:name` — the records-list endpoint `useContentEntries`
 * reads. Fabricates a deterministic row set from the type's detail schema, then
 * applies the request's `?search=` / `?sort=` / `?page=` / `?pageSize=` exactly
 * as the server would, returning the `{ items, total, page, pageSize }` envelope.
 * Register alongside {@link mockContentSchemaDetail} for any test that opens a
 * collection's records table.
 */
export async function mockContentEntries(
    page: Page,
    {
        details = CONTENT_DETAIL_SEED,
        entries,
        relationPreviews,
        status = 200
    }: ContentEntriesOptions = {}
): Promise<void> {
    await page.route(/\/api\/content\/([^/?]+)(\?.*)?$/, async (route) => {
        if (status >= 400) {
            await route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Server error' })
            });
            return;
        }
        const url = new URL(route.request().url());
        const name = decodeURIComponent(
            url.pathname.split('/').pop() ?? ''
        ).split('?')[0];
        const detail = details[name];
        const override = entries?.[name];
        if (!detail && !override) {
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Not found' })
            });
            return;
        }

        const params = url.searchParams;
        const search = params.get('search') ?? '';
        const sort = params.get('sort') ?? '';
        const pageNum = Number(params.get('page') ?? '1');
        const pageSize = Number(
            params.get('pageSize') ?? String(ENTRY_PAGE_SIZE)
        );

        const all = override ?? entriesFor(detail as ContentTypeDetail);
        const searched = search
            ? all.filter((row) => matchesSearch(row, search))
            : all;
        const sorted = applySort(searched, sort);
        const start = (pageNum - 1) * pageSize;
        let items = sorted.slice(start, start + pageSize);

        // Opt-in relation preview, narrowed to the requested fields — the
        // server attaches nothing without both params.
        const previews = relationPreviews?.[name];
        const wanted = (params.get('relationFields') ?? '')
            .split(',')
            .filter(Boolean);
        if (
            params.get('relations') === 'preview' &&
            previews &&
            wanted.length
        ) {
            const scoped = Object.fromEntries(
                Object.entries(previews).filter(([field]) =>
                    wanted.includes(field)
                )
            );
            items = items.map((row) => ({ ...row, relations: scoped }));
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                items,
                total: sorted.length,
                page: pageNum,
                pageSize
            })
        });
    });
}

/** A linked record on a relation field, as the relations read returns it. */
export interface RelationRefSeed {
    id: string;
    title: string;
    /**
     * The target's slug-field value, which the admin renders as the muted
     * `/handle` beside the title (falling back to a slugified title when
     * absent) — mirrors the server's `RelationRef.slug`.
     */
    slug?: string;
    status?: 'draft' | 'published';
}

interface EntryRelationsOptions {
    /**
     * Assigned links keyed by `"<type>/<id>"` then field name. A missing entry
     * (e.g. a brand-new record) resolves to no links. Defaults to empty — the
     * relations suite edits new entries, which have nothing linked yet.
     */
    relations?: Record<string, Record<string, RelationRefSeed[]>>;
}

/**
 * Stub `GET /api/content/:name/:id/relations` — the assigned-relations read the
 * editor loads (`useEntryRelations`) to seed single-relation values and the
 * section header counts. Wraps each field's seeded refs in the paginated
 * `{ items, total }` envelope the server now returns. An entry not in the seed
 * resolves to no links. Register **after** {@link mockContentEntryWrites} so this
 * more specific route wins the `/…/:id/relations` match.
 */
export async function mockEntryRelations(
    page: Page,
    { relations = {} }: EntryRelationsOptions = {}
): Promise<void> {
    await page.route(
        /\/api\/content\/[^/?]+\/[^/?]+\/relations(\?.*)?$/,
        async (route) => {
            const parts = new URL(route.request().url()).pathname
                .split('/')
                .filter(Boolean);
            // ['api','content',name,id,'relations']
            const key = `${decodeURIComponent(
                parts[2] ?? ''
            )}/${decodeURIComponent(parts[3] ?? '')}`;
            const fields = relations[key] ?? {};
            const view = Object.fromEntries(
                Object.entries(fields).map(([field, refs]) => [
                    field,
                    { items: refs, total: refs.length }
                ])
            );
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ relations: view })
            });
        }
    );
}

interface ContentEntryReadOptions {
    /**
     * Values per `"<type>/<id>"`, served by the read-one endpoint. Everything
     * else about the record is fabricated (timestamps, draft status).
     */
    records: Record<string, Record<string, unknown>>;
    /**
     * The row's **locale** per `"<type>/<id>"` — a BCP-47 tag, as the i18n
     * plugin's wire contract sends it. The editor puts it on the localized
     * fields as `lang`, so any spec about how a translated body is *announced*
     * needs a record that actually claims a language. Omitted keys read as a
     * type with no locales, which is what most of the suite wants.
     */
    locales?: Record<string, string>;
}

/**
 * Stub `GET /api/content/:name/:id` for named records. {@link
 * mockContentEntryWrites} already answers the read-one, but only with values
 * fabricated from the schema — `null` for anything it has no generator for, a
 * media field included. Use this when a test needs an existing record to hold
 * *specific* values (e.g. an attached asset id). Register **after** the write
 * mock, and note it claims only `GET`: writes still fall through.
 */
export async function mockContentEntryRead(
    page: Page,
    { records, locales = {} }: ContentEntryReadOptions
): Promise<void> {
    const now = '2026-01-01T00:00:00.000Z';
    await page.route(
        /\/api\/content\/[^/?]+\/[^/?]+(\?.*)?$/,
        async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            const parts = new URL(route.request().url()).pathname
                .split('/')
                .filter(Boolean);
            const name = decodeURIComponent(parts[2] ?? '');
            const id = decodeURIComponent(parts[3] ?? '');
            const values = records[`${name}/${id}`];
            if (!values) return route.fallback();
            const locale = locales[`${name}/${id}`];
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    id,
                    status: 'draft',
                    createdAt: now,
                    updatedAt: now,
                    ...(locale ? { locale } : {}),
                    values
                })
            });
        }
    );
}

/** One attached asset, as the entry-media read resolves it. */
export interface MediaRefSeed {
    id: string;
    name: string;
    /** Raw-stream route the tile renders (empty on a `missing` ref). */
    url: string;
    kind: string;
    mimeType: string;
    /** The id resolved to nothing — deleted, or in another workspace. */
    missing?: boolean;
}

interface EntryMediaOptions {
    /**
     * Attached assets keyed by `"<type>/<id>"` then field name. A missing entry
     * (a brand-new record) resolves to nothing attached.
     */
    media?: Record<string, Record<string, MediaRefSeed[]>>;
    /**
     * Hold the response open this long — the window in which a tile has ids but
     * no refs yet, which is exactly when it must not guess an asset's URL.
     */
    delayMs?: number;
}

/**
 * Stub `GET /api/content/:name/:id/media` — the editor's resolve of a saved
 * record's media ids to display refs (name / thumbnail url / kind), which the
 * Media tab renders instead of raw uuids. Register **after**
 * {@link mockContentEntryWrites}, whose multi-segment route would otherwise
 * answer this path with an entry record.
 */
export async function mockEntryMedia(
    page: Page,
    { media = {}, delayMs }: EntryMediaOptions = {}
): Promise<void> {
    await page.route(
        /\/api\/content\/[^/?]+\/[^/?]+\/media(\?.*)?$/,
        async (route) => {
            if (delayMs) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            const parts = new URL(route.request().url()).pathname
                .split('/')
                .filter(Boolean);
            // ['api','content',name,id,'media']
            const key = `${decodeURIComponent(
                parts[2] ?? ''
            )}/${decodeURIComponent(parts[3] ?? '')}`;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ media: media[key] ?? {} })
            });
        }
    );
}

interface RelationFieldLinksOptions {
    /**
     * The full link set per `"<typeName>/<fieldName>"` — served to every row of
     * that type (a spec rarely needs per-row link sets, and this keeps the seed
     * independent of generated entry ids). The handler paginates it with the
     * request's `?page=` / `?pageSize=`, exactly as the server does.
     */
    links?: Record<string, RelationRefSeed[]>;
}

/**
 * Stub `GET /api/content/:name/:id/relations/:field` — the **paginated
 * per-field** links read that backs the records table's relation dropdown (and
 * the editor's infinite scroll). Distinct from {@link mockEntryRelations},
 * whose route stops at `/relations` and so never matches this deeper path.
 *
 * A relation dropdown opens on the list's capped preview and then loads this to
 * page beyond it, so a suite asserting anything past the first page needs this
 * registered.
 */
export async function mockRelationFieldLinks(
    page: Page,
    { links = {} }: RelationFieldLinksOptions = {}
): Promise<void> {
    await page.route(
        /\/api\/content\/[^/?]+\/[^/?]+\/relations\/[^/?]+(\?.*)?$/,
        async (route) => {
            const url = new URL(route.request().url());
            const parts = url.pathname.split('/').filter(Boolean);
            // ['api','content',name,id,'relations',field]
            const key = `${decodeURIComponent(
                parts[2] ?? ''
            )}/${decodeURIComponent(parts[5] ?? '')}`;
            const all = links[key] ?? [];
            const pageNum = Number(url.searchParams.get('page') ?? '1');
            const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
            const start = (pageNum - 1) * pageSize;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    items: all.slice(start, start + pageSize),
                    total: all.length
                })
            });
        }
    );
}

/** A JSON 200 fulfilment helper for the write mocks. */
function json(
    route: import('@playwright/test').Route,
    body: unknown,
    status = 200
) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body)
    });
}

/**
 * One row of `POST …/bulk/publish/preview`, built the way the server builds it.
 *
 * The **checklist is the point**. `VerdictRow` gates its entire collapsible on
 * `item.checks.length > 0`, so the previous fixture — which hard-coded
 * `checks: []` and `verdict: 'publishable'` on every row — made the disclosure,
 * the pass/fail icons and the blocked branch unreachable from any browser
 * suite. A live stack answers with one check per required field, labelled by
 * `admin.label`, on **every** gated verdict including `already-published`
 * (dossier §6.5: an already-published row keeps its checklist so the dialog can
 * expand it like any other rather than leave a dead, unexpandable row).
 *
 * `failing` names the fields this entry does not satisfy; an entry absent from
 * the suite's `blocked` map passes every check.
 */
function verdictFor(
    entryId: string,
    detail: ContentTypeDetail | undefined,
    failing: string[] | undefined
) {
    const required = (detail?.fields ?? []).filter((field) => field.required);
    const failed = new Set(failing ?? []);
    const checks = required.map((field) => ({
        field: field.name,
        // The human label, not the machine name — this is what the dialog
        // renders. Falls back to the name exactly as the server's mapper does.
        label: field.admin?.label ?? field.name,
        ok: !failed.has(field.name),
        ...(failed.has(field.name) ? { message: 'is required' } : {})
    }));
    const issues = checks
        .filter((check) => !check.ok)
        .map((check) => ({ field: check.field, message: 'is required' }));
    return {
        id: entryId,
        title: entryId,
        status: 'draft',
        verdict: issues.length > 0 ? 'blocked' : 'publishable',
        issues,
        checks
    };
}

/**
 * Stub the entry **write** API the editor, row menu, and selection bar drive:
 * read-one (`GET /api/content/:name/:id`), create (`POST /api/content/:name`),
 * update (`PATCH`), publish/unpublish/restore, soft/permanent delete, and the
 * `/bulk/...` routes. Deterministic echoes — enough for the admin to navigate,
 * toast, and invalidate. The create route `fallback()`s non-POST requests so the
 * single-segment list mock ({@link mockContentEntries}) still handles `GET`.
 * Register alongside the list mocks for any test that edits or acts on entries.
 */
export async function mockContentEntryWrites(
    page: Page,
    {
        details = CONTENT_DETAIL_SEED,
        blocked = {}
    }: ContentEntryWriteOptions = {}
): Promise<void> {
    const now = '2026-01-01T00:00:00.000Z';

    // Multi-segment routes: read-one, item writes, and bulk.
    await page.route(/\/api\/content\/[^/?]+\/.+/, async (route) => {
        const req = route.request();
        const method = req.method();
        const parts = new URL(req.url()).pathname.split('/').filter(Boolean);
        // ['api','content',name,id|'bulk', action?, sub?]
        const name = decodeURIComponent(parts[2] ?? '');
        const id = decodeURIComponent(parts[3] ?? '');
        const action = parts[4];
        const detail = details[name];
        const body = (req.postDataJSON?.() ?? {}) as {
            ids?: string[];
            values?: Record<string, unknown>;
        };

        if (id === 'bulk') {
            const ids = body.ids ?? [];
            if (action === 'publish' && parts[5] === 'preview') {
                return json(route, {
                    items: ids.map((entryId) =>
                        verdictFor(entryId, detail, blocked[entryId])
                    )
                });
            }
            if (action === 'publish') {
                // `skipped` is a list of **objects** — `{ id, reason }` — not of
                // ids, and the reason is the verdict kind that stopped the row
                // (`BulkPublishResult` in the admin's domain types; pinned
                // server-side in `content-entries-write.spec.ts`). Deriving it
                // from the same `blocked` map the preview reads keeps the dry
                // run and the commit telling one story, the way the server's
                // re-validation inside the transaction does.
                const stopped = ids.filter((entryId) => blocked[entryId]);
                return json(route, {
                    published: ids.filter((entryId) => !blocked[entryId]),
                    skipped: stopped.map((entryId) => ({
                        id: entryId,
                        reason: 'blocked'
                    }))
                });
            }
            // unpublish / delete / restore / purge
            return json(route, { count: ids.length });
        }

        const record = (status: 'draft' | 'published') => ({
            id,
            ...(detail?.publishable ? { status } : {}),
            createdAt: now,
            updatedAt: now,
            values:
                body.values ??
                detail?.fields.reduce<Record<string, unknown>>((acc, f) => {
                    acc[f.name] = valueFor(f, 0);
                    return acc;
                }, {}) ??
                {}
        });

        if (method === 'GET') return json(route, record('draft'));
        if (method === 'PATCH') return json(route, record('draft'));
        if (method === 'DELETE')
            return route.fulfill({ status: 204, body: '' });
        if (method === 'POST') {
            // publish → published; unpublish/restore → draft
            return json(
                route,
                record(action === 'publish' ? 'published' : 'draft'),
                201
            );
        }
        return route.fallback();
    });

    // Create lives on the single-segment path the list mock also owns; only
    // claim POST and defer everything else to the list mock.
    await page.route(/\/api\/content\/[^/?]+(\?.*)?$/, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const name = decodeURIComponent(
            new URL(req.url()).pathname.split('/').pop() ?? ''
        ).split('?')[0];
        const detail = details[name];
        const body = (req.postDataJSON?.() ?? {}) as {
            values?: Record<string, unknown>;
        };
        return json(
            route,
            {
                id: `${name}-new`,
                ...(detail?.publishable ? { status: 'draft' } : {}),
                createdAt: now,
                updatedAt: now,
                values: body.values ?? {}
            },
            201
        );
    });
}

/** The body of one captured create/update request. */
export interface CapturedSave {
    values: Record<string, unknown>;
    relations?: Record<
        string,
        { link?: string[]; unlink?: string[]; order?: string[] }
    >;
    /**
     * Per-plugin state stored alongside the entry, keyed by extension — the
     * segments plugin's `access`. It rides the save body precisely so it lands
     * in one transaction with the record, which makes "what did the editor
     * send" the only place a spec can check that the Access tab's staging
     * actually reached the write.
     */
    extensions?: Record<string, unknown>;
}

/** Records the bodies sent to the entry create/update endpoints. */
export interface EntrySaveSpy {
    readonly bodies: CapturedSave[];
}

/**
 * Spy on the entry **save** endpoints — records the JSON body of each
 * `POST /api/content/:name` (create) and `PATCH /api/content/:name/:id` (update)
 * so a test can assert what the editor sent (e.g. the staged relation deltas,
 * and that a link-managed relation is **not** in `values`). Fulfils like the
 * write mock so the flow continues; non-write methods fall through to the other
 * mocks. Register **after** {@link mockContentEntryWrites} so it wins the match.
 */
export async function spyEntrySave(page: Page): Promise<EntrySaveSpy> {
    const bodies: CapturedSave[] = [];
    const now = '2026-01-01T00:00:00.000Z';
    const record = (id: string, body: CapturedSave) => ({
        id,
        status: 'draft' as const,
        createdAt: now,
        updatedAt: now,
        values: body.values ?? {}
    });

    // Create (single-segment POST).
    await page.route(/\/api\/content\/[^/?]+(\?.*)?$/, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const body = (req.postDataJSON?.() ?? {}) as CapturedSave;
        bodies.push(body);
        const name = decodeURIComponent(
            new URL(req.url()).pathname.split('/').pop() ?? ''
        ).split('?')[0];
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(record(`${name}-new`, body))
        });
    });

    // Update (`PATCH /content/:name/:id`); other multi-segment writes fall through.
    await page.route(
        /\/api\/content\/[^/?]+\/[^/?]+(\?.*)?$/,
        async (route) => {
            const req = route.request();
            if (req.method() !== 'PATCH') return route.fallback();
            const body = (req.postDataJSON?.() ?? {}) as CapturedSave;
            bodies.push(body);
            const id = decodeURIComponent(
                new URL(req.url()).pathname.split('/').pop() ?? ''
            );
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(record(id, body))
            });
        }
    );

    return {
        get bodies() {
            return bodies;
        }
    };
}

/* -------------------------------------------------------------------------- */
/* Resilience fixtures: a shrinking list, a hidden required field, a 422.      */
/* -------------------------------------------------------------------------- */

/**
 * A collection whose row set actually **shrinks** when a row is deleted.
 *
 * The standard {@link mockContentEntries} serves a fixed set, so a delete leaves
 * the list the same length — which is exactly the condition the stranded-pager
 * bug needs to *not* be reproducible. This owns a mutable array, serves it
 * through the same search/sort/paginate path, and removes the row on `DELETE`,
 * so `total` genuinely falls and the view's clamp has something to clamp.
 *
 * Registered **after** the shared mocks so its narrower routes win (Playwright
 * matches the most recently added handler first).
 */
export async function mockShrinkingEntries(
    page: Page,
    {
        typeName = 'blog_post',
        count = 21
    }: { typeName?: string; count?: number } = {}
): Promise<void> {
    const detail = CONTENT_DETAIL_SEED[typeName];
    const rows: EntryRecord[] = Array.from({ length: count }, (_, i) => {
        const values: Record<string, unknown> = {};
        for (const field of detail.fields)
            values[field.name] = valueFor(field, i);
        const day = new Date(Date.UTC(2026, 0, 1 + (i % 27))).toISOString();
        return {
            id: `${typeName}-${String(i + 1).padStart(2, '0')}`,
            ...(detail.publishable ? { status: 'draft' as const } : {}),
            createdAt: day,
            updatedAt: day,
            values
        };
    });

    // Delete first: the id route is also claimed by `mockContentEntryWrites`.
    await page.route(
        new RegExp(`/api/content/${typeName}/[^/?]+$`),
        async (route) => {
            if (route.request().method() !== 'DELETE') return route.fallback();
            const id = decodeURIComponent(
                new URL(route.request().url()).pathname.split('/').pop() ?? ''
            );
            const at = rows.findIndex((row) => row.id === id);
            if (at >= 0) rows.splice(at, 1);
            await route.fulfill({ status: 204, body: '' });
        }
    );

    await page.route(
        new RegExp(`/api/content/${typeName}(\\?.*)?$`),
        async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            const url = new URL(route.request().url());
            const pageNum = Number(url.searchParams.get('page') ?? '1');
            const pageSize = Number(
                url.searchParams.get('pageSize') ?? String(ENTRY_PAGE_SIZE)
            );
            // Mirror the server: a page size above the cap is a 400, not a clamp.
            if (pageSize > 100) {
                await route.fulfill({
                    status: 400,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        message: ['pageSize must not be greater than 100']
                    })
                });
                return;
            }
            const start = (pageNum - 1) * pageSize;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    items: rows.slice(start, start + pageSize),
                    total: rows.length,
                    page: pageNum,
                    pageSize
                })
            });
        }
    );
}

/** The catalogue for the hidden-required-field fixture. */
export const HIDDEN_FIELD_SCHEMA_SEED: ContentTypeSummary[] = [
    { name: 'gadget', kind: 'collection', label: 'Gadgets', publishable: true }
];

/**
 * A publishable collection with a **required field the editor renders nowhere**
 * (`admin.hidden`). It is a schema-authoring mistake rather than a normal shape,
 * and it used to pin the form shut: the publish gate is built from the visible
 * fields and read "ready", while validation still counted the hidden one and the
 * toast named it — a control the user could never find.
 */
export const HIDDEN_FIELD_DETAIL_SEED: Record<string, ContentTypeDetail> = {
    gadget: {
        name: 'gadget',
        kind: 'collection',
        label: 'Gadgets',
        publishable: true,
        fields: [
            {
                name: 'title',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Title', description: 'Shown in listings.' }
            },
            {
                name: 'internalCode',
                type: 'text',
                required: true,
                validation: {},
                admin: { label: 'Internal code', hidden: true }
            }
        ]
    }
};

/** A workspace granted only the hidden-field fixture type. */
export const HIDDEN_FIELD_WORKSPACE: WorkspaceView = {
    ...LIBRARY_WORKSPACE,
    id: 'ws_hidden',
    name: 'Hidden field demo',
    slug: 'hidden-field-demo',
    content: ['gadget']
};

/**
 * Reject the publish step with the 422 shape the write API uses, naming a field
 * the editor renders no control for. Registered after the write mocks so it
 * claims the publish route ahead of them.
 */
export async function mockPublishRejection(
    page: Page,
    { field, message = 'is required' }: { field: string; message?: string }
): Promise<void> {
    await page.route(
        /\/api\/content\/[^/?]+\/[^/?]+\/publish$/,
        async (route) => {
            await route.fulfill({
                status: 422,
                contentType: 'application/json',
                body: JSON.stringify({
                    message: 'Entry validation failed',
                    issues: [{ field, message }]
                })
            });
        }
    );
}
