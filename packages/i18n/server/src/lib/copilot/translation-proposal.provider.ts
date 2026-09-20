import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import {
    BULK_MAX_SAVE_ITEMS,
    InjectContentRegistry,
    WorkspaceGrantsQuery,
    type ContentTypeRegistry,
    type SerializedField
} from '@orthacms/content-server';
import type { ProposalChange, ProposalDraft } from '@orthacms/copilot-domain';
import { ToolRegistry } from '@orthacms/tools-server';
import type { ToolDefinition, ToolProvider } from '@orthacms/tools-server';
import { LocaleRegistryService } from '../locales/services/locale-registry.service';
import {
    LocaleGroupService,
    type EntryLocalesView
} from '../content/services/locale-group.service';

/** The proposal kinds this plugin declares and applies. */
export const I18N_PROPOSAL_KINDS = {
    /** Create a sibling row of an entry in another locale. */
    createTranslation: 'i18n.entry.translate',
    /**
     * Create several sibling rows — more locales of one record, more records
     * in one locale, or both — as **one** change.
     *
     * Its own kind rather than a repeated `createTranslation`, for the reason
     * `content.entry.bulk-save` is: a proposal row is the receipt for one tool
     * call, and "translate this into five languages" written as five rows is
     * five cards in the transcript for a single instruction, none of which says
     * what the other four were.
     */
    bulkTranslation: 'i18n.entry.bulk-translate'
} as const;

/**
 * The plugin's **write** tools: `i18n_propose_translation` for one locale of one
 * entry, and `i18n_propose_bulk_translation` for a batch of them.
 *
 * Like every propose tool their handlers **write nothing** — they compute the
 * change and hand it back, and the run engine records and applies it. What they
 * do is the part a model cannot be trusted to get right on its own: resolve the
 * locale slug against the configured set, confirm the target locale does not
 * already exist in the group (a duplicate is a 409 at apply time, after the
 * card has said the change is happening), and name the source entry so the
 * applier can inherit its shared values.
 *
 * Only **localized** fields are translated. A field the type declares as shared
 * is one value across the whole group by definition — writing a per-locale
 * version of it would either be ignored or silently overwrite every sibling,
 * and neither is something to show a reader as a translation.
 */
@Injectable()
export class TranslationProposalToolProvider
    implements ToolProvider, OnModuleInit
{
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly locales: LocaleRegistryService,
        private readonly groups: LocaleGroupService,
        private readonly grants: WorkspaceGrantsQuery,
        @Optional() private readonly toolRegistry?: ToolRegistry
    ) {}

    /**
     * Register with the shared tool registry once the DI graph is built —
     * the same catalogue the MCP endpoint serves, narrowed to the `copilot`
     * surface by each tool's `surfaces`. `@Optional()` because a deployment
     * may run neither consumer, in which case these simply go unregistered.
     */
    onModuleInit(): void {
        this.toolRegistry?.register(this);
    }

    /** The two i18n write tools — one translation, and the batch. */
    tools(): readonly ToolDefinition[] {
        return [this.proposeTranslation(), this.proposeBulkTranslation()];
    }

    /**
     * A granted, registered, **localized** type — the gate both write tools
     * open with.
     *
     * The two failures are worth separating: "unknown type" is the uniform
     * answer every content tool gives a name it cannot reach (it must not
     * distinguish "no such type" from "not granted here"), while "not
     * localized" describes a type the caller has already proved it can reach
     * and is safe — and useful — to say out loud.
     */
    private async resolveLocalizedType(typeName: string, workspaceId: string) {
        const type = this.registry.get(typeName);
        const granted = await this.grants.grantedSlugs(workspaceId);
        if (!type || !granted.has(type.name)) {
            throw new Error(
                `Unknown content type "${typeName}" in this workspace.`
            );
        }
        if (!type.i18n) {
            throw new Error(
                `Content type "${type.name}" is not localized, so it cannot be translated.`
            );
        }
        return type;
    }

    /**
     * The type's **localized** fields, keyed by name — the only ones a
     * translation may carry.
     *
     * A field the type declares as shared is one value across the whole group
     * by definition: writing a per-locale version of it would be fanned back
     * out over every sibling by this plugin's own sync, so a "translated"
     * shared field silently rewrites every other language.
     */
    private localizedFields(typeName: string): Map<string, SerializedField> {
        const schema = this.registry.serialize(typeName);
        return new Map(
            (schema?.fields ?? [])
                .filter((field) => field.localized)
                .map((field) => [field.name, field])
        );
    }

    /**
     * Rejects anything in `values` that is not a localized field, and an empty
     * bag — the check that makes a translation tool a translation tool.
     *
     * `prefix` names which item is at fault in a batch, and is empty for the
     * single-entry tool so its message is unchanged.
     */
    private assertTranslatable(
        values: Record<string, unknown>,
        localized: Map<string, SerializedField>,
        prefix = ''
    ): void {
        const rejected = Object.keys(values).filter(
            (name) => !localized.has(name)
        );
        if (rejected.length > 0) {
            throw new Error(
                `${prefix}These fields are shared across locales and cannot be translated: ` +
                    `${rejected.join(', ')}. Only ${[...localized.keys()].join(', ')} ` +
                    'vary per locale on this type.'
            );
        }
        if (Object.keys(values).length === 0) {
            throw new Error(`${prefix}No translated values were supplied.`);
        }
    }

    /** The field's admin label, when it has one — for the card's diff rows. */
    private labelOf(field: SerializedField | undefined): string | undefined {
        const label = field?.admin?.['label'];
        return typeof label === 'string' ? label : undefined;
    }

    /** `i18n_propose_translation` — one entry into one locale. */
    private proposeTranslation(): ToolDefinition {
        return {
            name: 'i18n_propose_translation',
            title: 'Propose a translation',
            description:
                'Propose a translation of an entry into another locale, creating that locale’s ' +
                'row in the same translation group. This does NOT save anything — it drafts ' +
                'the change for the user to approve, and the reply will say so. Read the ' +
                'source entry first (admin_content_get) and translate its text yourself; only ' +
                'fields the type marks as localized can differ per locale.',
            inputSchema: {
                type: 'object',
                properties: {
                    typeName: {
                        type: 'string',
                        description:
                            'The entry’s content type. It must be localized.'
                    },
                    id: {
                        type: 'string',
                        description:
                            'The id of the source entry — the row you translated from.'
                    },
                    locale: {
                        type: 'string',
                        maxLength: 35,
                        description:
                            'The locale slug to create, from i18n_locales_list. It must not ' +
                            'already exist in this entry’s translation group.'
                    },
                    values: {
                        type: 'object',
                        description:
                            'The translated values, keyed by field name. Only localized ' +
                            'fields are accepted; shared fields are copied by the CMS.'
                    },
                    summary: {
                        type: 'string',
                        maxLength: 200,
                        description:
                            'One line for the approval card, e.g. “German translation of ' +
                            'Spring launch”.'
                    }
                },
                required: ['typeName', 'id', 'locale', 'values', 'summary'],
                additionalProperties: false
            },
            // `content:update` rather than `content:create`: the design's v1
            // catalogue says so, and it is the right key — a translation is a
            // change to an existing piece of content, not a new one, which is
            // exactly how an editor thinks about it.
            requires: [PERMISSIONS.CONTENT_UPDATE],
            readOnly: false,
            effect: 'propose',
            // Copilot-only: it reads the admin services (a viewer must see
            // drafts) or writes through propose-then-apply with the human as
            // actor. MCP's content tools are the public-API set.
            surfaces: ['copilot'],
            handler: async (input, ctx): Promise<ProposalDraft> => {
                const args = (input ?? {}) as {
                    typeName: string;
                    id: string;
                    locale: string;
                    values: Record<string, unknown>;
                    summary: string;
                };

                const type = await this.resolveLocalizedType(
                    args.typeName,
                    ctx.workspaceId
                );

                const target = this.locales.get(args.locale);
                if (!target) {
                    throw new Error(
                        `Unknown locale "${args.locale}". Call i18n_locales_list for the ` +
                            'configured slugs.'
                    );
                }

                // The group read doubles as the existence check on the source
                // entry: it 404s a missing or soft-deleted row, workspace-scoped.
                const group = await this.groups.entryLocales(
                    type,
                    args.id,
                    ctx.workspaceId
                );
                const existing = group.items.find(
                    (item) => item.locale === target.slug
                );
                if (existing?.entry) {
                    throw new Error(
                        `This entry already has a "${target.slug}" translation. Use ` +
                            'content_propose_update on that row instead.'
                    );
                }

                const localized = this.localizedFields(type.name);
                const values = args.values ?? {};
                this.assertTranslatable(values, localized);

                return {
                    kind: I18N_PROPOSAL_KINDS.createTranslation,
                    target: {
                        typeName: type.name,
                        sourceId: args.id,
                        localeGroupId: group.localeGroupId,
                        locale: target.slug
                    },
                    patch: { values },
                    summary: args.summary,
                    changes: Object.entries(values).map(
                        ([field, after]): ProposalChange => {
                            const label = this.labelOf(localized.get(field));
                            return {
                                field,
                                ...(label ? { label } : {}),
                                after
                            };
                        }
                    )
                };
            }
        };
    }

    /**
     * `i18n_propose_bulk_translation` — several translations as **one** change.
     *
     * The single-entry tool scales badly in both directions users actually push
     * it: "translate this into German, French and Spanish" is three calls, and
     * "translate these eight posts into German" is eight. Each one spent a step
     * of a bounded run and left its own card, so one instruction read back as a
     * pile of receipts, none of which said what the others were.
     *
     * **Why this rather than `content_propose_bulk_save` with a
     * `localeGroupId`.** That is what a model reached for before, and it is the
     * shape that quietly breaks a group: a create is a whole row, so every
     * shared field the batch did not name arrives as `null`, and this plugin's
     * sync then pushes those nulls onto every sibling — see
     * {@link TranslationProposalApplier}. Joining a translation group needs the
     * source's shared values inherited at apply time, which is knowledge that
     * lives here, so the content tools no longer offer `localeGroupId` at all
     * and this is the one route in.
     *
     * An item is one **(source entry, target locale)** pair, so both shapes are
     * the same list: five items naming one `id` and five locales, eight naming
     * eight ids and one locale, or any mixture.
     */
    private proposeBulkTranslation(): ToolDefinition {
        return {
            name: 'i18n_propose_bulk_translation',
            title: 'Propose several translations',
            description:
                'Translate one or more entries into one or more locales in a SINGLE change. ' +
                'Use this instead of calling i18n_propose_translation repeatedly — the user ' +
                'sees one card listing every translation, and you spend one step instead of ' +
                'one per language. Each item is one entry translated into one locale: repeat ' +
                'the same `id` with different locales to translate a record into several ' +
                'languages, or list different `id`s with the same locale to translate several ' +
                'records. Read the source entries first (admin_content_get) and translate ' +
                'their text yourself; only fields the type marks as localized can differ per ' +
                'locale, and the CMS copies the shared ones. If a translation fails, the ' +
                'change stops there and the reply says how many landed — do not claim the ' +
                'whole batch saved without reading it.',
            inputSchema: {
                type: 'object',
                properties: {
                    typeName: {
                        type: 'string',
                        description:
                            'The content type every item belongs to. It must be localized.'
                    },
                    items: {
                        type: 'array',
                        minItems: 1,
                        maxItems: BULK_MAX_SAVE_ITEMS,
                        description: `The translations to create (1…${BULK_MAX_SAVE_ITEMS}), applied in order.`,
                        items: {
                            type: 'object',
                            properties: {
                                id: {
                                    type: 'string',
                                    description:
                                        'The id of the source entry — the row you translated from. ' +
                                        'Any locale of the record will do; they share one translation ' +
                                        'group.'
                                },
                                locale: {
                                    type: 'string',
                                    maxLength: 35,
                                    description:
                                        'The locale slug to create, from i18n_locales_list. It must ' +
                                        'not already exist in this entry’s translation group.'
                                },
                                values: {
                                    type: 'object',
                                    description:
                                        'The translated values for THIS locale, keyed by field name. ' +
                                        'Only localized fields are accepted; shared fields are copied ' +
                                        'by the CMS.'
                                }
                            },
                            required: ['id', 'locale', 'values'],
                            additionalProperties: false
                        }
                    },
                    summary: {
                        type: 'string',
                        maxLength: 200,
                        description:
                            'One line describing the whole batch, shown to the user on the card. ' +
                            'Write it for a person, e.g. “Translate Spring launch into 3 languages”.'
                    }
                },
                required: ['typeName', 'items', 'summary'],
                additionalProperties: false
            },
            // The same key the single-entry tool takes, and for the same
            // reason: a translation is a change to existing content, not a new
            // piece of it. Batching is a way of *asking* — it must not become a
            // route to authority the one-at-a-time tool was never given
            // (ADR-0005 §7).
            requires: [PERMISSIONS.CONTENT_UPDATE],
            readOnly: false,
            effect: 'propose',
            surfaces: ['copilot'],
            handler: async (input, ctx): Promise<ProposalDraft> => {
                const args = (input ?? {}) as {
                    typeName: string;
                    items?: BulkTranslationItem[];
                    summary: string;
                };
                const type = await this.resolveLocalizedType(
                    args.typeName,
                    ctx.workspaceId
                );
                const items = args.items ?? [];
                if (items.length === 0) {
                    throw new Error(
                        'Nothing to translate — `items` was empty. Send at least one translation.'
                    );
                }
                if (items.length > BULK_MAX_SAVE_ITEMS) {
                    throw new Error(
                        `Too many translations in one change: ${items.length}, and the limit ` +
                            `is ${BULK_MAX_SAVE_ITEMS}. Split it into smaller batches.`
                    );
                }

                const localized = this.localizedFields(type.name);
                const changes: ProposalChange[] = [];
                const patched: PatchedTranslation[] = [];
                // One group read per distinct source id: translating one record
                // into five languages is five items naming the same entry, and
                // re-reading its group five times would be five identical
                // queries answering an identical question.
                const groups = new Map<string, EntryLocalesView>();
                // Every (group, locale) this batch already claims. Two items
                // aiming at the same slot is a unique-index violation waiting
                // to happen halfway through the apply — after the first
                // translations have already been written.
                const claimed = new Set<string>();

                for (const [index, item] of items.entries()) {
                    const at = `Item ${index + 1}: `;
                    if (typeof item.id !== 'string' || item.id.length === 0) {
                        throw new Error(
                            `${at}no source entry \`id\`. Every item names the entry it translates.`
                        );
                    }
                    const target = this.locales.get(item.locale);
                    if (!target) {
                        throw new Error(
                            `${at}unknown locale "${item.locale}". Call i18n_locales_list for ` +
                                'the configured slugs.'
                        );
                    }

                    // Reads the group, and with it proves the source row exists
                    // in this workspace — so a bad id fails HERE, before
                    // anything is written, rather than partway through the
                    // batch. The whole view is cached, not just its group id:
                    // nothing is written during a propose, so which locales
                    // exist cannot change under the loop, and every later item
                    // naming the same entry answers "is this locale taken?"
                    // from it. Keyed by id rather than by group, which is the
                    // honest cost of not knowing two ids are siblings until one
                    // of them has been read.
                    let group = groups.get(item.id);
                    if (!group) {
                        group = await this.groups.entryLocales(
                            type,
                            item.id,
                            ctx.workspaceId
                        );
                        groups.set(item.id, group);
                    }
                    const existing = group.items.find(
                        (candidate) => candidate.locale === target.slug
                    );
                    if (existing?.entry) {
                        throw new Error(
                            `${at}this entry already has a "${target.slug}" translation. Use ` +
                                'content_propose_update on that row instead.'
                        );
                    }
                    const localeGroupId = group.localeGroupId;

                    const slot = `${localeGroupId}:${target.slug}`;
                    if (claimed.has(slot)) {
                        throw new Error(
                            `${at}an earlier item already translates this record into ` +
                                `"${target.slug}". A record has one row per locale, so send each ` +
                                'locale of it once.'
                        );
                    }
                    claimed.add(slot);

                    const values = item.values ?? {};
                    this.assertTranslatable(values, localized, at);

                    patched.push({
                        sourceId: item.id,
                        localeGroupId,
                        locale: target.slug,
                        values
                    });
                    for (const [field, after] of Object.entries(values)) {
                        changes.push({
                            // Prefixed by position, because the card keys its
                            // rows on `field` and five locales translating
                            // `title` would otherwise collapse into one row.
                            field: `items[${index}].${field}`,
                            label: `#${index + 1} ${target.slug} · ${
                                this.labelOf(localized.get(field)) ?? field
                            }`,
                            after
                        });
                    }
                }

                return {
                    kind: I18N_PROPOSAL_KINDS.bulkTranslation,
                    target: { typeName: type.name },
                    patch: { items: patched },
                    summary: args.summary,
                    changes
                };
            }
        };
    }
}

/** One translation in a proposed batch, as the model sends it. */
interface BulkTranslationItem {
    /** The source entry translated from — any locale of the record. */
    id: string;
    /** The locale slug to create. */
    locale: string;
    /** The translated values, localized fields only. */
    values: Record<string, unknown>;
}

/** One translation as the applier reads it back off the proposal. */
interface PatchedTranslation {
    /** The row whose shared values the new sibling inherits. */
    sourceId: string;
    /** The translation group it joins. */
    localeGroupId: string;
    /** The locale it is created in. */
    locale: string;
    /** The translated values. */
    values: Record<string, unknown>;
}
