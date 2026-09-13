import { createServer as createHttpServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { closeTestApp, createTestApp, type TestApp } from '../support/test-app';

/**
 * Where the harness's HTTP server is bound — the fix for the instability that
 * cost this suite roughly two tests per full run, on a different pair every
 * time, for as long as anyone had run it end to end.
 *
 * `supertest` builds every URL as `http://127.0.0.1:<port>`, but the listen it
 * performs for you names no address:
 *
 * ```js
 * if (!addr) this._server = app.listen(0);          // binds the WILDCARD
 * return 'http://127.0.0.1:' + app.address().port;  // dials LOOPBACK
 * ```
 *
 * Node sets `SO_REUSEADDR`, so a wildcard bind **succeeds** on a port another
 * process already holds bound to `127.0.0.1` specifically, and the more
 * specific socket wins the loopback traffic. The request is then answered by
 * that other process — a JetBrains IDE's built-in server, an Electron app's
 * local bridge — which replies `403`, or `301`, or hangs up. That is exactly
 * the shape the lost tests took, and it was reached about four times a run
 * because supertest closes the server after every request, so the old harness
 * re-bound a fresh ephemeral port ~35 000 times and cycled the whole
 * 49152–65535 range roughly four times over.
 *
 * `createTestApp` therefore binds `127.0.0.1` itself, before a test can touch
 * the server. The two claims below are the ones that keep it that way.
 */
describe('harness HTTP binding', () => {
    /** Listens, resolving with the bound address. */
    function listen(server: Server, ...args: unknown[]): Promise<AddressInfo> {
        return new Promise((resolve, reject) => {
            server.once('error', reject);
            (server.listen as (...a: unknown[]) => Server)(...args, () =>
                resolve(server.address() as AddressInfo)
            );
        });
    }

    /** A loopback GET, resolved with the body whoever answered sent. */
    function fetchBody(port: number): Promise<string> {
        return new Promise((resolve, reject) => {
            get({ host: '127.0.0.1', port, path: '/' }, (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => resolve(body));
            }).on('error', reject);
        });
    }

    describe('the app under test', () => {
        let harness: TestApp;

        beforeAll(async () => {
            harness = await createTestApp();
        });

        afterAll(async () => {
            await closeTestApp(harness);
        });

        it('is already bound to 127.0.0.1 before any request is made', () => {
            // The half that fails if `listenOnLoopback` is removed: without it
            // the server is unbound here, and supertest binds the wildcard on
            // the first request instead.
            const address = harness.server.address() as AddressInfo | null;
            expect(address).not.toBeNull();
            expect(address?.address).toBe('127.0.0.1');
        });

        it('keeps that one port for the whole file, so supertest never re-binds', async () => {
            // `Test.end` closes the server only when supertest opened it
            // (`this._server`). Finding it already listening is what stops the
            // bind/close churn — and therefore what stops the run from walking
            // the ephemeral range into somebody else's listener.
            const before = harness.server.address() as AddressInfo;
            await request(harness.server).get('/api/auth/me').expect(401);
            const between = harness.server.address() as AddressInfo | null;
            await request(harness.server).get('/api/auth/me').expect(401);
            const after = harness.server.address() as AddressInfo | null;

            expect(between?.port).toBe(before.port);
            expect(after?.port).toBe(before.port);
        });
    });

    describe('the hazard the binding closes', () => {
        // Not a test of our code — a test of the assumption the fix rests on,
        // built out of two servers so it is deterministic rather than a matter
        // of which port the kernel happens to hand out. If a platform ever
        // stopped behaving this way, the comment above would be wrong and this
        // is where that shows.

        let stranger: Server;
        let port: number;

        beforeAll(async () => {
            stranger = createHttpServer((_req, res) => res.end('STRANGER'));
            port = (await listen(stranger, 0, '127.0.0.1')).port;
        });

        afterAll(async () => {
            await new Promise((resolve) => stranger.close(resolve));
        });

        it('either refuses a wildcard listen on that port or hands it over and loses the traffic', async () => {
            // Two legitimate outcomes, and the disjunction is the point.
            //
            // On BSD/macOS `SO_REUSEADDR` lets a wildcard bind overlap a
            // live loopback listener, so the bind succeeds and the request
            // goes to the stranger — the hazard, reproduced. Linux refuses
            // the overlap outright (`SO_REUSEADDR` there only covers
            // `TIME_WAIT`), so the hazard cannot arise on a Linux runner.
            //
            // Asserting only the macOS branch would redden CI; asserting only
            // the Linux branch would claim the developer machines are safe.
            // What is true everywhere is that a wildcard listen is not in
            // control of who answers, which is why the harness names an
            // address instead.
            const mine = createHttpServer((_req, res) => res.end('MINE'));
            let bound = true;
            try {
                await listen(mine, port);
            } catch (error) {
                bound = false;
                expect(error).toMatchObject({ code: 'EADDRINUSE' });
            }
            try {
                if (bound) {
                    expect((mine.address() as AddressInfo).port).toBe(port);
                    await expect(fetchBody(port)).resolves.toBe('STRANGER');
                }
            } finally {
                await new Promise((resolve) => mine.close(resolve));
            }
        });

        it('refuses the same port to a loopback listen, which is why naming the address is a fix', async () => {
            const mine = createHttpServer((_req, res) => res.end('MINE'));
            await expect(listen(mine, port, '127.0.0.1')).rejects.toMatchObject(
                { code: 'EADDRINUSE' }
            );
            mine.close();
        });
    });
});
