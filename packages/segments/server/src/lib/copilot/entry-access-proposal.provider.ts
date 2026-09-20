import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
    ToolRegistry,
    type ToolDefinition,
    type ToolProvider
} from '@orthacms/tools-server';
import type { ProposalChange, ProposalDraft } from '@orthacms/copilot-domain';
import { PERMISSIONS } from '@orthacms/identity-server';
import { isOfferedIn } from '@orthacms/segments-domain';
import { EntryAccessService } from '../application/entry-access.service';
import { SegmentCatalogService } from '../application/segment-catalog.service';

/** The proposal kinds this plugin produces, and its appliers carry out. */
export const SEGMENTS_PROPOSAL_KINDS = {
    /** Replace one entry's — and therefore one record's — audiences. */
    setEntryAccess: 'segments.setEntryAccess'
} as const;

/**
 * The copilot's way of changing who may read a record: a **proposal**, not a
 * write.
 *
 * The MCP counterpart (`content_access_set`) writes directly, and the difference
 * is the actor rather than the surface. A bearer token is its own authority —
 * the registry checked `segments:manage` against its scope and there is nobody
 * to ask. A copilot run acts for a **person**, so
 * [ADR-0009](../../../../../docs/adr/0009-copilot-applies-directly.md) has it
 * record the change as a `copilot_proposals` row applied under that person's own
 * permissions, and the change card is what they see before it happens.
 *
 * That review matters more here than on a copy edit, which is why the summary is
 * a required argument and the diff names the audiences rather than their ids:
 * "restricted to Acme Corp" and "readable by everyone" are the two states a
 * reader will actually experience, and a card printing two uuids would be a card
 * nobody can check.
 */
@Injectable()
export class EntryAccessProposalProvider implements ToolProvider, OnModuleInit {
    constructor(
        private readonly catalog: SegmentCatalogService,
        private readonly access: EntryAccessService,
        @Optional() private readonly registry?: ToolRegistry
    ) {}

    onModuleInit(): void {
        this.registry?.register(this);
    }

    tools(): readonly ToolDefinition[] {
        return [this.proposeAccess()];
    }

    /** `content_propose_access` — a reviewed change to an entry's audiences. */
    private proposeAccess(): ToolDefinition {
        return {
            name: 'content_propose_access',
            title: 'Propose who can read an entry',
            description:
                'Propose changing who may see a published entry. This does NOT change ' +
                'anything — it drafts the change and asks the user to approve it, and the reply ' +
                'will say so. Call segments_list first for the audience ids, and ' +
                'content_access_get for what the entry says today: you send BOTH lists in ' +
                'full, so anything you leave out is being removed. An empty `allow` means ' +
                'EVERYONE may read it, not nobody. A deny always wins. On a type with ' +
                'translations this covers every language of the record.',
            inputSchema: {
                type: 'object',
                properties: {
                    entryId: {
                        type: 'string',
                        description: 'The entry to change access on.'
                    },
                    typeName: {
                        type: 'string',
                        description:
                            'The entry’s content type — needed to reach its translations.'
                    },
                    allow: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Audience ids that may read it. EMPTY MEANS EVERYONE, not nobody.'
                    },
                    deny: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Audience ids that may not, whatever else allows them.'
                    },
                    summary: {
                        type: 'string',
                        maxLength: 200,
                        description:
                            'One line describing the change, shown to the user on the approval ' +
                            'card. Write it for a person, e.g. “Restrict the pricing page to ' +
                            'Acme Corp”.'
                    }
                },
                required: ['entryId', 'typeName', 'allow', 'deny', 'summary'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.SEGMENTS_MANAGE],
            readOnly: false,
            effect: 'propose',
            surfaces: ['copilot'],
            handler: async (input, ctx): Promise<ProposalDraft> => {
                const args = input as {
                    entryId: string;
                    typeName: string;
                    allow: string[];
                    deny: string[];
                    summary: string;
                };
                // Refused here rather than at apply time: an audience this
                // workspace was never offered is not a choice the editor could
                // have made, and a card proposing one would be a card whose
                // Accept is a 400.
                this.assertOffered(
                    [...args.allow, ...args.deny],
                    ctx.workspaceId
                );

                const before = await this.access.get(
                    ctx.workspaceId,
                    args.entryId
                );

                return {
                    kind: SEGMENTS_PROPOSAL_KINDS.setEntryAccess,
                    target: {
                        typeName: args.typeName,
                        entryId: args.entryId
                    },
                    patch: { allow: args.allow, deny: args.deny },
                    summary: args.summary,
                    changes: [
                        this.change(
                            'allow',
                            'Can be seen by',
                            before.allow,
                            args.allow
                        ),
                        this.change(
                            'deny',
                            'Cannot be seen by',
                            before.deny,
                            args.deny
                        )
                    ]
                };
            }
        };
    }

    /** One list's before/after, named rather than identified. */
    private change(
        field: string,
        label: string,
        before: string[],
        after: string[]
    ): ProposalChange {
        return {
            field,
            label,
            before: this.names(before),
            after: this.names(after)
        };
    }

    /**
     * Audience labels for a list of ids.
     *
     * An **empty allow list is not an empty answer** — it is "everyone" — so it
     * is spelled out rather than rendered as a blank cell the reviewer has to
     * know how to read. The deny side's emptiness really is nothing refused, and
     * says so.
     */
    private names(ids: string[]): string[] {
        const byId = new Map(
            this.catalog.all().map((segment) => [segment.id, segment.label])
        );
        return ids.map((id) => byId.get(id) ?? id);
    }

    /** Refuse an id this workspace was never offered. */
    private assertOffered(ids: string[], workspaceId: string): void {
        const byId = new Map(
            this.catalog.all().map((segment) => [segment.id, segment])
        );
        const foreign = [...new Set(ids)].filter((id) => {
            const segment = byId.get(id);
            return !segment || !isOfferedIn(segment, workspaceId);
        });
        if (foreign.length) {
            throw new Error(
                `Audience(s) not available in this workspace: ${foreign.join(', ')}. ` +
                    'Call segments_list for the ones that are.'
            );
        }
    }
}
