import {
    ForbiddenException,
    NotFoundException,
    UnprocessableEntityException
} from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import { createToolContext } from './tool-context';
import type { ToolContext, ToolDefinition } from './tool';
import type { ToolProvider } from './tool-provider';
import { ToolRegistry } from './tool-registry';

/** A context holding exactly the named permissions. */
function contextWith(...permissions: string[]): ToolContext {
    return createToolContext(
        {
            kind: 'token',
            id: 'token-1',
            displayName: 'test token',
            grantedPermissions: new Set(permissions),
            userId: null
        },
        'workspace-1'
    );
}

/** A tool that records whether it ran. */
function tool(
    name: string,
    requires: ToolDefinition['requires'],
    ran: { value: boolean } = { value: false }
): ToolDefinition {
    return {
        name,
        title: name,
        description: name,
        inputSchema: { type: 'object' },
        requires,
        readOnly: true,
        handler: async () => {
            ran.value = true;
            return { ok: true };
        }
    };
}

/** A provider wrapping a fixed tool list. */
function provider(...tools: ToolDefinition[]): ToolProvider {
    return { tools: () => tools };
}

describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
    });

    describe('authorization', () => {
        // The security boundary. `visibleTo` only hides tools; a client is
        // free to call a name it was never shown, so the gate has to be here.
        it('refuses a tool the actor lacks the permission for [tools:I-01]', async () => {
            const ran = { value: false };
            registry.register(
                provider(
                    tool('content_create', [PERMISSIONS.CONTENT_CREATE], ran)
                )
            );

            await expect(
                registry.call(
                    'content_create',
                    {},
                    contextWith(PERMISSIONS.CONTENT_READ),
                    'mcp'
                )
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(ran.value).toBe(false);
        });

        it('refuses a tool a hidden-from-list actor invokes by name [copilot:I-05] [tools:I-02]', async () => {
            const ran = { value: false };
            registry.register(
                provider(
                    tool('content_delete', [PERMISSIONS.CONTENT_DELETE], ran)
                )
            );
            const readOnly = contextWith(PERMISSIONS.CONTENT_READ);

            // Not listed...
            expect(registry.visibleTo(readOnly, 'mcp')).toHaveLength(0);
            // ...and still refused when called anyway.
            await expect(
                registry.call('content_delete', {}, readOnly, 'mcp')
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(ran.value).toBe(false);
        });

        it('requires EVERY permission a tool declares [tools:I-03]', async () => {
            registry.register(
                provider(
                    tool('content_media', [
                        PERMISSIONS.CONTENT_READ,
                        PERMISSIONS.MEDIA_READ
                    ])
                )
            );

            await expect(
                registry.call(
                    'content_media',
                    {},
                    contextWith(PERMISSIONS.CONTENT_READ),
                    'mcp'
                )
            ).rejects.toBeInstanceOf(ForbiddenException);

            await expect(
                registry.call(
                    'content_media',
                    {},
                    contextWith(
                        PERMISSIONS.CONTENT_READ,
                        PERMISSIONS.MEDIA_READ
                    ),
                    'mcp'
                )
            ).resolves.toEqual({ ok: true });
        });

        it('runs a tool the actor is permitted to call', async () => {
            const ran = { value: false };
            registry.register(
                provider(tool('content_list', [PERMISSIONS.CONTENT_READ], ran))
            );

            await expect(
                registry.call(
                    'content_list',
                    {},
                    contextWith(PERMISSIONS.CONTENT_READ),
                    'mcp'
                )
            ).resolves.toEqual({ ok: true });
            expect(ran.value).toBe(true);
        });

        it('allows a tool that requires nothing', async () => {
            registry.register(provider(tool('ping', [])));

            await expect(
                registry.call('ping', {}, contextWith(), 'mcp')
            ).resolves.toEqual({ ok: true });
        });
    });

    describe('visibleTo', () => {
        it('shows a read token only the read tools', () => {
            registry.register(
                provider(
                    tool('content_list', [PERMISSIONS.CONTENT_READ]),
                    tool('content_create', [PERMISSIONS.CONTENT_CREATE]),
                    tool('content_delete', [PERMISSIONS.CONTENT_DELETE])
                )
            );

            expect(
                registry
                    .visibleTo(contextWith(PERMISSIONS.CONTENT_READ), 'mcp')
                    .map((entry) => entry.name)
            ).toEqual(['content_list']);
        });
    });

    describe('call', () => {
        it('404s an unknown tool, distinctly from a refusal [tools:I-10]', async () => {
            registry.register(provider(tool('content_list', [])));

            await expect(
                registry.call('content_teleport', {}, contextWith(), 'mcp')
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    // Not the security boundary — `requires` is — but the difference between a
    // caller's mistake coming back as a fixable `validation_failed` and as the
    // opaque 500 a handler produces when it is handed a string where the schema
    // promised an integer. The copilot's run engine validated all along; the MCP
    // endpoint did not, and one registry means one answer.
    describe('argument validation', () => {
        /** A tool whose schema closes the object and bounds its one field. */
        function searchTool(ran = { value: false }): ToolDefinition {
            return {
                ...tool('media_assets_search', [], ran),
                inputSchema: {
                    type: 'object',
                    properties: {
                        kind: { type: 'string', enum: ['image', 'video'] },
                        pageSize: { type: 'integer', minimum: 1, maximum: 25 }
                    },
                    additionalProperties: false
                }
            };
        }

        it('refuses arguments the tool’s own inputSchema rejects', async () => {
            const ran = { value: false };
            registry.register(provider(searchTool(ran)));

            await expect(
                registry.call(
                    'media_assets_search',
                    { pageSize: 'lots', kind: '../etc/passwd', nope: 1 },
                    contextWith(),
                    'mcp'
                )
            ).rejects.toBeInstanceOf(UnprocessableEntityException);
            expect(ran.value).toBe(false);
        });

        it('names every problem per field, so a model can fix and retry', async () => {
            registry.register(provider(searchTool()));

            const refusal = await registry
                .call(
                    'media_assets_search',
                    { pageSize: 'lots', kind: '../etc/passwd', nope: 1 },
                    contextWith(),
                    'mcp'
                )
                .catch((error: UnprocessableEntityException) => error);

            expect(
                (refusal as UnprocessableEntityException).getResponse()
            ).toEqual({
                message: 'Invalid arguments for "media_assets_search".',
                issues: [
                    { field: 'pageSize', message: 'expected integer' },
                    { field: 'kind', message: 'must be one of image, video' },
                    { field: 'nope', message: 'unexpected property' }
                ]
            });
        });

        it('accepts arguments the schema allows', async () => {
            const ran = { value: false };
            registry.register(provider(searchTool(ran)));

            await expect(
                registry.call(
                    'media_assets_search',
                    { pageSize: 5, kind: 'image' },
                    contextWith(),
                    'mcp'
                )
            ).resolves.toEqual({ ok: true });
            expect(ran.value).toBe(true);
        });

        // Otherwise a `read` token could probe a write tool's argument shape by
        // reading the refusals back, and two callers would get two different
        // answers to the same unauthorized call.
        it('refuses on permissions before it looks at the arguments [tools:I-12]', async () => {
            registry.register(
                provider({
                    ...searchTool(),
                    name: 'content_delete',
                    requires: [PERMISSIONS.CONTENT_DELETE]
                })
            );

            await expect(
                registry.call(
                    'content_delete',
                    { nope: 1 },
                    contextWith(PERMISSIONS.CONTENT_READ),
                    'mcp'
                )
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        // Both consumers defended against this themselves (`args ?? {}` in the
        // MCP adapter, `call.input ?? {}` in the run engine). A third would have
        // had to remember; now it does not.
        it('treats missing arguments as an empty object [tools:I-13]', async () => {
            registry.register(
                provider({
                    ...tool('media_folders_list', []),
                    inputSchema: { type: 'object', properties: {} }
                })
            );

            await expect(
                registry.call(
                    'media_folders_list',
                    undefined,
                    contextWith(),
                    'mcp'
                )
            ).resolves.toEqual({ ok: true });
        });
    });

    // A resource is the other thing a client can pull out of this registry, and
    // until now it was the one the authorization point never saw: no `requires`
    // on the contract, no check on either path. The gate exists now; nothing
    // shipped declares one yet, which is exactly why it had to be centralized
    // before the first resource needs it.
    describe('resource authorization', () => {
        /**
         * A provider serving one gated resource, recording whether it was
         * ever asked for the bytes.
         */
        function gated(
            requires: readonly string[],
            read: { value: boolean } = { value: false }
        ): ToolProvider {
            const definition = {
                uri: 'ortha://secret',
                name: 'secret',
                description: 'secret',
                mimeType: 'application/json',
                requires: requires as ToolDefinition['requires']
            };
            return {
                tools: () => [],
                resources: async () => [definition],
                readResource: async (uri) => {
                    if (uri !== definition.uri) {
                        return undefined;
                    }
                    read.value = true;
                    return {
                        uri,
                        mimeType: 'application/json',
                        text: '{"secret":true}'
                    };
                }
            };
        }

        it('hides a resource the actor lacks the permission for [tools:I-14]', async () => {
            registry.register(gated([PERMISSIONS.USERS_READ]));

            await expect(
                registry.resources(contextWith(PERMISSIONS.CONTENT_READ))
            ).resolves.toEqual([]);
        });

        it('refuses to read it even when the uri is named directly [tools:I-14]', async () => {
            registry.register(gated([PERMISSIONS.USERS_READ]));

            await expect(
                registry.readResource(
                    'ortha://secret',
                    contextWith(PERMISSIONS.CONTENT_READ)
                )
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('never asks the provider for the bytes it is about to refuse [mcp:I-23] [tools:I-14]', async () => {
            // The clause the refusal above cannot show. A gate applied *after*
            // `readResource` returned would throw the same ForbiddenException
            // from the same call, so the test next door passes either way —
            // while the provider has already done the work, gone to the
            // database, and materialized bytes for someone who may not have
            // them. Ordering is the whole content of "checked before"; the
            // only observable is whether the provider ran.
            const read = { value: false };
            registry.register(gated([PERMISSIONS.USERS_READ], read));

            await expect(
                registry.readResource(
                    'ortha://secret',
                    contextWith(PERMISSIONS.CONTENT_READ)
                )
            ).rejects.toBeInstanceOf(ForbiddenException);
            expect(read.value).toBe(false);

            // And the recorder is not stuck at `false`: the same provider does
            // run for an actor who holds the permission, so the assertion above
            // is about the gate rather than about a spy nothing ever trips.
            await registry.readResource(
                'ortha://secret',
                contextWith(PERMISSIONS.USERS_READ)
            );
            expect(read.value).toBe(true);
        });

        it('lists and reads it for an actor who holds the permission', async () => {
            registry.register(gated([PERMISSIONS.USERS_READ]));
            const permitted = contextWith(PERMISSIONS.USERS_READ);

            await expect(registry.resources(permitted)).resolves.toHaveLength(
                1
            );
            await expect(
                registry.readResource('ortha://secret', permitted)
            ).resolves.toMatchObject({ text: '{"secret":true}' });
        });

        it('leaves an ungated resource open to anyone who reached the endpoint', async () => {
            registry.register(gated([]));

            await expect(
                registry.readResource('ortha://secret', contextWith())
            ).resolves.toMatchObject({ text: '{"secret":true}' });
        });
    });

    // Every one of these used to surface at the first `tools/list` — or not at
    // all. A wiring bug belongs to the deploy, not to the first caller.
    describe('boot-time catalogue validation', () => {
        it('boots on the shape a correct catalogue has', () => {
            registry.register(
                provider(
                    tool('content_list', [PERMISSIONS.CONTENT_READ]),
                    tool('i18n_locales_list', [])
                )
            );

            expect(() => registry.onApplicationBootstrap()).not.toThrow();
        });

        it('refuses to boot when two providers claim one name [mcp:I-22] [tools:I-15]', () => {
            registry.register(provider(tool('content_list', [])));
            registry.register(provider(tool('content_list', [])));

            expect(() => registry.onApplicationBootstrap()).toThrow(
                /duplicate tool name "content_list"/
            );
        });

        // `can()` is exact-match set membership, so a permission key that is not
        // one of ours is a tool nobody can ever call — the fail-closed direction,
        // and silent until someone asks why the tool never appears.
        it('refuses to boot on a requires the deployment does not define [tools:I-15]', () => {
            registry.register(
                provider(tool('content_list', ['content:read ' as never]))
            );

            expect(() => registry.onApplicationBootstrap()).toThrow(
                /is not a permission this deployment defines/
            );
        });

        it('refuses to boot on a name that is not snake_case [tools:I-15]', () => {
            registry.register(provider(tool(' Content_List ', [])));

            expect(() => registry.onApplicationBootstrap()).toThrow(
                /is not a valid tool name/
            );
        });

        // `!tool.surfaces` is false for `[]` and `[].includes(x)` is false, so
        // an empty array is a tool offered to neither consumer — dead on arrival
        // and impossible to tell from a typo.
        it('refuses to boot on an empty surfaces array [tools:I-06]', () => {
            registry.register(
                provider({ ...tool('content_list', []), surfaces: [] })
            );

            expect(() => registry.onApplicationBootstrap()).toThrow(
                /offered to neither consumer/
            );
        });

        it('refuses to boot on an inputSchema that is not an object schema [tools:I-15]', () => {
            registry.register(
                provider({
                    ...tool('content_list', []),
                    inputSchema: { type: 'string' }
                })
            );

            expect(() => registry.onApplicationBootstrap()).toThrow(
                /tool arguments are always an object/
            );
        });

        it('reports every problem at once, not just the first [mcp:I-22] [tools:I-15]', () => {
            registry.register(
                provider(tool('BadName', ['not:a:permission' as never]))
            );

            expect(() => registry.onApplicationBootstrap()).toThrow(
                /is not a valid tool name[\s\S]*is not a permission/
            );
        });
    });

    // The other half of the boundary `requires` guards. A tool declares who it
    // is for, and both the listing AND the dispatch have to honour it — a
    // caller may name a tool it was never shown, which for a cross-surface tool
    // is the difference between "unknown" and a propose-shaped write an MCP
    // client has no way to accept.
    describe('surfaces', () => {
        /** A tool narrowed to one surface. */
        function narrowed(
            name: string,
            surfaces: ToolDefinition['surfaces'],
            ran: { value: boolean } = { value: false }
        ): ToolDefinition {
            return { ...tool(name, [], ran), surfaces };
        }

        it('offers a tool that names no surfaces to both [tools:I-06]', () => {
            registry.register(provider(tool('i18n_locales_list', [])));

            expect(registry.forSurface('mcp').map((e) => e.name)).toEqual([
                'i18n_locales_list'
            ]);
            expect(registry.forSurface('copilot').map((e) => e.name)).toEqual([
                'i18n_locales_list'
            ]);
        });

        it('withholds a narrowed tool from the other surface', () => {
            registry.register(
                provider(
                    narrowed('content_list', ['mcp']),
                    narrowed('content_propose_update', ['copilot']),
                    tool('media_folders_list', [])
                )
            );

            expect(registry.forSurface('mcp').map((e) => e.name)).toEqual([
                'content_list',
                'media_folders_list'
            ]);
            expect(registry.forSurface('copilot').map((e) => e.name)).toEqual([
                'content_propose_update',
                'media_folders_list'
            ]);
        });

        it('refuses to dispatch a tool the calling surface was never offered [tools:I-07]', async () => {
            const ran = { value: false };
            registry.register(
                provider(narrowed('content_propose_update', ['copilot'], ran))
            );

            // "Unknown", not "forbidden": the permissions are irrelevant here,
            // and an MCP client learning the copilot's propose tools exist
            // would only invite it to keep naming them.
            await expect(
                registry.call(
                    'content_propose_update',
                    {},
                    contextWith(),
                    'mcp'
                )
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(ran.value).toBe(false);
        });

        // A shared tool may render the same fact differently per caller (a
        // download link is session-gated for the copilot and bearer-fetchable
        // for MCP), so the handler has to be told which one it is answering —
        // and told by the registry, not by the caller, so it is always the
        // surface the call was authorized against.
        it('stamps the dispatching surface on the handler’s context [mcp:I-11] [tools:I-08]', async () => {
            let seen: ToolContext | undefined;
            registry.register(
                provider({
                    ...tool('media_assets_search', []),
                    handler: async (_input, context) => {
                        seen = context;
                        return { ok: true };
                    }
                })
            );

            await registry.call(
                'media_assets_search',
                {},
                contextWith(),
                'mcp'
            );

            expect(seen?.surface).toBe('mcp');
            // …and the rest of the context is passed through untouched.
            expect(seen?.workspaceId).toBe('workspace-1');
            expect(seen?.actor.id).toBe('token-1');
        });
    });

    describe('all', () => {
        it('concatenates every provider in registration order', () => {
            registry.register(provider(tool('a', [])));
            registry.register(provider(tool('b', []), tool('c', [])));

            expect(registry.all().map((entry) => entry.name)).toEqual([
                'a',
                'b',
                'c'
            ]);
        });

        // Silently letting one win would make behaviour depend on plugin
        // registration order — the exact class of bug this fails loudly for.
        it('throws when two providers claim the same tool name [tools:I-16]', () => {
            registry.register(provider(tool('content_list', [])));
            registry.register(provider(tool('content_list', [])));

            expect(() => registry.all()).toThrow(/Duplicate tool name/);
        });

        // The same provider twice changes nothing about what the catalogue
        // holds, so it must not brick it: every tool would collide with itself
        // and `all()` would throw for the rest of the process, taking both
        // surfaces down over a duplicated wiring line.
        it('ignores a provider instance registered twice [tools:I-16]', () => {
            const twice = provider(tool('content_list', []));
            registry.register(twice);
            registry.register(twice);

            expect(registry.all().map((entry) => entry.name)).toEqual([
                'content_list'
            ]);
            expect(() => registry.onApplicationBootstrap()).not.toThrow();
        });
    });

    describe('resources', () => {
        it('404s a uri no provider claims', async () => {
            registry.register(provider(tool('a', [])));

            await expect(
                registry.readResource('ortha://nope', contextWith())
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('returns the first provider that claims the uri', async () => {
            const contents = {
                uri: 'ortha://content-type/article',
                mimeType: 'application/json',
                text: '{}'
            };
            registry.register({
                tools: () => [],
                readResource: async () => undefined
            });
            registry.register({
                tools: () => [],
                readResource: async (uri) =>
                    uri === contents.uri ? contents : undefined
            });

            await expect(
                registry.readResource(contents.uri, contextWith())
            ).resolves.toEqual(contents);
        });

        it('flattens resource lists across providers', async () => {
            const one = {
                uri: 'ortha://a',
                name: 'a',
                description: 'a',
                mimeType: 'application/json'
            };
            const two = { ...one, uri: 'ortha://b', name: 'b' };
            registry.register({
                tools: () => [],
                resources: async () => [one]
            });
            registry.register({
                tools: () => [],
                resources: async () => [two]
            });

            await expect(registry.resources(contextWith())).resolves.toEqual([
                one,
                two
            ]);
        });
    });
});
