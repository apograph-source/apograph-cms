import {
    Inject,
    Injectable,
    Logger,
    type OnApplicationBootstrap
} from '@nestjs/common';
import { notInArray, sql, type AnyColumn } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import {
    InjectContentRegistry,
    type AnyContentType,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import { I18N_CONFIG } from '../../i18n.constants';
import type { I18nPluginConfig } from '../../types/locale';
import { LocaleRegistryService } from './locale-registry.service';

/** A generated content table seen as a bag of columns by property name. */
type ContentTable = Record<string, AnyColumn>;

/** One localized content type's rows in a slug the config no longer declares. */
export interface OrphanedLocaleReport {
    /** The content type holding the rows. */
    typeName: string;
    /** The unconfigured locale slug. */
    locale: string;
    /** How many rows sit in it. */
    rows: number;
}

/**
 * Boot-time guard against the one locale change that fails silently: **removing
 * a locale from the config while its rows still exist**.
 *
 * Adding a locale is safe and self-announcing — existing groups gain a missing
 * slot, coverage reports `translated: 0`, the panel shows `entry: null`.
 * Removing one is neither. Nothing deletes the rows and nothing migrates them,
 * and from that moment every read path hides them: `?locale=de` becomes a 400
 * (`resolve` no longer knows the slug), the locale panel iterates the
 * configured set, the coverage query and the virtual filters restrict to it,
 * and the batched summary drops them. The German content is intact, reachable
 * only by `psql`, and the product never mentions it again — including to the
 * person who made the change, who sees a smaller locale switcher and nothing
 * else. `LocaleSet.remove` guards the *default* against exactly this class of
 * mistake, but the plugin never calls it: the config is a literal array, so
 * there is no removal operation to guard, only a diff nobody computes.
 *
 * This computes it, once, at boot: for every localized content type, the
 * distinct locale slugs present that the config does not declare, with a row
 * count. Under the default `'fail'` policy the boot aborts, which puts the
 * decision (migrate the rows, or restore the locale) in front of whoever
 * changed the config while it is still their change; `'warn'` logs the same
 * report and continues, for a deployment knowingly mid-migration.
 *
 * The scan is one `GROUP BY locale` per localized type, on a column the
 * `(locale_group_id, locale)` index already covers.
 */
@Injectable()
export class OrphanedLocaleChecker implements OnApplicationBootstrap {
    private readonly logger = new Logger(OrphanedLocaleChecker.name);

    constructor(
        @InjectDatabase() private readonly db: Database,
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        @Inject(I18N_CONFIG) private readonly config: I18nPluginConfig,
        private readonly locales: LocaleRegistryService
    ) {}

    /** @inheritdoc */
    async onApplicationBootstrap(): Promise<void> {
        const orphans = await this.findOrphans();
        if (!orphans.length) return;

        const detail = orphans
            .map(
                (orphan) =>
                    `${orphan.typeName}: ${orphan.rows} row(s) in "${orphan.locale}"`
            )
            .join('; ');
        const configured = this.locales
            .all()
            .map((locale) => locale.slug)
            .join(', ');
        const message =
            `Entry rows exist in locales this deployment no longer configures ` +
            `(configured: ${configured}). They are invisible to every read ` +
            `path — migrate or delete them, or restore the locale. ${detail}`;

        if ((this.config.orphanedLocales ?? 'fail') === 'warn') {
            this.logger.warn(message);
            return;
        }
        throw new Error(
            `${message} Set plugins.i18n.orphanedLocales to 'warn' to boot anyway.`
        );
    }

    /**
     * Rows in an unconfigured locale, per localized content type. Public so a
     * migration script or an operator endpoint can ask the same question
     * without re-deriving the rule.
     */
    async findOrphans(): Promise<OrphanedLocaleReport[]> {
        const configured = this.locales.all().map((locale) => locale.slug);
        const reports: OrphanedLocaleReport[] = [];
        for (const type of this.registry.all()) {
            if (!type.i18n) continue;
            reports.push(...(await this.orphansOf(type, configured)));
        }
        return reports;
    }

    /** The unconfigured locales present on one type, with row counts. */
    private async orphansOf(
        type: AnyContentType,
        configured: string[]
    ): Promise<OrphanedLocaleReport[]> {
        const table = type.table as unknown as ContentTable;
        // Soft-deleted rows are counted too: a restore would bring back a row
        // in a locale nothing can show, which is the same problem deferred.
        const rows = (await this.db
            .select({
                locale: sql<string>`${table['locale']}`,
                rows: sql<number>`count(*)::int`
            })
            .from(type.table)
            .where(notInArray(table['locale'], configured))
            .groupBy(sql`${table['locale']}`)) as {
            locale: string;
            rows: number;
        }[];
        return rows.map((row) => ({
            typeName: type.name,
            locale: row.locale,
            rows: row.rows
        }));
    }
}
