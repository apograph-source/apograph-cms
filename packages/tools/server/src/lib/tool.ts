import type { PermissionKey } from '@orthacms/identity-server';

/**
 * A JSON Schema fragment. Tools declare their input shape as **plain JSON
 * Schema** rather than a validator's object model, because most of this CMS's
 * schema is runtime data — content types are defined in code and held in a
 * registry, so their shapes are computed at boot, not declared as classes.
 * `content/server`'s `docs/field-schema.ts` already produces exactly this for
 * the OpenAPI document; the MCP tool schemas reuse it.
 */
export type JsonSchema = Record<string, unknown>;

/** Who a tool call acts as. */
export type ToolActorKind = 'token' | 'user';

/**
 * The identity a tool call runs under — the transport-neutral half of "who is
 * asking". A bearer API token from the public API and a signed-in admin user
 * driving the copilot are the same shape here, which is what lets one tool
 * implementation serve both callers.
 *
 * `grantedPermissions` is resolved by whoever built the context (the MCP
 * endpoint's bearer auth, or the copilot's RBAC lookup) and is the **only**
 * input to the authorization decision — a tool never re-derives rights from
 * `id` or `userId`.
 */
export interface ToolActor {
    /** Whether this is a bearer token acting as itself, or a signed-in user. */
    kind: ToolActorKind;
    /**
     * The actor's own id — a token id or a user id. What a log line keys on.
     * For a token this is deliberately **not** the minting user: a token acts
     * as itself, so revoking it revokes its access whoever created it.
     */
    id: string;
    /** Display name, for diagnostics and audit lines. */
    displayName: string;
    /** The `resource:action` keys this actor holds. */
    grantedPermissions: ReadonlySet<string>;
    /**
     * The accountable human, when there is one — the user themselves, or the
     * user who minted a token. **Attribution only, never authorization.**
     */
    userId: string | null;
}

/**
 * Everything a tool handler is told about the call, beyond its own arguments.
 * Framework-free by design: no request, no response, nothing HTTP. A tool
 * written against this runs identically behind the MCP endpoint and inside the
 * copilot's in-process tool loop.
 */
export interface ToolContext {
    /** Who is calling. */
    actor: ToolActor;
    /** The workspace this call acts in — always resolved before dispatch. */
    workspaceId: string;
    /**
     * Aborted when the caller goes away, so a tool doing real I/O can give up
     * instead of finishing work nobody will read.
     *
     * Optional because only one consumer has one: the copilot's run is a live
     * SSE stream that ends when the browser disconnects, while an MCP call is a
     * request/response and finishes either way. A tool that ignores it is
     * correct — this is a courtesy, never a correctness boundary.
     */
    signal?: AbortSignal;
    /**
     * Which consumer dispatched this call — stamped by
     * {@link ToolRegistry.call}, so it is always the surface the call was
     * authorized against and never something the caller can assert.
     *
     * **For presentation only, never for authorization.** A tool offered to
     * both surfaces may need to render the same fact differently for each — a
     * download link is the session-gated admin route for the copilot and the
     * bearer-fetchable `/v1` one for MCP, because the two callers hold
     * different credentials. What a tool must *not* do is widen what it returns
     * or skip a check on one surface: that is a difference in authority, and
     * authority is `requires` plus {@link can}, which mean one thing for
     * everybody. A tool that finds itself wanting `if (surface === 'copilot')`
     * around a rule is two tools.
     *
     * Optional so a handler can be unit-tested with a hand-built context;
     * absent, treat it as the copilot's admin-facing rendering.
     */
    surface?: ToolSurface;
    /**
     * Whether the actor holds a permission. Handlers use this for decisions
     * **finer** than the tool's own `requires` gate — e.g. content reads let a
     * writer see drafts, which is a widening inside one tool rather than a
     * separate tool.
     */
    can(permission: PermissionKey): boolean;
}

/**
 * What running a tool does to the system — the **authority** vocabulary, as
 * distinct from the `readOnly`/`destructive` MCP *hints* below.
 *
 * `read` runs freely. `propose` produces a reviewable change a human accepts
 * ([ADR-0005](../../../../docs/adr/0005-copilot-authority-model.md) §5) — its
 * handler writes nothing, returning the change for its consumer to record.
 * `apply` writes directly, gated only by the caller's own permissions
 * ([ADR-0009](../../../../docs/adr/0009-copilot-applies-directly.md) §5 — it is
 * offered exactly when a `read` tool with the same `requires` would be). It
 * used to be off behind a workspace policy; ADR-0009 §4 deleted that policy,
 * and an `apply` tool is now something a run performs, not something an
 * operator opts into.
 *
 * Two vocabularies rather than one because they answer different questions.
 * `readOnly` tells an MCP client what is safe to auto-approve; `effect` tells
 * the *server* whether a handler's return value is a change or a result. A
 * `propose` tool is not read-only in the MCP sense (it is part of a write
 * flow), and a direct-write tool is not `propose` however destructive it is.
 */
export type ToolEffect = 'read' | 'propose' | 'apply';

/**
 * Which consumer of the registry a tool is offered to.
 *
 * Sharing the registry does **not** mean every tool suits every caller. The
 * MCP content tools read through the public API's published-only services and
 * attribute writes to a token; the copilot's read the admin's services (a
 * viewer must see drafts) and write through propose-then-apply with the human
 * as actor. Both are correct for their caller and wrong for the other, so the
 * tool declares who it is for rather than a filter elsewhere guessing.
 *
 * Omitted means **both** — the honest default for a tool with no such tension
 * (locales, media search), and the one that makes adding a genuinely shared
 * tool the path of least resistance.
 */
export type ToolSurface = 'mcp' | 'copilot';

/**
 * What a tool returns. A plain JSON-serializable value — the transport decides
 * how to present it (MCP wraps it as `structuredContent` plus a text rendering;
 * the copilot's loop will feed it back to the model as a tool result).
 */
export type ToolOutput = unknown;

/**
 * One callable tool. The unit every consumer of the registry sees.
 *
 * `requires` is the authorization contract and is enforced **centrally** by
 * {@link ToolRegistry.call}, exactly as `@RequirePermissions(...)` is enforced
 * by a guard on the HTTP routes — a handler never checks its own gate, so a new
 * tool cannot forget to. It is the direct analogue of the decorator, and the
 * reason a `read`-scoped token gets a refusal on every write tool without a
 * line of code here saying so.
 */
export interface ToolDefinition {
    /**
     * Machine name, `snake_case`, unique across every provider. Namespaced by
     * subject (`content_list`, `content_create`) so a second contributing
     * plugin's tools cannot read as the first's.
     */
    name: string;
    /** Short human title, shown by MCP clients in tool pickers. */
    title: string;
    /**
     * What the tool does, written **for a model**. This is the only
     * documentation the caller gets, so it carries the workflow rules the HTTP
     * API states in prose: that a create yields a draft, that publish is a
     * separate call, that an update merges.
     */
    description: string;
    /** JSON Schema for the arguments object. */
    inputSchema: JsonSchema;
    /**
     * Permissions the actor must hold — **all** of them. Checked before the
     * handler runs, and used to hide the tool from actors who cannot call it.
     */
    requires: readonly PermissionKey[];
    /**
     * True when the tool cannot modify anything. Surfaces as MCP's
     * `readOnlyHint`, which clients use to decide what to auto-approve.
     */
    readOnly: boolean;
    /**
     * What running this does to the system. Defaults to `read` when omitted,
     * which is what every tool written before the copilot joined the registry
     * meant — but say it explicitly on anything that writes.
     */
    effect?: ToolEffect;
    /**
     * Which consumers may be offered this tool. Omitted means both; see
     * {@link ToolSurface} for why a tool would ever narrow it.
     */
    surfaces?: readonly ToolSurface[];
    /**
     * True when the tool can destroy data an actor would not get back.
     * Surfaces as MCP's `destructiveHint`.
     */
    destructive?: boolean;
    /** Runs the tool. Throws to signal failure; see `toToolError`. */
    handler(
        input: Record<string, unknown>,
        context: ToolContext
    ): Promise<ToolOutput>;
}

/** One readable resource — a document a client can pull in without a call. */
export interface ResourceDefinition {
    /** Stable URI, e.g. `ortha://content-type/article`. */
    uri: string;
    /** Short human name. */
    name: string;
    /** What the resource holds. */
    description: string;
    /** MIME type of the contents, e.g. `application/json`. */
    mimeType: string;
    /**
     * Permissions the actor must hold to list **or read** this resource — all
     * of them, exactly as {@link ToolDefinition.requires}. Enforced centrally by
     * {@link ToolRegistry}, so a resource cannot forget its own gate.
     *
     * Omitted means "no gate beyond reaching the endpoint", which is what every
     * resource shipped today means: the content-type schemas are already
     * narrowed to the workspace's own grants by the provider that builds them,
     * and a resource that needs more than the workspace scope says so here
     * rather than re-implementing the check.
     */
    requires?: readonly PermissionKey[];
}

/** The body of a resource read. */
export interface ResourceContents {
    /** Echoes the requested URI. */
    uri: string;
    /** MIME type of {@link text}. */
    mimeType: string;
    /** The resource body. */
    text: string;
}
