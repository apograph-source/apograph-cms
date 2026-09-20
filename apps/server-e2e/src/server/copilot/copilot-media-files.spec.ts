import request from 'supertest';
import {
    closeTestApp,
    createTestApp,
    type TestApp
} from '../../support/test-app';
import {
    countMediaAssets,
    resetDb,
    seedActiveUser,
    seedMediaAsset,
    seedMediaFolder,
    seedMembership,
    seedWorkspace,
    type SeededWorkspace
} from '../../support/seed';
import { copilotCalls, scriptCopilot } from '../../support/copilot';
import { framesOfType, parseSse, streamSse } from '../../support/sse';
import { TEST_ALLOWED_ORIGIN } from '../../support/test-config';

const ADMIN_EMAIL = 'media-file-admin@example.com';
const VIEWER_EMAIL = 'media-file-viewer@example.com';
const CONTRIBUTOR_EMAIL = 'media-file-contributor@example.com';
const PASSWORD = 'SecurePass123!';

/**
 * `media_propose_file` end to end — Ortha AI authoring a report into the media
 * library, from the offer through the permission prompt to a real asset with
 * real bytes behind it.
 *
 * The suite is separate from `copilot-proposals.spec.ts` because the property
 * under test is different. That one is about the *mechanism* — a change asks
 * first, is recorded before it is made, and runs the ordinary use-case. This
 * one is about the mechanism reaching **storage**: a proposal whose apply ends
 * in a blob, a MIME type derived from a closed enum rather than from the model,
 * and the failure paths that have to land *before* approval to be recoverable.
 */
describe('Copilot file creation', () => {
    let harness: TestApp;
    let workspace: SeededWorkspace;

    beforeAll(async () => {
        harness = await createTestApp();
    });

    afterAll(async () => {
        await closeTestApp(harness);
    });

    beforeEach(async () => {
        await resetDb();
        workspace = await seedWorkspace({ name: 'Docs', slug: 'docs' });
    });

    async function login(email: string) {
        const agent = request.agent(harness.server);
        await agent
            .post('/api/auth/login')
            .send({ email, password: PASSWORD })
            .expect(201);
        agent.set('X-Workspace-Id', workspace.id);
        return agent;
    }

    async function signIn(
        email: string,
        role: 'admin' | 'contributor' | 'viewer'
    ) {
        const user = await seedActiveUser(harness.app, {
            email,
            password: PASSWORD,
            role
        });
        await seedMembership(user.id, workspace.id);
        return { user, agent: await login(email) };
    }

    async function run(agent: request.Agent, body: Record<string, unknown>) {
        const response = await agent
            .post('/api/copilot/runs')
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .send(body)
            .expect(200);
        return parseSse(response.text);
    }

    /** Answer one parked call. Fire-and-forget: the run is awaiting this. */
    function decide(
        agent: request.Agent,
        runId: string,
        callId: string,
        decision: 'once' | 'chat' | 'deny'
    ): void {
        void agent
            .post(`/api/copilot/runs/${runId}/permission`)
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .send({ callId, decision })
            .expect(204)
            .catch((error: Error) => {
                throw new Error(`answering ${callId} failed: ${error.message}`);
            });
    }

    /**
     * Script one `media_propose_file` call, answer the prompt it parks on, and
     * return the frames.
     *
     * The answer has to go out **mid-stream** — a propose tool suspends the run
     * until `POST /runs/:runId/permission` resolves it, so buffering the whole
     * SSE body first would deadlock waiting for an ending that cannot arrive.
     */
    async function proposeFile(
        agent: request.Agent,
        input: Record<string, unknown>,
        decision: 'once' | 'chat' | 'deny' = 'once'
    ) {
        scriptCopilot(
            { toolCalls: [{ name: 'media_propose_file', input }] },
            { text: 'Written for you.' }
        );
        const request$ = agent
            .post('/api/copilot/runs')
            .set('Origin', TEST_ALLOWED_ORIGIN)
            .send({ message: 'write me a report' })
            .expect(200);
        const events = await streamSse(request$, (event) => {
            if (event.type === 'tool-permission-request') {
                decide(agent, event.runId, event.id, decision);
            }
        });
        return {
            events,
            result: framesOfType(events, 'tool-result')[0],
            proposal: framesOfType(events, 'proposal')[0],
            permission: framesOfType(events, 'tool-permission-request')[0]
        };
    }

    /**
     * The library's own listing of one folder — `folderId` omitted lists the
     * workspace **root**, which is what the route means by an absent filter.
     */
    async function listAssets(agent: request.Agent, folderId?: string) {
        const response = await agent
            .get('/api/media/assets')
            .query(folderId ? { folderId } : {})
            .expect(200);
        return response.body.items as {
            id: string;
            name: string;
            mimeType: string;
            size: number;
            kind: string;
            folderId: string | null;
        }[];
    }

    // ------------------------------------------------------------- the offer
    describe('the offer', () => {
        it('offers file creation to a contributor, who holds media:create', async () => {
            scriptCopilot({ text: 'ok' });
            const { agent } = await signIn(CONTRIBUTOR_EMAIL, 'contributor');

            await run(agent, { message: 'hello' });

            expect(
                (copilotCalls()[0].tools ?? []).map((t) => t.name)
            ).toContain('media_propose_file');
        });

        // The property no new permission was introduced in order to preserve:
        // a viewer holds `media:read` and not `media:create`, so their copilot
        // is offered every media read tool and no way to write one.
        it('withholds it from a viewer, whose copilot stays read-only', async () => {
            scriptCopilot({ text: 'ok' });
            const { agent } = await signIn(VIEWER_EMAIL, 'viewer');

            await run(agent, { message: 'hello' });

            const offered = (copilotCalls()[0].tools ?? []).map((t) => t.name);
            expect(offered).not.toContain('media_propose_file');
            expect(offered).toContain('media_assets_search');
            expect(offered).toContain('media_asset_read');
        });

        // Withheld at offer time is a usability filter; `ToolRegistry.call` is
        // the boundary. A model can name a tool it was never shown.
        it('refuses the call from a viewer who names it anyway', async () => {
            const { agent } = await signIn(VIEWER_EMAIL, 'viewer');

            const { result } = await proposeFile(agent, {
                fileName: 'audit',
                format: 'md',
                content: '# Audit',
                summary: 'Audit'
            });

            expect(result.ok).toBe(false);
            expect(await countMediaAssets(workspace.id)).toBe(0);
        });
    });

    // ------------------------------------------------------- the happy path
    describe('an approved file lands in the library', () => {
        it('creates a real asset with the bytes the model wrote', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');
            const content = '# Q3 audit\n\n- 12 drafts\n- 3 stale entries\n';

            const { result, proposal } = await proposeFile(agent, {
                fileName: 'Q3 audit',
                format: 'md',
                content,
                summary: 'Q3 content audit as Markdown'
            });

            expect(result.ok).toBe(true);
            expect(proposal.status).toBe('accepted');

            const [asset] = await listAssets(agent);
            expect(asset).toMatchObject({
                name: 'Q3 audit.md',
                // Derived from `format`, never from anything the model said.
                mimeType: 'text/markdown',
                kind: 'document',
                size: Buffer.byteLength(content, 'utf8'),
                folderId: null
            });

            // The bytes are really in storage, not just a row describing them.
            const download = await agent
                .get(`/api/media/assets/${asset.id}/raw`)
                .expect(200);
            expect(download.text).toBe(content);
        });

        it('files it in the folder the model chose', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');
            const folder = await seedMediaFolder({
                workspaceId: workspace.id,
                name: 'Reports'
            });

            await proposeFile(agent, {
                fileName: 'weekly',
                format: 'csv',
                content: 'type,count\narticle,12\n',
                folderId: folder.id,
                summary: 'Weekly counts'
            });

            const [asset] = await listAssets(agent, folder.id);
            expect(asset.folderId).toBe(folder.id);
            expect(asset.name).toBe('weekly.csv');
            expect(asset.mimeType).toBe('text/csv');
        });

        // The extension follows from `format`, so a model that puts the wrong
        // one in `fileName` cannot make the name disagree with the MIME type.
        it('replaces an extension that contradicts the chosen format', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            await proposeFile(agent, {
                fileName: 'summary.txt',
                format: 'md',
                content: '# Summary',
                summary: 'Summary'
            });

            const [asset] = await listAssets(agent);
            expect(asset.name).toBe('summary.md');
            expect(asset.mimeType).toBe('text/markdown');
        });

        // ADR-0009's gate: the arguments are shown *before* the call runs, so
        // the person approving is reading the report rather than discovering it.
        it('shows the file’s text in the prompt before anything is written', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            const { permission } = await proposeFile(agent, {
                fileName: 'draft',
                format: 'md',
                content: '# The whole report',
                summary: 'Draft'
            });

            expect(permission.name).toBe('media_propose_file');
            expect(JSON.stringify(permission.input)).toContain(
                'The whole report'
            );
        });

        it('writes nothing when the user refuses', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            const { result } = await proposeFile(
                agent,
                {
                    fileName: 'unwanted',
                    format: 'md',
                    content: '# No',
                    summary: 'Unwanted'
                },
                'deny'
            );

            expect(result.ok).toBe(false);
            expect(await countMediaAssets(workspace.id)).toBe(0);
        });

        // The row written before the write is the only thing carrying
        // ADR-0005 §5's "undoable, never invisible" now that nothing waits for
        // review. A file with no receipt would be a change nobody can trace.
        it('records the change as a proposal joined to the new asset', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            const { proposal } = await proposeFile(agent, {
                fileName: 'traceable',
                format: 'txt',
                content: 'hello',
                summary: 'A traceable file'
            });

            const [asset] = await listAssets(agent);
            expect(proposal.entityId).toBe(asset.id);

            const response = await agent
                .get('/api/copilot/proposals')
                .expect(200);
            const rows = response.body.items as {
                toolName: string;
                kind: string;
                status: string;
                result: Record<string, unknown> | null;
            }[];
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                toolName: 'media_propose_file',
                kind: 'media.asset.create',
                status: 'accepted'
            });
            // The applier's own return value, recorded on the row — the receipt
            // that ties this change to the file it produced.
            expect(rows[0].result).toMatchObject({
                entityId: asset.id,
                detail: expect.objectContaining({
                    fileName: 'traceable.txt',
                    format: 'txt'
                })
            });
        });
    });

    // ----------------------------------------------- failing before the write
    describe('a bad draft fails before anything is written', () => {
        /**
         * Approve the call, then assert it failed anyway.
         *
         * The run engine asks **before** it runs a write tool (ADR-0009's
         * injection mitigation), so a bad draft still parks on the permission
         * prompt — the checks in `media_propose_file` run when the approved
         * call reaches the handler. That is still ahead of every write: the
         * failure lands as a tool error the model can act on, with no asset,
         * no blob and no `copilot_proposals` row behind it. Which is why the
         * prompt has to be answered here too, exactly as the happy path does
         * it — buffering the body would deadlock on a run that is waiting.
         */
        async function attempt(
            agent: request.Agent,
            input: Record<string, unknown>
        ) {
            const { result } = await proposeFile(agent, input);
            return result;
        }

        // A model asked for a report proposes `reports/2026/q3.md` readily.
        // Flattening it silently would file the report at the root while the
        // model told the user it went to `reports/2026`.
        it('rejects a path and names the parameter that does the job [media:I-32]', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            const result = await attempt(agent, {
                fileName: 'reports/2026/q3',
                format: 'md',
                content: '# Q3',
                summary: 'Q3'
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('folderId');
            expect(await countMediaAssets(workspace.id)).toBe(0);
            // The draft never became a change: a proposal row is written from
            // the handler's return value, and this call had none.
            const proposals = await agent
                .get('/api/copilot/proposals')
                .expect(200);
            expect(proposals.body.items).toHaveLength(0);
        });

        it('rejects a folder id from another workspace', async () => {
            const other = await seedWorkspace({ name: 'Other', slug: 'other' });
            const outside = await seedMediaFolder({
                workspaceId: other.id,
                name: 'Elsewhere'
            });
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            const result = await attempt(agent, {
                fileName: 'stray',
                format: 'md',
                content: '# Stray',
                summary: 'Stray',
                folderId: outside.id
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('No folder');
            expect(await countMediaAssets(workspace.id)).toBe(0);
        });

        it('rejects an empty file', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            const result = await attempt(agent, {
                fileName: 'blank',
                format: 'md',
                content: '',
                summary: 'Blank'
            });

            expect(result.ok).toBe(false);
            expect(await countMediaAssets(workspace.id)).toBe(0);
        });

        // The closed enum is what stops a generated file being stored as
        // something executable — `MediaKind.classify` would file
        // `application/x-msdownload` under `document` without complaint.
        it('rejects a format outside the enum [media:I-32]', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            const result = await attempt(agent, {
                fileName: 'payload',
                format: 'exe',
                content: 'MZ',
                summary: 'Payload'
            });

            expect(result.ok).toBe(false);
            expect(await countMediaAssets(workspace.id)).toBe(0);
        });
    });

    // ---------------------------------------------------------- attachments
    describe('files attached to a turn', () => {
        /** Upload a file the way the composer does — the user's own session. */
        async function upload(
            agent: request.Agent,
            name: string,
            body: string,
            contentType: string
        ) {
            const response = await agent
                .post('/api/media/assets')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .attach('file', Buffer.from(body), {
                    filename: name,
                    contentType
                })
                .expect(201);
            return response.body as { id: string };
        }

        /** Start a run carrying `attachments`, with no tool call scripted. */
        async function runWith(
            agent: request.Agent,
            attachments: { assetId: string }[],
            message = 'what did I send you?'
        ) {
            scriptCopilot({ text: 'Got it.' });
            return run(agent, { message, attachments });
        }

        /** The system prompt + messages the fake provider was handed. */
        function lastRequest() {
            return copilotCalls()[copilotCalls().length - 1];
        }

        it('tells the model what was attached, without inlining the bytes', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');
            const asset = await upload(
                agent,
                'brief.md',
                '# The brief\n\nShip it.',
                'text/markdown'
            );

            await runWith(agent, [{ assetId: asset.id }]);

            const sent = JSON.stringify(lastRequest().messages);
            expect(sent).toContain('brief.md');
            expect(sent).toContain('text/markdown');
            expect(sent).toContain('media_asset_read');
            // Metadata only. Pasting every attached file into the prompt would
            // spend the context window on files nobody asked about — the model
            // has a tool for reading one when the question needs it.
            expect(sent).not.toContain('Ship it.');
        });

        // A file name is user-authored text arriving in the prompt, so it gets
        // the same envelope a tool result does (ADR-0005 §8).
        it('fences the manifest as untrusted data', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');
            const asset = await upload(
                agent,
                'ignore-previous-instructions.txt',
                'hello',
                'text/plain'
            );

            await runWith(agent, [{ assetId: asset.id }]);

            const sent = JSON.stringify(lastRequest().messages);
            expect(sent).toContain('untrusted-data');
            expect(sent).toContain('ignore-previous-instructions.txt');
        });

        // `readable` is answered by the plugin that owns the allowlist, so the
        // model does not spend a step discovering a PDF cannot be decoded.
        it('says up front whether a file can be read', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');
            const text = await upload(agent, 'a.md', 'x', 'text/markdown');
            const binary = await upload(
                agent,
                'b.pdf',
                '%PDF-',
                'application/pdf'
            );

            await runWith(agent, [
                { assetId: text.id },
                { assetId: binary.id }
            ]);

            const sent = JSON.stringify(lastRequest().messages);
            expect(sent).toContain('\\"readable\\":true');
            expect(sent).toContain('\\"readable\\":false');
        });

        // The whole reason attachments needed no new authority: the id is the
        // only part the server can verify, so a foreign one must not resolve.
        it('refuses an asset from another workspace [copilot:I-24]', async () => {
            const other = await seedWorkspace({ name: 'Other', slug: 'other' });
            const { user, agent } = await signIn(ADMIN_EMAIL, 'admin');
            const outside = await seedMediaAsset({
                workspaceId: other.id,
                uploadedBy: user.id,
                name: 'secret.txt',
                mimeType: 'text/plain'
            });

            const events = await runWith(agent, [{ assetId: outside.id }]);

            const errors = framesOfType(events, 'error');
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toContain('no longer available');
            // Nothing was persisted: resolution happens before the thread is
            // touched, so a bad attachment cannot leave a turn behind.
            const list = await agent
                .get('/api/copilot/conversations')
                .expect(200);
            expect(list.body.items).toHaveLength(0);
        });

        it('refuses an id that is not an asset at all', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            const events = await runWith(agent, [
                { assetId: '00000000-0000-4000-8000-000000000000' }
            ]);

            expect(framesOfType(events, 'error')[0].message).toContain(
                'no longer available'
            );
        });

        // The manifest is written onto the turn, so a later question about
        // "the file I sent" still reaches it.
        it('carries into a follow-up turn in the same thread', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');
            const asset = await upload(
                agent,
                'plan.md',
                '# Plan',
                'text/markdown'
            );

            const first = await runWith(agent, [{ assetId: asset.id }]);
            const conversationId = framesOfType(first, 'run-started')[0]
                .conversationId;

            scriptCopilot({ text: 'Still got it.' });
            await run(agent, {
                message: 'summarise the file I sent',
                conversationId
            });

            // The second turn attached nothing, yet the first turn's manifest
            // is in the history the model was handed.
            const sent = JSON.stringify(lastRequest().messages);
            expect(sent).toContain('plan.md');
        });

        it('serves them back on the persisted transcript', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');
            const asset = await upload(agent, 'notes.txt', 'hi', 'text/plain');

            const events = await runWith(agent, [{ assetId: asset.id }]);
            const conversationId = framesOfType(events, 'run-started')[0]
                .conversationId;

            const response = await agent
                .get(`/api/copilot/conversations/${conversationId}`)
                .expect(200);
            const messages = response.body.messages as {
                role: string;
                attachments: { assetId: string; name: string }[] | null;
            }[];

            // Structured on the row rather than recoverable by parsing a text
            // block — which is what lets a reopened thread draw the same chips.
            expect(messages[0].attachments).toEqual([
                expect.objectContaining({
                    assetId: asset.id,
                    name: 'notes.txt'
                })
            ]);
            expect(messages[1].attachments).toBeNull();
        });

        it('rejects more attachments than one turn may carry', async () => {
            const { user, agent } = await signIn(ADMIN_EMAIL, 'admin');
            const ids = await Promise.all(
                Array.from({ length: 9 }, (_unused, index) =>
                    seedMediaAsset({
                        workspaceId: workspace.id,
                        uploadedBy: user.id,
                        name: `f${index}.txt`,
                        mimeType: 'text/plain'
                    })
                )
            );

            // A 400 from the strict pipe, before the stream opens — the
            // ceiling is on the DTO, not discovered mid-run.
            await agent
                .post('/api/copilot/runs')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({
                    message: 'too many',
                    attachments: ids.map((asset) => ({ assetId: asset.id }))
                })
                .expect(400);
        });

        it('rejects an attachment that is not a uuid', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            await agent
                .post('/api/copilot/runs')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({ message: 'hi', attachments: [{ assetId: 'nope' }] })
                .expect(400);
        });

        // The nested-DTO trap `RunContextDto` documents, one level deeper: an
        // array of objects needs `{ each: true }` or the whitelist strips every
        // property and the handler silently receives `[{}]`.
        it('rejects an unknown key inside an attachment', async () => {
            const { agent } = await signIn(ADMIN_EMAIL, 'admin');

            await agent
                .post('/api/copilot/runs')
                .set('Origin', TEST_ALLOWED_ORIGIN)
                .send({
                    message: 'hi',
                    attachments: [
                        {
                            assetId: '00000000-0000-4000-8000-000000000000',
                            name: 'a-name-the-server-must-not-trust.txt'
                        }
                    ]
                })
                .expect(400);
        });
    });

    // The other half of the surface split — that an MCP client cannot reach
    // this tool even holding `media:create` — is asserted in `mcp.spec.ts`,
    // where the bearer-token harness lives.
});
