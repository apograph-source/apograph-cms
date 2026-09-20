import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { ToolContext, ToolRegistry } from '@orthacms/tools-server';
import { buildMcpServer, type McpServerLimits } from './build-mcp-server';

const INFO = { name: 'ortha-cms-test', version: '0.0.0-test' };
const LIMITS: McpServerLimits = {
    callTimeoutMs: 30_000,
    maxResultBytes: 4_194_304
};

/** The context the endpoint would have built from a verified bearer token. */
function context(): ToolContext {
    return {
        actor: {
            kind: 'token',
            id: 'token-1',
            displayName: 'spec token',
            grantedPermissions: new Set<string>(),
            userId: null
        },
        workspaceId: '11111111-1111-4111-8111-111111111111',
        can: () => true
    };
}

/** Only the four members {@link buildMcpServer} touches. */
function registry(
    overrides: Partial<Record<keyof ToolRegistry, unknown>> = {}
): ToolRegistry {
    return {
        visibleTo: () => [],
        call: async () => ({}),
        resources: async () => [],
        readResource: async () => ({ uri: 'x', text: '' }),
        ...overrides
    } as unknown as ToolRegistry;
}

/** An MCP client speaking to `server` over a paired in-memory transport. */
async function connect(
    reg: ToolRegistry,
    limits: McpServerLimits = LIMITS
): Promise<Client> {
    const server = buildMcpServer(reg, context(), INFO, limits);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'spec', version: '0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return client;
}

/** The parsed JSON a tool result's text block carries. */
function parsed(result: unknown): Record<string, unknown> {
    const { content } = result as { content: { text: string }[] };
    return JSON.parse(content[0].text);
}

describe('buildMcpServer', () => {
    describe('tools/call', () => {
        it('emits the same value as text and as structuredContent [mcp:I-14]', async () => {
            const client = await connect(
                registry({ call: async () => ({ items: [1, 2], total: 2 }) })
            );

            const result = (await client.callTool({
                name: 'content_list'
            })) as Record<string, unknown>;

            expect(parsed(result)).toEqual(result['structuredContent']);
            expect(result['structuredContent']).toEqual({
                items: [1, 2],
                total: 2
            });
        });

        // MCP's `structuredContent` must be a JSON object, and a tool is free
        // to return an array or a scalar.
        it.each([
            [[1, 2], { value: [1, 2] }],
            ['done', { value: 'done' }],
            [null, { value: null }]
            // covers: mcp:I-14
        ])('boxes a non-object result %p under `value`', async (from, to) => {
            const client = await connect(registry({ call: async () => from }));

            const result = (await client.callTool({
                name: 'anything'
            })) as Record<string, unknown>;

            expect(result['structuredContent']).toEqual(to);
        });

        // A failure rides as a result, not a protocol error, so the *model*
        // reads it and can fix its next call.
        it('reports a thrown HttpException as an isError result [mcp:I-12]', async () => {
            const client = await connect(
                registry({
                    call: async () => {
                        throw new NotFoundException('No such entry.');
                    }
                })
            );

            const result = (await client.callTool({
                name: 'content_get'
            })) as Record<string, unknown>;

            expect(result['isError']).toBe(true);
            expect(parsed(result)).toEqual({
                status: 404,
                code: 'not_found',
                message: 'No such entry.'
            });
        });

        it('keeps an unexpected throw opaque', async () => {
            const client = await connect(
                registry({
                    call: async () => {
                        // covers: mcp:I-13
                        throw new Error('connect ECONNREFUSED 10.0.0.7:5432');
                    }
                })
            );

            const result = (await client.callTool({
                name: 'content_list'
            })) as Record<string, unknown>;

            expect(result['isError']).toBe(true);
            expect(parsed(result)['code']).toBe('internal_error');
            expect(JSON.stringify(result)).not.toContain('5432');
        });
    });

    describe('the per-call deadline', () => {
        it('abandons a handler that never settles, as a 504 result', async () => {
            const client = await connect(
                registry({ call: () => new Promise(() => undefined) }),
                { ...LIMITS, callTimeoutMs: 25 }
            );

            const result = (await client.callTool({
                name: 'content_list'
            })) as Record<string, unknown>;

            expect(result['isError']).toBe(true);
            expect(parsed(result)['status']).toBe(504);
            expect(parsed(result)['code']).toBe('timeout');
        });

        // The handler is *told*; whether it stops is its own business. Bounding
        // the caller's wait is the guarantee this layer makes.
        it('hands the handler a signal that aborts on expiry [mcp:I-16]', async () => {
            let seen: AbortSignal | undefined;
            const client = await connect(
                registry({
                    call: (
                        _name: string,
                        _args: unknown,
                        ctx: { signal?: AbortSignal }
                    ) => {
                        seen = ctx.signal;
                        return new Promise(() => undefined);
                    }
                }),
                { ...LIMITS, callTimeoutMs: 25 }
            );

            await client.callTool({ name: 'content_list' });

            expect(seen).toBeInstanceOf(AbortSignal);
            expect(seen?.aborted).toBe(true);
        });

        // A handler that rejects *after* the race was lost has nobody left to
        // report to. Without a catch on the loser that is an unhandled
        // rejection, which ends the process — the failure this bound exists to
        // contain, caused by the bound itself.
        it('survives a handler that rejects after the deadline [mcp:I-16]', async () => {
            const client = await connect(
                registry({
                    call: () =>
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('too late')), 40)
                        )
                }),
                { ...LIMITS, callTimeoutMs: 15 }
            );

            const result = (await client.callTool({
                name: 'content_list'
            })) as Record<string, unknown>;
            expect(parsed(result)['code']).toBe('timeout');

            await new Promise((resolve) => setTimeout(resolve, 60));
        });

        // A client hanging up is routine. Routing it through `toToolError`
        // would log every disconnect as an unhandled error with a stack.
        it('does not report a caller disconnect as a handler failure', async () => {
            const logged: unknown[] = [];
            const spy = jest
                .spyOn(Logger.prototype, 'error')
                .mockImplementation((...args: unknown[]) => {
                    logged.push(args);
                });
            try {
                let seen: AbortSignal | undefined;
                const client = await connect(
                    registry({
                        call: (
                            _name: string,
                            _args: unknown,
                            ctx: { signal?: AbortSignal }
                        ) => {
                            seen = ctx.signal;
                            return new Promise(() => undefined);
                        }
                    })
                );

                const pending = client.callTool(
                    { name: 'content_list' },
                    undefined,
                    { timeout: 20 }
                );
                await pending.catch(() => undefined);
                await new Promise((resolve) => setTimeout(resolve, 30));

                // Non-vacuous: the cancellation really reached the handler.
                expect(seen?.aborted).toBe(true);
                expect(logged).toHaveLength(0);
            } finally {
                spy.mockRestore();
            }
        });

        it('lets a handler inside the deadline through untouched', async () => {
            const client = await connect(
                registry({
                    call: () =>
                        new Promise((resolve) =>
                            setTimeout(() => resolve({ ok: true }), 5)
                        )
                }),
                { ...LIMITS, callTimeoutMs: 500 }
            );

            const result = (await client.callTool({
                name: 'content_list'
            })) as Record<string, unknown>;

            expect(result['isError']).toBeUndefined();
            expect(result['structuredContent']).toEqual({ ok: true });
        });
    });

    describe('the result ceiling', () => {
        it('refuses an oversized result with an actionable 413', async () => {
            const client = await connect(
                registry({ call: async () => ({ blob: 'x'.repeat(4_000) }) }),
                { ...LIMITS, maxResultBytes: 1_024 }
            );

            const result = (await client.callTool({
                name: 'content_list'
            })) as Record<string, unknown>;

            expect(result['isError']).toBe(true);
            const failure = parsed(result);
            expect(failure['status']).toBe(413);
            expect(failure['code']).toBe('result_too_large');
            expect(failure['message']).toContain('1024');
            // The payload itself must not ride out inside the refusal.
            expect(result['structuredContent']).toBeUndefined();
        });

        it('lets a result under the ceiling through', async () => {
            const client = await connect(
                registry({ call: async () => ({ ok: true }) }),
                { ...LIMITS, maxResultBytes: 1_024 }
            );

            const result = (await client.callTool({
                name: 'content_list'
            })) as Record<string, unknown>;

            expect(result['isError']).toBeUndefined();
        });
    });

    // The other half of the asymmetry: a resource read has no model in the
    // loop, so MCP models its failures as protocol errors.
    describe('resources/read', () => {
        it('maps an unknown URI to -32002, not an internal error', async () => {
            const client = await connect(
                registry({
                    readResource: async () => {
                        throw new NotFoundException(
                            'Unknown resource "ortha://content-type/nope".'
                        );
                    }
                })
            );

            const error = await client
                .readResource({ uri: 'ortha://content-type/nope' })
                .catch((thrown: unknown) => thrown);

            expect(error).toBeInstanceOf(McpError);
            expect((error as McpError).code).toBe(-32002);
            expect((error as McpError).data).toMatchObject({
                status: 404,
                code: 'not_found'
            });
        });

        it('carries a refusal as data rather than conflating it with absence', async () => {
            const client = await connect(
                registry({
                    readResource: async () => {
                        throw new ForbiddenException('Needs content:read.');
                    }
                })
            );

            const error = (await client
                .readResource({ uri: 'ortha://content-type/x' })
                .catch((thrown: unknown) => thrown)) as McpError;

            expect(error.code).toBe(-32002);
            expect(error.data).toMatchObject({ code: 'forbidden' });
        });

        // The reason this path needed a mapper at all: the SDK puts a raw
        // `error.message` on the wire, so a driver error used to leave the
        // process verbatim under a code claiming it was internal.
        it('keeps an unexpected throw opaque', async () => {
            const client = await connect(
                registry({
                    readResource: async () => {
                        // covers: mcp:I-13
                        throw new Error('relation "secrets" does not exist');
                    }
                })
            );

            const error = (await client
                .readResource({ uri: 'ortha://content-type/x' })
                .catch((thrown: unknown) => thrown)) as McpError;

            expect(error.code).toBe(-32603);
            expect(error.message).not.toContain('secrets');
            expect(error.data).toMatchObject({ code: 'internal_error' });
        });
    });

    describe('resources/list', () => {
        it('keeps an unexpected throw opaque', async () => {
            const client = await connect(
                registry({
                    resources: async () => {
                        throw new Error('connect ECONNREFUSED :5432');
                    }
                })
            );

            const error = (await client
                .listResources()
                .catch((thrown: unknown) => thrown)) as McpError;

            expect(error.code).toBe(-32603);
            expect(error.message).not.toContain('5432');
        });
    });
});
