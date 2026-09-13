import { Injectable, Logger } from '@nestjs/common';
import { lookup as dnsLookup } from 'node:dns';
import {
    DELIVERY_HEADERS,
    LEGACY_DELIVERY_HEADERS,
    DELIVERY_USER_AGENT,
    WebhookUrlRejectedError,
    assertAddressAllowed,
    assertUrlShape,
    isAllowedCustomHeader,
    parseRetryAfter,
    signatureHeader
} from '@apograph/webhooks-domain';
import { Agent, request } from 'undici';
import { InjectWebhooksConfig } from '../webhooks.tokens';
import type { ResolvedWebhooksConfig } from '../types/webhooks-config';

/** Everything one POST needs. */
export interface WebhookRequest {
    url: string;
    secret: string;
    /** Extra static headers from the endpoint's configuration. */
    headers: Record<string, string>;
    /** The envelope. Serialised once, because the signature covers the bytes. */
    body: unknown;
    eventKind: string;
    deliveryId: string;
    eventId: string;
    workspaceId: string | null;
    /** 1-based, sent as `X-Apograph-Attempt`. */
    attempt: number;
}

/** What came back. */
export interface WebhookResponse {
    /** The HTTP status, or null when nothing answered. */
    statusCode: number | null;
    /** A `Retry-After`, in milliseconds from now, when the receiver sent one. */
    retryAfterMs?: number;
    /** Why it failed, when no status came back. */
    error: string | null;
    /** The first `responseSnippetBytes` of the body. */
    responseSnippet: string | null;
    durationMs: number;
}

/**
 * Posts one delivery, under the policy that decides where this server may be
 * talked into connecting.
 *
 * **Why an `undici.Agent` and not `fetch`.** The address has to be checked
 * *after* the hostname resolves and the connection has to go to that same
 * address. Global `fetch` gives no hook between the two, so a name that passes
 * a pre-flight check and then resolves to `169.254.169.254` — DNS rebinding —
 * connects anyway. A custom `lookup` is the seam where the resolved address is
 * judged and either handed to the connector or refused.
 *
 * Redirects are not followed. A `3xx` is reported as a failed delivery rather
 * than an invitation to make a second request, because following one is the
 * simplest way to be walked to an internal address after the first hop passed.
 */
@Injectable()
export class WebhookHttpClient {
    private readonly logger = new Logger(WebhookHttpClient.name);

    /**
     * One agent for every delivery, so connections are pooled across them.
     * Built lazily because it captures the policy from injected config.
     */
    private agent: Agent | null = null;

    constructor(
        @InjectWebhooksConfig()
        private readonly config: ResolvedWebhooksConfig
    ) {}

    /** Sends one delivery and reports what happened. Never throws. */
    async send(delivery: WebhookRequest): Promise<WebhookResponse> {
        const startedAt = Date.now();
        const body = JSON.stringify(delivery.body);
        const timestamp = Math.floor(startedAt / 1000);

        try {
            // Re-checked on every send, not only when the endpoint was saved:
            // a hostname re-pointed at a private address afterwards must be
            // refused here, and the URL policy may have been tightened since.
            const url = assertUrlShape(delivery.url, this.policy());

            const response = await request(url, {
                method: 'POST',
                body,
                headers: this.headersFor(delivery, body, timestamp),
                dispatcher: this.dispatcher(),
                // `request` does not follow redirects unless a redirect
                // interceptor is added, and none is: a 3xx is reported as a
                // failed delivery rather than followed, because following one
                // is the simplest way to be walked to an internal address
                // after the first hop already passed the address check.
                headersTimeout: this.config.timeoutMs,
                bodyTimeout: this.config.timeoutMs
            });

            const snippet = await this.readSnippet(response.body);

            return {
                statusCode: response.statusCode,
                retryAfterMs: retryAfterOf(response.headers),
                error: null,
                responseSnippet: snippet,
                durationMs: Date.now() - startedAt
            };
        } catch (error) {
            return {
                statusCode: null,
                error: describeFailure(error),
                responseSnippet: null,
                durationMs: Date.now() - startedAt
            };
        }
    }

    /** The URL policy this deployment configured. */
    private policy() {
        return {
            allowInsecureUrls: this.config.allowInsecureUrls,
            allowPrivateNetworks: this.config.allowPrivateNetworks
        };
    }

    /**
     * The agent, with the address check wired into its DNS lookup.
     *
     * `lookup` is called by the connector with the hostname it is about to
     * connect to; refusing here means the socket is never opened, and the
     * address that was judged is the address that would have been used.
     */
    private dispatcher(): Agent {
        if (this.agent) return this.agent;

        const policy = this.policy();
        this.agent = new Agent({
            connect: {
                timeout: this.config.timeoutMs,
                lookup: (hostname, options, callback) => {
                    dnsLookup(hostname, options, (error, address, family) => {
                        if (error) {
                            callback(error, address as never, family as never);
                            return;
                        }
                        try {
                            for (const resolved of toAddressList(address)) {
                                assertAddressAllowed(resolved, policy);
                            }
                        } catch (rejection) {
                            callback(
                                rejection as NodeJS.ErrnoException,
                                address as never,
                                family as never
                            );
                            return;
                        }
                        callback(null, address as never, family as never);
                    });
                }
            }
        });
        return this.agent;
    }

    /** The headers one delivery travels with. */
    private headersFor(
        delivery: WebhookRequest,
        body: string,
        timestamp: number
    ): Record<string, string> {
        const headers: Record<string, string> = {};

        // The endpoint's own headers go first, so the reserved ones below can
        // never be overwritten by configuration. `isAllowedCustomHeader` is
        // also enforced on write; this is the belt to that braces, because a
        // row could predate the check.
        for (const [name, value] of Object.entries(delivery.headers)) {
            if (isAllowedCustomHeader(name)) headers[name] = value;
        }

        headers['content-type'] = 'application/json';
        headers['user-agent'] = DELIVERY_USER_AGENT;

        // Every delivery header goes out under both spellings during the
        // rename window. The values are computed once and written twice, so
        // the two can never disagree — a receiver that verifies the signature
        // against `X-apograph-Signature` and one that reads `X-Apograph-Signature`
        // are checking the same bytes.
        const signature = signatureHeader(delivery.secret, timestamp, body);
        const values: Record<keyof typeof DELIVERY_HEADERS, string | null> = {
            EVENT: delivery.eventKind,
            DELIVERY: delivery.deliveryId,
            EVENT_ID: delivery.eventId,
            ATTEMPT: String(delivery.attempt),
            SIGNATURE: signature,
            // Omitted entirely when the event has no workspace, rather than
            // sent empty — the same as before the rename.
            WORKSPACE: delivery.workspaceId
        };

        for (const [field, value] of Object.entries(values)) {
            if (value === null) continue;
            const key = field as keyof typeof DELIVERY_HEADERS;
            headers[DELIVERY_HEADERS[key]] = value;
            headers[LEGACY_DELIVERY_HEADERS[key]] = value;
        }

        return headers;
    }

    /**
     * Reads at most `responseSnippetBytes` of the body, then abandons the rest.
     *
     * A receiver that answers with a gigabyte would otherwise be able to
     * exhaust this process's memory from the far end of a connection we
     * initiated.
     */
    private async readSnippet(
        body: NodeJS.ReadableStream
    ): Promise<string | null> {
        const chunks: Buffer[] = [];
        let size = 0;

        try {
            for await (const chunk of body) {
                const buffer = Buffer.isBuffer(chunk)
                    ? chunk
                    : Buffer.from(chunk as string);
                chunks.push(buffer);
                size += buffer.length;
                if (size >= this.config.responseSnippetBytes) break;
            }
        } catch (error) {
            this.logger.debug(
                `Could not read the response body: ${describeFailure(error)}`
            );
        } finally {
            // Whether we stopped early or the stream errored, the connection
            // must not be left half-read or the pooled socket is unusable.
            body.resume?.();
        }

        if (chunks.length === 0) return null;
        return Buffer.concat(chunks)
            .subarray(0, this.config.responseSnippetBytes)
            .toString('utf8');
    }
}

/**
 * A `Retry-After` from the response headers, in milliseconds.
 *
 * Parsed in the domain so the header's two legal forms live in one place;
 * `undefined` simply falls back to our own schedule.
 */
function retryAfterOf(
    headers: Record<string, string | string[] | undefined>
): number | undefined {
    const raw = headers['retry-after'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ? parseRetryAfter(value) : undefined;
}

/** `lookup` may hand back one address or a list; normalise to a list. */
function toAddressList(address: string | Array<{ address: string }>): string[] {
    return typeof address === 'string'
        ? [address]
        : address.map((entry) => entry.address);
}

/** A failure, phrased for the delivery log rather than for a stack trace. */
function describeFailure(error: unknown): string {
    if (error instanceof WebhookUrlRejectedError) return error.message;
    if (error instanceof Error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (
            code === 'UND_ERR_HEADERS_TIMEOUT' ||
            code === 'UND_ERR_BODY_TIMEOUT'
        ) {
            return 'The receiver did not respond in time.';
        }
        if (code === 'UND_ERR_CONNECT_TIMEOUT') {
            return 'Could not connect to the receiver in time.';
        }
        if (code === 'ENOTFOUND') {
            return 'The host name could not be resolved.';
        }
        if (code === 'ECONNREFUSED') {
            return 'The receiver refused the connection.';
        }
        return error.message;
    }
    return String(error);
}
