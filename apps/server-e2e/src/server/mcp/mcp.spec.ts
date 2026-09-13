import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    expireApiToken,
    resetDb,
    seedActiveUser,
    seedArticles,
    seedContentGrants,
    seedWorkspace
} from '../../support/seed';

const ADMIN_EMAIL = 'mcp-admin@example.com';
const PASSWORD = 'SecurePass123!';
const MCP_PATH = '/api/v1/mcp';

/** Enough of a PNG for the upload route; the bytes are never decoded here. */
const PNG = Buffer.from('\x89PNG\r\n\x1a\nfake-png-bytes', 'binary');

/** The Accept header every MCP client sends on a Streamable HTTP POST. */
const ACCEPT = 'application/json, text/event-stream';

/** One JSON-RPC response, as far as these assertions care. */
interface RpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: { code: number; message: string };
}

/** One MCP tool, as `tools/list` returns it. */
interface McpTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/**
 * `POST /api/v1/mcp` — the **Model Context Protocol endpoint**. Covers the
 * bearer authentication, the workspace bucket, scope-based tool visibility and
 * enforcement, the full content CRUD round-trip, and the error contract.
 *
 * Driven as raw JSON-RPC over supertest rather than through the MCP client SDK:
 * the wire format is the contract an external client depends on, so asserting
 * the bytes is what actually pins it.
 */
describe('MCP endpoint (/api/v1/mcp)', () => {
    let harness: TestApp;
    let workspaceId: string;
    let otherWorkspaceId: string;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        await seedActiveUser(harness.app, {
            email: ADMIN_EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
        workspaceId = (await seedWorkspace({ name: 'WS A', slug: 'ws-a' })).id;
        otherWorkspaceId = (await seedWorkspace({ name: 'WS B', slug: 'ws-b' }))
            .id;
        // `test_page` is deliberately left ungranted, so the grant gate has
        // something to hide.
        await seedContentGrants(workspaceId, ['test_article']);
        await seedContentGrants(otherWorkspaceId, ['test_article']);
    });

    /** Logs in as the admin and returns a cookie-bearing agent. */
    async function login() {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email: ADMIN_EMAIL, password: PASSWORD })
            .expect(201);
        return agent;
    }

    /** Mints a token through the real management API and returns its secret. */
    async function mintToken(
        options: {
            workspaceIds?: string[];
            scope?: 'read' | 'full';
        } = {}
    ): Promise<{ id: string; secret: string }> {
        const agent = await login();
        const res = await agent
            .post('/api/api-tokens')
            .send({
                name: 'mcp-e2e',
                workspaceIds: options.workspaceIds ?? [workspaceId],
                scope: options.scope ?? 'read'
            })
            .expect(201);
        return { id: res.body.id, secret: res.body.secret };
    }

    let nextId = 1;

    /** Sends one JSON-RPC request with a bearer token. */
    function rpc(
        secret: string,
        method: string,
        params?: Record<string, unknown>,
        options: { workspaceId?: string; query?: string } = {}
    ) {
        const call = request(harness.server)
            .post(options.query ? `${MCP_PATH}?${options.query}` : MCP_PATH)
            .set('Authorization', `Bearer ${secret}`)
            .set('Accept', ACCEPT)
            .set('Content-Type', 'application/json');
        if (options.workspaceId) {
            call.set('X-Workspace-Id', options.workspaceId);
        }
        return call.send({
            jsonrpc: '2.0',
            id: nextId++,
            method,
            ...(params ? { params } : {})
        });
    }

    /** Sends a `tools/call` and returns the parsed result. */
    async function callTool(
        secret: string,
        name: string,
        args: Record<string, unknown> = {},
        options: { workspaceId?: string } = {}
    ) {
        const res = await rpc(
            secret,
            'tools/call',
            { name, arguments: args },
            options
        ).expect(200);
        const body = res.body as RpcResponse;
        const result = body.result as {
            isError?: boolean;
            structuredContent?: Record<string, unknown>;
            content: { type: string; text: string }[];
        };
        return {
            isError: result.isError === true,
            data: JSON.parse(result.content[0].text) as Record<string, unknown>
        };
    }

    /** Seeds one published article and returns its id. */
    async function seedPublished(text: string, ws = workspaceId) {
        const [id] = await seedArticles(
            [
                {
                    text,
                    select: 'article',
                    status: 'published',
                    publishedAt: new Date()
                }
            ],
            ws
        );
        return id;
    }

    describe('authentication', () => {
        it('401s without an Authorization header [mcp:I-01]', async () => {
            await request(harness.server)
                .post(MCP_PATH)
                .set('Accept', ACCEPT)
                .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
                .expect(401);
        });

        it('401s on an unknown bearer token', async () => {
            await rpc('apograph_not-a-real-token', 'tools/list').expect(401);
        });

        // A cookie rides along ambiently, which is exactly what makes a
        // cookie-authenticated write CSRF-able. This endpoint writes content.
        it('does not accept a session cookie in place of a token [mcp:I-03]', async () => {
            const agent = await login();
            await agent
                .post(MCP_PATH)
                .set('Accept', ACCEPT)
                .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
                .expect(401);
        });

        it('401s once the token is revoked [mcp:I-04]', async () => {
            const { id, secret } = await mintToken();
            await rpc(secret, 'tools/list').expect(200);

            const agent = await login();
            await agent.delete(`/api/api-tokens/${id}`).expect(204);

            await rpc(secret, 'tools/list').expect(401);
        });

        it('401s once the token has expired [mcp:I-04]', async () => {
            // Expiry kills every surface at once — it is decided in
            // `ApiTokenService.verify`, upstream of the protocol — and the
            // refusal is a transport 401 rather than a JSON-RPC error object:
            // an MCP client that has to parse a 200 to discover its credential
            // died will report the tool as broken instead of the key as stale.
            const { id, secret } = await mintToken();
            await rpc(secret, 'tools/list').expect(200);

            await expireApiToken(id);

            await rpc(secret, 'tools/list').expect(401);
        });
    });

    describe('workspace resolution', () => {
        it('needs no header when the token covers one workspace', async () => {
            const { secret } = await mintToken();
            await seedPublished('Only workspace');

            const { data } = await callTool(secret, 'content_list', {
                typeName: 'test_article'
            });

            expect(data['total']).toBe(1);
        });

        it('400s when a multi-workspace token names none', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId, otherWorkspaceId]
            });

            await rpc(secret, 'tools/list').expect(400);
        });

        it('honours X-Workspace-Id for a multi-workspace token', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId, otherWorkspaceId]
            });
            await seedPublished('In A', workspaceId);

            const inA = await callTool(
                secret,
                'content_list',
                { typeName: 'test_article' },
                { workspaceId }
            );
            const inB = await callTool(
                secret,
                'content_list',
                { typeName: 'test_article' },
                { workspaceId: otherWorkspaceId }
            );

            expect(inA.data['total']).toBe(1);
            expect(inB.data['total']).toBe(0);
        });

        // MCP client configs are URL-shaped, and several clients cannot send
        // custom headers.
        it('accepts ?workspaceId= on the endpoint URL', async () => {
            const { secret } = await mintToken({
                workspaceIds: [workspaceId, otherWorkspaceId]
            });
            await seedPublished('In A', workspaceId);

            const res = await rpc(
                secret,
                'tools/call',
                {
                    name: 'content_list',
                    arguments: { typeName: 'test_article' }
                },
                { query: `workspaceId=${workspaceId}` }
            ).expect(200);

            const result = res.body.result as {
                content: { text: string }[];
            };
            expect(JSON.parse(result.content[0].text)['total']).toBe(1);
        });

        it('403s a workspace outside the token bucket [mcp:I-06]', async () => {
            const { secret } = await mintToken({ workspaceIds: [workspaceId] });

            await rpc(secret, 'tools/list', undefined, {
                workspaceId: otherWorkspaceId
            }).expect(403);
        });
    });

    describe('initialize', () => {
        it('reports the server identity and its capabilities', async () => {
            const { secret } = await mintToken();

            const res = await rpc(secret, 'initialize', {
                protocolVersion: '2025-06-18',
                capabilities: {},
                clientInfo: { name: 'e2e', version: '1.0.0' }
            }).expect(200);

            const result = (res.body as RpcResponse).result as {
                serverInfo: { name: string; version: string };
                capabilities: Record<string, unknown>;
            };
            expect(result.serverInfo).toEqual({
                name: 'apograph-cms-test',
                version: '0.0.0-test'
            });
            expect(result.capabilities).toHaveProperty('tools');
            expect(result.capabilities).toHaveProperty('resources');
        });
    });

    describe('tools/list', () => {
        it('shows a read-scoped token only the read tools [mcp:I-18]', async () => {
            const { secret } = await mintToken({ scope: 'read' });

            const res = await rpc(secret, 'tools/list').expect(200);
            const names = (
                (res.body as RpcResponse).result as { tools: McpTool[] }
            ).tools.map((tool) => tool.name);

            expect(names).toContain('content_list');
            expect(names).toContain('content_types_list');
            expect(names).not.toContain('content_create');
            expect(names).not.toContain('content_update');
            expect(names).not.toContain('content_publish');
            expect(names).not.toContain('content_delete');
        });

        it('shows a full-scoped token the write tools too [mcp:I-18]', async () => {
            const { secret } = await mintToken({ scope: 'full' });

            const res = await rpc(secret, 'tools/list').expect(200);
            const names = (
                (res.body as RpcResponse).result as { tools: McpTool[] }
            ).tools.map((tool) => tool.name);

            expect(names).toEqual(
                expect.arrayContaining([
                    'content_types_list',
                    'content_type_get',
                    'content_list',
                    'content_get',
                    'content_relations',
                    'content_media',
                    'content_translations',
                    'content_create',
                    'content_update',
                    'content_publish',
                    'content_unpublish',
                    'content_delete'
                ])
            );
        });

        it('annotates read-only and destructive tools', async () => {
            const { secret } = await mintToken({ scope: 'full' });

            const res = await rpc(secret, 'tools/list').expect(200);
            const tools = (
                (res.body as RpcResponse).result as { tools: McpTool[] }
            ).tools;
            const byName = (name: string) =>
                tools.find((tool) => tool.name === name);

            expect(byName('content_list')?.annotations?.readOnlyHint).toBe(
                true
            );
            expect(byName('content_delete')?.annotations?.readOnlyHint).toBe(
                false
            );
            expect(byName('content_delete')?.annotations?.destructiveHint).toBe(
                true
            );
        });

        // The registry is shared with the copilot's run loop (ADR-0006 §2), so
        // "which tools does an MCP client see" stopped being "all of them" the
        // moment a second consumer registered its own. A copilot tool reaching
        // this list would be a real leak: they read the ADMIN services (drafts,
        // the trash) and their write half produces proposals only the chat panel
        // can accept, so an MCP client could see unpublished content or create
        // changes it has no way to apply.
        it('shows no copilot-only tool, whatever the scope [activity:I-21] [mcp:I-09] [media:I-30]', async () => {
            const { secret } = await mintToken({ scope: 'full' });

            const res = await rpc(secret, 'tools/list').expect(200);
            const names = (
                (res.body as RpcResponse).result as { tools: McpTool[] }
            ).tools.map((tool) => tool.name);

            expect(names).toEqual(
                expect.not.arrayContaining([
                    // The admin-scoped content reads: they see drafts on
                    // `content:read` alone, which a `read` token must not.
                    'admin_content_types',
                    'admin_content_search',
                    'admin_content_get',
                    'admin_content_revisions',
                    'admin_content_diff',
                    // Reports a draft sibling and its status — `liveWhere`
                    // there scopes to workspace + soft-delete only.
                    'i18n_translations_get',
                    // Permissions no token scope mints, so these could never
                    // list anyway; `surfaces` says so rather than leaving it
                    // to a coincidence of the scope table.
                    'activity_recent',
                    'workspace_members_list',
                    // `alarms:read` is mintable by no scope either, and a
                    // finding names entries regardless of publish state.
                    'admin_alarms_findings',
                    // Every propose tool: the handler writes nothing and hands
                    // back a change for the run engine to record and apply.
                    // There is no engine here, so a call would look like a
                    // success and change nothing at all.
                    'content_propose_create',
                    'content_propose_update',
                    'i18n_propose_translation',
                    'i18n_propose_bulk_translation',
                    'media_propose_alt_text',
                    'media_propose_file'
                ])
            );
        });

        // The complement of the case above, and the reason `surfaces` is a
        // deliberate declaration rather than a wall: a tool with no draft
        // state to leak, no write, and no user-only attribution belongs to
        // both callers. These are the registry's shared tools — a change that
        // makes one of them copilot-only should have to delete an assertion.
        it('shows the shared tools to a read-scoped token [media:I-30]', async () => {
            const { secret } = await mintToken({ scope: 'read' });

            const res = await rpc(secret, 'tools/list').expect(200);
            const names = (
                (res.body as RpcResponse).result as { tools: McpTool[] }
            ).tools.map((tool) => tool.name);

            expect(names).toEqual(
                expect.arrayContaining([
                    'i18n_locales_list',
                    'media_assets_search',
                    'media_folders_list',
                    'media_asset_read'
                ])
            );
        });

        it('runs a shared tool for a read-scoped token', async () => {
            const { secret } = await mintToken({ scope: 'read' });

            const { isError, data } = await callTool(
                secret,
                'i18n_locales_list'
            );

            expect(isError).toBeFalsy();
            // Listed *and* callable: `forSurface` narrows both, so a tool that
            // lists but 404s on call would mean the two had drifted.
            expect(data).toHaveProperty('locales');
        });

        // The one thing a shared tool is allowed to vary by surface, and the
        // reason `ToolContext.surface` exists. The admin's raw route scopes by
        // workspace *membership*, which a token has none of, so handing an MCP
        // client that path would be a link it is guaranteed to get a 401 from.
        it('gives an MCP caller the bearer-fetchable download path [media:I-30]', async () => {
            const { secret: writeSecret } = await mintToken({ scope: 'full' });
            await request(harness.server)
                .post('/api/v1/media/assets')
                .set('Authorization', `Bearer ${writeSecret}`)
                .set('X-Workspace-Id', workspaceId)
                .attach('file', PNG, {
                    filename: 'pixel.png',
                    contentType: 'image/png'
                })
                .expect(201);

            const { secret } = await mintToken({ scope: 'read' });
            const { isError, data } = await callTool(
                secret,
                'media_assets_search'
            );

            expect(isError).toBeFalsy();
            const items = (data as { items: { downloadPath: string }[] }).items;
            expect(items).toHaveLength(1);
            expect(items[0].downloadPath).toMatch(
                /^\/api\/v1\/media\/assets\/[^/]+\/raw$/
            );
            // …and the path is one the caller can actually fetch, which is the
            // whole point: the admin's route derives its scope from workspace
            // membership and 401s a bearer.
            await request(harness.server)
                .get(items[0].downloadPath)
                .set('Authorization', `Bearer ${secret}`)
                .set('X-Workspace-Id', workspaceId)
                .expect(200);
        });

        // Surface filtering is applied in `call` too, not only in `list` —
        // exactly as the permission check is, and for the same reason: a client
        // may invoke a name it was never shown.
        it('refuses a copilot-only tool invoked by name [mcp:I-09]', async () => {
            const { secret } = await mintToken({ scope: 'full' });

            const { isError } = await callTool(secret, 'admin_content_search', {
                typeName: 'test_article'
            });

            expect(isError).toBe(true);
        });

        // The media propose tool is the sharper half of the same rule: it
        // *writes*, and a token holds `media:create` under the `full` scope, so
        // permissions alone would let this through. Only `surfaces` stops it —
        // and it has to, because an MCP client has no way to answer the
        // permission prompt the write is gated behind.
        it('refuses copilot-only file creation, which a full token could otherwise afford', async () => {
            const { secret } = await mintToken({ scope: 'full' });

            const { isError } = await callTool(secret, 'media_propose_file', {
                fileName: 'backdoor',
                format: 'md',
                content: '# Written without a prompt',
                summary: 'Backdoor'
            });

            expect(isError).toBe(true);
        });

        it('gives every tool an object input schema', async () => {
            const { secret } = await mintToken({ scope: 'full' });

            const res = await rpc(secret, 'tools/list').expect(200);
            const tools = (
                (res.body as RpcResponse).result as { tools: McpTool[] }
            ).tools;

            for (const tool of tools) {
                expect(tool.inputSchema['type']).toBe('object');
                expect(tool.description.length).toBeGreaterThan(0);
            }
        });
    });

    describe('authorization', () => {
        // The security boundary: `tools/list` only hides a tool, and a client
        // is free to invoke a name it was never shown.
        it('refuses a write tool a read token invokes by name [mcp:I-08] [tools:I-05]', async () => {
            const { secret } = await mintToken({ scope: 'read' });

            const { isError, data } = await callTool(secret, 'content_create', {
                typeName: 'test_article',
                values: { text: 'Sneaky' }
            });

            expect(isError).toBe(true);
            expect(data['code']).toBe('forbidden');
        });

        it('refuses each write tool to a read token', async () => {
            const { secret } = await mintToken({ scope: 'read' });
            const id = await seedPublished('Untouchable');

            for (const name of [
                'content_update',
                'content_publish',
                'content_unpublish',
                'content_delete'
            ]) {
                const { isError, data } = await callTool(secret, name, {
                    typeName: 'test_article',
                    id,
                    values: {}
                });
                expect({ name, isError, code: data['code'] }).toEqual({
                    name,
                    isError: true,
                    code: 'forbidden'
                });
            }
        });

        it('refuses draft visibility to a read token [mcp:I-24]', async () => {
            const { secret } = await mintToken({ scope: 'read' });

            const { isError, data } = await callTool(secret, 'content_list', {
                typeName: 'test_article',
                status: 'any'
            });

            expect(isError).toBe(true);
            expect(data['code']).toBe('forbidden');
        });

        // `surfaces` is scoping, not decoration: `ToolRegistry.call` looks the
        // name up **within** the caller's surface, so a copilot-only tool is
        // not merely hidden from `tools/list` — it does not exist here. Which
        // is the honest answer: `alarms:read` is mintable by no scope, so a
        // token that could reach the handler would be refused by it anyway.
        it('refuses a copilot-only tool a full-scope token names [alarms:I-34]', async () => {
            const { secret } = await mintToken({ scope: 'full' });

            const { isError, data } = await callTool(
                secret,
                'admin_alarms_findings'
            );

            expect(isError).toBe(true);
            expect(data['code']).toBe('not_found');
        });

        it('reports an unknown tool as not_found [tools:I-10]', async () => {
            const { secret } = await mintToken();

            const { isError, data } = await callTool(
                secret,
                'content_teleport'
            );

            expect(isError).toBe(true);
            expect(data['code']).toBe('not_found');
        });
    });

    // `ToolRegistry.call` checks a call's arguments against the tool's own
    // `inputSchema` before dispatch. The copilot's run engine always did; MCP
    // did not, so a shared tool answered a malformed call by running anyway —
    // `pageSize: "lots"` came back as `"pageSize": null`, an unknown property
    // was silently dropped despite `additionalProperties: false`, and an
    // invalid enum reached a query that threw a bare `Error` and became an
    // opaque 500. One registry, one answer.
    describe('argument validation', () => {
        it('refuses arguments the tool’s inputSchema rejects', async () => {
            const { secret } = await mintToken();

            const { isError, data } = await callTool(
                secret,
                'media_assets_search',
                { pageSize: 'lots', kind: '../etc/passwd', nope: 1 }
            );

            expect(isError).toBe(true);
            expect(data['status']).toBe(422);
            expect(data['code']).toBe('validation_failed');
            // Per field, so the model can fix exactly what it got wrong.
            expect(data['issues']).toEqual([
                { field: 'pageSize', message: 'expected integer' },
                {
                    field: 'kind',
                    message:
                        'must be one of image, video, audio, document, archive'
                },
                { field: 'nope', message: 'unexpected property' }
            ]);
        });

        it('refuses a call missing a required argument', async () => {
            const { secret } = await mintToken();

            const { isError, data } = await callTool(secret, 'content_list');

            expect(isError).toBe(true);
            expect(data['code']).toBe('validation_failed');
            expect(data['issues']).toEqual([
                { field: 'typeName', message: 'required' }
            ]);
        });

        it('still answers a permission refusal before it reads the arguments [mcp:I-10]', async () => {
            const { secret } = await mintToken({ scope: 'read' });

            const { isError, data } = await callTool(secret, 'content_delete', {
                nonsense: true
            });

            // Forbidden, not validation_failed: an actor who may not call the
            // tool must not be able to probe its argument shape.
            expect(isError).toBe(true);
            expect(data['code']).toBe('forbidden');
        });

        it('lets a well-formed call through untouched', async () => {
            const { secret } = await mintToken();

            const { isError, data } = await callTool(
                secret,
                'media_assets_search',
                { pageSize: 5, kind: 'image' }
            );

            expect(isError).toBe(false);
            expect(data['pageSize']).toBe(5);
        });

        // The registry's JSON Schema subset deliberately ignores `format` and
        // `pattern`, so a uuid-shaped argument is only `{"type": "string"}` and
        // the check lives in the query. Those checks raise framework-free
        // domain errors, which `toToolError` used to treat as a bug: a plainly
        // bad argument came back as an opaque 500 with the reason withheld, so
        // an MCP caller had nothing to fix.
        it('reports a non-uuid folderId as bad_request, not an opaque 500', async () => {
            const { secret } = await mintToken();

            const { isError, data } = await callTool(
                secret,
                'media_assets_search',
                { folderId: 'not-a-uuid' }
            );

            expect(isError).toBe(true);
            expect(data['status']).toBe(400);
            expect(data['code']).toBe('bad_request');
            expect(data['message']).toMatch(/folderId/);
        });

        it('reports a non-uuid assetId as bad_request, not an opaque 500', async () => {
            // Same defect one tool over: `locate` filters on a `uuid` column,
            // so the driver — not the tool — was deciding the status.
            const { secret } = await mintToken();

            const { isError, data } = await callTool(
                secret,
                'media_asset_read',
                { assetId: 'not-a-uuid' }
            );

            expect(isError).toBe(true);
            expect(data['status']).toBe(400);
            expect(data['code']).toBe('bad_request');
        });
    });

    describe('discovery', () => {
        it('lists only the workspace’s granted types', async () => {
            const { secret } = await mintToken();

            const { data } = await callTool(secret, 'content_types_list');
            const names = (data['items'] as { name: string }[]).map(
                (item) => item.name
            );

            expect(names).toContain('test_article');
            expect(names).not.toContain('test_page');
        });

        it('returns a type’s fields and a values JSON Schema', async () => {
            const { secret } = await mintToken();

            const { data } = await callTool(secret, 'content_type_get', {
                typeName: 'test_article'
            });

            expect(data['name']).toBe('test_article');
            const schema = data['valuesSchema'] as {
                type: string;
                properties: Record<string, unknown>;
            };
            expect(schema.type).toBe('object');
            expect(schema.properties).toHaveProperty('text');
            // Publishable: `required` means required *to publish*, so telling
            // a model it cannot save an incomplete draft would be wrong.
            expect(schema).not.toHaveProperty('required');
        });

        it('404s an ungranted type exactly like an unknown one [tools:I-11]', async () => {
            const { secret } = await mintToken();

            const ungranted = await callTool(secret, 'content_type_get', {
                typeName: 'test_page'
            });
            const unknown = await callTool(secret, 'content_type_get', {
                typeName: 'no_such_type'
            });

            expect(ungranted.data['code']).toBe('not_found');
            expect(unknown.data['code']).toBe('not_found');
        });

        it('exposes granted types as resources', async () => {
            const { secret } = await mintToken();

            const res = await rpc(secret, 'resources/list').expect(200);
            const resources = (
                (res.body as RpcResponse).result as {
                    resources: { uri: string }[];
                }
            ).resources;

            expect(resources.map((entry) => entry.uri)).toContain(
                'apograph://content-type/test_article'
            );
            expect(resources.map((entry) => entry.uri)).not.toContain(
                'apograph://content-type/test_page'
            );
        });

        it('reads a content-type resource', async () => {
            const { secret } = await mintToken();

            const res = await rpc(secret, 'resources/read', {
                uri: 'apograph://content-type/test_article'
            }).expect(200);

            const contents = (
                (res.body as RpcResponse).result as {
                    contents: { uri: string; text: string }[];
                }
            ).contents[0];
            expect(JSON.parse(contents.text)['name']).toBe('test_article');
        });
    });

    describe('reads', () => {
        it('lists published entries only [mcp:I-24]', async () => {
            const { secret } = await mintToken();
            await seedPublished('Live one');
            await seedArticles(
                [{ text: 'A draft', status: 'draft' }],
                workspaceId
            );

            const { data } = await callTool(secret, 'content_list', {
                typeName: 'test_article'
            });

            expect(data['total']).toBe(1);
            expect(
                (data['items'] as { values: { text: string } }[])[0].values.text
            ).toBe('Live one');
        });

        it('does not leak another workspace’s entries', async () => {
            const { secret } = await mintToken({ workspaceIds: [workspaceId] });
            await seedPublished('Theirs', otherWorkspaceId);

            const { data } = await callTool(secret, 'content_list', {
                typeName: 'test_article'
            });

            expect(data['total']).toBe(0);
        });

        it('reads one entry by id', async () => {
            const { secret } = await mintToken();
            const id = await seedPublished('Readable');

            const { data } = await callTool(secret, 'content_get', {
                typeName: 'test_article',
                id
            });

            expect(data['id']).toBe(id);
        });

        it('honours a sparse fieldset', async () => {
            const { secret } = await mintToken();
            const id = await seedPublished('Sparse');

            const { data } = await callTool(secret, 'content_get', {
                typeName: 'test_article',
                id,
                fields: 'text'
            });

            expect(Object.keys(data['values'] as object)).toEqual(['text']);
        });

        it('rejects an unknown argument rather than ignoring it', async () => {
            const { secret } = await mintToken();

            const { isError, data } = await callTool(secret, 'content_list', {
                typeName: 'test_article',
                pagesize: 5
            });

            expect(isError).toBe(true);
            // The registry's schema check now catches this before the DTO
            // layer does, so a mistyped argument answers `validation_failed`
            // (422) rather than the `bad_request` (400) the strict DTO used to
            // produce. Same refusal, one layer earlier, and now identical for
            // the shared tools that have no DTO behind them at all.
            expect(data['code']).toBe('validation_failed');
            expect(data['issues']).toEqual([
                { field: 'pagesize', message: 'unexpected property' }
            ]);
        });

        it('requires a locator on a single-entry read', async () => {
            const { secret } = await mintToken();

            const { isError, data } = await callTool(secret, 'content_get', {
                typeName: 'test_article'
            });

            expect(isError).toBe(true);
            expect(data['code']).toBe('bad_request');
        });
    });

    describe('write round-trip', () => {
        it('creates a draft, reads it back, publishes, and deletes it', async () => {
            const { secret } = await mintToken({ scope: 'full' });

            // Create — lands as a draft.
            const created = await callTool(secret, 'content_create', {
                typeName: 'test_article',
                values: { text: 'From an agent', select: 'article' }
            });
            expect(created.isError).toBe(false);
            const id = created.data['id'] as string;
            expect(created.data['status']).toBe('draft');

            // Invisible to a published-only read...
            const beforePublish = await callTool(secret, 'content_list', {
                typeName: 'test_article'
            });
            expect(beforePublish.data['total']).toBe(0);

            // ...but reachable with `status: any`, which is why the widening
            // exists at all: otherwise the write API would be write-only.
            const draftRead = await callTool(secret, 'content_get', {
                typeName: 'test_article',
                id,
                status: 'any'
            });
            expect(draftRead.data['id']).toBe(id);

            // Update merges — the untouched field survives.
            const updated = await callTool(secret, 'content_update', {
                typeName: 'test_article',
                id,
                values: { number: 7 }
            });
            expect(
                (updated.data['values'] as Record<string, unknown>)['text']
            ).toBe('From an agent');
            expect(
                (updated.data['values'] as Record<string, unknown>)['number']
            ).toBe(7);

            // Publish takes it live.
            const published = await callTool(secret, 'content_publish', {
                typeName: 'test_article',
                id
            });
            expect(published.data['status']).toBe('published');

            const afterPublish = await callTool(secret, 'content_list', {
                typeName: 'test_article'
            });
            expect(afterPublish.data['total']).toBe(1);

            // Unpublish takes it back off the air.
            await callTool(secret, 'content_unpublish', {
                typeName: 'test_article',
                id
            });
            const afterUnpublish = await callTool(secret, 'content_list', {
                typeName: 'test_article'
            });
            expect(afterUnpublish.data['total']).toBe(0);

            // Delete.
            const deleted = await callTool(secret, 'content_delete', {
                typeName: 'test_article',
                id
            });
            expect(deleted.data).toEqual({ deleted: true });

            const afterDelete = await callTool(secret, 'content_get', {
                typeName: 'test_article',
                id,
                status: 'any'
            });
            expect(afterDelete.data['code']).toBe('not_found');
        });

        it('clears a field with an explicit null but leaves omitted ones', async () => {
            const { secret } = await mintToken({ scope: 'full' });
            const created = await callTool(secret, 'content_create', {
                typeName: 'test_article',
                values: { text: 'Keeper', richtext: 'Droppable' }
            });
            const id = created.data['id'] as string;

            const updated = await callTool(secret, 'content_update', {
                typeName: 'test_article',
                id,
                values: { richtext: null }
            });

            const values = updated.data['values'] as Record<string, unknown>;
            expect(values['text']).toBe('Keeper');
            expect(values['richtext']).toBeNull();
        });

        // The most useful failure a model can get: the offending fields, named.
        it('reports publish-time validation failures with per-field issues', async () => {
            const { secret } = await mintToken({ scope: 'full' });
            // `text` has a minLength of 3, and required rules bite at publish.
            const created = await callTool(secret, 'content_create', {
                typeName: 'test_article',
                values: { text: 'x' }
            });
            expect(created.isError).toBe(false);

            const published = await callTool(secret, 'content_publish', {
                typeName: 'test_article',
                id: created.data['id']
            });

            expect(published.isError).toBe(true);
            expect(published.data['code']).toBe('validation_failed');
            expect(published.data['issues']).toBeDefined();
        });

        it('cannot write into a workspace outside the bucket', async () => {
            const { secret } = await mintToken({
                scope: 'full',
                workspaceIds: [workspaceId]
            });

            await rpc(
                secret,
                'tools/call',
                {
                    name: 'content_create',
                    arguments: {
                        typeName: 'test_article',
                        values: { text: 'Trespass' }
                    }
                },
                { workspaceId: otherWorkspaceId }
            ).expect(403);
        });
    });

    /**
     * The transport contract, as opposed to the tool contract: which verbs the
     * endpoint answers, what a malformed frame gets back, and the ceilings one
     * exchange runs under. Everything here must be a well-formed answer — never
     * a 500, and never a hang.
     */
    describe('transport', () => {
        // A stateless endpoint has no server-initiated stream to open. Handed
        // the GET, the SDK transport opens an SSE stream and holds it forever,
        // so the controller answers before it gets there.
        it('405s a GET rather than opening a stream nothing will ever write to', async () => {
            const { secret } = await mintToken();

            const res = await request(harness.server)
                .get(MCP_PATH)
                .set('Authorization', `Bearer ${secret}`)
                .set('Accept', 'text/event-stream')
                .expect(405);

            expect(res.headers['allow']).toBe('POST');
            expect((res.body as RpcResponse).error?.message).toContain(
                'stateless'
            );
        });

        it('405s a DELETE — there is no session to end', async () => {
            const { secret } = await mintToken();

            await request(harness.server)
                .delete(MCP_PATH)
                .set('Authorization', `Bearer ${secret}`)
                .expect(405);
        });

        // Authentication runs before the protocol layer, so the verb answer is
        // not reachable without a credential.
        it('401s an unauthenticated GET, before the verb is considered [mcp:I-02]', async () => {
            await request(harness.server).get(MCP_PATH).expect(401);
        });

        it('401s a bearer value carrying internal whitespace [mcp:I-05]', async () => {
            const { secret } = await mintToken();

            await request(harness.server)
                .post(MCP_PATH)
                .set('Authorization', `Bearer ${secret} extra`)
                .set('Accept', ACCEPT)
                .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
                .expect(401);
        });

        // Express parses a repeated query parameter into an array. Reading that
        // as "unnamed" let a single-workspace token quietly succeed against its
        // own workspace while the caller had named two others.
        it('400s a repeated ?workspaceId= instead of ignoring it [mcp:I-06]', async () => {
            const { secret } = await mintToken();

            const res = await rpc(secret, 'tools/list', undefined, {
                query: `workspaceId=${workspaceId}&workspaceId=${otherWorkspaceId}`
            }).expect(400);

            expect(res.body.message).toContain('more than one workspace');
        });

        it('answers an unknown method with -32601, not a 500', async () => {
            const { secret } = await mintToken();

            const res = await rpc(secret, 'prompts/list').expect(200);

            expect((res.body as RpcResponse).error?.code).toBe(-32601);
        });

        // A notification carries no id, so there is nothing to respond to.
        it('202s a notification with an empty body', async () => {
            const { secret } = await mintToken();

            const res = await request(harness.server)
                .post(MCP_PATH)
                .set('Authorization', `Bearer ${secret}`)
                .set('Accept', ACCEPT)
                .send({ jsonrpc: '2.0', method: 'notifications/initialized' })
                .expect(202);

            expect(res.text).toBe('');
        });

        // One bearer check, many operations — the reason this endpoint is one
        // route rather than a route per tool.
        it('answers a batch with one result per request', async () => {
            const { secret } = await mintToken();

            const res = await request(harness.server)
                .post(MCP_PATH)
                .set('Authorization', `Bearer ${secret}`)
                .set('Accept', ACCEPT)
                .send([
                    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
                    { jsonrpc: '2.0', id: 2, method: 'resources/list' }
                ])
                .expect(200);

            const body = res.body as RpcResponse[];
            expect(body).toHaveLength(2);
            expect(body.map((entry) => entry.id).sort()).toEqual([1, 2]);
            expect(body.every((entry) => entry.result !== undefined)).toBe(
                true
            );
        });

        it.each([
            ['an empty body', ''],
            ['a frame with no method', { jsonrpc: '2.0', id: 1 }],
            [
                'a frame claiming JSON-RPC 1.0',
                { jsonrpc: '1.0', id: 1, method: 'tools/list' }
            ]
        ])('answers %s with a JSON-RPC error, not a 500', async (_l, body) => {
            const { secret } = await mintToken();

            const res = await request(harness.server)
                .post(MCP_PATH)
                .set('Authorization', `Bearer ${secret}`)
                .set('Accept', ACCEPT)
                .set('Content-Type', 'application/json')
                .send(body as never)
                .expect(400);

            expect((res.body as RpcResponse).error?.code).toBeLessThan(0);
        });

        // The single most common first-connection failure, so the message has
        // to name the fix.
        it('406s a POST that does not accept both content types', async () => {
            const { secret } = await mintToken();

            const res = await request(harness.server)
                .post(MCP_PATH)
                .set('Authorization', `Bearer ${secret}`)
                .set('Accept', 'application/json')
                .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
                .expect(406);

            expect((res.body as RpcResponse).error?.message).toContain(
                'text/event-stream'
            );
        });

        it('ignores an Mcp-Session-Id from a client that thinks it has one [mcp:I-17]', async () => {
            const { secret } = await mintToken();

            await request(harness.server)
                .post(MCP_PATH)
                .set('Authorization', `Bearer ${secret}`)
                .set('Accept', ACCEPT)
                .set('Mcp-Session-Id', 'a-session-that-never-existed')
                .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
                .expect(200);
        });

        // The asymmetry, pinned on the wire: a tool failure is a result, a
        // resource failure is a protocol error — and it carries the same
        // flattened payload either way.
        it('answers an unreadable resource URI with -32002 and structured data [mcp:I-12]', async () => {
            const { secret } = await mintToken();

            const res = await rpc(secret, 'resources/read', {
                uri: 'apograph://content-type/never_granted'
            }).expect(200);

            const body = res.body as RpcResponse & {
                error?: { data?: Record<string, unknown> };
            };
            expect(body.result).toBeUndefined();
            expect(body.error?.code).toBe(-32002);
            expect(body.error?.data).toMatchObject({ code: 'not_found' });
        });

        it('refuses a tool result over the endpoint ceiling [mcp:I-15]', async () => {
            const tiny = await createTestApp({ mcpMaxResultBytes: 200 });
            try {
                const agent = request.agent(tiny.server);
                await agent
                    .post('/api/auth/login')
                    .send({ email: ADMIN_EMAIL, password: PASSWORD })
                    .expect(201);
                const minted = await agent
                    .post('/api/api-tokens')
                    .send({
                        name: 'mcp-ceiling',
                        workspaceIds: [workspaceId],
                        scope: 'read'
                    })
                    .expect(201);

                const res = await request(tiny.server)
                    .post(MCP_PATH)
                    .set('Authorization', `Bearer ${minted.body.secret}`)
                    .set('Accept', ACCEPT)
                    .send({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'tools/call',
                        params: {
                            name: 'content_types_list',
                            arguments: {}
                        }
                    })
                    .expect(200);

                const result = (res.body as RpcResponse).result as {
                    isError?: boolean;
                    structuredContent?: unknown;
                    content: { text: string }[];
                };
                expect(result.isError).toBe(true);
                expect(result.structuredContent).toBeUndefined();
                expect(JSON.parse(result.content[0].text)['code']).toBe(
                    'result_too_large'
                );
            } finally {
                await tiny.app.close();
            }
        });

        it('abandons a tool call that outlives the endpoint deadline [mcp:I-15]', async () => {
            // 1ms is shorter than any real query, so whichever tool runs, the
            // deadline wins — this pins that the caller always gets an answer.
            const impatient = await createTestApp({ mcpCallTimeoutMs: 1 });
            try {
                const agent = request.agent(impatient.server);
                await agent
                    .post('/api/auth/login')
                    .send({ email: ADMIN_EMAIL, password: PASSWORD })
                    .expect(201);
                const minted = await agent
                    .post('/api/api-tokens')
                    .send({
                        name: 'mcp-deadline',
                        workspaceIds: [workspaceId],
                        scope: 'read'
                    })
                    .expect(201);

                const res = await request(impatient.server)
                    .post(MCP_PATH)
                    .set('Authorization', `Bearer ${minted.body.secret}`)
                    .set('Accept', ACCEPT)
                    .send({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'tools/call',
                        params: {
                            name: 'content_list',
                            arguments: { typeName: 'test_article' }
                        }
                    })
                    .expect(200);

                const result = (res.body as RpcResponse).result as {
                    isError?: boolean;
                    content: { text: string }[];
                };
                expect(result.isError).toBe(true);
                const failure = JSON.parse(result.content[0].text);
                expect(failure['status']).toBe(504);
                expect(failure['code']).toBe('timeout');
            } finally {
                await impatient.app.close();
            }
        });
    });

    describe('kill switch', () => {
        it('unmounts the endpoint when disabled', async () => {
            const disabled = await createTestApp({ mcpEnabled: false });
            try {
                const agent = request.agent(disabled.server);
                await agent
                    .post('/api/auth/login')
                    .send({ email: ADMIN_EMAIL, password: PASSWORD })
                    .expect(201);
                const minted = await agent
                    .post('/api/api-tokens')
                    .send({
                        name: 'mcp-off',
                        workspaceIds: [workspaceId],
                        scope: 'read'
                    })
                    .expect(201);

                await request(disabled.server)
                    .post(MCP_PATH)
                    .set('Authorization', `Bearer ${minted.body.secret}`)
                    .set('Accept', ACCEPT)
                    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
                    .expect(404);
            } finally {
                await disabled.app.close();
            }
        });
    });
});
