import type { DeliveryStatus } from '@orthacms/webhooks-domain';

/**
 * The read shapes the application layer hands to the HTTP layer.
 *
 * They are what the API returns, so the one rule that matters here is what is
 * **missing**: no `secret`. It is written on mint and on rotation, returned in
 * that one response, and never present in a shape that a `GET` can reach.
 */

/** An endpoint as the list and detail routes return it. */
export interface WebhookEndpointView {
    id: string;
    name: string;
    url: string;
    /** The trailing characters of the secret. Never the secret itself. */
    secretHint: string;
    enabled: boolean;
    /** Empty means every kind. */
    eventKinds: string[];
    /** Empty means every type. */
    contentTypes: string[];
    allWorkspaces: boolean;
    /** Empty when {@link allWorkspaces} is true. */
    workspaceIds: string[];
    headers: Record<string, string>;
    /** Set when the endpoint switched itself off; null otherwise. */
    disabledReason: string | null;
    consecutiveFailures: number;
    createdAt: string;
    updatedAt: string;
    /** The most recent delivery's outcome, for the list's status column. */
    lastDelivery: WebhookLastDeliveryView | null;
}

/** The one-line delivery summary shown against an endpoint in the list. */
export interface WebhookLastDeliveryView {
    id: string;
    status: DeliveryStatus;
    eventKind: string;
    statusCode: number | null;
    createdAt: string;
}

/** A delivery as the log's list route returns it — no bodies. */
export interface WebhookDeliveryView {
    id: string;
    endpointId: string;
    eventId: string;
    eventKind: string;
    workspaceId: string | null;
    contentType: string | null;
    status: DeliveryStatus;
    attempts: number;
    nextAttemptAt: string | null;
    statusCode: number | null;
    error: string | null;
    durationMs: number | null;
    createdAt: string;
    completedAt: string | null;
}

/** A delivery with its request and response bodies, for the detail panel. */
export interface WebhookDeliveryDetailView extends WebhookDeliveryView {
    /** The frozen envelope — exactly what was, or will be, posted. */
    payload: unknown;
    /** The first couple of kilobytes of the receiver's response. */
    responseSnippet: string | null;
}

/** A page of deliveries. */
export interface WebhookDeliveryPage {
    items: WebhookDeliveryView[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
}

/** The result of "Send test" — reported synchronously, never queued. */
export interface WebhookTestResult {
    /** Whether the receiver answered 2xx. */
    ok: boolean;
    /** The HTTP status, or null when nothing answered. */
    statusCode: number | null;
    /** Why it failed, when it did. */
    error: string | null;
    durationMs: number;
    /** The first couple of kilobytes of the response. */
    responseSnippet: string | null;
}
