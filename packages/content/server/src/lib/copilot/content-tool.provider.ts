import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import { ToolRegistry } from '@orthacms/tools-server';
import type { ToolDefinition, ToolProvider } from '@orthacms/tools-server';
import { InjectContentRegistry } from '../content.tokens';
import type { ContentTypeRegistry } from '../registry/content-type-registry';
import { EntriesService } from '../entries/infrastructure/queries/entries.service';
import { EntryWriterService } from '../entries/infrastructure/persistence/entry-writer.service';
import { WorkspaceGrantsQuery } from '../content-types/queries/workspace-grants.query';
import { MAX_PAGE_SIZE } from '../entries/entries.constants';
import { buildEntryFilterSurface } from '../entries/infrastructure/queries/entry-filter-surface';
import { describeFilterFields, filterTreeSchema } from './filter-schema';
import { projectEntry } from './project-entry';

/** Rows a single `admin_content_search` call may return. */
const MAX_TOOL_PAGE_SIZE = 25;

/**
 * The content plugin's contribution to the copilot's tool catalogue — phase 1's
 * three **read-only** tools.
 *
 * Bindings live with their owner: this package already holds `EntriesService`
 * and the registry, so the tools are thin wrappers over the same services the
 * HTTP controllers call, with no refactor and no duplicated query logic. The
 * copilot never imports content ([`docs/design/copilot.md`](../../../../../docs/design/copilot.md) §4).
 *
 * **Every tool re-checks the workspace's content grants.** `WorkspaceGuard`
 * proved the caller belongs to the workspace, but not that the workspace may
 * reach a given type — and the type name arrives from the *model*, which is
 * steerable by content it has read. `resolveGranted` is the one place that
 * check lives, and every tool goes through it.
 */
@Injectable()
export class ContentCopilotToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly entries: EntriesService,
        private readonly writer: EntryWriterService,
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

    /** The three read tools, in the order the model sees them. */
    tools(): readonly ToolDefinition[] {
        return [this.listTypes(), this.searchEntries(), this.getEntry()];
    }

    /**
     * Resolves a model-supplied type name to a registered type the workspace
     * was actually granted, or throws — the error becomes a tool error the
     * model can recover from.
     *
     * "Not granted" and "does not exist" deliberately produce the **same**
     * message: a distinguishable answer would let a run in one workspace
     * enumerate the deployment's other content types.
     */
    private async resolveGranted(typeName: string, workspaceId: string) {
        const type = this.registry.get(typeName);
        const granted = await this.grants.grantedSlugs(workspaceId);
        if (!type || !granted.has(type.name)) {
            throw new Error(
                `Unknown content type "${typeName}" in this workspace.`
            );
        }
        return type;
    }

    /**
     * `admin_content_types` — the workspace's types, and a named type's full
     * field schema on demand.
     *
     * This is the other half of the "summaries in the prompt, schema on
     * demand" decision (`docs/design/copilot.md` §10): the prompt lists types
     * without fields, and the model calls this when it needs one type's fields,
     * costing one round trip instead of a context window.
     */
    private listTypes(): ToolDefinition {
        return {
            name: 'admin_content_types',
            title: 'Content types (admin)',
            description:
                'List the content types available in this workspace. Pass a typeName to get ' +
                'that type’s full field schema (field names, types, required flags, relation ' +
                'targets) AND the paths you may filter and sort on — neither is in your system ' +
                'prompt, so call this before reasoning about a type’s fields or building a filter.',
            inputSchema: {
                type: 'object',
                properties: {
                    typeName: {
                        type: 'string',
                        description:
                            'Return this one type with its full field schema. Omit to list all types.'
                    }
                },
                additionalProperties: false
            },
            requires: [PERMISSIONS.CONTENT_READ],
            readOnly: true,
            effect: 'read',
            surfaces: ['copilot'],
            handler: async (input, ctx) => {
                const { typeName } = (input ?? {}) as { typeName?: string };
                const granted = await this.grants.grantedSlugs(ctx.workspaceId);

                if (typeName) {
                    const type = await this.resolveGranted(
                        typeName,
                        ctx.workspaceId
                    );
                    // The filterable surface is built with `grantedTypes`, so a
                    // relation hop into a type this workspace was never granted
                    // is never advertised. The list query itself enforces a
                    // wider (unpruned) schema, so advertising less is safe —
                    // the reverse would offer paths the engine then rejects.
                    const { schema, fields } = buildEntryFilterSurface(type, {
                        workspaceId: ctx.workspaceId,
                        grantedTypes: granted
                    });
                    return {
                        type: this.registry.serialize(type.name),
                        // `fields` is the admin PICKER's list, which omits the
                        // envelope timestamps a person reads off a badge —
                        // `publishedAt` most of all, without which a model
                        // cannot ask "published, with unpublished edits". The
                        // root of `schema` is the SQL whitelist itself, so
                        // unioning it advertises exactly what the engine will
                        // accept. See `describeFilterFields`.
                        filterableFields: describeFilterFields(
                            fields,
                            schema.fields
                        )
                    };
                }

                return {
                    types: this.registry
                        .summaries()
                        .filter((summary) => granted.has(summary.name))
                };
            }
        };
    }

    /** `admin_content_search` — one page of a type's entries. */
    private searchEntries(): ToolDefinition {
        return {
            name: 'admin_content_search',
            title: 'Search entries (admin)',
            description:
                'Search a content type’s entries in this workspace. Combine free-text `search` ' +
                '(across text-like fields) with a structured `filter` for precise queries, and ' +
                '`fields` to return only the columns you need — a full entry includes rich-text ' +
                'bodies and a page of them is very large. Results are paginated and the response ' +
                'reports the true total, so you can state how many matched even when you have ' +
                'only read the first page. On a localized type, pass `locale` — omitting it ' +
                'searches the default locale, which is rarely what the user meant. ' +
                'Publish state is two fields, so `status` alone conflates two different ' +
                'things: entries with live content plus unpublished changes (“modified”, ' +
                '“edited but not published”) are `status` eq "draft" AND `publishedAt` ' +
                'op "null" value false, while never-published ones are `status` eq "draft" ' +
                'AND `publishedAt` op "null" value true.',
            inputSchema: {
                type: 'object',
                properties: {
                    typeName: {
                        type: 'string',
                        description:
                            'The content type to search, e.g. "article".'
                    },
                    search: {
                        type: 'string',
                        maxLength: 255,
                        description: 'Free-text query. Omit to list everything.'
                    },
                    sort: {
                        type: 'string',
                        maxLength: 255,
                        description:
                            'A field name, or "-" prefixed for descending, e.g. "-updatedAt".'
                    },
                    page: {
                        type: 'integer',
                        minimum: 1,
                        description: '1-based page number.'
                    },
                    pageSize: {
                        type: 'integer',
                        minimum: 1,
                        maximum: MAX_TOOL_PAGE_SIZE,
                        description: `Rows per page (max ${MAX_TOOL_PAGE_SIZE}).`
                    },
                    filter: filterTreeSchema(),
                    fields: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Field names to return in `values`. Strongly recommended: omitting ' +
                            'this returns every field including rich text. The envelope ' +
                            '(id, status, locale, timestamps) is always returned.'
                    },
                    locale: {
                        type: 'string',
                        maxLength: 35,
                        description:
                            'Locale slug to search, e.g. "de". Only meaningful on a localized ' +
                            'type; omitted, the default locale is searched.'
                    },
                    localeFallback: {
                        type: 'string',
                        enum: ['default'],
                        description:
                            'Set to "default" to include the default locale where the requested ' +
                            'one has no row.'
                    }
                },
                required: ['typeName'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.CONTENT_READ],
            readOnly: true,
            effect: 'read',
            surfaces: ['copilot'],
            handler: async (input, ctx) => {
                const args = (input ?? {}) as {
                    typeName: string;
                    search?: string;
                    sort?: string;
                    page?: number;
                    pageSize?: number;
                    filter?: unknown;
                    fields?: string[];
                    locale?: string;
                    localeFallback?: string;
                };
                const type = await this.resolveGranted(
                    args.typeName,
                    ctx.workspaceId
                );

                // The page size is clamped rather than trusted. The schema
                // already caps it, but the validator is defence in depth, not
                // the boundary — and a model that ignores `maximum` must not be
                // able to pull the whole table into a prompt.
                const pageSize = Math.min(
                    Math.max(args.pageSize ?? 10, 1),
                    Math.min(MAX_TOOL_PAGE_SIZE, MAX_PAGE_SIZE)
                );

                const result = await this.entries.list(
                    type,
                    {
                        ...(args.search ? { search: args.search } : {}),
                        ...(args.sort ? { sort: args.sort } : {}),
                        // The engine's `?filter=` is a JSON string on the wire;
                        // the model gets an object, which is far easier for it
                        // to build correctly. `parseFilterTree` accepts either,
                        // and validates every path against the type's schema —
                        // a bad path is a 400 turned into a tool error, never a
                        // query.
                        ...(args.filter
                            ? { filter: JSON.stringify(args.filter) }
                            : {}),
                        // Forwarded verbatim to the bound entry extension,
                        // which validates the slug (unknown → error) and scopes
                        // the rows. Content-server stays locale-agnostic.
                        ...(args.locale ? { locale: args.locale } : {}),
                        ...(args.localeFallback === 'default'
                            ? { localeFallback: 'default' }
                            : {}),
                        page: Math.max(args.page ?? 1, 1),
                        pageSize
                    },
                    ctx.workspaceId
                );

                return {
                    typeName: type.name,
                    total: result.total,
                    page: result.page,
                    pageSize: result.pageSize,
                    items: result.items.map((item) =>
                        projectEntry(item, args.fields)
                    )
                };
            }
        };
    }

    /** `admin_content_get` — one entry in full, by id. */
    private getEntry(): ToolDefinition {
        return {
            name: 'admin_content_get',
            title: 'Get an entry (admin)',
            description:
                'Fetch one entry of a content type by its id, with all of its field values. ' +
                'Use this after admin_content_search when you need an entry’s full contents.',
            inputSchema: {
                type: 'object',
                properties: {
                    typeName: {
                        type: 'string',
                        description: 'The entry’s content type.'
                    },
                    id: {
                        type: 'string',
                        description:
                            'The entry’s id, as returned by admin_content_search.'
                    },
                    fields: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Field names to return in `values`. Omitted, every field is ' +
                            'returned including rich text.'
                    }
                },
                required: ['typeName', 'id'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.CONTENT_READ],
            readOnly: true,
            effect: 'read',
            surfaces: ['copilot'],
            handler: async (input, ctx) => {
                const args = (input ?? {}) as {
                    typeName: string;
                    id: string;
                    fields?: string[];
                };
                const type = await this.resolveGranted(
                    args.typeName,
                    ctx.workspaceId
                );
                // `getOne` is workspace-scoped and 404s a soft-deleted row, so
                // the tool inherits both without restating either. An entry id
                // already names one row, including its locale, so there is no
                // `locale` parameter here — ask for a sibling by searching the
                // type with a `localeGroupId` filter.
                const entry = await this.writer.getOne(
                    type,
                    args.id,
                    ctx.workspaceId
                );
                return projectEntry(entry, args.fields);
            }
        };
    }
}
