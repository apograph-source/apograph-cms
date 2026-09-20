import type { INestApplication } from '@nestjs/common';
import {
    createFakeProvider,
    type FakeTurn
} from '@orthacms/copilot-provider-fake';
import { ConversationRepository } from '@orthacms/copilot-server';
import {
    ToolRegistry,
    type ToolProvider,
    type ToolSurface
} from '@orthacms/tools-server';
import type {
    ModelCapabilities,
    ModelProvider,
    ModelRequest,
    ModelStreamEvent
} from '@orthacms/copilot-domain';

/** Models the harness advertises. Named so a "wrong model" test has a target. */
const MODELS = ['fake-1'] as const;

/**
 * The models the **second** registered provider advertises.
 *
 * A second backend exists so "which provider serves a run that names none?" is
 * a question with a wrong answer available. There is no `defaultProvider`
 * setting any more — the first registration serves it — and with one provider
 * registered that rule is unfalsifiable: every assertion passes whether the
 * engine reads the list, the request, or nothing at all.
 */
const ALT_MODELS = ['alt-1'] as const;

/**
 * The provider currently backing the harness. Replaced wholesale by
 * {@link scriptCopilot}, because `createFakeProvider` takes its script at
 * construction — deliberately, so a script cannot be mutated mid-run.
 */
let current = createFakeProvider({ models: [...MODELS] });

/** The same, for the second registration. Scripted with the same turns. */
let currentAlt = createFakeProvider({ models: [...ALT_MODELS] });

/**
 * The provider registered with `CopilotPlugin` in `buildTestPlugins`.
 *
 * A **stable delegating facade** rather than the fake itself: the plugin list
 * is built once per spec file, but each test needs its own script, so the
 * object handed to the plugin has to outlive the fake it forwards to. Jest
 * isolates module registries per spec file, so `current` is per-file — one
 * suite can never see another's script or call log.
 */
export const fakeProvider: ModelProvider = {
    models: () => current.models(),
    capabilities: (model?: string): Promise<ModelCapabilities> =>
        current.capabilities(model),
    stream: (
        request: ModelRequest,
        signal?: AbortSignal
    ): AsyncIterable<ModelStreamEvent> => current.stream(request, signal)
};

/**
 * The **second** provider registered with `CopilotPlugin`, after
 * {@link fakeProvider}.
 *
 * Registered purely so registration *order* is observable: it is what a run
 * naming no provider must NOT be served by, and what one naming `fake-alt`
 * must be. It runs the same script — a test that switches provider is asking
 * about routing, not about a different answer — and advertises its own model
 * id, which is how the assertion tells the two apart.
 */
export const fakeAltProvider: ModelProvider = {
    models: () => currentAlt.models(),
    capabilities: (model?: string): Promise<ModelCapabilities> =>
        currentAlt.capabilities(model),
    stream: (
        request: ModelRequest,
        signal?: AbortSignal
    ): AsyncIterable<ModelStreamEvent> => currentAlt.stream(request, signal)
};

/**
 * Scripts the turns the model will "produce", one per model call, and clears
 * the previous call log. Call it in each test, before the request.
 *
 * Running past the end of a script **throws** rather than inventing a turn, so
 * a test that triggers one model call more than it scripted fails loudly
 * instead of passing against a fabricated answer.
 */
export function scriptCopilot(...turns: FakeTurn[]): void {
    current = createFakeProvider({ script: turns, models: [...MODELS] });
    // The second provider gets the same turns, so a test that routes to it
    // scripts nothing extra — and each fake keeps its own call log, which is
    // what makes `copilotCalls()` still mean "what the FIRST provider served".
    currentAlt = createFakeProvider({ script: turns, models: [...ALT_MODELS] });
}

/**
 * Drop the current script and call log. Registered as a global `afterEach` by
 * `jest.setup.ts`, so no test can inherit another's.
 *
 * Without it a test that *forgot* to script — a deleted nested `beforeEach`, a
 * new case pasted into an existing block — silently ran against the previous
 * test's turns and asserted against the previous test's call log. It passed, and
 * it proved nothing. With the reset, the empty script makes the fake throw on
 * the first model call, which is the loud failure the fake is designed for.
 */
export function resetCopilot(): void {
    current = createFakeProvider({ script: [], models: [...MODELS] });
    currentAlt = createFakeProvider({ script: [], models: [...ALT_MODELS] });
}

/**
 * Every `ModelRequest` served since the last {@link scriptCopilot}.
 *
 * This is the assertion target for the negative path ADR-0005 makes mandatory:
 * *a viewer's run must be verified not to be offered write tools.* That is an
 * assertion about `copilotCalls()[0].tools` — made without a model, and true of
 * the offer itself rather than of what the model happened to do with it.
 */
export function copilotCalls(): readonly ModelRequest[] {
    return current.calls;
}

/** As {@link copilotCalls}, for the second registered provider. */
export function copilotAltCalls(): readonly ModelRequest[] {
    return currentAlt.calls;
}

/**
 * Registers a tool provider with the running app's copilot registry — the same
 * call `content-server` makes from its own `onModuleInit`.
 *
 * Lives in the harness rather than in a spec because `src/support/**` is the
 * only place exempt from `@nx/enforce-module-boundaries`; specs are not, and a
 * static `@orthacms/copilot-server` import in one is a lint error.
 */
export function registerCopilotTools(
    app: INestApplication,
    provider: ToolProvider
): void {
    app.get(ToolRegistry).register(provider);
}

/**
 * Every tool name the running app's **shared registry** holds for `surface`,
 * sorted.
 *
 * Reads the registry itself rather than a surface's HTTP catalogue, which is
 * the only way to ask the question `copilot:I-34` poses: with the copilot
 * unmounted there is no run to inspect, so "the registry is unchanged" can be
 * asserted for the copilot's own tools only from inside DI. Sorted because
 * registration order is a provider-discovery detail, not a contract — a test
 * comparing two apps should go red on a *missing or extra* tool, never on a
 * reordered one.
 *
 * Lives here for the same reason {@link registerCopilotTools} does:
 * `src/support/**` is the only place exempt from
 * `@nx/enforce-module-boundaries`.
 */
export function registryToolNames(
    app: INestApplication,
    surface: ToolSurface
): string[] {
    return app
        .get(ToolRegistry)
        .forSurface(surface)
        .map((tool) => tool.name)
        .sort();
}

/**
 * The code-defined skills the harness boots with, mirroring what a host
 * declares in `plugins.ts`.
 *
 * Two, and they differ in the one dimension that changes behaviour: `always` is
 * in force whether or not a run asks for it, `manual` only when someone
 * attaches it. A suite that only had one could not tell those apart.
 */
export const testCodeSkills = [
    {
        name: 'house-style',
        title: 'House style',
        description: 'How this deployment writes product copy.',
        mode: 'always' as const,
        instructions: 'ALWAYS-ON-SKILL-BODY: write in sentence case.'
    },
    {
        name: 'seo-checklist',
        title: 'SEO checklist',
        description: 'What to check before publishing.',
        mode: 'manual' as const,
        instructions: 'MANUAL-SKILL-BODY: check the meta description.'
    }
];

/** One run's audit rows — the surface a security review reads. */
export function copilotToolCallRows(app: INestApplication, runId: string) {
    return app.get(ConversationRepository).toolCalls(runId);
}
