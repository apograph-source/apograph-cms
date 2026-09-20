import { EntryProposalToolProvider } from './entry-proposal.provider';
import type { ContentTypeRegistry } from '../registry/content-type-registry';
import type { EntryWriterService } from '../entries/infrastructure/persistence/entry-writer.service';
import type { WorkspaceGrantsQuery } from '../content-types/queries/workspace-grants.query';
import type {
    ContentEntryExtension,
    EntryWriteFanout
} from '../extension/entry-extension';
import type { ToolDefinition } from '@orthacms/tools-server';

/**
 * The **disclosure** the propose tools owe a localized type, exercised without
 * a database.
 *
 * A field a type does not mark `localized` is shared across the translation
 * group, so writing it rewrites every sibling row — correctly, since "shared"
 * means shared. The defect ADR-0009 turned into a real hazard is that nobody
 * was told: the change applies as it is drafted, and the proposal read as an
 * ordinary single-entry edit.
 *
 * The rule this pins is about **wiring**, not about locales: does what the
 * bound extension reports reach the summary the person, the audit row and the
 * model all read, and does an extension that reports nothing leave the
 * model's own words alone. The locale semantics themselves belong to the i18n
 * plugin and are covered against a live database in `apps/server-e2e`.
 */
describe('propose tools disclose what a write also rewrites', () => {
    const WORKSPACE = 'ws-1';
    const TYPE = { name: 'article' } as never;

    /** The narrowest registry the provider actually uses. */
    const registry = {
        get: () => TYPE,
        serialize: () => ({
            fields: [
                { name: 'title', type: 'text' },
                { name: 'category', type: 'text' }
            ]
        })
    } as unknown as ContentTypeRegistry;

    const grants = {
        grantedSlugs: async () => new Set(['article'])
    } as unknown as WorkspaceGrantsQuery;

    const writer = {
        getOne: async () => ({ values: { title: 'Old', category: 'news' } })
    } as unknown as EntryWriterService;

    /** An extension that reports whatever the test hands it. */
    function extensionReporting(
        fanout?: EntryWriteFanout
    ): ContentEntryExtension {
        return {
            describeFanout: async () => fanout
        } as unknown as ContentEntryExtension;
    }

    function toolsOf(extension?: ContentEntryExtension) {
        const provider = new EntryProposalToolProvider(
            registry,
            writer,
            grants,
            undefined,
            extension
        );
        const byName = new Map<string, ToolDefinition>();
        for (const tool of provider.tools()) byName.set(tool.name, tool);
        return byName;
    }

    function run(tool: ToolDefinition, input: Record<string, unknown>) {
        return tool.handler(input, {
            workspaceId: WORKSPACE
        } as never) as Promise<{
            summary: string;
            target: Record<string, unknown>;
        }>;
    }

    const edit = {
        typeName: 'article',
        id: 'entry-1',
        values: { category: 'guides' },
        summary: 'Recategorise the article'
    };

    it('appends the sibling rows and the shared fields to the summary', async () => {
        const tool = toolsOf(
            extensionReporting({ fields: ['category'], locales: ['de', 'fr'] })
        ).get('content_propose_update') as ToolDefinition;

        const draft = await run(tool, edit);

        // The summary rather than a field of its own: it is the card's title,
        // the audit row's `output_summary`, and — through the run engine's
        // `Applied: …` receipt — the sentence the model reads back.
        expect(draft.summary).toBe(
            'Recategorise the article — also changes this record’s de, fr ' +
                'rows, because category is shared across locales.'
        );
        expect(draft.target['fanout']).toEqual({
            fields: ['category'],
            locales: ['de', 'fr']
        });
    });

    it('agrees with itself in the singular', async () => {
        const tool = toolsOf(
            extensionReporting({ fields: ['category'], locales: ['de'] })
        ).get('content_propose_update') as ToolDefinition;

        const draft = await run(tool, edit);

        expect(draft.summary).toContain('this record’s de row, because');
        expect(draft.summary).toContain('category is shared');
    });

    it('leaves the model’s own summary alone when nothing else is touched', async () => {
        const tool = toolsOf(extensionReporting(undefined)).get(
            'content_propose_update'
        ) as ToolDefinition;

        const draft = await run(tool, edit);

        expect(draft.summary).toBe('Recategorise the article');
        expect(draft.target).not.toHaveProperty('fanout');
    });

    it('says nothing when no extension is bound at all', async () => {
        const tool = toolsOf(undefined).get(
            'content_propose_update'
        ) as ToolDefinition;

        const draft = await run(tool, edit);

        expect(draft.summary).toBe('Recategorise the article');
        expect(draft.target).not.toHaveProperty('fanout');
    });

    it('describes the fan-out of what will be written, not of what was sent', async () => {
        const seen: Record<string, unknown>[] = [];
        const extension = {
            describeFanout: async (
                _type: unknown,
                _id: string,
                values: Record<string, unknown>
            ) => {
                seen.push(values);
                return undefined;
            }
        } as unknown as ContentEntryExtension;
        const tool = toolsOf(extension).get(
            'content_propose_update'
        ) as ToolDefinition;

        // `title` is already "Old", so it is dropped as a no-op before the
        // write — describing it would name a field the save never carries.
        await run(tool, {
            ...edit,
            values: { title: 'Old', category: 'guides' }
        });

        expect(seen).toEqual([{ category: 'guides' }]);
    });

    it('merges a batch into one disclosure and counts the records', async () => {
        const tool = toolsOf(
            extensionReporting({ fields: ['category'], locales: ['de'] })
        ).get('content_propose_bulk_save') as ToolDefinition;

        const draft = await run(tool, {
            typeName: 'article',
            items: [
                { id: 'entry-1', values: { category: 'guides' } },
                { id: 'entry-2', values: { category: 'guides' } }
            ],
            summary: 'Tidy up two articles'
        });

        // One card, one summary — the reader's question is "what else did this
        // touch", not "which item touched what".
        expect(draft.summary).toBe(
            'Tidy up two articles — also changes the de rows of 2 of these ' +
                'records, because category is shared across locales.'
        );
        expect(draft.target['fanout']).toEqual({
            fields: ['category'],
            locales: ['de']
        });
    });

    it('never asks about a created row — a create starts its own group', async () => {
        let asked = 0;
        const extension = {
            describeFanout: async () => {
                asked += 1;
                return undefined;
            }
        } as unknown as ContentEntryExtension;

        const tool = toolsOf(extension).get(
            'content_propose_create'
        ) as ToolDefinition;
        await run(tool, {
            typeName: 'article',
            values: { title: 'New' },
            summary: 'New article'
        });

        // The create tools dropped `localeGroupId` and the applier refuses a
        // stored one, so a create has no siblings to reach.
        expect(asked).toBe(0);
    });
});
