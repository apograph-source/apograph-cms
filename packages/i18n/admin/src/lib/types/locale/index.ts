/**
 * Wire contracts of the i18n server plugin, as the admin sees them. Mirrors
 * `@orthacms/i18n-server`'s views without importing across the server
 * boundary (the workspace convention for wire types).
 */

import type { EntryStatus } from '@orthacms/content-admin';

/**
 * Writing direction of a locale's content.
 *
 * Resolved **server-side** (explicit host config, else inferred from the slug's
 * language/script subtags) so no client has to keep its own list of which
 * languages are right-to-left.
 */
export type LocaleDir = 'ltr' | 'rtl';

/** One configured locale, served by `GET /api/i18n/locales`. */
export type Locale = {
    /**
     * Stable machine slug stored on entry rows (e.g. `en`, `pt-br`).
     *
     * Contractually a **BCP-47 language tag**, so it may be used verbatim as an
     * HTML `lang` value — which is what every surface here does.
     */
    slug: string;
    /** Human display name. */
    name: string;
    /** Whether it's the default locale (exactly one is). */
    isDefault: boolean;
    /**
     * Writing direction of content in this locale. Always sent by the server;
     * optional here only so a stale/failed read degrades to "unknown" rather
     * than to a wrong direction.
     */
    dir?: LocaleDir;
};

/** The `GET /api/i18n/locales` envelope. */
export type LocalesResult = {
    items: Locale[];
};

/** One locale's slot in an entry's translation group. */
export type EntryLocaleItem = {
    locale: string;
    /** Writing direction of that locale — sent alongside `locale`. */
    dir?: LocaleDir;
    isDefault: boolean;
    /** The group's row in this locale, or null when not yet translated. */
    entry: {
        id: string;
        /** Publish state — publishable types only. */
        status?: EntryStatus;
        /**
         * When this locale last went live, or `null` if never — publishable
         * types only. With `status` it names the four states the switcher
         * renders (see content-admin's `entryStatusView`): a `draft` that has a
         * `publishedAt` is *modified*, not a plain draft.
         */
        publishedAt?: string | null;
        /** ISO last-updated timestamp. */
        updatedAt: string;
    } | null;
};

/** The `GET /api/i18n/content/:type/:id/locales` envelope. */
export type EntryLocalesResult = {
    localeGroupId: string;
    /** One item per configured locale, in config order. */
    items: EntryLocaleItem[];
};

/** One live group member in a batched locale summary. */
export type LocaleSummaryItem = {
    locale: string;
    entryId: string;
    /** Publish state — publishable types only. */
    status?: EntryStatus;
    /** When this locale last went live, or `null` — publishable types only. */
    publishedAt?: string | null;
};

/** The `POST /api/i18n/content/:type/locale-summary` envelope. */
export type LocaleSummariesResult = {
    /** Per requested group id: its live members, config-ordered. */
    groups: Record<string, LocaleSummaryItem[]>;
};

/** How much of the workspace's localized content exists in one locale. */
export type LocaleCoverage = {
    locale: string;
    name: string;
    isDefault: boolean;
    /** Records that have a row in this locale. */
    translated: number;
    /** Records that do not. */
    missing: number;
};

/**
 * One localized content type's own coverage.
 *
 * The same four figures as the envelope, scoped to a type — what turns "122
 * records need translating" into "and 88 of them are articles". A workspace
 * total says work exists; only this says where it is.
 */
export type ContentTypeCoverage = {
    name: string;
    label: string;
    records: number;
    localized: number;
    notLocalized: number;
    requiresLocalization: number;
};

/**
 * The `GET /api/insights/i18n/coverage` envelope.
 *
 * Every figure counts **records** (translation groups), never rows: a localized
 * entry is one row per language, so counting rows would report 40 stories in 3
 * languages as 120 things and make every share on the card wrong.
 *
 * `notLocalized` is a **subset** of `requiresLocalization`, not a second slice
 * of it — a record in one of four languages both has no translations and needs
 * some. They are separate figures because they are separate jobs.
 */
export type I18nCoverageResult = {
    /** One entry per configured locale, in config order. */
    locales: LocaleCoverage[];
    records: number;
    /** Records that exist in every configured locale. */
    localized: number;
    /** Records that exist in exactly one locale. Always 0 with one locale configured. */
    notLocalized: number;
    /** Records missing at least one configured locale. */
    requiresLocalization: number;
    /** Per-type coverage, most records first. Unused types are omitted. */
    types: ContentTypeCoverage[];
};
