/**
 * Every state a delivery can be in.
 *
 * Restated here rather than imported from `@orthacms/webhooks-domain`, and that
 * is deliberate twice over. It is the convention — the admin restates the
 * server's contracts locally, so a server-side rename surfaces as a type error
 * here instead of as `undefined` in a cell. And it is a hard requirement: that
 * package's barrel re-exports the HMAC helpers, which import `node:crypto`, so
 * importing anything at all from it puts a Node built-in in the browser bundle
 * and the whole admin fails to render.
 */
export const DELIVERY_STATUSES = [
    'pending',
    'delivering',
    'succeeded',
    'failed',
    'dead'
] as const;

/** One of {@link DELIVERY_STATUSES}. */
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** One configured endpoint, as the admin renders it. */
export type WebhookEndpoint = {
    id: string;
    name: string;
    url: string;
    /** The trailing characters of the signing secret. Never the secret itself. */
    secretHint: string;
    enabled: boolean;
    /** Empty means every kind. */
    eventKinds: string[];
    /** Empty means every content type. */
    contentTypes: string[];
    allWorkspaces: boolean;
    /** Empty when {@link allWorkspaces} is true. */
    workspaceIds: string[];
    headers: Record<string, string>;
    /** Set when the endpoint switched itself off after repeated failures. */
    disabledReason: string | null;
    consecutiveFailures: number;
    createdAt: string;
    updatedAt: string;
    lastDelivery: WebhookLastDelivery | null;
};

/** The one-line delivery summary shown against an endpoint in the list. */
export type WebhookLastDelivery = {
    id: string;
    status: DeliveryStatus;
    eventKind: string;
    statusCode: number | null;
    createdAt: string;
};

/**
 * An endpoint together with its freshly minted secret.
 *
 * Returned only by create and rotate — the one moment the plaintext exists
 * outside the server.
 */
export type CreatedWebhookEndpoint = {
    endpoint: WebhookEndpoint;
    secret: string;
};

/** One row of an endpoint's delivery log. */
export type WebhookDelivery = {
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
};

/** A delivery with the body that was sent and the response that came back. */
export type WebhookDeliveryDetail = WebhookDelivery & {
    payload: unknown;
    responseSnippet: string | null;
};

/** A page of deliveries. */
export type WebhookDeliveryPage = {
    items: WebhookDelivery[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
};

/** The outcome of "Send test", reported in the dialog that asked for it. */
export type WebhookTestResult = {
    ok: boolean;
    statusCode: number | null;
    error: string | null;
    durationMs: number;
    responseSnippet: string | null;
};

/** One subscribable event kind, as the picker renders it. */
export type WebhookEventOption = {
    kind: string;
    group: string;
    label: string;
    scopedByContentType: boolean;
    carriesWorkspace: boolean;
};
