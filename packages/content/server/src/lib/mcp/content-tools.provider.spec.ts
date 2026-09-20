import { NotFoundException } from '@nestjs/common';
import type { ToolContext, ToolDefinition } from '@orthacms/tools-server';
import type { ContentTypeRegistry } from '../registry/content-type-registry';
import type { WorkspaceGrantsQuery } from '../content-types/queries/workspace-grants.query';
import type { PublicEntriesQuery } from '../public-api/infrastructure/public-entries.query';
import type { PublicEntryWritesService } from '../public-api/infrastructure/public-entry-writes.service';
import { ContentToolProvider } from './content-tools.provider';

/**
 * The grant gate on the **resource** path.
 *
 * `resources/read` is the one way into this provider that does not pass through
 * `ToolRegistry.call`, so it is the one place a missing check would not be
 * caught by the tool authorization the registry owns. The rule
 * (`mcp:I-23`) is deliberately narrow: a content type the workspace was **not
 * granted** must answer a `resources/read` exactly as a type that does not
 * exist, so a client cannot enumerate the content model by asking for schemas
 * one URI at a time.
 *
 * ## Why the fixture is shaped the way it is
 *
 * "Indistinguishable" is a claim about **one name asked in two worlds**, not
 * about two names asked in one. The refusal embeds the name that was asked for
 * (`Unknown content type "x".`), so comparing the answer for an ungranted `x`
 * against the answer for an unknown `y` compares two sentences that differ by
 * construction and proves nothing either way. So each case below builds two
 * providers — one where `test_ungranted` is registered and withheld, one where
 * it was never registered — and asks both for the same URI.
 *
 * That distinction is exactly what the server-e2e suite is missing today: its
 * `-32002` case reads `ortha://content-type/never_granted`, a name no registry
 * holds, which pins *unknown URI* and would pass unchanged against a
 * `readResource` that consulted no grant set at all. Only a type that exists
 * and was withheld can tell the gate apart from its absence.
 */

/** A serialized type as the registry hands it over, minimal but real-shaped. */
const serialized = (name: string) => ({
    name,
    label: name,
    kind: 'collection' as const,
    publishable: false,
    localized: false,
    softDelete: false,
    fields: []
});

/** A provider, plus the record of what its registry was asked to serialize. */
interface World {
    provider: ContentToolProvider;
    /** Every type name `describeType` reached the registry for. */
    serializedNames: string[];
}

/**
 * A provider over a registry holding `registered` and a workspace granted
 * `granted`.
 */
function world(registered: string[], granted: string[]): World {
    const serializedNames: string[] = [];

    const registry = {
        get: (name: string) =>
            registered.includes(name) ? { name } : undefined,
        summaries: () => registered.map(serialized),
        serialize: (name: string) => {
            serializedNames.push(name);
            return registered.includes(name) ? serialized(name) : undefined;
        }
    } as unknown as ContentTypeRegistry;

    const grants = {
        grantedSlugs: async () => new Set(granted)
    } as unknown as WorkspaceGrantsQuery;

    // Neither entry service is reachable from the two paths under test:
    // `content_type_get` and `readResource` go registry + grants and stop. A
    // stub that throws says so loudly if that ever stops being true.
    const unreachable = new Proxy(
        {},
        {
            get() {
                throw new Error(
                    'the schema paths must not reach the entry services'
                );
            }
        }
    );

    return {
        provider: new ContentToolProvider(
            registry,
            grants,
            unreachable as PublicEntriesQuery,
            unreachable as PublicEntryWritesService
        ),
        serializedNames
    };
}

/** The type is registered but the workspace was never granted it. */
const withheld = () =>
    world(['test_granted', 'test_ungranted'], ['test_granted']);

/** The same name, in a deployment where no such content type was ever defined. */
const nonexistent = () => world(['test_granted'], ['test_granted']);

const UNGRANTED_URI = 'ortha://content-type/test_ungranted';

/** A context holding every permission, so nothing but the grant gate can refuse. */
function context(): ToolContext {
    return {
        actor: {
            kind: 'token',
            id: 'token-1',
            displayName: 'test token',
            grantedPermissions: new Set<string>(),
            userId: null
        },
        workspaceId: 'workspace-1',
        surface: 'mcp',
        can: () => true
    };
}

/** The error a call threw, or `null` if it did not throw. */
async function refusal(run: () => Promise<unknown>): Promise<Error | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

describe('ContentToolProvider resource reads', () => {
    it('serves the schema of a type the workspace was granted', async () => {
        // The control. Without it every assertion below is satisfied by a
        // `readResource` that refuses everything, which is not the invariant —
        // and the "was it serialized?" recorder would never fire.
        const { provider, serializedNames } = withheld();

        await expect(
            provider.readResource(
                'ortha://content-type/test_granted',
                context()
            )
        ).resolves.toMatchObject({
            uri: 'ortha://content-type/test_granted',
            mimeType: 'application/json'
        });
        expect(serializedNames).toEqual(['test_granted']);
    });

    it('refuses a type that exists but was not granted [mcp:I-23]', async () => {
        const error = await refusal(() =>
            withheld().provider.readResource(UNGRANTED_URI, context())
        );

        expect(error).toBeInstanceOf(NotFoundException);
    });

    it('answers it exactly as a deployment where the type never existed [mcp:I-23]', async () => {
        // The same URI, asked of two worlds that differ only in whether the
        // type is defined at all. Both answers must be the same class and the
        // same sentence: a refusal that said "not granted", or named the type
        // as known-but-withheld, would let a client walk the content model one
        // schema URI at a time.
        const viaWithheld = await refusal(() =>
            withheld().provider.readResource(UNGRANTED_URI, context())
        );
        const viaNonexistent = await refusal(() =>
            nonexistent().provider.readResource(UNGRANTED_URI, context())
        );

        expect(viaWithheld).toBeInstanceOf(NotFoundException);
        expect(viaNonexistent).toBeInstanceOf(NotFoundException);
        expect(viaWithheld?.message).toBe(viaNonexistent?.message);
    });

    it('answers a resource read exactly as it answers the equivalent tool call [mcp:I-23]', async () => {
        // The invariant's own wording: an ungranted type 404s on
        // `resources/read` *exactly as it does on a tool call*.
        // `content_type_get` returns the same schema for the same type, so it
        // is the tool to compare against — a resource path resolving through
        // anything but the tools' own gate would drift from it here.
        const { provider } = withheld();
        const typeGet = provider
            .tools()
            .find(
                (tool: ToolDefinition) => tool.name === 'content_type_get'
            ) as ToolDefinition;

        const viaTool = await refusal(() =>
            typeGet.handler({ typeName: 'test_ungranted' }, context())
        );
        const viaResource = await refusal(() =>
            provider.readResource(UNGRANTED_URI, context())
        );

        expect(viaTool).toBeInstanceOf(NotFoundException);
        expect(viaResource).toBeInstanceOf(NotFoundException);
        expect(viaResource?.message).toBe(viaTool?.message);
    });

    it('builds no schema for a type it is about to refuse [mcp:I-23]', async () => {
        // The ordering half, at the provider. `describeType` is what turns a
        // registered type into bytes, and it must not run for a type the grant
        // set withheld: a gate applied to the *result* would answer the same
        // 404 having already assembled the schema. The granted case above
        // proves the recorder fires when the read does go through.
        const { provider, serializedNames } = withheld();

        await refusal(() => provider.readResource(UNGRANTED_URI, context()));

        expect(serializedNames).toEqual([]);
    });

    it('claims no uri outside its own prefix', async () => {
        // The registry walks every provider until one answers, so returning
        // `undefined` for a foreign URI is what lets another provider own it —
        // and what makes the registry's own "Unknown resource" 404 reachable.
        await expect(
            withheld().provider.readResource(
                'ortha://media-asset/1',
                context()
            )
        ).resolves.toBeUndefined();
    });
});

/**
 * That the handlers **delegate** rather than re-implement.
 *
 * The claim (`mcp:I-19`) is "no content rule is rewritten here: the handlers
 * call the same `resolveGrantedType`, `PublicEntriesQuery` and
 * `PublicEntryWritesService` the HTTP controllers do, and validate with the
 * real DTOs." It reads like a statement about the call graph, and a judgment
 * once retired it as one — no harness can assert that two call sites reached
 * the same collaborator.
 *
 * They can, though, when the collaborator is injected. This provider takes both
 * entry services through its constructor, so a recording pair says exactly what
 * each tool reached for, and a handler that grew its own query would touch
 * neither. That is the whole observable: not "which module was imported", but
 * "was the injected object called, and did its answer come back unchanged".
 *
 * What this file cannot see is that the injected class is the one the
 * controllers get — that is DI wiring, pinned by `apps/server-e2e`'s MCP suite
 * answering identically to the `/v1` routes.
 */

/** The value a recorded collaborator hands back, so a re-shape is visible. */
const ANSWER = Symbol('the collaborator’s answer');

/** One recorded call: which injected service, which method, which arguments. */
interface Recorded {
    target: 'entries' | 'writes';
    method: string;
    args: unknown[];
}

/** A recording stand-in for one of the two entry services. */
function recorder(target: Recorded['target'], log: Recorded[]) {
    return new Proxy(
        {},
        {
            get:
                (_unused, method: string) =>
                (...args: unknown[]) => {
                    log.push({ target, method, args });
                    return ANSWER;
                }
        }
    );
}

/** A provider whose entry services record instead of running. */
function delegating() {
    const log: Recorded[] = [];
    const registry = {
        get: (name: string) => (name === 'article' ? { name } : undefined),
        summaries: () => [serialized('article')],
        serialize: (name: string) =>
            name === 'article' ? serialized('article') : undefined
    } as unknown as ContentTypeRegistry;
    const grants = {
        grantedSlugs: async () => new Set(['article'])
    } as unknown as WorkspaceGrantsQuery;

    return {
        log,
        provider: new ContentToolProvider(
            registry,
            grants,
            recorder('entries', log) as PublicEntriesQuery,
            recorder('writes', log) as PublicEntryWritesService
        )
    };
}

/** The tool of that name, or a failure that names it. */
function toolNamed(provider: ContentToolProvider, name: string) {
    const tool = provider
        .tools()
        .find((candidate: ToolDefinition) => candidate.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    return tool;
}

describe('ContentToolProvider delegates to the public API’s own services', () => {
    /**
     * One row per tool: the arguments a caller sends, and the single method on
     * a single injected service it must resolve to.
     *
     * A read that paged itself, a write that inserted its own row, or a tool
     * that called the right method and then post-processed the answer all fail
     * here — the first two because nothing was recorded, the last because the
     * sentinel did not come back.
     */
    const cases: [
        string,
        Recorded['target'],
        string,
        Record<string, unknown>
    ][] = [
        ['content_list', 'entries', 'list', { typeName: 'article' }],
        [
            'content_get',
            'entries',
            'getOne',
            { typeName: 'article', id: 'entry-1' }
        ],
        [
            'content_relations',
            'entries',
            'relationField',
            { typeName: 'article', id: 'entry-1', field: 'authors' }
        ],
        [
            'content_create',
            'writes',
            'create',
            { typeName: 'article', values: { title: 'Hello' } }
        ],
        [
            'content_update',
            'writes',
            'update',
            { typeName: 'article', id: 'entry-1', values: { title: 'Hi' } }
        ],
        [
            'content_publish',
            'writes',
            'publish',
            { typeName: 'article', id: 'entry-1' }
        ],
        [
            'content_bulk_publish',
            'writes',
            'bulkPublish',
            {
                typeName: 'article',
                ids: [
                    '3f1a7c1e-9d2b-4a6f-8c11-5b8e2f0d7a91',
                    '9c2e5b40-1a77-4f3d-b0e6-2d1c4a8f6b03'
                ]
            }
        ]
    ];

    it.each(cases)(
        '%s runs through %s.%s [mcp:I-19]',
        async (name, target, method, input) => {
            const { provider, log } = delegating();

            const result = await toolNamed(provider, name).handler(
                input,
                context()
            );

            expect(log).toEqual([{ target, method, args: expect.any(Array) }]);
            // Verbatim: the tool maps arguments onto a call and returns what it
            // gets. Anything else here is a second implementation of a rule the
            // public API already owns.
            expect(result).toBe(ANSWER);
        }
    );

    it('carries the workspace and the resolved grant set into the call [mcp:I-19]', async () => {
        // The two arguments the grant gate exists to produce. A handler that
        // resolved the type itself — or passed the raw name through — would
        // reach the query with a different shape here even though it reached it.
        const { provider, log } = delegating();

        await toolNamed(provider, 'content_list').handler(
            { typeName: 'article' },
            context()
        );

        const [type, , workspaceId, granted] = log[0].args;
        expect(type).toEqual({ name: 'article' });
        expect(workspaceId).toBe('workspace-1');
        expect(granted).toEqual(new Set(['article']));
    });

    it('validates arguments with the route’s own DTO [mcp:I-19]', async () => {
        // `forbidNonWhitelisted`, which is the host's `ValidationPipe` setting
        // and not class-validator's default. A hand-rolled check over the
        // arguments would let an unknown key through — the failure mode the
        // rule is stated for, because a silently dropped argument produces a
        // plausible wrong answer rather than an error.
        const { provider, log } = delegating();

        await expect(
            toolNamed(provider, 'content_list').handler(
                { typeName: 'article', pageSizze: 25 },
                context()
            )
        ).rejects.toMatchObject({ status: 400 });
        // …and it refused *before* reaching the query, not after.
        expect(log).toEqual([]);
    });
});
