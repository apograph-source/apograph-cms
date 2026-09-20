import { Injectable } from '@nestjs/common';
import {
    and,
    eq,
    inArray,
    isNull,
    sql,
    type AnyColumn,
    type SQL
} from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { InjectDatabase, type Database } from '@orthacms/database';
import { InjectContentRegistry } from '@orthacms/content-server';
import type {
    AnyContentType,
    ContentTypeRegistry
} from '@orthacms/content-server';
import { LocaleRegistryService } from '../../../locales/services/locale-registry.service';
import type {
    ContentTypeCoverageView,
    I18nCoverageView,
    LocaleCoverageView
} from '../../types/i18n-insights-view';

/** A generated content table seen as a bag of columns by property name. */
type ContentTable = Record<string, AnyColumn>;

/** Reads a generated table's columns by property name. */
function columnsOf(type: AnyContentType): ContentTable {
    return type.table as unknown as ContentTable;
}

/**
 * Live read-model for the localization coverage widget.
 *
 * **This lives in i18n-server, not content-server, and that is not arbitrary.**
 * Coverage is a question about a set the content plugin deliberately does not
 * know: the *configured* locales. content-server owns the `locale` column's
 * shape and nothing about what a locale means, so it can report which slugs
 * happen to appear in the data but not which ones are missing — and "missing"
 * is the entire widget. `LocaleRegistryService` is the source of that set, and
 * it is here.
 *
 * Like content's own insights query this aggregates **on demand**, per type,
 * with no projection: a localized collection is its own generated
 * `content_<name>` table, so a workspace-wide answer is inherently a fan-out.
 */
@Injectable()
export class LocalizationCoverageQuery {
    constructor(
        @InjectDatabase() private readonly db: Database,
        @InjectContentRegistry() private readonly registry: ContentTypeRegistry,
        private readonly locales: LocaleRegistryService
    ) {}

    /** Coverage across every localized content type in the workspace. */
    async coverage(workspaceId: string): Promise<I18nCoverageView> {
        const configured = this.locales.all();
        const slugs = configured.map((locale) => locale.slug);
        const localizedTypes = this.registry.all().filter((type) => type.i18n);

        /** Records holding a row in each locale, by slug. */
        const translated = new Map<string, number>(
            slugs.map((slug) => [slug, 0])
        );
        const types: ContentTypeCoverageView[] = [];
        let records = 0;
        let localized = 0;
        let single = 0;

        for (const type of localizedTypes) {
            for (const row of await this.perLocale(type, workspaceId, slugs)) {
                translated.set(
                    row.locale,
                    (translated.get(row.locale) ?? 0) + row.translated
                );
            }

            const spread = await this.groupSpread(
                type,
                workspaceId,
                slugs,
                configured.length
            );
            records += spread.records;
            localized += spread.complete;
            single += spread.single;

            // A type the workspace has never used is noise on a chart about
            // where the outstanding work sits — and listing it would push the
            // types that do hold work further down.
            if (spread.records === 0) continue;
            types.push({
                name: type.name,
                label: type.label,
                records: spread.records,
                localized: spread.complete,
                notLocalized: configured.length > 1 ? spread.single : 0,
                requiresLocalization: spread.records - spread.complete
            });
        }

        types.sort((a, b) => b.records - a.records);

        const locales: LocaleCoverageView[] = configured.map((locale) => {
            const covered = translated.get(locale.slug) ?? 0;
            return {
                locale: locale.slug,
                name: locale.name,
                isDefault: locale.isDefault ?? false,
                translated: covered,
                missing: records - covered
            };
        });

        return {
            locales,
            records,
            localized,
            // With one locale configured there is nowhere to translate to, so
            // every record trivially covers "all" of them — reporting those
            // same records as "not localized" would state both at once.
            notLocalized: configured.length > 1 ? single : 0,
            requiresLocalization: records - localized,
            types
        };
    }

    /**
     * Records holding a row in each locale, for one type.
     *
     * `count(distinct locale_group_id)` rather than `count(*)`: the
     * `(locale_group_id, locale)` unique index makes those equal in a healthy
     * table, and the distinct keeps the figure honest against a paranoid type
     * where the index is partial and a trashed row could otherwise be counted
     * twice.
     */
    private async perLocale(
        type: AnyContentType,
        workspaceId: string,
        slugs: string[]
    ): Promise<{ locale: string; translated: number }[]> {
        const columns = columnsOf(type);
        // The generated tables are reached as an untyped column bag, so both
        // the projection and the grouping go through `sql` fragments — a bare
        // `AnyColumn` carries no dialect and doesn't satisfy the builder's
        // overloads.
        const locale = sql<string>`${columns['locale']}`;
        return this.db
            .select({
                locale,
                translated: sql<number>`cast(count(distinct ${columns['localeGroupId']}) as int)`
            })
            .from(type.table as PgTable)
            .where(this.configuredScope(type, workspaceId, slugs))
            .groupBy(locale);
    }

    /**
     * How many translation groups this type has, how many are complete, and how
     * many sit in a single language.
     *
     * One grouped subquery folded by an outer aggregate — the alternative,
     * reading one row per group and counting in JS, would pull the workspace's
     * whole content set over the wire to produce three integers.
     */
    private async groupSpread(
        type: AnyContentType,
        workspaceId: string,
        slugs: string[],
        configuredCount: number
    ): Promise<{ records: number; complete: number; single: number }> {
        const columns = columnsOf(type);
        const groups = this.db
            .select({
                covered: sql<number>`count(distinct ${columns['locale']})`.as(
                    'covered'
                )
            })
            .from(type.table as PgTable)
            .where(this.configuredScope(type, workspaceId, slugs))
            .groupBy(sql`${columns['localeGroupId']}`)
            .as('groups');

        // The subquery alias carries no column type through, so both filters
        // are raw fragments rather than `eq(...)`, whose overloads can't
        // resolve one.
        const [row] = await this.db
            .select({
                records: sql<number>`cast(count(*) as int)`,
                complete: sql<number>`cast(count(*) filter (
                    where ${groups.covered} = ${configuredCount}
                ) as int)`,
                single: sql<number>`cast(count(*) filter (
                    where ${groups.covered} = 1
                ) as int)`
            })
            .from(groups);

        return {
            records: row?.records ?? 0,
            complete: row?.complete ?? 0,
            single: row?.single ?? 0
        };
    }

    /**
     * Workspace scope, the soft-delete guard, **and** the configured locale set.
     *
     * The locale filter is what makes "complete" mean what it says. A row in a
     * slug the host has since removed from its config is not coverage of
     * anything, and left in it would push a group's distinct-locale count past
     * the configured total — so a record could be over-covered and still not
     * counted as complete. Filtering here also drops a group made entirely of
     * such rows, which is the right answer rather than a record with zero
     * languages.
     */
    private configuredScope(
        type: AnyContentType,
        workspaceId: string,
        slugs: string[]
    ): SQL | undefined {
        const columns = columnsOf(type);
        return and(
            eq(columns['workspaceId'], workspaceId),
            inArray(columns['locale'], slugs),
            type.paranoid ? isNull(columns['deletedAt']) : undefined
        );
    }
}
