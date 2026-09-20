import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { getPool } from '@orthacms/database';
import { WebhookDeliveryWorker } from '@orthacms/webhooks-server';
// Two providers the plugin binds for DI but does not re-export from its index.
// Reached by path for the same reason `seed.ts` reaches for `HashingService`:
// the point is to hold the SAME instance the running app holds, so a test
// observes the real collaborator rather than a copy of it.
import {
    WebhookHttpClient,
    type WebhookRequest
} from '../../../../packages/webhooks/server/src/lib/infrastructure/webhook-http.client';
import { WebhookEndpointRepository } from '../../../../packages/webhooks/server/src/lib/infrastructure/webhook-endpoint.repository';

/** One request the fixture receiver took. */
export interface ReceivedDelivery {
    headers: Record<string, string | string[] | undefined>;
    /** The raw body, exactly as it arrived — the signature covers these bytes. */
    raw: string;
    /** The parsed body, for readable assertions. */
    body: Record<string, unknown>;
}

/** A local HTTP endpoint that records what a webhook posted to it. */
export interface WebhookReceiver {
    /** The URL to configure an endpoint with. */
    url: string;
    /** Everything received so far, in arrival order. */
    received: ReceivedDelivery[];
    /** Answer the next `count` requests with this status instead of 200. */
    respondWith(status: number, count?: number): void;
    /**
     * Answer the next `count` requests with this body instead of `received`.
     *
     * Separate from {@link WebhookReceiver.respondWith} because the two queue
     * independently — a suite that wants a scripted status *and* a scripted
     * body for the same request would have to say so, and none does.
     */
    respondWithBody(body: string, count?: number): void;
    close(): Promise<void>;
}

/** How a receiver may be built. */
export interface WebhookReceiverOptions {
    /**
     * Called while the receiver is still holding the request open — before it
     * answers, and therefore while the worker is blocked on `await request()`.
     *
     * This is the only moment from which "no transaction is open while a
     * receiver is answering" can be observed at all. A throw here is swallowed
     * and the receiver still answers: a hook that hung the response would be
     * reported as a delivery timeout, which says nothing about what it found.
     * So a hook collects observations and the suite asserts on them afterwards
     * — see {@link observeDeliveryRow}, which never throws for that reason.
     */
    onRequest?: (delivery: ReceivedDelivery) => Promise<void>;
}

/**
 * Starts a receiver on loopback.
 *
 * The suites post to a real socket rather than stubbing the HTTP client,
 * because the things worth asserting — that the signature covers the bytes that
 * actually went out, that the delivery headers are present and correct — only
 * exist on the wire. The harness config permits loopback for exactly this; the
 * shipped policy does not, and that refusal has its own assertion.
 */
export async function startWebhookReceiver(
    options: WebhookReceiverOptions = {}
): Promise<WebhookReceiver> {
    const received: ReceivedDelivery[] = [];
    const scriptedStatus: number[] = [];
    const scriptedBody: string[] = [];

    const server: Server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const delivery: ReceivedDelivery = {
                headers: req.headers,
                raw,
                body: raw ? JSON.parse(raw) : {}
            };
            received.push(delivery);

            const answer = () => {
                res.statusCode = scriptedStatus.shift() ?? 200;
                res.end(scriptedBody.shift() ?? 'received');
            };

            if (!options.onRequest) {
                answer();
                return;
            }
            void options.onRequest(delivery).then(answer, answer);
        });
    });

    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;

    return {
        url: `http://127.0.0.1:${port}/hooks`,
        received,
        respondWith(status, count = 1) {
            for (let index = 0; index < count; index += 1) {
                scriptedStatus.push(status);
            }
        },
        respondWithBody(body, count = 1) {
            for (let index = 0; index < count; index += 1) {
                scriptedBody.push(body);
            }
        },
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            )
    };
}

/**
 * Sends whatever is claimable right now.
 *
 * The harness runs with the sender's interval switched off, so this is how a
 * suite advances the queue — the analogue of `drainOutbox` for the second hop.
 */
export async function deliverWebhooks(app: INestApplication): Promise<void> {
    await app.get(WebhookDeliveryWorker).runOnce();
}

/** The repository the endpoint state assertions drive directly. */
export function webhookEndpoints(
    app: INestApplication
): WebhookEndpointRepository {
    return app.get(WebhookEndpointRepository);
}

/** Every send the app's HTTP client was asked to make, with the undo. */
export interface WebhookSendLog {
    /** Delivery ids handed to {@link WebhookHttpClient.send}, in order. */
    readonly sent: string[];
    /** Puts the real method back. Safe to call twice. */
    restore(): void;
}

/**
 * Records every call into the plugin's HTTP client, without replacing it.
 *
 * Two different questions need this. The first is ADR-0016's rule: the fan-out
 * subscriber runs inside `OutboxDispatcher`'s claim transaction and must not
 * touch the network, and "the receiver saw nothing" cannot tell that apart from
 * "the subscriber tried and the request failed". Watching the client itself
 * can. The second is ordering: `onSend` runs after the claim has returned and
 * before the request goes out, which is one of the two moments a suite can ask
 * the database what it can see.
 *
 * The real method is still called, so the delivery genuinely happens.
 */
export function recordWebhookSends(
    app: INestApplication,
    onSend?: (delivery: WebhookRequest) => Promise<void>
): WebhookSendLog {
    const client = app.get(WebhookHttpClient);
    const real = client.send.bind(client);
    const sent: string[] = [];

    client.send = async (delivery) => {
        sent.push(delivery.deliveryId);
        if (onSend) await onSend(delivery);
        return real(delivery);
    };

    return {
        sent,
        restore() {
            // Deleting the own property uncovers the prototype's method again,
            // which is what every other holder of this singleton is using.
            Reflect.deleteProperty(client, 'send');
        }
    };
}

/**
 * What a **separate connection** could see of a delivery row at one moment.
 *
 * The whole of `webhooks:I-02` lives in the difference between the two fields.
 * `status` is ordinary MVCC visibility: the claim's `UPDATE … SET status =
 * 'delivering'` is invisible to any other connection until its transaction
 * commits, so reading `delivering` from here proves the commit happened. And
 * `lockable` is the sharper half — `FOR UPDATE NOWAIT` raises `55P03`
 * immediately if any transaction still holds the row, so a send that had been
 * moved back inside the claim would be caught even if it somehow committed the
 * status first.
 *
 * Never throws: it is called from inside the receiver's request handler, where
 * a rejection would be reported as a delivery timeout half a second later
 * rather than as the assertion it is.
 */
export interface DeliveryRowObservation {
    /** The row's status, as another connection reads it. Null if not visible. */
    status: string | null;
    /** Whether `claimed_at` is set on the version another connection sees. */
    claimed: boolean;
    /** Whether the row could be locked from another connection right then. */
    lockable: boolean;
    /** The SQLSTATE (or message) that refused the lock, when one did. */
    lockError: string | null;
}

export async function observeDeliveryRow(
    deliveryId: string
): Promise<DeliveryRowObservation> {
    const pool = getPool();
    const observation: DeliveryRowObservation = {
        status: null,
        claimed: false,
        lockable: false,
        lockError: null
    };

    try {
        const { rows } = await pool.query<{
            status: string;
            claimedAt: Date | null;
        }>(
            `SELECT status, claimed_at AS "claimedAt"
             FROM webhook_deliveries WHERE id = $1`,
            [deliveryId]
        );
        observation.status = rows[0]?.status ?? null;
        observation.claimed = rows[0]?.claimedAt != null;
    } catch (error) {
        observation.status = `error: ${describe(error)}`;
    }

    try {
        await pool.query(
            `SELECT id FROM webhook_deliveries WHERE id = $1 FOR UPDATE NOWAIT`,
            [deliveryId]
        );
        observation.lockable = true;
    } catch (error) {
        observation.lockError = describe(error);
    }

    return observation;
}

/** A SQLSTATE where there is one, so an assertion failure names the cause. */
function describe(error: unknown): string {
    const code = (error as { code?: string } | null)?.code;
    return code ?? String(error);
}

/**
 * Marks an aggregate's outbox rows undispatched, so the next drain delivers
 * them again.
 *
 * Not a contrivance: outbox delivery is at-least-once by design, and a
 * subscriber that failed partway through a batch sees exactly this on the
 * retry. It is the only way to prove the fan-out's unique index is doing its
 * job rather than merely existing.
 */
export async function replayOutbox(aggregateId: string): Promise<void> {
    await getPool().query(
        `UPDATE outbox_events SET dispatched_at = NULL WHERE aggregate_id = $1`,
        [aggregateId]
    );
}

/** One `webhook_deliveries` row, as the assertions read it. */
export interface DeliveryRow {
    id: string;
    endpointId: string;
    eventId: string;
    eventKind: string;
    workspaceId: string | null;
    contentType: string | null;
    status: string;
    attempts: number;
    lastStatusCode: number | null;
    payload: Record<string, unknown>;
}

/** Every queued delivery for one endpoint, oldest first. */
export async function getDeliveries(
    endpointId: string
): Promise<DeliveryRow[]> {
    const { rows } = await getPool().query<DeliveryRow>(
        `SELECT id, endpoint_id AS "endpointId", event_id AS "eventId",
                event_kind AS "eventKind", workspace_id AS "workspaceId",
                content_type AS "contentType", status, attempts,
                last_status_code AS "lastStatusCode", payload
         FROM webhook_deliveries
         WHERE endpoint_id = $1
         ORDER BY created_at, id`,
        [endpointId]
    );
    return rows;
}

/**
 * Makes a queued delivery claimable now.
 *
 * A retry is scheduled minutes out by design, so a suite that wants to watch
 * the second attempt would otherwise have to wait for it. Moving the clock on
 * the row is honest about what is being skipped — the wait — while leaving the
 * decision that produced it, and everything the next attempt does, real.
 */
export async function makeDeliveryDue(deliveryId: string): Promise<void> {
    await getPool().query(
        `UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 minute'
         WHERE id = $1`,
        [deliveryId]
    );
}
