import type { ToolContext, ToolDefinition } from '@orthacms/tools-server';
import type { ProposalActor } from '@orthacms/copilot-domain';
import type { Segment } from '@orthacms/segments-domain';
import {
    EntryAccessProposalProvider,
    SEGMENTS_PROPOSAL_KINDS
} from './entry-access-proposal.provider';
import { EntryAccessProposalApplier } from './entry-access-proposal.applier';

const ACME: Segment = {
    id: 's-acme',
    key: 'acme',
    label: 'Acme Corp',
    tags: ['acme']
};
const ELSEWHERE: Segment = {
    id: 's-else',
    key: 'elsewhere',
    label: 'Elsewhere',
    tags: ['elsewhere'],
    // Offered only in another workspace.
    workspaceIds: ['w2']
};

/** A catalogue over a fixed vocabulary. */
const catalogue = (segments: Segment[]) => ({ all: () => segments }) as never;

/** An access service reporting one entry's stored lists. */
const access = (stored = { allow: [] as string[], deny: [] as string[] }) =>
    ({ get: async () => stored }) as never;

const ctx = { workspaceId: 'w1' } as ToolContext;

/** The provider's single tool. */
function tool(segments: Segment[], stored?: Parameters<typeof access>[0]) {
    return new EntryAccessProposalProvider(
        catalogue(segments),
        access(stored)
    ).tools()[0] as ToolDefinition;
}

describe('content_propose_access', () => {
    it('is a copilot-only propose tool gated on segments:manage [segments:I-32]', () => {
        // The three properties that make it a *proposal* rather than a write:
        // the copilot acts for a person, so the change is drafted, shown, and
        // carried out under that person's own permissions.
        const definition = tool([ACME]);

        expect(definition.effect).toBe('propose');
        expect(definition.surfaces).toEqual(['copilot']);
        expect(definition.requires).toEqual(['segments:manage']);
        expect(definition.readOnly).toBe(false);
    });

    it('drafts the change without writing it', async () => {
        const service = access({ allow: [], deny: [] });
        const definition = new EntryAccessProposalProvider(
            catalogue([ACME]),
            service
        ).tools()[0] as ToolDefinition;

        const draft = (await definition.handler(
            {
                entryId: 'e1',
                typeName: 'article',
                allow: [ACME.id],
                deny: [],
                summary: 'Restrict to Acme'
            },
            ctx
        )) as { kind: string; target: unknown; patch: unknown };

        expect(draft.kind).toBe(SEGMENTS_PROPOSAL_KINDS.setEntryAccess);
        expect(draft.target).toEqual({ typeName: 'article', entryId: 'e1' });
        expect(draft.patch).toEqual({ allow: [ACME.id], deny: [] });
    });

    it('names the audiences in the diff rather than identifying them', async () => {
        // The card is what a person decides on, and two uuids are not something
        // anybody can check.
        const definition = tool([ACME], { allow: [], deny: [] });

        const draft = (await definition.handler(
            {
                entryId: 'e1',
                typeName: 'article',
                allow: [ACME.id],
                deny: [],
                summary: 'Restrict to Acme'
            },
            ctx
        )) as { changes: { field: string; before: unknown; after: unknown }[] };

        const allow = draft.changes.find((change) => change.field === 'allow');
        expect(allow?.before).toEqual([]);
        expect(allow?.after).toEqual(['Acme Corp']);
    });

    it('refuses an audience this workspace was never offered', async () => {
        // Refused at propose time rather than at apply: a card whose Accept is a
        // 400 is a card that should never have been drawn.
        const definition = tool([ACME, ELSEWHERE]);

        await expect(
            definition.handler(
                {
                    entryId: 'e1',
                    typeName: 'article',
                    allow: [ELSEWHERE.id],
                    deny: [],
                    summary: 'Restrict to Elsewhere'
                },
                ctx
            )
        ).rejects.toThrow(/not available in this workspace/);
    });
});

describe('EntryAccessProposalApplier', () => {
    const actor = { workspaceId: 'w1' } as ProposalActor;
    const registry = { get: (name: string) => ({ name }) } as never;
    const grants = {
        grantedSlugs: async () => new Set(['article'])
    } as never;

    it('carries the change out through the shared write path', async () => {
        // `setForGroup`, not a write of its own: an accepted proposal must not
        // mean anything the entry save and the PUT route do not — both lists
        // replaced, the workspace scope checked, every language written.
        const calls: Record<string, unknown>[] = [];
        const service = {
            setForGroup: async (input: Record<string, unknown>) => {
                calls.push(input);
                return {
                    access: { allow: ['s-acme'], deny: [] },
                    entryIds: ['e1', 'e2']
                };
            }
        } as never;

        const result = await new EntryAccessProposalApplier(
            registry,
            grants,
            service
        ).apply(
            {
                target: { typeName: 'article', entryId: 'e1' },
                patch: { allow: ['s-acme'], deny: [] }
            },
            actor
        );

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            workspaceId: 'w1',
            entryId: 'e1',
            allow: ['s-acme'],
            deny: []
        });
        expect(result.entityId).toBe('e1');
        // How many rows it reached, so a run's receipt can say "and its
        // translation" rather than leaving that to be discovered.
        expect(result.detail?.['entries']).toBe(2);
    });

    it('re-checks the grant rather than trusting the proposal [segments:I-34]', async () => {
        // A proposal can sit between being drafted and being accepted, and a
        // type ungranted in that window must not be written through an old card.
        const ungranted = {
            grantedSlugs: async () => new Set<string>()
        } as never;

        await expect(
            new EntryAccessProposalApplier(registry, ungranted, {
                setForGroup: async () => {
                    throw new Error('should not be reached');
                }
            } as never).apply(
                {
                    target: { typeName: 'article', entryId: 'e1' },
                    patch: { allow: [], deny: [] }
                },
                actor
            )
        ).rejects.toThrow(/Unknown content type/);
    });

    it('reads a stored patch defensively', async () => {
        // The patch comes back out of a `copilot_proposals` row, which is JSON
        // this code did not write on this request.
        const calls: Record<string, unknown>[] = [];
        const service = {
            setForGroup: async (input: Record<string, unknown>) => {
                calls.push(input);
                return { access: { allow: [], deny: [] }, entryIds: ['e1'] };
            }
        } as never;

        await new EntryAccessProposalApplier(registry, grants, service).apply(
            {
                target: { typeName: 'article', entryId: 'e1' },
                patch: { allow: 'not-a-list', deny: [42, 's-acme'] }
            },
            actor
        );

        expect(calls[0]).toMatchObject({ allow: [], deny: ['s-acme'] });
    });
});
