import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import { ToolRegistry } from '@orthacms/tools-server';
import type {
    ToolContext,
    ToolDefinition,
    ToolProvider
} from '@orthacms/tools-server';
import { ALARM_SEVERITIES } from '../domain/alarm-severity';
import type { AlarmSeverity } from '../domain/alarm-severity';
import { FINDING_STATES, type FindingState } from '../domain/finding-state';
import { AlarmFindingStore } from '../infrastructure/alarm-finding.store';
import {
    buildFindingsToolOutput,
    type FindingsToolOutput
} from './findings-tool-output';

/** Findings a single call may return. */
const MAX_TOOL_PAGE_SIZE = 25;

/** What a call returns when the caller names no page size. */
const DEFAULT_TOOL_PAGE_SIZE = 10;

/**
 * The alarms plugin's contribution to the copilot's tool catalogue —
 * `admin_alarms_findings`, a read over the same `AlarmFindingStore` the HTTP
 * routes use.
 *
 * **Why this exists.** The whole feature is about making "what is wrong with
 * this workspace's content?" answerable. Until now the copilot could not answer
 * it at all: it could search entries and read revisions, but nothing told it
 * which of them a rule had flagged. One read closes that gap, and it composes —
 * a finding carries an `entryId`, so the model's natural next step is
 * `admin_content_get`.
 *
 * ### `surfaces: ['copilot']` — the reason, recorded
 *
 * Per the checklist in
 * [`tools/server/AGENTS.md`](../../../../tools/server/AGENTS.md#adding-a-tool-decide-surfaces-deliberately),
 * the first **yes** decides it, and this is a yes at (3): *does it need a
 * permission no token scope mints?* `scopePermissions` yields `content:*` plus
 * `media:read`/`media:create` and nothing else, so `alarms:read` can never be
 * held by a token. Offered to MCP, this tool would be listed in `tools/list`
 * and refused on every call — which is worse than absent, because it advertises
 * a capability that does not exist.
 *
 * Declaring the field rather than letting the permission check do the work is
 * the point of the rule: a future token scope that happened to include
 * `alarms:read` would otherwise silently open an MCP surface nobody decided to
 * open. The same reasoning, and the same answer, as `activity_recent`.
 *
 * It is also arguably a yes at (2) — a finding names entries regardless of
 * publish state, which is admin-facing information — but (3) settles it first
 * and more durably.
 *
 * ### What bounds it
 *
 * `alarms:read`, which every role holds, so the tool is offered to any signed-in
 * member. That is deliberate and matches the UI: findings render inline in the
 * entry editor precisely so a contributor can act on them, and a copilot that
 * could not mention what the editor is already showing would be strange rather
 * than safe. The scope is the workspace — `ToolContext.workspaceId` is resolved
 * before dispatch, so a call can only ever read the workspace the run is in.
 *
 * There is deliberately **no write tool here**. Muting a finding is the act of
 * deciding an exception is acceptable, which is the one judgement this feature
 * exists to ask a human for; automating it would automate the thing away.
 * Creating a rule is defensible as a `propose` tool, but only once the proposal
 * can carry the rule's live preview ("matches 14 of 312") — a JSON filter tree
 * on a card is not something a reviewer can meaningfully approve.
 */
@Injectable()
export class AlarmsCopilotToolProvider implements ToolProvider, OnModuleInit {
    constructor(
        private readonly findings: AlarmFindingStore,
        @Optional() private readonly toolRegistry?: ToolRegistry
    ) {}

    /**
     * Register with the shared tool registry once the DI graph is built.
     * `@Optional()` because a deployment may run neither consumer, in which
     * case this simply goes unregistered.
     */
    onModuleInit(): void {
        this.toolRegistry?.register(this);
    }

    /** The one alarms read tool. */
    tools(): readonly ToolDefinition[] {
        return [this.findingsTool()];
    }

    private findingsTool(): ToolDefinition {
        return {
            name: 'admin_alarms_findings',
            title: 'List content alarm findings',
            description:
                'Lists the content problems flagged in this workspace by its ' +
                'alarm rules — a published record linking to a draft one, a ' +
                'missing cover image, anything a rule watches for. Each finding ' +
                'names the rule, what is wrong, the content type, and the ' +
                'entry id, so follow one up with admin_content_get. ' +
                'Findings never block a save or a publish: they are ' +
                'information, and severity only orders them. ' +
                'This returns everything currently flagged. Resolved findings ' +
                'are history and are excluded unless asked for by name.',
            inputSchema: {
                type: 'object',
                properties: {
                    state: {
                        type: 'string',
                        enum: [...FINDING_STATES],
                        description:
                            'Restrict to one state. Omitted, everything except ' +
                            '"resolved".'
                    },
                    severity: {
                        type: 'string',
                        enum: [...ALARM_SEVERITIES],
                        description:
                            'Restrict to one severity. "error" is the most ' +
                            'severe; none of the three blocks anything.'
                    },
                    ruleId: {
                        type: 'string',
                        description:
                            'Restrict to one rule, by the id a finding reports.'
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
                        description: `Findings per page (max ${MAX_TOOL_PAGE_SIZE}).`
                    }
                },
                additionalProperties: false
            },
            requires: [PERMISSIONS.ALARMS_READ],
            readOnly: true,
            effect: 'read',
            // See the class JSDoc: `alarms:read` is mintable by no token scope,
            // so on MCP this would list and never run.
            surfaces: ['copilot'],
            handler: (input, context) => this.run(input, context)
        };
    }

    /** Runs one call. */
    private async run(
        input: Record<string, unknown>,
        context: ToolContext
    ): Promise<FindingsToolOutput> {
        const args = (input ?? {}) as {
            state?: FindingState;
            severity?: AlarmSeverity;
            ruleId?: string;
            page?: number;
            pageSize?: number;
        };

        // Clamped here as well as declared in the schema: the validator is
        // defence in depth, not the boundary.
        const pageSize = Math.min(
            Math.max(args.pageSize ?? DEFAULT_TOOL_PAGE_SIZE, 1),
            MAX_TOOL_PAGE_SIZE
        );
        const page = Math.max(args.page ?? 1, 1);
        const filter = {
            ...(args.state ? { state: args.state } : {}),
            ...(args.severity ? { severity: args.severity } : {}),
            ...(args.ruleId ? { ruleId: args.ruleId } : {})
        };

        // The page and its severity tally are two reads of the *same*
        // predicate — `severityCounts` shares `list`'s `where` builder — so the
        // strip rendered above the list can never describe a different set from
        // the list itself.
        const [listed, bySeverity] = await Promise.all([
            this.findings.list(context.workspaceId, {
                ...filter,
                page,
                pageSize
            }),
            this.findings.severityCounts(context.workspaceId, filter)
        ]);

        return buildFindingsToolOutput({
            findings: listed.items,
            total: listed.total,
            bySeverity,
            page: listed.page,
            pageSize: listed.pageSize,
            now: new Date()
        });
    }
}
