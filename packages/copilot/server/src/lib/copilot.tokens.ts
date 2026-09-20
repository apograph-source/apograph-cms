import { Inject } from '@nestjs/common';

/**
 * DI tokens and their inject decorators for the copilot plugin. Kept in a
 * dependency-free module (imports only `@nestjs/common`) so providers and
 * services can reference them without forming an import cycle with
 * `copilot.module.ts`.
 *
 * The model-provider seam's tokens (`MODEL_REGISTRY`, `MODEL_RESOLVER`) live
 * in `@orthacms/copilot-domain` alongside the port they bind, so an adapter
 * package never has to import the server.
 */

/** Injection token for the resolved copilot configuration. */
export const COPILOT_CONFIG = Symbol('COPILOT_CONFIG');

/** Parameter decorator that injects the copilot configuration. */
export const InjectCopilotConfig = (): ParameterDecorator =>
    Inject(COPILOT_CONFIG);

/**
 * Optional override for the run engine's ceilings (`RunLimits`). Unbound, the
 * engine uses `DEFAULT_RUN_LIMITS`.
 *
 * A token rather than a defaulted constructor parameter: Nest resolves every
 * constructor argument positionally and does **not** honour a TypeScript
 * default, so `limits: RunLimits = DEFAULT_RUN_LIMITS` fails boot with an
 * unresolvable dependency at that index rather than quietly using the default.
 */
export const COPILOT_RUN_LIMITS = Symbol('COPILOT_RUN_LIMITS');

/**
 * The host's code-defined skills, as a built `SkillRegistry`.
 *
 * Always bound (an empty registry when the host declared none) rather than
 * optional: "this deployment ships no skills" and "the registry was not wired"
 * would otherwise be the same missing dependency, and only one of them is a
 * bug.
 */
export const COPILOT_SKILL_REGISTRY = Symbol('COPILOT_SKILL_REGISTRY');
