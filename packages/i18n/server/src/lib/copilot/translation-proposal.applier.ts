import { proposalEventActor } from '@orthacms/copilot-server';
import { Injectable } from '@nestjs/common';
import { and, eq, isNull, type AnyColumn } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import {
    EntryWriterService,
    InjectContentRegistry,
    WorkspaceGrantsQuery,
    isPerLocaleField,
    toRecord,
    type AnyContentType,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import type {
    ProposalActor,
    ProposalApplier,
    ProposalApplyResult,
    ProposalTarget
} from '@orthacms/copilot-domain';
import { I18N_PROPOSAL_KINDS } from './translation-proposal.provider';

/** A generated content table seen as a bag of columns by property name. */
type ContentTable = Record<string, AnyColumn>;

/**
 * Applies `i18n.entry.translate` by creating the sibling row through
 * {@link EntryWriterService.create} — the same call `POST /api/content/:type`
 * makes, with a `localeGroupId`.
 *
 * **There is no "create translation" write path to reuse, and that is the
 * point**: joining an existing group is what `localeGroupId` on a create
 * already means, and the bound entry extension stamps and validates it inside
 * the write transaction. So this applier passes two extra arguments to the
 * ordinary create rather than reaching for a second mechanism — which is also
 * what makes a duplicate `(group, locale)` a clean 409 instead of a corrupt
 * group.
 *
 * ## Why it reads the source entry first
 *
 * The propose tool accepts **only localized values** — a shared field is one
 * value across the group, so asking a model to translate it is meaningless. But
 * a create is a whole row: `coerceValues` stamps every declared field onto the
 * bag, so a shared field nobody supplied arrives as `null` rather than as
 * "absent". Two things then go wrong at once, and neither is obvious:
 *
 * 1. The new row fails its own required-field validation — `tag.slug` is
 *    required and shared, and no translation of a tag ever carries it.
 * 2. Worse, the bound extension treats that `null` as a shared value the save
 *    *carries* and pushes it onto every sibling in the group. A published
 *    sibling is re-validated and fails, which rolls the create back — but a
 *    group whose siblings are all drafts has no such guard, and the shared
 *    field is silently blanked in every locale.
 *
 * So the values the create is given are the **source entry's**, with the
 * translated ones layered on top: the same thing the admin's own "create
 * translation" does (it sends the source's values), and the reason that path
 * has never hit this. The shared values then match the group exactly, the
 * extension's `IS DISTINCT FROM` predicate finds nothing to sync, and no
 * sibling is touched at all.
 *
 * Read at **apply** time rather than frozen into the proposal: a shared field
 * can be edited between drafting and applying, and the group's current value is
 * the one that must not be clobbered.
 */
@Injectable()
export class TranslationProposalApplier implements ProposalApplier {
    readonly kind = I18N_PROPOSAL_KINDS.createTranslation;

    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService,
        private readonly grants: WorkspaceGrantsQuery,
        @InjectDatabase() private readonly db: Database
    ) {}

    async apply(
        input: { target: ProposalTarget; patch: Record<string, unknown> },
        actor: ProposalActor
    ): Promise<ProposalApplyResult> {
        const typeName = input.target['typeName'];
        const locale = input.target['locale'];
        const localeGroupId = input.target['localeGroupId'];
        const sourceId = input.target['sourceId'];
        if (
            typeof typeName !== 'string' ||
            typeof locale !== 'string' ||
            typeof localeGroupId !== 'string' ||
            typeof sourceId !== 'string'
        ) {
            throw new Error('This proposal is missing its translation target.');
        }

        // Re-checked rather than trusted from the row: grants can be revoked
        // between proposing and applying, and a stored type name is an
        // argument like any other.
        const type = this.registry.get(typeName);
        const granted = await this.grants.grantedSlugs(actor.workspaceId);
        if (!type || !granted.has(type.name)) {
            throw new Error(
                `Unknown content type "${typeName}" in this workspace.`
            );
        }

        const translated = (input.patch['values'] ?? {}) as Record<
            string,
            unknown
        >;
        const inherited = await sharedValues(
            this.db,
            type,
            sourceId,
            actor.workspaceId
        );

        const entry = await this.writer.create(
            type,
            { ...inherited, ...translated },
            actor.workspaceId,
            undefined,
            locale,
            localeGroupId,
            proposalEventActor(actor)
        );
        return {
            entityId: entry.id,
            detail: { typeName: type.name, locale, localeGroupId }
        };
    }
}

/**
 * The source entry's **shared** field values — everything the new sibling must
 * carry over rather than invent.
 *
 * The exclusions mirror what the extension itself treats as shared, because a
 * value copied here that the extension does *not* consider shared would be a
 * per-locale field silently seeded from another language:
 *
 * - **Localized fields** are what the translation supplies.
 * - **Many and inverse relations** are join-backed rather than column-backed,
 *   so `toRecord` already drops them; the extension's own sync is what carries
 *   them onto the new sibling.
 * - **Any relation whose stored id differs per locale** — mirrored or unsynced
 *   (`isPerLocaleField`). Copying the source's would point the German row at an
 *   English one, which the writer rejects as a cross-locale link; for a
 *   mirrored relation the extension resolves the right per-locale id itself,
 *   after the insert.
 *
 * A free function rather than a method because **both** appliers need it, and
 * needing it is not optional: it is the whole difference between joining a
 * translation group and blanking it.
 */
async function sharedValues(
    db: Database,
    type: AnyContentType,
    sourceId: string,
    workspaceId: string
): Promise<Record<string, unknown>> {
    const table = type.table as unknown as ContentTable;
    const [row] = await db
        .select()
        .from(type.table)
        .where(
            and(
                eq(table['id'], sourceId),
                eq(table['workspaceId'], workspaceId),
                ...(type.paranoid ? [isNull(table['deletedAt'])] : [])
            )
        )
        .limit(1);
    if (!row) {
        // The propose tool proved this row existed; by apply time it may not.
        // Failing here beats creating a translation of nothing.
        throw new Error('The entry this translates no longer exists.');
    }

    const source = toRecord(type, row as Record<string, unknown>).values;
    const shared: Record<string, unknown> = {};
    for (const [name, spec] of Object.entries(type.fields)) {
        if (isPerLocaleField(type, spec)) continue;
        if (!(name in source)) continue;
        shared[name] = source[name];
    }
    return shared;
}

/**
 * Applies `i18n.entry.bulk-translate` — several translations carried out as one
 * change.
 *
 * **Item by item through the same `EntryWriterService.create` the single-entry
 * applier calls**, each with its own source entry's shared values inherited: a
 * batch is a way of asking for N translations, not a second way of writing one.
 * Sequentially rather than concurrently, because every write takes the
 * workspace's shared content lock and (on a localized type) an advisory lock
 * over the translation group — a batch translating one record into five
 * languages contends with itself by construction, so a fan-out would buy
 * nothing but lock waits.
 *
 * **It stops at the first failure and throws**, exactly as the content plugin's
 * bulk applier does. A proposal is one row with one status, so there is no
 * per-item verdict to render; carrying on would grow the number of rows written
 * under a receipt that then reports failure. The error names how many landed,
 * which is what the model reads back to the user.
 */
@Injectable()
export class BulkTranslationProposalApplier implements ProposalApplier {
    readonly kind = I18N_PROPOSAL_KINDS.bulkTranslation;

    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly writer: EntryWriterService,
        private readonly grants: WorkspaceGrantsQuery,
        @InjectDatabase() private readonly db: Database
    ) {}

    async apply(
        input: { target: ProposalTarget; patch: Record<string, unknown> },
        actor: ProposalActor
    ): Promise<ProposalApplyResult> {
        const typeName = input.target['typeName'];
        if (typeof typeName !== 'string') {
            throw new Error('This proposal is missing its content type.');
        }

        // Re-checked rather than trusted from the row: grants can be revoked
        // between proposing and applying, and a stored type name is an
        // argument like any other.
        const type = this.registry.get(typeName);
        const granted = await this.grants.grantedSlugs(actor.workspaceId);
        if (!type || !granted.has(type.name)) {
            throw new Error(
                `Unknown content type "${typeName}" in this workspace.`
            );
        }

        const items = input.patch['items'];
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('This change names no translations.');
        }

        const created: string[] = [];
        const locales: string[] = [];

        for (const [index, raw] of items.entries()) {
            const item = (raw ?? {}) as {
                sourceId?: unknown;
                localeGroupId?: unknown;
                locale?: unknown;
                values?: unknown;
            };
            const sourceId = item.sourceId;
            const localeGroupId = item.localeGroupId;
            const locale = item.locale;
            if (
                typeof sourceId !== 'string' ||
                typeof localeGroupId !== 'string' ||
                typeof locale !== 'string'
            ) {
                throw new Error(
                    `Translation ${index + 1} of ${items.length} is missing its target.`
                );
            }

            try {
                // Read per item and at apply time, not once for the batch: two
                // items may translate two different records, and a shared field
                // edited between drafting and applying must not be clobbered by
                // a stale copy of itself.
                const inherited = await sharedValues(
                    this.db,
                    type,
                    sourceId,
                    actor.workspaceId
                );
                const translated = (item.values ?? {}) as Record<
                    string,
                    unknown
                >;
                const entry = await this.writer.create(
                    type,
                    { ...inherited, ...translated },
                    actor.workspaceId,
                    undefined,
                    locale,
                    localeGroupId,
                    proposalEventActor(actor)
                );
                created.push(entry.id);
                locales.push(locale);
            } catch (error) {
                throw new Error(
                    `Translation ${index + 1} of ${items.length} (${locale}) failed: ` +
                        `${error instanceof Error ? error.message : String(error)}. ` +
                        (created.length === 0
                            ? 'Nothing was saved.'
                            : `The first ${created.length} were saved and the rest were not.`)
                );
            }
        }

        return {
            // No `entityId`: a batch has no single entity to link to, and
            // naming one of them would send the user to an arbitrary member of
            // the set. The ids are in `detail` instead.
            detail: {
                typeName: type.name,
                created,
                locales,
                count: created.length
            }
        };
    }
}
