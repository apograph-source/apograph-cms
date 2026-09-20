import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import type { ProposalDraft } from '@orthacms/copilot-domain';
import { ToolRegistry } from '@orthacms/tools-server';
import type { ToolDefinition, ToolProvider } from '@orthacms/tools-server';
import { AssetViewQuery } from '../infrastructure/queries/asset-view.query';
import { MEDIA_PROPOSAL_KINDS } from './proposal-kinds';

/**
 * `media_propose_alt_text` — the alt-text tool ADR-0005 §6 names as the
 * motivating case for auto-apply ("a team that trusts alt-text generation
 * should not click twice a hundred times a day").
 *
 * Like every propose tool it **writes nothing**: it reads the asset, drafts the
 * change, and the run engine records it for a human — or applies it directly,
 * if this workspace opted this specific tool in.
 *
 * The tool deliberately does not generate the text itself. The model already
 * has the asset's name, kind and MIME type from `media_assets_search`, and
 * asking it to describe an image it has not seen would produce confident
 * fiction. What this does is carry the model's proposed text to a reviewer with
 * the current value beside it.
 */
@Injectable()
export class AltTextProposalToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        private readonly assets: AssetViewQuery,
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

    /** The one media write tool. */
    tools(): readonly ToolDefinition[] {
        return [this.proposeAltText()];
    }

    private proposeAltText(): ToolDefinition {
        return {
            name: 'media_propose_alt_text',
            title: 'Propose alt text',
            description:
                'Propose alternative text for a media asset. This does NOT save anything — it ' +
                'drafts the change for the user to approve, and the reply will say so. Find ' +
                'the asset with media_assets_search first; assets with no alt text report ' +
                '`alt: null`. Describe what the image conveys in context, not what file it is.',
            inputSchema: {
                type: 'object',
                properties: {
                    assetId: {
                        type: 'string',
                        description:
                            'The asset’s id, as returned by media_assets_search.'
                    },
                    alt: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 1000,
                        description:
                            'The alternative text to set — what the image says, for someone ' +
                            'who cannot see it. Required unless `decorative` is true. Do not ' +
                            'send an empty string: use `decorative` to say an image says ' +
                            'nothing.'
                    },
                    decorative: {
                        type: 'boolean',
                        description:
                            'True only for an image that carries no information — a divider, ' +
                            'a texture, a shape behind text — so it should be skipped by a ' +
                            'screen reader entirely. Never true for a photo, a chart, a ' +
                            'screenshot, or a logo.'
                    },
                    summary: {
                        type: 'string',
                        maxLength: 200,
                        description:
                            'One line for the approval card, written for a person, ' +
                            'e.g. “Alt text for hero.jpg”.'
                    }
                },
                // `alt` is deliberately **not** required: `decorative` is the
                // other way to answer, and requiring both would force a model
                // to send the empty string this change exists to reject.
                required: ['assetId', 'summary'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.MEDIA_UPDATE],
            readOnly: false,
            effect: 'propose',
            // Copilot-only: it reads the admin services (a viewer must see
            // drafts) or writes through propose-then-apply with the human as
            // actor. MCP's content tools are the public-API set.
            surfaces: ['copilot'],
            handler: async (input, ctx): Promise<ProposalDraft> => {
                const args = (input ?? {}) as {
                    assetId: string;
                    alt?: string;
                    decorative?: boolean;
                    summary: string;
                };

                // "Decorative" and "nobody wrote one" used to be the same
                // bytes: `alt` was `type: string` with no `minLength`, and an
                // empty string was documented as meaning decorative with
                // nothing checking that it was deliberate. That is exactly the
                // distinction WCAG 1.1.1 turns on, so it is now an explicit
                // answer rather than an absence (`ORT-120`).
                const decorative = args.decorative === true;
                const alt = decorative ? '' : (args.alt ?? '').trim();
                if (!decorative && !alt) {
                    throw new Error(
                        'Alt text is required. Describe what the image says, or set ' +
                            '`decorative: true` if it carries no information at all.'
                    );
                }
                if (decorative && (args.alt ?? '').trim()) {
                    throw new Error(
                        'An image cannot be decorative and carry alt text. Send one or ' +
                            'the other.'
                    );
                }

                // Workspace-scoped, so an id from another workspace reads as
                // absent — and the failure lands here rather than after a human
                // has approved something that cannot be applied.
                const asset = await this.assets.byId(
                    args.assetId,
                    ctx.workspaceId
                );
                if (!asset) {
                    throw new Error(`No asset "${args.assetId}".`);
                }
                if ((asset.alt ?? '') === alt) {
                    throw new Error(
                        `"${asset.name}" already has exactly that alt text.`
                    );
                }

                return {
                    kind: MEDIA_PROPOSAL_KINDS.setAltText,
                    target: { assetId: asset.id, name: asset.name },
                    patch: { alt },
                    summary: args.summary,
                    changes: [
                        {
                            field: 'alt',
                            label: 'Alternative text',
                            before: asset.alt,
                            // Spelled out on the card rather than shown as an
                            // empty cell: "(decorative)" is a decision a
                            // reviewer can disagree with, whereas blank reads
                            // as the model having failed to write anything.
                            after: decorative ? '(decorative)' : alt
                        }
                    ]
                };
            }
        };
    }
}
