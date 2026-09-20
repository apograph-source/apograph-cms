/**
 * A `resource:action` permission key, as a plain string.
 *
 * Deliberately **not** imported from `@orthacms/identity-server`: this package
 * imports nothing, and the binder that declares a tool passes the real
 * `PERMISSIONS.*` constant, so the concrete union is still enforced at the one
 * place that matters — the tool declaration.
 */
export type ToolPermissionKey = string;

/**
 * The least this decision needs to know about a tool.
 *
 * Structural rather than an import of `@orthacms/tools-server`'s
 * `ToolDefinition`, because this package imports nothing — and because the
 * decision genuinely only reads these three fields. A real `ToolDefinition`
 * satisfies it, so the server passes the shared registry's tools straight in
 * and gets its own definitions back out.
 */
export interface AuthorizableTool {
    /** The tool's name — what a duplicate collides on. */
    name: string;
    /** Permission keys the caller must hold in full. */
    requires: readonly ToolPermissionKey[];
    /** What running it does. Absent reads as `read`. */
    effect?: 'read' | 'propose' | 'apply';
}

/**
 * The acting user, reduced to what an authority decision needs. Structurally
 * identical to identity's `Actor` on purpose — the server maps one to the other
 * so this package can stay import-free while the decision still runs off the
 * grants `PermissionsService.forRole` resolved.
 */
export interface CopilotActor {
    /** The acting user's id. */
    userId: string;
    /** The `resource:action` keys the actor's role grants. */
    grantedPermissions: ReadonlySet<ToolPermissionKey>;
}

/** Why a declared tool is not on offer for this run. */
export type WithheldReason =
    /** The caller lacks at least one of the tool's declared permissions. */
    | 'missing-permission'
    /** A later tool re-declared a name an earlier one already took. */
    | 'duplicate-name';

/** One tool that was declared but not offered, and the reason. */
export interface WithheldTool {
    /** The tool's name. */
    name: string;
    /** Why it was withheld. */
    reason: WithheldReason;
    /**
     * The permissions the caller was missing. Present only for
     * `missing-permission`, and used to explain the gap — never to the model,
     * which is not told the tool exists at all.
     */
    missing?: readonly ToolPermissionKey[];
}

/**
 * The tools one run may use, and what was left out.
 *
 * Recomputed per run and **never cached across a conversation** (ADR-0005 §2):
 * permissions can be revoked mid-thread, and a long chat must not carry stale
 * authority.
 */
export interface CapabilityProfile<
    T extends AuthorizableTool = AuthorizableTool
> {
    /** The tools offered to the model, in declaration order. */
    tools: readonly T[];
    /** What was declared but withheld, for logging and for the settings UI. */
    withheld: readonly WithheldTool[];
}

/** Inputs to {@link resolveCapabilityProfile}. */
export interface ResolveCapabilityProfileInput<
    T extends AuthorizableTool = AuthorizableTool
> {
    /** Every tool the shared registry offers this surface. */
    tools: readonly T[];
    /** The user the run acts as. */
    actor: CopilotActor;
}

/** The permissions `actor` is missing from `required`, in declaration order. */
function missingPermissions(
    actor: CopilotActor,
    required: readonly ToolPermissionKey[]
): ToolPermissionKey[] {
    return required.filter((key) => !actor.grantedPermissions.has(key));
}

/**
 * Derives the tool set a run may use — the **offer**-time gate, which
 * [ADR-0005](../../../../../docs/adr/0005-copilot-authority-model.md) §3 is
 * explicit is not an optimisation: a tool the model was never told about
 * cannot be requested, argued into existence, or refused at token cost.
 * Execution re-checks the same permissions against a freshly resolved session.
 *
 * **Permission is now the only gate**
 * ([ADR-0009](../../../../../docs/adr/0009-copilot-applies-directly.md)). There
 * was a second one — a per-workspace opt-in an `apply` tool had to appear in —
 * and removing it is the whole of that ADR: what a run may do is what the
 * caller's role may do, decided here and nowhere else.
 *
 * Pure and total — no I/O, no clock — so "a viewer is offered no write tools"
 * is a unit test rather than a promise.
 */
export function resolveCapabilityProfile<T extends AuthorizableTool>(
    input: ResolveCapabilityProfileInput<T>
): CapabilityProfile<T> {
    const tools: T[] = [];
    const withheld: WithheldTool[] = [];
    const claimed = new Set<string>();

    for (const tool of input.tools) {
        // First declaration of a name wins. A later one is dropped rather than
        // allowed to shadow it: MCP tools are namespaced precisely so they
        // cannot impersonate a native tool (ADR-0005 §8), and silently letting
        // the last registration win would undo that.
        if (claimed.has(tool.name)) {
            withheld.push({ name: tool.name, reason: 'duplicate-name' });
            continue;
        }
        claimed.add(tool.name);

        const missing = missingPermissions(input.actor, tool.requires);
        if (missing.length > 0) {
            withheld.push({
                name: tool.name,
                reason: 'missing-permission',
                missing
            });
            continue;
        }

        // No second gate on `effect`. A write tool is offered on the strength
        // of the permissions it declares, exactly like a read one — which is
        // what "the copilot can do what your role can do" has to mean if it is
        // to mean anything (ADR-0009).
        tools.push(tool);
    }

    return { tools, withheld };
}
