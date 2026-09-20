import {
    BadRequestException,
    Injectable,
    OnModuleInit,
    Optional
} from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import {
    ToolRegistry,
    type ResourceContents,
    type ResourceDefinition,
    type ToolContext,
    type ToolDefinition,
    type ToolProvider
} from '@orthacms/tools-server';
import { InjectContentRegistry } from '../content.tokens';
import { toToolEventActor } from '../public-api/infrastructure/token-actor';
import type {
    ContentTypeRegistry,
    SerializedContentType
} from '../registry/content-type-registry';
import { WorkspaceGrantsQuery } from '../content-types/queries/workspace-grants.query';
import { resolveGrantedType } from '../public-api/http/controllers/resolve-granted-type';
import { PublicEntriesQuery } from '../public-api/infrastructure/public-entries.query';
import { PublicEntryWritesService } from '../public-api/infrastructure/public-entry-writes.service';
import {
    PublicEntryQueryDto,
    PublicListEntriesQueryDto
} from '../public-api/http/dto/public-list-entries-query.dto';
import { PublicSaveEntryDto } from '../public-api/http/dto/public-save-entry.dto';
import {
    PublicBulkIdsDto,
    PublicBulkSaveDto
} from '../public-api/http/dto/public-bulk.dto';
import { RELATION_PAGE_SIZE } from '../entries/infrastructure/persistence/relation-link.service';
import { fieldSchema, isValueField } from '../docs/field-schema';
import {
    assertDraftVisibility,
    requireLocator,
    requireTypeName,
    validateToolInput
} from './tool-input';
import {
    BULK_IDS_SCHEMA,
    BULK_SAVE_SCHEMA,
    CREATE_SCHEMA,
    ENTRY_ACTION_SCHEMA,
    GET_ENTRY_SCHEMA,
    GET_TYPE_SCHEMA,
    LIST_ENTRIES_SCHEMA,
    LIST_TYPES_SCHEMA,
    MEDIA_SCHEMA,
    RELATIONS_SCHEMA,
    TRANSLATIONS_SCHEMA,
    UPDATE_SCHEMA
} from './tool-schemas';

/** URI prefix for the per-content-type schema resources. */
const TYPE_RESOURCE_PREFIX = 'ortha://content-type/';

/**
 * The content plugin's contribution to the shared agent tool registry — the
 * same CRUD the public HTTP API serves, reachable by an MCP client or the
 * copilot's tool loop.
 *
 * **Every handler delegates to the objects the HTTP controllers call**:
 * `resolveGrantedType` for the grant gate, `PublicEntriesQuery` for reads,
 * `PublicEntryWritesService` for writes. That is the whole design. The rules
 * that make the public API safe — published-only by default, soft-deleted rows
 * invisible, an ungranted type indistinguishable from an unknown one, relations
 * that may not cross locales, validation at publish time, revision numbering
 * under an advisory lock, the outbox — are not restated here and therefore
 * cannot drift from the HTTP surface. This class contributes the tool
 * descriptions, argument validation, and the mapping from arguments to those
 * calls, and nothing else.
 *
 * **Authorization is declared, not implemented.** Each tool names the
 * permissions it needs in `requires`, and `ToolRegistry.call` enforces them
 * before dispatch — the analogue of `@RequirePermissions(...)` on a route. A
 * `read`-scoped token cannot reach a write tool, and no handler below contains
 * a line of code saying so. The one authorization decision a handler *does*
 * make is the draft-visibility widening, because it is a rule about an argument
 * rather than about the operation.
 *
 * Registration is `@Optional()`: MCP is a plugin, so a deployment that omits it
 * must still boot. The tools simply go unregistered.
 */
@Injectable()
export class ContentToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        private readonly grants: WorkspaceGrantsQuery,
        private readonly entries: PublicEntriesQuery,
        private readonly writes: PublicEntryWritesService,
        @Optional() private readonly toolRegistry?: ToolRegistry
    ) {}

    /**
     * Register with the tool registry once the DI graph is built. A call rather
     * than a DI binding because Nest has no multi-provider token — see
     * `ToolProvider`.
     */
    onModuleInit(): void {
        this.toolRegistry?.register(this);
    }

    /**
     * The sixteen content tools. @see ToolProvider.tools
     *
     * Every one is stamped `surfaces: ['mcp']` below rather than tool by tool:
     * they are uniformly the **public-API** set — published-only reads through
     * `PublicEntriesQuery`, writes through `PublicEntryWritesService` attributed
     * to a token. The copilot's content tools are the admin-scoped counterpart
     * (a viewer must see drafts; a write records the accepting human), so the
     * two sets share the registry and not each other's callers.
     */
    tools(): readonly ToolDefinition[] {
        return this.mcpTools().map((tool) => ({
            ...tool,
            surfaces: ['mcp'] as const
        }));
    }

    /** The tool definitions themselves, before the surface stamp. */
    private mcpTools(): readonly ToolDefinition[] {
        return [
            // ---- discovery ------------------------------------------------
            // A model cannot type a `values` bag it has not seen, so discovery
            // is the entry point of every authoring conversation, not a
            // nicety. These two are why the write tools can take an open
            // object and still be usable.
            {
                name: 'content_types_list',
                title: 'List content types',
                description:
                    'List the content types available in this workspace: machine name, label, kind (collection or single), and whether each is publishable, localized, or soft-deleting. Start here — the names it returns are exactly the ones the other tools accept.',
                inputSchema: LIST_TYPES_SCHEMA,
                requires: [PERMISSIONS.CONTENT_READ],
                readOnly: true,
                handler: async (_input, context) => ({
                    items: await this.grantedSummaries(context)
                })
            },
            {
                name: 'content_type_get',
                title: 'Get a content type’s schema',
                description:
                    'The full field schema of one content type — every field with its type, validation rules and options, as JSON Schema. Call this before `content_create` or `content_update` so the `values` you send match the type.',
                inputSchema: GET_TYPE_SCHEMA,
                requires: [PERMISSIONS.CONTENT_READ],
                readOnly: true,
                handler: async (input, context) => {
                    const typeName = requireTypeName(input);
                    await this.resolve(typeName, context);
                    return this.describeType(typeName);
                }
            },

            // ---- reads ----------------------------------------------------
            {
                name: 'content_list',
                title: 'List entries',
                description:
                    'One page of a content type’s entries — published only unless you pass `status`. Supports free-text `search`, a structured `filter`, `sort`, and paging. Serves single/page types too: take `items[0]`. Prefer naming `fields` to keep the result small.',
                inputSchema: LIST_ENTRIES_SCHEMA,
                requires: [PERMISSIONS.CONTENT_READ],
                readOnly: true,
                handler: async (input, context) => {
                    assertDraftVisibility(input, context);
                    const { type, granted } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    const query = await validateToolInput(
                        PublicListEntriesQueryDto,
                        input
                    );
                    return this.entries.list(
                        type,
                        query,
                        context.workspaceId,
                        granted
                    );
                }
            },
            {
                name: 'content_get',
                title: 'Get one entry',
                description:
                    'Read a single entry by `id`, or by `localeGroupId` plus `locale`. Optionally expands relations, media, and sibling translations. A draft, a deleted entry, one in another workspace, and an unknown id all read the same: not found.',
                inputSchema: GET_ENTRY_SCHEMA,
                requires: [PERMISSIONS.CONTENT_READ],
                readOnly: true,
                handler: async (input, context) => {
                    assertDraftVisibility(input, context);
                    const { type, granted } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    const query = await validateToolInput(
                        PublicEntryQueryDto,
                        input
                    );
                    return this.entries.getOne(
                        type,
                        requireLocator(input),
                        context.workspaceId,
                        query,
                        granted
                    );
                }
            },
            {
                name: 'content_relations',
                title: 'Page one relation field',
                description:
                    'One ordered page of a single relation field’s links — the way past the cap that `content_get`’s relation preview applies. Only published targets are shown or counted.',
                inputSchema: RELATIONS_SCHEMA,
                requires: [PERMISSIONS.CONTENT_READ],
                readOnly: true,
                handler: async (input, context) => {
                    assertDraftVisibility(input, context);
                    const { type, granted } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    const query = await validateToolInput(
                        PublicListEntriesQueryDto,
                        input
                    );
                    return this.entries.relationField(
                        type,
                        requireLocator(input),
                        requireField(input),
                        query.page ?? 1,
                        query.pageSize ?? RELATION_PAGE_SIZE,
                        context.workspaceId,
                        granted,
                        query.locale,
                        query.status
                    );
                }
            },
            {
                name: 'content_media',
                title: 'Get an entry’s media',
                description:
                    'Every media field of one entry, keyed by field name and resolved to asset metadata (name, kind, MIME type, alt) and URLs.',
                inputSchema: MEDIA_SCHEMA,
                requires: [PERMISSIONS.CONTENT_READ, PERMISSIONS.MEDIA_READ],
                readOnly: true,
                handler: async (input, context) => {
                    assertDraftVisibility(input, context);
                    const { type } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    const query = await validateToolInput(
                        PublicEntryQueryDto,
                        input
                    );
                    return {
                        media: await this.entries.mediaOf(
                            type,
                            requireLocator(input),
                            context.workspaceId,
                            query.locale,
                            query.mediaLimit,
                            query.status
                        )
                    };
                }
            },
            {
                name: 'content_translations',
                title: 'Get an entry’s translations',
                description:
                    'The entry’s other locale rows — the rest of its translation group, ordered by locale slug. The entry itself is not repeated. An error on a type that is not localized.',
                inputSchema: TRANSLATIONS_SCHEMA,
                requires: [PERMISSIONS.CONTENT_READ],
                readOnly: true,
                handler: async (input, context) => {
                    assertDraftVisibility(input, context);
                    const { type } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    const query = await validateToolInput(
                        PublicEntryQueryDto,
                        input
                    );
                    return {
                        translations: await this.entries.translationsOf(
                            type,
                            requireLocator(input),
                            context.workspaceId,
                            query
                        )
                    };
                }
            },

            // ---- writes ---------------------------------------------------
            {
                name: 'content_create',
                title: 'Create an entry',
                description:
                    'Create an entry. On a publishable type it lands as a **draft** — publishing is a separate call (`content_publish`), so every create has a reviewable state. Required fields are required *to publish*, not to create, so a draft may be incomplete. Read it back with `status: "any"`; the published-only default will not find it.',
                inputSchema: CREATE_SCHEMA,
                requires: [PERMISSIONS.CONTENT_CREATE],
                readOnly: false,
                handler: async (input, context) => {
                    const { type, granted } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    const body = await validateToolInput(
                        PublicSaveEntryDto,
                        input
                    );
                    return this.writes.create(
                        type,
                        body,
                        context.workspaceId,
                        granted,
                        toToolEventActor(context.actor)
                    );
                }
            },
            {
                name: 'content_update',
                title: 'Update an entry',
                description:
                    'A **partial** update — the `values` you send are merged over the stored ones, so omitting a field leaves it alone and an explicit `null` clears it. You never need to send the whole record. On a publishable type this returns a published entry to draft while its published version stays live; call `content_publish` to ship the change.',
                inputSchema: UPDATE_SCHEMA,
                requires: [PERMISSIONS.CONTENT_UPDATE],
                readOnly: false,
                handler: async (input, context) => {
                    const { type, granted } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    // The save body carries only `values` + `relations`: the
                    // addressing locale is a separate argument, exactly as the
                    // HTTP route keeps it in the query string. Folding them
                    // together is how a group-addressed update to the German
                    // row silently retargets the English one.
                    const body = await validateToolInput(PublicSaveEntryDto, {
                        values: input['values'],
                        ...(input['relations'] === undefined
                            ? {}
                            : { relations: input['relations'] })
                    });
                    return this.writes.update(
                        type,
                        requireLocator(input),
                        body,
                        context.workspaceId,
                        granted,
                        localeArg(input),
                        toToolEventActor(context.actor)
                    );
                }
            },
            {
                name: 'content_publish',
                title: 'Publish an entry',
                description:
                    'Re-validate the stored entry and take it live. A draft that does not pass the type’s validation rules fails here with the offending fields named — that is the moment `required` bites.',
                inputSchema: ENTRY_ACTION_SCHEMA,
                requires: [PERMISSIONS.CONTENT_PUBLISH],
                readOnly: false,
                handler: async (input, context) => {
                    const { type, granted } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    return this.writes.publish(
                        type,
                        requireLocator(input),
                        context.workspaceId,
                        granted,
                        localeArg(input),
                        toToolEventActor(context.actor)
                    );
                }
            },
            {
                name: 'content_unpublish',
                title: 'Unpublish an entry',
                description:
                    'Revert an entry to a draft. It leaves the published reads immediately; a write-scoped caller can still see it with `status: "draft"`.',
                inputSchema: ENTRY_ACTION_SCHEMA,
                requires: [PERMISSIONS.CONTENT_PUBLISH],
                readOnly: false,
                handler: async (input, context) => {
                    const { type, granted } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    return this.writes.unpublish(
                        type,
                        requireLocator(input),
                        context.workspaceId,
                        granted,
                        localeArg(input),
                        toToolEventActor(context.actor)
                    );
                }
            },
            {
                name: 'content_delete',
                title: 'Delete an entry',
                description:
                    'Remove an entry — recoverable from the admin’s trash on a soft-deleting type, permanent otherwise. Deletes exactly one row: on a localized type the other translations stay live.',
                inputSchema: ENTRY_ACTION_SCHEMA,
                requires: [PERMISSIONS.CONTENT_DELETE],
                readOnly: false,
                destructive: true,
                handler: async (input, context) => {
                    const { type } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    await this.writes.remove(
                        type,
                        requireLocator(input),
                        context.workspaceId,
                        localeArg(input),
                        toToolEventActor(context.actor)
                    );
                    return { deleted: true };
                }
            },
            // ---- batches ---------------------------------------------------
            //
            // The single-entry writes above stay exactly as they are; these are
            // for the case a model has a *list*. Without them, "publish these
            // twelve drafts" is twelve tool calls — twelve round trips through
            // the model, each spending context on a result nobody reads, and on
            // the copilot's side twelve steps against a bounded run. Each one
            // runs the same use-case its single-entry sibling does.
            {
                name: 'content_bulk_save',
                title: 'Save many entries',
                description:
                    'Create and/or update many entries of one type in a single call. An item with an `id` updates that entry (a **partial** update, exactly like `content_update`); an item without one creates a draft. Always succeeds as a call: each item gets its own verdict in the same position, and a failure carries the reason that item would have failed with on its own — so read `failed` and the per-item `error`, and do not report the batch as saved without checking them.',
                inputSchema: BULK_SAVE_SCHEMA,
                requires: [
                    PERMISSIONS.CONTENT_CREATE,
                    PERMISSIONS.CONTENT_UPDATE
                ],
                readOnly: false,
                handler: async (input, context) => {
                    const { type, granted } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    const body = await validateToolInput(PublicBulkSaveDto, {
                        items: input['items']
                    });
                    return this.writes.bulkSave(
                        type,
                        body.items,
                        context.workspaceId,
                        granted,
                        toToolEventActor(context.actor)
                    );
                }
            },
            {
                name: 'content_bulk_publish',
                title: 'Publish many entries',
                description:
                    'Re-validate and publish many drafts at once. Publishes the ones that pass and reports the rest in `skipped` with why — `already-published`, `blocked` (it fails the type’s validation rules), or `not-found`. A partly-skipped batch is the normal outcome, so say what actually went live rather than assuming all of it did.',
                inputSchema: BULK_IDS_SCHEMA,
                requires: [PERMISSIONS.CONTENT_PUBLISH],
                readOnly: false,
                handler: async (input, context) => {
                    const { type } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    const body = await validateToolInput(PublicBulkIdsDto, {
                        ids: input['ids']
                    });
                    return this.writes.bulkPublish(
                        type,
                        body.ids,
                        context.workspaceId,
                        toToolEventActor(context.actor)
                    );
                }
            },
            {
                name: 'content_bulk_unpublish',
                title: 'Unpublish many entries',
                description:
                    'Revert many entries to drafts. `count` is how many actually changed — an id that was not a live published entry here changes nothing and is not counted.',
                inputSchema: BULK_IDS_SCHEMA,
                requires: [PERMISSIONS.CONTENT_PUBLISH],
                readOnly: false,
                handler: async (input, context) => {
                    const { type } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    const body = await validateToolInput(PublicBulkIdsDto, {
                        ids: input['ids']
                    });
                    return this.writes.bulkUnpublish(
                        type,
                        body.ids,
                        context.workspaceId,
                        toToolEventActor(context.actor)
                    );
                }
            },
            {
                name: 'content_bulk_delete',
                title: 'Delete many entries',
                description:
                    'Remove many entries — recoverable from the admin’s trash on a soft-deleting type, permanent otherwise. Deletes exactly the listed rows: on a localized type the other translations stay live. `count` is how many were removed.',
                inputSchema: BULK_IDS_SCHEMA,
                requires: [PERMISSIONS.CONTENT_DELETE],
                readOnly: false,
                destructive: true,
                handler: async (input, context) => {
                    const { type } = await this.resolve(
                        requireTypeName(input),
                        context
                    );
                    const body = await validateToolInput(PublicBulkIdsDto, {
                        ids: input['ids']
                    });
                    return this.writes.bulkRemove(
                        type,
                        body.ids,
                        context.workspaceId,
                        toToolEventActor(context.actor)
                    );
                }
            }
        ];
    }

    /**
     * Each readable content type as a resource, so a client that supports them
     * can pull a schema into context without spending a tool call. Pruned to
     * the workspace's grants, exactly like `content_types_list`.
     */
    async resources(
        context: ToolContext
    ): Promise<readonly ResourceDefinition[]> {
        const summaries = await this.grantedSummaries(context);
        return summaries.map((summary) => ({
            uri: `${TYPE_RESOURCE_PREFIX}${summary.name}`,
            name: `${summary.label} schema`,
            description: `Field schema of the \`${summary.name}\` content type.`,
            mimeType: 'application/json'
        }));
    }

    /** @see ToolProvider.readResource */
    async readResource(
        uri: string,
        context: ToolContext
    ): Promise<ResourceContents | undefined> {
        if (!uri.startsWith(TYPE_RESOURCE_PREFIX)) {
            return undefined;
        }
        const typeName = uri.slice(TYPE_RESOURCE_PREFIX.length);
        // Through the same grant gate as the tools, so an ungranted type is a
        // 404 here exactly as it is there — a resource read must not be a way
        // around the gate that guards the equivalent tool call.
        await this.resolve(typeName, context);
        return {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(this.describeType(typeName), null, 2)
        };
    }

    /** The workspace's granted type summaries. */
    private async grantedSummaries(context: ToolContext) {
        const granted = await this.grants.grantedSlugs(context.workspaceId);
        return this.registry
            .summaries()
            .filter((summary) => granted.has(summary.name));
    }

    /** Resolve a type through the shared registry + grant gate. */
    private resolve(typeName: string, context: ToolContext) {
        return resolveGrantedType(
            this.registry,
            this.grants,
            typeName,
            context.workspaceId
        );
    }

    /**
     * One type's serialized schema, plus a JSON Schema for its `values` bag.
     *
     * Both, because they answer different questions: the serialized fields
     * carry the CMS's own vocabulary (which field is a relation, what a select's
     * options are), while the JSON Schema is what a model needs to construct a
     * valid `values` object. `fieldSchema` is the same generator the OpenAPI
     * document uses, so the two descriptions of a type cannot disagree.
     */
    private describeType(typeName: string) {
        const type = this.registry.serialize(typeName) as SerializedContentType;
        const properties: Record<string, unknown> = {};
        for (const field of type.fields.filter(isValueField)) {
            properties[field.name] = fieldSchema(field);
        }
        return {
            ...type,
            valuesSchema: {
                type: 'object',
                properties,
                // Required fields are listed only on a type that is always
                // live: on a publishable one they are required *to publish*,
                // and declaring them required here would tell a model it
                // cannot save the incomplete draft it is allowed to save.
                ...(type.publishable
                    ? {}
                    : {
                          required: type.fields
                              .filter(
                                  (field) =>
                                      isValueField(field) && field.required
                              )
                              .map((field) => field.name)
                      }),
                additionalProperties: false
            }
        };
    }
}

/** The `field` argument, required by `content_relations`. */
function requireField(input: Record<string, unknown>): string {
    const field = input['field'];
    if (typeof field !== 'string' || field.length === 0) {
        throw new BadRequestException(
            '`field` is required — the relation field to page, e.g. `tags`.'
        );
    }
    return field;
}

/** The addressing `locale` argument, when present. */
function localeArg(input: Record<string, unknown>): string | undefined {
    const locale = input['locale'];
    return typeof locale === 'string' ? locale : undefined;
}
