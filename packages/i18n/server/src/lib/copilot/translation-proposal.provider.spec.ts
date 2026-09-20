import type { ToolContext, ToolDefinition } from '@orthacms/tools-server';
import type { ProposalDraft } from '@orthacms/copilot-domain';
import { TranslationProposalToolProvider } from './translation-proposal.provider';
import type { EntryLocalesView } from '../content/services/locale-group.service';

/**
 * The batch translation tool's **offer-time** rules, which are the last ones
 * before a write: since ADR-0009 a proposal is applied as soon as it is
 * drafted, so anything this handler waves through is a row in the database.
 *
 * The single-entry tool's equivalents are exercised end to end (they need a
 * real group and a real write); what earns a unit test here is the part that is
 * only true of a batch — a locale claimed twice by two items, a group read that
 * must not be repeated per item, and per-item error messages that say *which*
 * item is wrong.
 */
describe('i18n_propose_bulk_translation', () => {
    const TYPE = {
        name: 'article',
        i18n: true
    };

    /** One entry's group: `en` exists, `de`/`fr` are empty slots. */
    function group(localeGroupId: string): EntryLocalesView {
        return {
            localeGroupId,
            items: [
                {
                    locale: 'en',
                    dir: 'ltr',
                    isDefault: true,
                    entry: {
                        id: 'entry-en',
                        status: 'published',
                        publishedAt: null,
                        updatedAt: '2026-08-18T00:00:00.000Z'
                    }
                },
                { locale: 'de', dir: 'ltr', isDefault: false, entry: null },
                { locale: 'fr', dir: 'ltr', isDefault: false, entry: null }
            ]
        };
    }

    interface Fakes {
        type?: unknown;
        granted?: string[];
        groups?: Record<string, EntryLocalesView>;
        localized?: string[];
        shared?: string[];
    }

    /** The tool, over hand-built collaborators. */
    function build(fakes: Fakes = {}) {
        const entryLocales = jest.fn(
            async (_type: unknown, id: string): Promise<EntryLocalesView> => {
                const view = fakes.groups?.[id];
                if (!view) {
                    throw new Error(`No entry "${id}" on content type.`);
                }
                return view;
            }
        );
        const registry = {
            get: jest.fn(() =>
                'type' in fakes ? (fakes.type as unknown) : TYPE
            ),
            serialize: jest.fn(() => ({
                fields: [
                    ...(fakes.localized ?? ['text', 'body']).map((name) => ({
                        name,
                        localized: true,
                        admin: { label: name.toUpperCase() }
                    })),
                    ...(fakes.shared ?? ['select']).map((name) => ({
                        name,
                        localized: false
                    }))
                ]
            }))
        };
        const provider = new TranslationProposalToolProvider(
            registry as never,
            {
                get: (slug: string) =>
                    ['en', 'de', 'fr'].includes(slug)
                        ? {
                              slug,
                              name: slug,
                              isDefault: slug === 'en',
                              dir: 'ltr'
                          }
                        : undefined
            } as never,
            { entryLocales } as never,
            {
                grantedSlugs: async () => new Set(fakes.granted ?? ['article'])
            } as never
        );
        const tool = provider
            .tools()
            .find(
                (candidate) =>
                    candidate.name === 'i18n_propose_bulk_translation'
            ) as ToolDefinition;
        return { tool, entryLocales };
    }

    const ctx = {
        workspaceId: 'ws-1',
        actor: {
            kind: 'user',
            id: 'u-1',
            displayName: 'Ada',
            grantedPermissions: new Set<string>(),
            userId: 'u-1'
        },
        can: () => true
    } as unknown as ToolContext;

    /** Call the handler, typed as the draft it returns. */
    async function call(
        tool: ToolDefinition,
        input: Record<string, unknown>
    ): Promise<ProposalDraft> {
        return (await tool.handler(input, ctx)) as ProposalDraft;
    }

    it('is offered alongside the single-entry tool, on the copilot only', () => {
        const { tool } = build();

        expect(tool.effect).toBe('propose');
        expect(tool.readOnly).toBe(false);
        // Batching is a way of *asking*: it must not carry authority the
        // one-at-a-time tool was never given (ADR-0005 §7).
        expect(tool.requires).toEqual(['content:update']);
        expect(tool.surfaces).toEqual(['copilot']);
    });

    it('drafts one change for several locales of one entry', async () => {
        const { tool, entryLocales } = build({
            groups: { 'entry-en': group('group-1') }
        });

        const draft = await call(tool, {
            typeName: 'article',
            summary: 'Translate into German and French',
            items: [
                { id: 'entry-en', locale: 'de', values: { text: 'Hallo' } },
                { id: 'entry-en', locale: 'fr', values: { text: 'Bonjour' } }
            ]
        });

        expect(draft.kind).toBe('i18n.entry.bulk-translate');
        expect(draft.patch['items']).toEqual([
            {
                sourceId: 'entry-en',
                localeGroupId: 'group-1',
                locale: 'de',
                values: { text: 'Hallo' }
            },
            {
                sourceId: 'entry-en',
                localeGroupId: 'group-1',
                locale: 'fr',
                values: { text: 'Bonjour' }
            }
        ]);
        // One read for the one entry, not one per item: five languages of one
        // record is five items asking an identical question.
        expect(entryLocales).toHaveBeenCalledTimes(1);
    });

    it('keys the diff rows by position and locale', async () => {
        const { tool } = build({ groups: { 'entry-en': group('group-1') } });

        const draft = await call(tool, {
            typeName: 'article',
            summary: 'Two languages',
            items: [
                { id: 'entry-en', locale: 'de', values: { text: 'Hallo' } },
                { id: 'entry-en', locale: 'fr', values: { text: 'Bonjour' } }
            ]
        });

        // The card keys its rows on `field`, so two locales translating `text`
        // would otherwise collapse into a single row showing one of them.
        expect(draft.changes?.map((change) => change.field)).toEqual([
            'items[0].text',
            'items[1].text'
        ]);
        expect(draft.changes?.map((change) => change.label)).toEqual([
            '#1 de · TEXT',
            '#2 fr · TEXT'
        ]);
    });

    it('refuses a locale the record already has', async () => {
        const { tool } = build({ groups: { 'entry-en': group('group-1') } });

        await expect(
            call(tool, {
                typeName: 'article',
                summary: 'Again',
                items: [
                    { id: 'entry-en', locale: 'en', values: { text: 'Hi' } }
                ]
            })
        ).rejects.toThrow(/already has a "en" translation/);
    });

    it('refuses two items aiming at the same record and locale', async () => {
        const { tool } = build({ groups: { 'entry-en': group('group-1') } });

        // Both would insert the same `(group, locale)` — a unique-index
        // violation halfway through an apply, after the earlier translations
        // have already been written.
        await expect(
            call(tool, {
                typeName: 'article',
                summary: 'Twice',
                items: [
                    { id: 'entry-en', locale: 'de', values: { text: 'Eins' } },
                    { id: 'entry-en', locale: 'de', values: { text: 'Zwei' } }
                ]
            })
        ).rejects.toThrow(/Item 2:.*already translates this record into "de"/);
    });

    it('refuses a shared field, naming the ones that vary [i18n:I-28]', async () => {
        const { tool } = build({ groups: { 'entry-en': group('group-1') } });

        await expect(
            call(tool, {
                typeName: 'article',
                summary: 'Bad field',
                items: [
                    {
                        id: 'entry-en',
                        locale: 'de',
                        values: { text: 'Hallo', select: 'tutorial' }
                    }
                ]
            })
        ).rejects.toThrow(
            /Item 1: These fields are shared across locales.*select.*Only text, body/s
        );
    });

    it('says which item names an unknown locale', async () => {
        const { tool } = build({ groups: { 'entry-en': group('group-1') } });

        await expect(
            call(tool, {
                typeName: 'article',
                summary: 'Klingon',
                items: [
                    { id: 'entry-en', locale: 'de', values: { text: 'Hallo' } },
                    {
                        id: 'entry-en',
                        locale: 'tlh',
                        values: { text: 'nuqneH' }
                    }
                ]
            })
        ).rejects.toThrow(/Item 2: unknown locale "tlh"/);
    });

    it('refuses an item with no translated values', async () => {
        const { tool } = build({ groups: { 'entry-en': group('group-1') } });

        await expect(
            call(tool, {
                typeName: 'article',
                summary: 'Empty',
                items: [{ id: 'entry-en', locale: 'de', values: {} }]
            })
        ).rejects.toThrow(/Item 1: No translated values/);
    });

    it('refuses an empty batch and one over the cap', async () => {
        const { tool } = build({ groups: { 'entry-en': group('group-1') } });

        await expect(
            call(tool, { typeName: 'article', summary: 'Nothing', items: [] })
        ).rejects.toThrow(/Nothing to translate/);

        await expect(
            call(tool, {
                typeName: 'article',
                summary: 'Too many',
                items: Array.from({ length: 51 }, () => ({
                    id: 'entry-en',
                    locale: 'de',
                    values: { text: 'Hallo' }
                }))
            })
        ).rejects.toThrow(/Too many translations in one change: 51/);
    });

    it('refuses a type this workspace was not granted, without saying so [i18n:I-27]', async () => {
        const { tool } = build({
            granted: ['post'],
            groups: { 'entry-en': group('group-1') }
        });

        // The same message a nonexistent type gets: a run must not be able to
        // enumerate the deployment's other content types.
        await expect(
            call(tool, {
                typeName: 'article',
                summary: 'Ungranted',
                items: [
                    { id: 'entry-en', locale: 'de', values: { text: 'Hallo' } }
                ]
            })
        ).rejects.toThrow('Unknown content type "article" in this workspace.');
    });

    it('refuses a type that is not localized', async () => {
        const { tool } = build({
            type: { name: 'article', i18n: false },
            groups: { 'entry-en': group('group-1') }
        });

        await expect(
            call(tool, {
                typeName: 'article',
                summary: 'Plain type',
                items: [
                    { id: 'entry-en', locale: 'de', values: { text: 'Hallo' } }
                ]
            })
        ).rejects.toThrow(/is not localized, so it cannot be translated/);
    });
});
