import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, type AnyColumn } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import type { AnyContentType, EntryStatus } from '@orthacms/content-server';
import type { LocaleDir } from '../../i18n.constants';
import { LocaleRegistryService } from '../../locales/services/locale-registry.service';

/** A generated content table seen as a bag of columns by property name. */
type ContentTable = Record<string, AnyColumn>;

/** One locale's slot in a translation group — the row, or null if missing. */
export interface EntryLocaleItem {
    /**
     * The configured locale slug — a BCP-47 language tag, usable verbatim as
     * the HTML `lang` of this translation's editor surface and preview.
     */
    locale: string;
    /**
     * This locale's text direction, so the editor can set `dir` alongside
     * `lang` without a second call to `GET /api/i18n/locales`.
     */
    dir: LocaleDir;
    /** Whether it's the configured default locale. */
    isDefault: boolean;
    /** The group's row in this locale, or null when not yet translated. */
    entry: {
        id: string;
        /** Publish state — publishable types only. */
        status?: EntryStatus;
        /**
         * ISO timestamp of when this locale last went live, or `null` if never
         * — publishable types only. Paired with `status` it separates a
         * never-published draft from one carrying unpublished edits over live
         * content, which is the difference the locale switcher renders.
         */
        publishedAt?: string | null;
        /** ISO last-updated timestamp. */
        updatedAt: string;
    } | null;
}

/** The `GET /api/i18n/content/:typeName/:id/locales` response envelope. */
export interface EntryLocalesView {
    /** The entry's translation-group id. */
    localeGroupId: string;
    /** One item per **configured** locale, in config order. */
    items: EntryLocaleItem[];
}

/** One group member in a batch summary. */
export interface LocaleSummaryItem {
    locale: string;
    entryId: string;
    /** Publish state — publishable types only. */
    status?: EntryStatus;
    /** When this locale last went live, or `null` — publishable types only. */
    publishedAt?: string | null;
}

/** The `POST /api/i18n/content/:typeName/locale-summary` response envelope. */
export interface LocaleSummaryView {
    /** Per requested group id: its live members (config-ordered). */
    groups: Record<string, LocaleSummaryItem[]>;
}

/**
 * Reads over translation groups: the per-entry locale panel (which locales
 * exist, with status) and the records table's batched per-page summary.
 * Read-only — writes live in {@link TranslationService}.
 */
@Injectable()
export class LocaleGroupService {
    constructor(
        @InjectDatabase() private readonly db: Database,
        private readonly locales: LocaleRegistryService
    ) {}

    /**
     * The locale panel for one entry: every configured locale with its
     * sibling row (id, status, updatedAt) or null. 404 when the entry is
     * missing (or soft-deleted) in this workspace.
     */
    async entryLocales(
        type: AnyContentType,
        id: string,
        workspaceId: string
    ): Promise<EntryLocalesView> {
        const table = type.table as unknown as ContentTable;
        const [row] = (await this.db
            .select()
            .from(type.table)
            .where(this.liveWhere(type, eq(table['id'], id), workspaceId))
            .limit(1)) as Record<string, unknown>[];
        if (!row) {
            throw new NotFoundException(
                `No entry "${id}" on content type "${type.name}".`
            );
        }
        const groupId = row['localeGroupId'] as string;
        const siblings = (await this.db
            .select()
            .from(type.table)
            .where(
                this.liveWhere(
                    type,
                    eq(table['localeGroupId'], groupId),
                    workspaceId
                )
            )) as Record<string, unknown>[];
        const byLocale = new Map(
            siblings.map((sibling) => [sibling['locale'] as string, sibling])
        );
        return {
            localeGroupId: groupId,
            items: this.locales.all().map((locale) => {
                const sibling = byLocale.get(locale.slug);
                return {
                    locale: locale.slug,
                    // Always resolved by the registry; the fallback is for
                    // type flow only.
                    dir: locale.dir ?? 'ltr',
                    isDefault: locale.isDefault ?? false,
                    entry: sibling
                        ? {
                              id: sibling['id'] as string,
                              ...(type.publishable
                                  ? {
                                        status: sibling[
                                            'status'
                                        ] as EntryStatus,
                                        publishedAt: this.publishedAt(sibling)
                                    }
                                  : {}),
                              updatedAt: (
                                  sibling['updatedAt'] as Date
                              ).toISOString()
                          }
                        : null
                };
            })
        };
    }

    /**
     * Batched group summary for the records table's Locales column: for each
     * requested group id, its live members **in a configured locale**, with
     * per-row status — one query for the whole page.
     *
     * The response's keys are exactly the request's: every requested id is
     * seeded to `[]` up front and the rows are workspace-scoped, so a group id
     * from another workspace and one that names nothing at all come back
     * identical. A caller learns nothing it did not already supply.
     */
    async summaries(
        type: AnyContentType,
        groupIds: string[],
        workspaceId: string
    ): Promise<LocaleSummaryView> {
        const groups: Record<string, LocaleSummaryItem[]> = {};
        for (const groupId of groupIds) groups[groupId] = [];
        if (!groupIds.length) return { groups };

        const table = type.table as unknown as ContentTable;
        const rows = (await this.db
            .select()
            .from(type.table)
            .where(
                this.liveWhere(
                    type,
                    inArray(table['localeGroupId'], groupIds),
                    workspaceId
                )
            )) as Record<string, unknown>[];

        // Config order within each group, so badge order is stable. The map
        // doubles as the **configured-set filter**: a row in a slug the host no
        // longer declares is not a translation the UI can offer, and reporting
        // it here made this endpoint the one place an orphaned locale stayed
        // visible — the locale panel iterates the configured set, coverage
        // filters it out, and `?locale=` 400s it, so the records table's badges
        // contradicted every other view of the same record.
        const order = new Map(
            this.locales.all().map((locale, index) => [locale.slug, index])
        );
        for (const row of rows) {
            const groupId = row['localeGroupId'] as string;
            if (!order.has(row['locale'] as string)) continue;
            groups[groupId]?.push({
                locale: row['locale'] as string,
                entryId: row['id'] as string,
                ...(type.publishable
                    ? {
                          status: row['status'] as EntryStatus,
                          publishedAt: this.publishedAt(row)
                      }
                    : {})
            });
        }
        for (const members of Object.values(groups)) {
            // Every surviving member is configured, so the lookup always hits.
            members.sort(
                (a, b) =>
                    (order.get(a.locale) as number) -
                    (order.get(b.locale) as number)
            );
        }
        return { groups };
    }

    /** A row's `published_at` as an ISO string, or null when it never went live. */
    private publishedAt(row: Record<string, unknown>): string | null {
        const value = row['publishedAt'] as Date | null | undefined;
        return value ? value.toISOString() : null;
    }

    /** A predicate AND workspace scope AND (paranoid) the not-deleted guard. */
    private liveWhere(
        type: AnyContentType,
        predicate: ReturnType<typeof eq>,
        workspaceId: string
    ) {
        const table = type.table as unknown as ContentTable;
        return and(
            predicate,
            eq(table['workspaceId'], workspaceId),
            ...(type.paranoid ? [isNull(table['deletedAt'])] : [])
        );
    }
}
