import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import { ToolRegistry } from '@orthacms/tools-server';
import type { ToolDefinition, ToolProvider } from '@orthacms/tools-server';
import { InjectContentRegistry } from '../content.tokens';
import type { ContentTypeRegistry } from '../registry/content-type-registry';
import { WorkspaceGrantsQuery } from '../content-types/queries/workspace-grants.query';
import {
    InjectRevisionStore,
    type RevisionStore
} from '../revisions/application/ports/revision-store';
import { diffSnapshots } from './diff-snapshots';

/** Revisions a single `admin_content_revisions` call may return. */
const MAX_REVISION_PAGE_SIZE = 25;

/**
 * The content plugin's **version-history** tools — `admin_content_revisions` and
 * `admin_content_diff`.
 *
 * A second provider rather than more methods on
 * {@link ContentCopilotToolProvider}: revisions are their own feature folder
 * with their own port, and the registry takes any number of providers, so the
 * split costs one `register(...)` call and keeps each file about one thing.
 *
 * Both re-check the workspace's content grants for the same reason the entry
 * tools do — the type name arrives from the *model*. The revision store is
 * workspace-scoped on every read besides, so an entry id from another workspace
 * reads as absent rather than as a leak.
 */
@Injectable()
export class RevisionCopilotToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        @InjectContentRegistry()
        private readonly registry: ContentTypeRegistry,
        @InjectRevisionStore()
        private readonly revisions: RevisionStore,
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

    /** The two history tools, in the order the model sees them. */
    tools(): readonly ToolDefinition[] {
        return [this.listRevisions(), this.diffRevisions()];
    }

    /**
     * Resolves a model-supplied type name to a granted, registered type, or
     * throws. Same uniform message as the entry tools, for the same reason:
     * distinguishing "not granted" from "does not exist" would let a run in one
     * workspace enumerate the deployment's other content types.
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

    /** `admin_content_revisions` — an entry's version timeline, newest first. */
    private listRevisions(): ToolDefinition {
        return {
            name: 'admin_content_revisions',
            title: 'List an entry’s versions',
            description:
                'List an entry’s saved versions, newest first — version number, status ' +
                '(draft / published / superseded), when it was captured and by whom. Use this ' +
                'to answer “when did this change?” or “what version is live?”, and to find the ' +
                'two version numbers to pass to admin_content_diff. Each locale of a ' +
                'localized entry has its own timeline, keyed by that locale’s entry id.',
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
                    page: {
                        type: 'integer',
                        minimum: 1,
                        description: '1-based page number.'
                    },
                    pageSize: {
                        type: 'integer',
                        minimum: 1,
                        maximum: MAX_REVISION_PAGE_SIZE,
                        description: `Versions per page (max ${MAX_REVISION_PAGE_SIZE}).`
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
                    page?: number;
                    pageSize?: number;
                };
                const type = await this.resolveGranted(
                    args.typeName,
                    ctx.workspaceId
                );

                // Clamped in `run` as well as declared: the schema validator is
                // defence in depth, not the boundary.
                const pageSize = Math.min(
                    Math.max(args.pageSize ?? 10, 1),
                    MAX_REVISION_PAGE_SIZE
                );
                const result = await this.revisions.list(
                    type.name,
                    args.id,
                    ctx.workspaceId,
                    Math.max(args.page ?? 1, 1),
                    pageSize
                );
                return {
                    ...result,
                    page: Math.max(args.page ?? 1, 1),
                    pageSize
                };
            }
        };
    }

    /**
     * `admin_content_diff` — what changed between two versions.
     *
     * The tool returns **only the changed fields**, plus a count of the
     * unchanged ones. A full side-by-side of every field is what the admin's
     * dialog renders, because a person wants unchanged rows for context; a
     * model gets nothing from them but a bigger prompt, and on a wide type the
     * unchanged richtext bodies alone would dominate the run's token budget.
     */
    private diffRevisions(): ToolDefinition {
        return {
            name: 'admin_content_diff',
            title: 'Compare two versions',
            description:
                'Compare two saved versions of an entry and report which fields differ, with ' +
                'the before and after value of each. Only changed fields are returned (the ' +
                'number of unchanged ones is reported separately). Get the version numbers ' +
                'from admin_content_revisions.',
            inputSchema: {
                type: 'object',
                properties: {
                    typeName: {
                        type: 'string',
                        description: 'The entry’s content type.'
                    },
                    id: { type: 'string', description: 'The entry’s id.' },
                    from: {
                        type: 'integer',
                        minimum: 1,
                        description:
                            'The older version number — the baseline to compare against.'
                    },
                    to: {
                        type: 'integer',
                        minimum: 1,
                        description: 'The newer version number.'
                    }
                },
                required: ['typeName', 'id', 'from', 'to'],
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
                    from: number;
                    to: number;
                };
                const type = await this.resolveGranted(
                    args.typeName,
                    ctx.workspaceId
                );

                const [before, after] = await Promise.all([
                    this.revisions.get(
                        type.name,
                        args.id,
                        ctx.workspaceId,
                        args.from
                    ),
                    this.revisions.get(
                        type.name,
                        args.id,
                        ctx.workspaceId,
                        args.to
                    )
                ]);
                // Naming the missing one matters: "version 7 does not exist"
                // is recoverable by re-reading the timeline, "not found" is
                // not. Neither reveals anything — the store is already
                // workspace-scoped, so an entry the caller cannot reach has no
                // versions to enumerate either.
                const missing = [
                    ...(before ? [] : [args.from]),
                    ...(after ? [] : [args.to])
                ];
                if (!before || !after) {
                    throw new Error(
                        `No version ${missing.join(' or ')} of this entry.`
                    );
                }

                // `serialize` is `T | undefined` for an unregistered name;
                // `resolveGranted` already proved this one is registered, so
                // the fallback is unreachable rather than a real branch — an
                // empty field list would diff to "nothing changed", which is
                // why it isn't left implicit.
                const schema = this.registry.serialize(type.name);
                if (!schema) {
                    throw new Error(
                        `Unknown content type "${args.typeName}" in this workspace.`
                    );
                }
                const { changes, unchangedFields } = diffSnapshots(
                    schema,
                    before.snapshot,
                    after.snapshot
                );
                return {
                    typeName: type.name,
                    from: {
                        number: before.number,
                        createdAt: before.createdAt
                    },
                    to: { number: after.number, createdAt: after.createdAt },
                    changes,
                    unchangedFields
                };
            }
        };
    }
}
