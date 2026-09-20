import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import { ToolRegistry } from '@orthacms/tools-server';
import type { ToolDefinition, ToolProvider } from '@orthacms/tools-server';
import { ActivityService } from '../activity/services/activity.service';

/** Events a single `activity_recent` call may return. */
const MAX_TOOL_PAGE_SIZE = 25;

/**
 * The activity plugin's contribution to the copilot's tool catalogue —
 * `activity_recent`, a thin wrapper over the same `ActivityService.list` the
 * read route calls.
 *
 * **This tool is deployment-wide, not workspace-scoped, and that is not an
 * oversight.** `activity_events` has no workspace column: the trail records
 * user invites, role changes and workspace lifecycle alongside content edits,
 * and several of those events belong to no workspace at all. So there is
 * nothing to scope by, and the tool says so in its description rather than
 * implying a boundary it cannot enforce.
 *
 * What bounds it instead is `activity:read`, which the v1 role matrix grants to
 * **admins only** — the same key guarding `GET /api/activity`. The capability
 * profile withholds the tool from everyone else at *offer* time, so a viewer's
 * or contributor's run is never told it exists (ADR-0005 §3). An admin asking
 * their copilot about the audit log reads exactly what they could already read
 * by opening the Activity page.
 */
@Injectable()
export class ActivityCopilotToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        private readonly activity: ActivityService,
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

    /** The one activity read tool. */
    tools(): readonly ToolDefinition[] {
        return [this.recent()];
    }

    /** `activity_recent` — a page of the audit trail, newest first. */
    private recent(): ToolDefinition {
        return {
            name: 'activity_recent',
            title: 'Recent activity',
            description:
                'Read the audit trail — who did what, when. Filter by event kind ' +
                '(e.g. "entry.published"), by the subject acted upon, by actor, or by a time ' +
                'window. Newest first. This log covers the whole deployment, not just the ' +
                'current workspace, and it includes account and workspace administration as ' +
                'well as content changes, so say which scope you are reporting on.',
            inputSchema: {
                type: 'object',
                properties: {
                    kind: {
                        type: 'array',
                        items: { type: 'string', maxLength: 255 },
                        description:
                            'Event kinds to include, matched exactly (e.g. ["entry.published"]). ' +
                            'Kinds are owned by the emitting plugins — read one off a result ' +
                            'rather than guessing.'
                    },
                    subjectType: {
                        type: 'string',
                        maxLength: 255,
                        description:
                            'Restrict to one kind of subject, e.g. "user" or "entry".'
                    },
                    subjectId: {
                        type: 'string',
                        maxLength: 255,
                        description:
                            'Restrict to one entity’s history — e.g. an entry id, to see ' +
                            'everything that happened to it.'
                    },
                    actorEmail: {
                        type: 'string',
                        maxLength: 255,
                        description:
                            'Case-insensitive substring of the actor’s email, as recorded at ' +
                            'the time. Use this rather than a user id when the question names ' +
                            'a person.'
                    },
                    from: {
                        type: 'string',
                        description:
                            'Inclusive lower bound on the event time, ISO 8601 (e.g. "2026-01-01T00:00:00Z").'
                    },
                    to: {
                        type: 'string',
                        description:
                            'Inclusive upper bound on the event time, ISO 8601.'
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
                        description: `Events per page (max ${MAX_TOOL_PAGE_SIZE}).`
                    }
                },
                additionalProperties: false
            },
            requires: [PERMISSIONS.ACTIVITY_READ],
            readOnly: true,
            effect: 'read',
            surfaces: ['copilot'],
            handler: async (input) => {
                const args = (input ?? {}) as {
                    kind?: string[];
                    subjectType?: string;
                    subjectId?: string;
                    actorEmail?: string;
                    from?: string;
                    to?: string;
                    page?: number;
                    pageSize?: number;
                };

                // Clamped here as well as declared in the schema: the
                // validator is defence in depth, not the boundary.
                const pageSize = Math.min(
                    Math.max(args.pageSize ?? 10, 1),
                    MAX_TOOL_PAGE_SIZE
                );
                const result = await this.activity.list({
                    ...(args.kind?.length ? { kind: args.kind } : {}),
                    ...(args.subjectType
                        ? { subjectType: args.subjectType }
                        : {}),
                    ...(args.subjectId ? { subjectId: args.subjectId } : {}),
                    ...(args.actorEmail ? { actorEmail: args.actorEmail } : {}),
                    ...(args.from ? { from: args.from } : {}),
                    ...(args.to ? { to: args.to } : {}),
                    page: Math.max(args.page ?? 1, 1),
                    pageSize,
                    sort: 'at',
                    order: 'desc'
                });

                return {
                    total: result.total,
                    page: result.page,
                    pageSize: result.pageSize,
                    // `meta` is an open per-kind payload each plugin owns, and
                    // some of it is user-authored text. It rides through the
                    // engine's untrusted-content fence like any other tool
                    // output, so it is passed on rather than stripped — the
                    // fence is what makes that safe, not omission.
                    items: result.items.map((event) => ({
                        ...event,
                        at: event.at.toISOString()
                    }))
                };
            }
        };
    }
}
