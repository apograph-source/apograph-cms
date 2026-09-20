import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
    MODEL_RESOLVER,
    type ModelRegistry,
    type ModelResolver,
    type ModelProvider
} from '@orthacms/copilot-domain';
import { CopilotModule } from './copilot.module';
import type { ProviderRegistration } from './infrastructure/model-registry';
import type { CopilotPluginConfig } from './types/copilot-config';

const provider = (models: string[]): ModelProvider => ({
    models: () => models,
    capabilities: async (model?: string) => ({
        model: model ?? models[0],
        toolCalling: true,
        streaming: true,
        vision: false,
        contextWindow: 1_000,
        maxOutputTokens: 100
    }),
    // eslint-disable-next-line require-yield
    stream: async function* () {
        throw new Error('not called');
    }
});

const config: CopilotPluginConfig = { enabled: true, maxOutputTokens: 1_024 };

const registrations: ProviderRegistration[] = [
    { name: 'claude', provider: provider(['big', 'small']) },
    { name: 'ollama', provider: provider(['llama3.1']) },
    { name: 'local', provider: provider(['llama3.1-70b']) }
];

/** The bound resolver, as DI would hand it to the engine. */
function resolverOf(providers: readonly ProviderRegistration[]): ModelResolver {
    const module = CopilotModule.forRoot({ providers, config });
    const bound = (module.providers ?? []).find(
        (entry): entry is { provide: symbol; useValue: ModelResolver } =>
            typeof entry === 'object' &&
            'provide' in entry &&
            entry.provide === MODEL_RESOLVER
    );
    if (!bound) {
        throw new Error('MODEL_RESOLVER was not bound');
    }
    return bound.useValue;
}

const ctx = { workspaceId: 'w1', userId: 'u1' };
const registry = {} as ModelRegistry;

/**
 * Which provider serves a run that names none. There is no `defaultProvider`
 * setting to answer that — the **registered list is the setting**, and its
 * order is the answer, so a host cannot name a backend it never registered and
 * cannot leave a name behind when it changes the list.
 */
describe('CopilotModule provider defaulting', () => {
    it('serves a run naming no provider from the first registered one', () => {
        expect(resolverOf(registrations)(ctx, registry)).toBe('claude');
    });

    it('follows the list when the host reorders it', () => {
        expect(resolverOf([...registrations].reverse())(ctx, registry)).toBe(
            'local'
        );
    });

    it("prefers the host's own resolver over the first entry", () => {
        const module = CopilotModule.forRoot({
            providers: registrations,
            resolve: () => 'ollama',
            config
        });
        const bound = (module.providers ?? []).find(
            (entry): entry is { provide: symbol; useValue: ModelResolver } =>
                typeof entry === 'object' &&
                'provide' in entry &&
                entry.provide === MODEL_RESOLVER
        );

        expect(bound?.useValue(ctx, registry)).toBe('ollama');
    });

    /**
     * An enabled copilot with nothing to call is a misconfiguration, and this
     * is the last place to catch it before the first chat message. It is only a
     * misconfiguration when the copilot is **on**: there is no scripted offline
     * adapter registered any more, so a deployment that configured no backend
     * reaches this constructor with an empty list, and that is the ordinary
     * state of a fresh checkout.
     */
    it('refuses to build with no providers once the copilot is on', () => {
        expect(() => CopilotModule.forRoot({ providers: [], config })).toThrow(
            /enabled but has no model provider/
        );
    });

    it('builds with no providers while the copilot is off', () => {
        expect(() =>
            CopilotModule.forRoot({
                providers: [],
                config: { ...config, enabled: false }
            })
        ).not.toThrow();
    });
});

/**
 * The operator's kill switch, applied where MCP applies its own: a disabled
 * deployment registers no controller, so every `/api/copilot/*` route 404s.
 *
 * It used to be read in one place only — `RunEngine.run` — which made "off"
 * mean *the send button returns an error frame*, with the model catalogue, the
 * conversation and skill routes and both admin surfaces still live behind it.
 */
describe('CopilotModule kill switch', () => {
    it('registers the routes when the copilot is on', () => {
        const module = CopilotModule.forRoot({
            providers: registrations,
            config: { ...config, enabled: true }
        });

        expect(module.controllers?.length).toBeGreaterThan(0);
    });

    it('registers no controller at all when it is off [copilot:I-34]', () => {
        const module = CopilotModule.forRoot({
            providers: registrations,
            config: { ...config, enabled: false }
        });

        expect(module.controllers).toEqual([]);
    });

    it('still binds the model registry and resolver when it is off', () => {
        // The switch takes away the *routes*, not the wiring. A disabled
        // deployment must still construct: the module is global, the shared
        // `ToolsModule` is imported rather than provided, and the MCP endpoint
        // serves the same tool catalogue either way.
        const module = CopilotModule.forRoot({
            providers: registrations,
            config: { ...config, enabled: false }
        });

        expect(module.imports).toBeDefined();
        expect(
            (module.providers ?? []).some(
                (entry) =>
                    typeof entry === 'object' &&
                    'provide' in entry &&
                    entry.provide === MODEL_RESOLVER
            )
        ).toBe(true);
    });
});

/**
 * Every route the module registers, as `METHOD path`.
 *
 * Read off the decorators rather than off a booted app, because the claim is
 * about what exists at all — and a route that exists is a route somebody can
 * reach, whatever a running instance happens to have mounted.
 */
function routesOf(controllers: readonly unknown[]): string[] {
    return controllers.flatMap((entry) => {
        const controller = entry as Type<object>;
        const base = Reflect.getMetadata(PATH_METADATA, controller) ?? '';
        const proto = controller.prototype as object;
        return Object.getOwnPropertyNames(proto)
            .filter((name) => name !== 'constructor')
            .flatMap((name) => {
                const handler = Object.getOwnPropertyDescriptor(proto, name)
                    ?.value as object | undefined;
                if (!handler) return [];
                const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
                    | number
                    | undefined;
                if (verb === undefined) return [];
                const path = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
                return [`${RequestMethod[verb]} ${base}/${path}`];
            });
    });
}

/**
 * **A conversation is archived, never deleted, and a skill is deleted.**
 *
 * The disjointness half of the invariant is pinned by the e2e suite, which
 * archives a thread and watches it move between two lists. The other half is
 * made of an *absence*, and no test that drives the API can see one: a suite
 * exercising the routes that exist says nothing about a route that does not,
 * and the day somebody adds `DELETE /conversations/:id` — the obvious companion
 * to the archive toggle — every existing case stays green while the receipts
 * for changes already made to somebody's content acquire a delete button.
 *
 * So the assertion is over the router itself, and it is exhaustive rather than
 * a `not.toContain`: the skills delete is named, which is what stops this from
 * passing for the trivial reason that the copilot registers no DELETE at all.
 */
describe('CopilotModule routes', () => {
    const routes = routesOf(
        CopilotModule.forRoot({ providers: registrations, config })
            .controllers ?? []
    );

    it('reads the routes at all', () => {
        // The guard on the guard: reflection that found nothing would make
        // every claim below vacuous.
        expect(routes).toContain('GET copilot/conversations');
        expect(routes).toContain('GET copilot/conversations/:id');
        expect(routes.length).toBeGreaterThan(8);
    });

    it('deletes a skill and never a conversation [copilot:I-33]', () => {
        expect(routes.filter((route) => route.startsWith('DELETE'))).toEqual([
            'DELETE copilot/skills/:id'
        ]);
        // Archiving is the removal, and it is the PATCH.
        expect(routes).toContain('PATCH copilot/conversations/:id');
    });
});
