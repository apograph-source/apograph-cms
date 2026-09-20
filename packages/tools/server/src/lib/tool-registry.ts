import {
    ForbiddenException,
    Injectable,
    NotFoundException,
    UnprocessableEntityException,
    type OnApplicationBootstrap
} from '@nestjs/common';
import { PERMISSION_KEYS } from '@orthacms/identity-server';
import type {
    ResourceContents,
    ResourceDefinition,
    ToolContext,
    ToolDefinition,
    ToolOutput,
    ToolSurface
} from './tool';
import type { ToolProvider } from './tool-provider';
import { validateToolInput } from './validate-tool-input';

/**
 * The shape a tool name must have — `snake_case`, lowercase, no leading,
 * trailing or doubled underscores. Checked at boot rather than trusted, because
 * every deviation is silent: a padded name registers and is callable only by
 * sending the padding back, and `Content_List` next to `content_list` is two
 * live tools one letter apart.
 */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** The permission keys this deployment actually defines. */
const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(PERMISSION_KEYS);

/** A non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Split one `path: message` validation error into the per-field shape the rest
 * of the API's 422s carry, so a model reads a registry refusal exactly as it
 * reads a content plugin's.
 */
function toIssue(error: string): { field: string; message: string } {
    const at = error.indexOf(': ');
    return at === -1
        ? { field: 'input', message: error }
        : { field: error.slice(0, at), message: error.slice(at + 2) };
}

/**
 * The shared, transport-neutral catalogue of everything an agent can do to this
 * CMS — and the **single place** a tool call is authorized.
 *
 * Two consumers, one registry: the MCP endpoint exposes it to external clients
 * (Claude Desktop, Cursor, an agent framework), and the copilot's in-process
 * tool loop will inject the very same instance. That is the whole reason
 * nothing on {@link ToolDefinition} or {@link ToolContext} mentions HTTP or
 * JSON-RPC — a tool added for one consumer is automatically available to the
 * other, and neither can end up with a private set of rules.
 *
 * **The authorization invariant.** `call()` checks `requires` before dispatch,
 * and `visibleTo()` merely *hides* what the actor could not call anyway.
 * Filtering a list is a usability nicety; the check in `call()` is the security
 * boundary, and it must stay that way — an MCP client is free to invoke a tool
 * name it was never shown, and the copilot may hallucinate one outright.
 */
@Injectable()
export class ToolRegistry implements OnApplicationBootstrap {
    private readonly providers: ToolProvider[] = [];

    /**
     * Add a provider's contributions. Called by each capability plugin from
     * `onModuleInit`; see {@link ToolProvider} for why this is a call rather
     * than a DI multi-binding.
     *
     * **Idempotent per provider instance.** Registration is a call, so nothing
     * stops a plugin making it twice — an `onModuleInit` that also runs on a
     * re-created testing module, a provider bound in two modules. Pushing the
     * same instance twice would make every one of its tools collide with
     * itself and take the *whole* catalogue down, on both surfaces, for a
     * mistake that changes nothing. Registering the same provider again is
     * therefore a no-op; two *different* providers claiming one name is still
     * the wiring bug {@link onApplicationBootstrap} refuses to boot with.
     */
    register(provider: ToolProvider): void {
        if (this.providers.includes(provider)) {
            return;
        }
        this.providers.push(provider);
    }

    /**
     * Validate the assembled catalogue **once, at boot**.
     *
     * Every problem below used to surface at the first `tools/list` or
     * `tools/call` instead — a duplicate name took both surfaces down at
     * runtime while boot reported success, and a tool whose `requires` names a
     * permission no role grants (a raw string literal gone stale, a stray
     * space) simply became invisible and uncallable with nothing said. Both are
     * wiring bugs, and a wiring bug belongs to the deploy, not to the first
     * caller unlucky enough to hit it.
     *
     * `OnApplicationBootstrap` rather than `register()` because every
     * capability plugin registers from `onModuleInit`, and a provider's
     * `tools()` may depend on state (the content-type registry) that is only
     * complete once every module has initialized. Throwing here aborts
     * `app.init()`, so the process never starts serving.
     */
    onApplicationBootstrap(): void {
        const problems = this.catalogueProblems();
        if (problems.length > 0) {
            throw new Error(
                `The agent tool catalogue is invalid:\n- ${problems.join(
                    '\n- '
                )}`
            );
        }
    }

    /**
     * Every registered tool, in registration order.
     *
     * A duplicate name is a **wiring bug** — two plugins claiming one tool name
     * would make which implementation runs depend on registration order — so it
     * fails loudly here rather than resolving silently. This is the backstop:
     * {@link onApplicationBootstrap} refuses to boot with one, so the only way
     * to reach this throw is a provider whose `tools()` starts colliding after
     * boot.
     */
    all(): readonly ToolDefinition[] {
        const tools: ToolDefinition[] = [];
        const seen = new Set<string>();
        for (const provider of this.providers) {
            for (const tool of provider.tools()) {
                if (seen.has(tool.name)) {
                    throw new Error(
                        `Duplicate tool name "${tool.name}" — two providers registered it. Tool names must be unique across plugins.`
                    );
                }
                seen.add(tool.name);
                tools.push(tool);
            }
        }
        return tools;
    }

    /**
     * Every tool offered to one **surface** — the MCP endpoint or the copilot.
     *
     * A tool that names no surfaces is offered to both, so this narrows only
     * the ones that declared a reason to be narrowed (see {@link ToolSurface}).
     */
    forSurface(surface: ToolSurface): readonly ToolDefinition[] {
        return this.all().filter(
            (tool) => !tool.surfaces || tool.surfaces.includes(surface)
        );
    }

    /**
     * The tools `context`'s actor holds the permissions for, on one surface.
     * What a client is shown — a read-only token never learns that
     * `content_create` exists, which is a far better experience than
     * discovering it via a refusal, and keeps a model from burning turns on
     * calls that cannot succeed.
     */
    visibleTo(
        context: ToolContext,
        surface: ToolSurface
    ): readonly ToolDefinition[] {
        return this.forSurface(surface).filter((tool) =>
            this.permits(tool, context)
        );
    }

    /**
     * Authorize, validate and run one tool.
     *
     * An unknown name and a name the actor may not call are deliberately
     * **different** answers: the tool set is not secret (it is the same for
     * every actor of a given scope, and documented), so conflating them would
     * only make a legitimate permission problem undiagnosable. What is never
     * revealed is *data* — that distinction lives in the handlers, where an
     * ungranted content type 404s exactly like an unknown one.
     *
     * Arguments are checked against the tool's own `inputSchema` before
     * dispatch (see {@link validateToolInput} for the subset that covers, and
     * the keywords it deliberately ignores). It is not a security boundary —
     * `requires` is — but it is what keeps a caller's malformed arguments from
     * reaching a handler and coming back as an opaque 500 instead of a
     * `validation_failed` naming the field.
     */
    async call(
        name: string,
        input: Record<string, unknown> | undefined,
        context: ToolContext,
        surface: ToolSurface
    ): Promise<ToolOutput> {
        // Scoped to the surface, so a caller cannot invoke a tool the *other*
        // consumer's rules were written for — an MCP client naming
        // `content_propose_edit` gets "unknown tool", not a proposal it has no
        // way to accept.
        const tool = this.forSurface(surface).find(
            (candidate) => candidate.name === name
        );
        if (!tool) {
            throw new NotFoundException(`Unknown tool "${name}".`);
        }
        if (!this.permits(tool, context)) {
            throw new ForbiddenException(
                `"${name}" requires ${tool.requires.join(', ')}, which this ${
                    context.actor.kind === 'token' ? 'token' : 'user'
                } does not hold.`
            );
        }
        // Defaulted here rather than at each edge. Both shipped consumers
        // already compensate for a missing arguments object (`args ?? {}` in
        // the MCP adapter, `call.input ?? {}` in the run engine) — for a
        // parameter this signature types as an object, that is a defence the
        // registry owes them, not one each has to remember.
        const args = input ?? {};
        // Authorization first, validation second: a caller who may not run the
        // tool learns nothing about its arguments, and the answer to an
        // unauthorized call is the same whatever it sent.
        const validation = validateToolInput(args, tool.inputSchema);
        if (!validation.valid) {
            throw new UnprocessableEntityException({
                message: `Invalid arguments for "${name}".`,
                issues: validation.errors.map(toIssue)
            });
        }
        // Stamped here rather than at the edge that built the context, so the
        // surface a handler sees is by construction the one its `surfaces` was
        // narrowed against — a tool cannot be authorized as one consumer and
        // rendered for the other. See `ToolContext.surface` for what a handler
        // may and may not do with it.
        return tool.handler(args, { ...context, surface });
    }

    /**
     * Every resource visible to the actor, across providers — permission
     * filtered, exactly as {@link visibleTo} filters tools.
     */
    async resources(
        context: ToolContext
    ): Promise<readonly ResourceDefinition[]> {
        return (await this.declaredResources(context)).filter((resource) =>
            this.permitsResource(resource, context)
        );
    }

    /**
     * Read one resource. Providers are asked in registration order and the
     * first that claims the URI wins; nobody claiming it is a 404.
     *
     * A declared resource's `requires` is checked **here, before any provider
     * is asked for the bytes** — the same rule as {@link call}, for the same
     * reason: `resources()` hiding a resource is a listing nicety, and a client
     * is free to read a URI it was never shown. The extra enumeration is the
     * price of the gate; `resources/read` is not a hot path, and a provider
     * that declares no resources costs nothing.
     */
    async readResource(
        uri: string,
        context: ToolContext
    ): Promise<ResourceContents> {
        const declared = (await this.declaredResources(context)).find(
            (resource) => resource.uri === uri
        );
        if (declared && !this.permitsResource(declared, context)) {
            throw new ForbiddenException(
                `"${uri}" requires ${(declared.requires ?? []).join(
                    ', '
                )}, which this ${
                    context.actor.kind === 'token' ? 'token' : 'user'
                } does not hold.`
            );
        }
        for (const provider of this.providers) {
            const contents = await provider.readResource?.(uri, context);
            if (contents) {
                return contents;
            }
        }
        throw new NotFoundException(`Unknown resource "${uri}".`);
    }

    /** Every resource every provider declares, before permission filtering. */
    private async declaredResources(
        context: ToolContext
    ): Promise<readonly ResourceDefinition[]> {
        const perProvider = await Promise.all(
            this.providers.map(
                (provider) => provider.resources?.(context) ?? []
            )
        );
        return perProvider.flat();
    }

    /** Whether the actor holds every permission the tool requires. */
    private permits(tool: ToolDefinition, context: ToolContext): boolean {
        return tool.requires.every((permission) => context.can(permission));
    }

    /**
     * Whether the actor holds every permission the resource requires. A
     * resource that declares none is readable by anyone who reached the
     * endpoint, which is what every shipped resource means today.
     */
    private permitsResource(
        resource: ResourceDefinition,
        context: ToolContext
    ): boolean {
        return (resource.requires ?? []).every((permission) =>
            context.can(permission)
        );
    }

    /**
     * Everything wrong with the registered catalogue, as human sentences.
     *
     * Reported all at once rather than throwing on the first, so a deploy that
     * broke two things learns about both.
     */
    private catalogueProblems(): string[] {
        const problems: string[] = [];
        const seen = new Set<string>();
        for (const provider of this.providers) {
            for (const tool of provider.tools()) {
                if (seen.has(tool.name)) {
                    problems.push(
                        `duplicate tool name "${tool.name}" — two providers registered it. Tool names must be unique across plugins.`
                    );
                }
                seen.add(tool.name);
                problems.push(...this.toolProblems(tool));
            }
        }
        return problems;
    }

    /** Everything wrong with one tool definition. */
    private toolProblems(tool: ToolDefinition): string[] {
        const problems: string[] = [];
        if (!TOOL_NAME_PATTERN.test(tool.name)) {
            problems.push(
                `"${tool.name}" is not a valid tool name — names are snake_case (${TOOL_NAME_PATTERN.source}).`
            );
        }
        if (tool.surfaces && tool.surfaces.length === 0) {
            problems.push(
                `"${tool.name}" declares an empty \`surfaces\` array, so it is offered to neither consumer and callable by none. Omit the field to share it.`
            );
        }
        if (!Array.isArray(tool.requires)) {
            problems.push(
                `"${tool.name}" has no \`requires\` array — a tool declares its permissions even when the answer is \`[]\`.`
            );
        } else {
            for (const permission of tool.requires) {
                if (!KNOWN_PERMISSIONS.has(permission)) {
                    problems.push(
                        `"${tool.name}" requires "${permission}", which is not a permission this deployment defines. Use a PERMISSIONS.* constant — a raw literal goes stale silently and leaves the tool uncallable by everyone.`
                    );
                }
            }
        }
        if (!isPlainObject(tool.inputSchema)) {
            problems.push(
                `"${tool.name}" has no \`inputSchema\` object. Declare \`{ type: 'object', properties: {} }\` for a tool that takes no arguments.`
            );
        } else if (
            tool.inputSchema['type'] !== undefined &&
            tool.inputSchema['type'] !== 'object'
        ) {
            problems.push(
                `"${tool.name}" declares an \`inputSchema\` of type "${String(
                    tool.inputSchema['type']
                )}" — tool arguments are always an object.`
            );
        }
        return problems;
    }
}
