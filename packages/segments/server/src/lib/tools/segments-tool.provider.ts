import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
    ToolRegistry,
    type ToolContext,
    type ToolDefinition,
    type ToolProvider
} from '@orthacms/tools-server';
import {
    InjectContentRegistry,
    toToolEventActor,
    type ContentTypeRegistry
} from '@orthacms/content-server';
import { PERMISSIONS } from '@orthacms/identity-server';
import { isOfferedIn, isOpen, type Segment } from '@orthacms/segments-domain';
import { EntryAccessService } from '../application/entry-access.service';
import { SegmentCatalogService } from '../application/segment-catalog.service';

/** One audience, as an agent sees it. */
interface SegmentView {
    id: string;
    key: string;
    label: string;
    tags: string[];
}

/** One entry's audiences, resolved to names an agent can reason about. */
interface EntryAccessView {
    entryId: string;
    restricted: boolean;
    allow: SegmentView[];
    deny: SegmentView[];
}

/**
 * The **agent-facing** half of reader entitlements — what an MCP client and the
 * copilot can ask and change about who may read a record.
 *
 * Three tools, and the split between them is the whole design:
 *
 * - `segments_list` and `content_access_get` are **reads on both surfaces**. An
 *   agent that cannot ask whether an entry is restricted is one that reports a
 *   partial answer as a complete one, which is worse than one that cannot see
 *   the entry at all.
 * - `content_access_set` is **MCP only**, and writes directly. A bearer token is
 *   its own actor: the registry has already checked `segments:manage` against
 *   the token's scope, so there is nobody to ask for approval and nothing to
 *   propose to.
 * - The copilot's counterpart is a **propose** tool
 *   (`content_propose_access`, in `../copilot/`), because a copilot write is a
 *   proposal recorded and applied under the signing-in human's own permissions
 *   ([ADR-0009](../../../../../docs/adr/0009-copilot-applies-directly.md)).
 *
 * ## What is deliberately absent
 *
 * There is **no tool over the audience directory** — no create, rename, retag or
 * delete. Renaming one audience's tags changes who every entry naming it is
 * visible to, installation-wide, and deleting one rewrites both lists on every
 * entry that held it. That is administration of the vocabulary, and it stays on
 * a session-authenticated screen where a person is looking at the consequence
 * the dialog spells out. `segments:manage` on a `full` token therefore reaches
 * exactly the entry-level tools below.
 *
 * ## Why these read entry access without reading the entry
 *
 * `content_access_get` answers from this plugin's own table, keyed by entry id
 * and workspace. It deliberately does **not** go through the public entry read,
 * which is reader-scoped: an agent that had just restricted an entry would then
 * be unable to read back what it had done, because the restriction it wrote is
 * the thing hiding it. Asking "who may read this record" is not reading the
 * record.
 */
@Injectable()
export class SegmentsToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        private readonly catalog: SegmentCatalogService,
        private readonly access: EntryAccessService,
        @InjectContentRegistry()
        private readonly types: ContentTypeRegistry,
        // A deployment may run neither consumer, in which case these simply go
        // unregistered — the same `@Optional()` every tool provider takes.
        @Optional() private readonly registry?: ToolRegistry
    ) {}

    onModuleInit(): void {
        this.registry?.register(this);
    }

    tools(): readonly ToolDefinition[] {
        return [this.listSegments(), this.getAccess(), this.setAccess()];
    }

    /** `segments_list` — the audiences this workspace may decide against. */
    private listSegments(): ToolDefinition {
        return {
            name: 'segments_list',
            title: 'List audiences',
            description:
                'List the reader audiences this workspace can restrict content to. An audience ' +
                'is a named set of reader tags — the identifiers your readers arrive with — and ' +
                'an entry names the audiences that may read it and the ones that may not. ' +
                'Returns an empty list when the installation has none, which means every ' +
                'published entry is readable by everyone and nothing about access applies.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false
            },
            requires: [PERMISSIONS.SEGMENTS_READ],
            readOnly: true,
            handler: async (
                _input,
                ctx: ToolContext
            ): Promise<{ segments: SegmentView[] }> => ({
                // Scoped to the workspace, like the editor's own list: an
                // audience this workspace was not offered is one no entry here
                // may name, so listing it would be offering a choice the write
                // then refuses.
                segments: this.catalog
                    .all()
                    .filter((segment) => isOfferedIn(segment, ctx.workspaceId))
                    .map(toSegmentView)
            })
        };
    }

    /** `content_access_get` — who may read one entry. */
    private getAccess(): ToolDefinition {
        return {
            name: 'content_access_get',
            title: 'Read an entry’s audiences',
            description:
                'Read who may see one published entry. `allow` empty means EVERYONE — not ' +
                'nobody — which is the state every entry is in until somebody restricts it; ' +
                '`restricted` is the plain answer to "has anyone decided about this record". A ' +
                'deny always wins over an allow. On a type with translations this answers for ' +
                'the whole record: every language of it carries the same audiences.',
            inputSchema: {
                type: 'object',
                properties: {
                    entryId: {
                        type: 'string',
                        description: 'The entry to read access for.'
                    }
                },
                required: ['entryId'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.SEGMENTS_READ],
            readOnly: true,
            handler: async (input, ctx): Promise<EntryAccessView> => {
                const { entryId } = input as { entryId: string };
                const stored = await this.access.get(ctx.workspaceId, entryId);
                return this.view(entryId, stored);
            }
        };
    }

    /** `content_access_set` — replace one entry's audiences. MCP only. */
    private setAccess(): ToolDefinition {
        return {
            name: 'content_access_set',
            title: 'Set an entry’s audiences',
            description:
                'Replace who may see one published entry — both lists at once, so send the ' +
                'whole intended state rather than a change to it (there is no spelling for ' +
                '"leave the rest alone"). Sending two empty lists opens the entry to everyone. ' +
                'Use audience ids from segments_list. On a type with translations this applies ' +
                'to EVERY language of the record: who may read something is a fact about the ' +
                'record, not about one translation of it. The change is live when this returns.',
            inputSchema: {
                type: 'object',
                properties: {
                    entryId: {
                        type: 'string',
                        description: 'The entry to set access on.'
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
                    }
                },
                required: ['entryId', 'typeName', 'allow', 'deny'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.SEGMENTS_MANAGE],
            readOnly: false,
            // MCP only. The copilot's counterpart proposes rather than writes,
            // because its actor is a person who has to see the change first.
            surfaces: ['mcp'],
            handler: async (input, ctx): Promise<EntryAccessView> => {
                const args = input as {
                    entryId: string;
                    typeName: string;
                    allow: string[];
                    deny: string[];
                };
                const type = this.resolveType(args.typeName);
                const written = await this.access.setForGroup({
                    workspaceId: ctx.workspaceId,
                    type,
                    entryId: args.entryId,
                    allow: args.allow,
                    deny: args.deny,
                    actor: toToolEventActor(ctx.actor)
                });
                return this.view(args.entryId, written.access);
            }
        };
    }

    /** A stored pair of id lists, with each id resolved to its audience. */
    private view(
        entryId: string,
        stored: { allow: string[]; deny: string[] }
    ): EntryAccessView {
        const byId = new Map(
            this.catalog.all().map((segment) => [segment.id, segment])
        );
        // An id the catalogue no longer holds is dropped rather than printed
        // raw: a deleted audience is scrubbed from every entry in the same
        // transaction, so one surviving here would be a bug worth not
        // laundering into an agent's answer as a plausible-looking uuid.
        const resolve = (ids: string[]): SegmentView[] =>
            ids
                .map((id) => byId.get(id))
                .filter((segment): segment is NonNullable<typeof segment> =>
                    Boolean(segment)
                )
                .map(toSegmentView);
        return {
            entryId,
            restricted: !isOpen(stored),
            allow: resolve(stored.allow),
            deny: resolve(stored.deny)
        };
    }

    /** The content type behind a slug, or a tool error naming it. */
    private resolveType(typeName: string) {
        const type = this.types.get(typeName);
        if (!type) {
            throw new Error(`Unknown content type "${typeName}".`);
        }
        return type;
    }
}

/** The wire shape of one audience — ids and names, never a stored row. */
function toSegmentView(segment: Segment): SegmentView {
    return {
        id: segment.id,
        key: segment.key,
        label: segment.label,
        tags: [...segment.tags]
    };
}
