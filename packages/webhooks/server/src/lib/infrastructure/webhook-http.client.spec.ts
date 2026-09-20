import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { assertUrlShape } from '@orthacms/webhooks-domain';
import {
    resolveWebhooksConfig,
    type WebhooksPluginConfig
} from '../types/webhooks-config';
import { WebhookHttpClient, type WebhookRequest } from './webhook-http.client';

/**
 * A receiver on loopback that records what actually arrived.
 *
 * The recording is what makes the address check observable: a guard that fires
 * before the socket opens leaves `paths` empty, while a guard that has been
 * removed leaves a request in it.
 */
interface Receiver {
    /** The port it is listening on, so a URL can name it. */
    port: number;
    /** The path of every request that reached it, in order. */
    paths: string[];
    /** The headers of every request that reached it, in the same order. */
    headers: Array<Record<string, string | string[] | undefined>>;
    /** What to answer with. Replaced per test. */
    reply: (path: string) => {
        status: number;
        headers?: Record<string, string>;
        body?: string;
    };
    close: () => Promise<void>;
}

async function startReceiver(): Promise<Receiver> {
    const state: Pick<Receiver, 'paths' | 'headers' | 'reply'> = {
        paths: [],
        headers: [],
        reply: () => ({ status: 200, body: 'ok' })
    };

    const server: Server = createServer((request, response) => {
        const path = request.url ?? '';
        state.paths.push(path);
        state.headers.push(request.headers);
        // Drain the request body so the socket is not half-read from our end.
        request.resume();
        request.on('end', () => {
            const answer = state.reply(path);
            response.writeHead(answer.status, answer.headers ?? {});
            response.end(answer.body ?? '');
        });
    });

    await new Promise<void>((resolve) => {
        // Loopback only: this fixture must never be reachable off the machine.
        server.listen(0, '127.0.0.1', resolve);
    });

    return {
        port: (server.address() as AddressInfo).port,
        get paths() {
            return state.paths;
        },
        get headers() {
            return state.headers;
        },
        get reply() {
            return state.reply;
        },
        set reply(next) {
            state.reply = next;
        },
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.closeAllConnections();
                server.close((error) => (error ? reject(error) : resolve()));
            })
    };
}

function client(config: WebhooksPluginConfig): WebhookHttpClient {
    return new WebhookHttpClient(resolveWebhooksConfig(config));
}

function delivery(url: string): WebhookRequest {
    return {
        url,
        secret: 'whsec_test',
        headers: {},
        body: { event: 'entry.published' },
        eventKind: 'entry.published',
        deliveryId: 'delivery-1',
        eventId: 'event-1',
        workspaceId: null,
        attempt: 1
    };
}

/**
 * The policy a strict deployment runs: plain HTTP is permitted only so the
 * fixture can be an ordinary `http.Server` — the clause under test,
 * `allowPrivateNetworks`, stays off, exactly as it ships.
 */
const STRICT: WebhooksPluginConfig = {
    allowInsecureUrls: true,
    allowPrivateNetworks: false
};

describe('WebhookHttpClient — the connect-time address check', () => {
    let receiver: Receiver;

    beforeAll(async () => {
        receiver = await startReceiver();
    });

    afterAll(async () => {
        await receiver.close();
    });

    beforeEach(() => {
        receiver.paths.length = 0;
        receiver.reply = () => ({ status: 200, body: 'ok' });
    });

    it('refuses a host that the URL policy accepts but DNS resolves to loopback [webhooks:I-10]', async () => {
        // `localhost` is a *name*, not an IP literal, so nothing in the
        // write-time policy has anything to object to — asserted here so a
        // failure below cannot be mistaken for the hostname check answering.
        const url = `http://localhost:${receiver.port}/hooks`;
        expect(() =>
            assertUrlShape(url, {
                allowInsecureUrls: true,
                allowPrivateNetworks: false
            })
        ).not.toThrow();

        const result = await client(STRICT).send(delivery(url));

        // The socket was never opened: the receiver saw nothing.
        expect(receiver.paths).toEqual([]);
        expect(result.statusCode).toBeNull();
        // And the refusal names the address the resolver returned, which only
        // `assertAddressAllowed` can say; `assertUrlShape` names the host.
        expect(result.error).toMatch(/resolves to (127\.0\.0\.1|::1)/);
    });

    it('delivers to that same host once the deployment allows private networks [webhooks:I-10]', async () => {
        // Same URL, same resolver, same client — only the policy differs. This
        // is what makes the refusal above attributable to the address check
        // rather than to a name that could not be reached.
        const url = `http://localhost:${receiver.port}/hooks`;

        const result = await client({
            allowInsecureUrls: true,
            allowPrivateNetworks: true
        }).send(delivery(url));

        expect(result.statusCode).toBe(200);
        expect(receiver.paths).toEqual(['/hooks']);
    });

    it('refuses a private IP literal before it resolves anything [webhooks:I-10]', async () => {
        // The write-time half, re-run on the way out: the message names the
        // host rather than a resolved address, so the two guards are
        // distinguishable in the delivery log.
        const result = await client(STRICT).send(
            delivery(`http://127.0.0.1:${receiver.port}/hooks`)
        );

        expect(result.error).toContain(
            '127.0.0.1 is a private or reserved address'
        );
        expect(result.error).not.toMatch(/resolves to/);
        expect(result.statusCode).toBeNull();
        expect(receiver.paths).toEqual([]);
    });

    it('reports a redirect as the delivery result instead of following it [webhooks:I-10]', async () => {
        const url = `http://localhost:${receiver.port}/hooks`;
        receiver.reply = (path) =>
            path === '/hooks'
                ? {
                      status: 302,
                      headers: {
                          location: `http://localhost:${receiver.port}/moved`
                      }
                  }
                : { status: 200, body: 'followed' };

        const result = await client({
            allowInsecureUrls: true,
            allowPrivateNetworks: true
        }).send(delivery(url));

        expect(result.statusCode).toBe(302);
        // The second hop was never made — following one is how a receiver
        // walks us past the address check it already passed.
        expect(receiver.paths).toEqual(['/hooks']);
    });
});

describe('WebhookHttpClient — the delivery headers', () => {
    let receiver: Receiver;

    beforeAll(async () => {
        receiver = await startReceiver();
    });

    afterAll(async () => {
        await receiver.close();
    });

    beforeEach(() => {
        receiver.paths.length = 0;
        receiver.headers.length = 0;
    });

    const OPEN: WebhooksPluginConfig = {
        allowInsecureUrls: true,
        allowPrivateNetworks: true
    };

    it('sends every delivery header', async () => {
        const url = `http://localhost:${receiver.port}/hooks`;
        await client(OPEN).send({
            ...delivery(url),
            workspaceId: 'workspace-1'
        });

        const sent = receiver.headers[0];
        expect(sent).toBeDefined();

        for (const field of [
            'event',
            'delivery',
            'event-id',
            'workspace',
            'attempt',
            'signature'
        ]) {
            expect(sent[`x-ortha-${field}`]).toBeDefined();
        }
    });

    it('omits the workspace header when there is none', async () => {
        const url = `http://localhost:${receiver.port}/hooks`;
        await client(OPEN).send({ ...delivery(url), workspaceId: null });

        const sent = receiver.headers[0];
        expect(sent['x-ortha-workspace']).toBeUndefined();
        // Still sent, so an absent workspace is not mistaken for no headers.
        expect(sent['x-ortha-event']).toBe('entry.published');
    });
});

describe('WebhookHttpClient — the response snippet', () => {
    let receiver: Receiver;

    beforeAll(async () => {
        receiver = await startReceiver();
    });

    afterAll(async () => {
        await receiver.close();
    });

    it('keeps at most responseSnippetBytes of what the receiver sent [webhooks:I-17]', async () => {
        const body = 'a'.repeat(64 * 1024);
        receiver.reply = () => ({ status: 200, body });

        const result = await client({
            allowInsecureUrls: true,
            allowPrivateNetworks: true,
            responseSnippetBytes: 128
        }).send(delivery(`http://localhost:${receiver.port}/hooks`));

        expect(result.statusCode).toBe(200);
        expect(result.responseSnippet).toBe('a'.repeat(128));
    });
});
