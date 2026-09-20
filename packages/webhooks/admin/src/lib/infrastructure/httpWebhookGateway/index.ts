import { apiClient, toApiError } from '@orthacms/utils-admin';
import type {
    CreatedWebhookEndpoint,
    WebhookDelivery,
    WebhookDeliveryDetail,
    WebhookDeliveryPage,
    WebhookEndpoint,
    WebhookEventOption,
    WebhookTestResult
} from '../../domain/types/webhook';
import type { ContentTypeOption } from '../../domain/types/contentTypeOption';
import type { WorkspaceOption } from '../../domain/types/workspaceOption';
import type { SaveWebhookInput, WebhookGateway } from '../webhookGateway';
import type { DeliveriesListParams } from '../webhooksKeys';
import {
    toWebhookDelivery,
    toWebhookDeliveryDetail,
    toWebhookEndpoint,
    toContentTypeOption,
    toWebhookEventOption,
    toWorkspaceOption,
    type CreatedWebhookEndpointResponse,
    type WebhookDeliveryDetailResponse,
    type WebhookDeliveryResponse,
    type WebhookEndpointResponse,
    type ContentTypeSummaryResponse,
    type WebhookEventResponse,
    type WorkspaceOptionResponse
} from '../webhookMapper';

/** The paginated envelope `GET /api/webhooks/:id/deliveries` returns. */
type DeliveryPageResponse = {
    items: WebhookDeliveryResponse[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
};

/** Maps a created/rotated endpoint, secret included. */
function toCreated(
    dto: CreatedWebhookEndpointResponse
): CreatedWebhookEndpoint {
    return { endpoint: toWebhookEndpoint(dto.endpoint), secret: dto.secret };
}

/**
 * HTTP implementation of {@link WebhookGateway} over the shared `apiClient`
 * (axios, same-origin, cookie-authed; paths omit the `/api` dev-proxy prefix).
 *
 * Every response goes through a mapper and every failure through `toApiError`,
 * so callers see this plugin's models and `ApiError` rather than axios
 * internals. The single place `apiClient` is used in this package.
 */
export const httpWebhookGateway: WebhookGateway = {
    async list(): Promise<WebhookEndpoint[]> {
        try {
            const { data } =
                await apiClient.get<WebhookEndpointResponse[]>('/webhooks');
            return data.map(toWebhookEndpoint);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async get(id: string): Promise<WebhookEndpoint> {
        try {
            const { data } = await apiClient.get<WebhookEndpointResponse>(
                `/webhooks/${id}`
            );
            return toWebhookEndpoint(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async create(input: SaveWebhookInput): Promise<CreatedWebhookEndpoint> {
        try {
            const { data } =
                await apiClient.post<CreatedWebhookEndpointResponse>(
                    '/webhooks',
                    input
                );
            return toCreated(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async update(
        id: string,
        input: SaveWebhookInput
    ): Promise<WebhookEndpoint> {
        try {
            const { data } = await apiClient.patch<WebhookEndpointResponse>(
                `/webhooks/${id}`,
                input
            );
            return toWebhookEndpoint(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async remove(id: string): Promise<void> {
        try {
            await apiClient.delete(`/webhooks/${id}`);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async rotateSecret(id: string): Promise<CreatedWebhookEndpoint> {
        try {
            const { data } =
                await apiClient.post<CreatedWebhookEndpointResponse>(
                    `/webhooks/${id}/secret`
                );
            return toCreated(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async test(id: string): Promise<WebhookTestResult> {
        try {
            const { data } = await apiClient.post<WebhookTestResult>(
                `/webhooks/${id}/test`
            );
            return data;
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listDeliveries(
        id: string,
        params: DeliveriesListParams
    ): Promise<WebhookDeliveryPage> {
        try {
            const { data } = await apiClient.get<DeliveryPageResponse>(
                `/webhooks/${id}/deliveries`,
                { params }
            );
            return { ...data, items: data.items.map(toWebhookDelivery) };
        } catch (error) {
            throw toApiError(error);
        }
    },

    async getDelivery(
        id: string,
        deliveryId: string
    ): Promise<WebhookDeliveryDetail> {
        try {
            const { data } = await apiClient.get<WebhookDeliveryDetailResponse>(
                `/webhooks/${id}/deliveries/${deliveryId}`
            );
            return toWebhookDeliveryDetail(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async redeliver(id: string, deliveryId: string): Promise<WebhookDelivery> {
        try {
            const { data } = await apiClient.post<WebhookDeliveryResponse>(
                `/webhooks/${id}/deliveries/${deliveryId}/redeliver`
            );
            return toWebhookDelivery(data);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listEvents(): Promise<WebhookEventOption[]> {
        try {
            const { data } =
                await apiClient.get<WebhookEventResponse[]>('/webhook-events');
            return data.map(toWebhookEventOption);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listWorkspaceOptions(): Promise<WorkspaceOption[]> {
        try {
            // Unpaginated and scoped to the caller's memberships by the server
            // — `GET /api/workspaces` returns a bare array, which is also what
            // the API-tokens picker reads.
            const { data } =
                await apiClient.get<WorkspaceOptionResponse[]>('/workspaces');
            return data.map(toWorkspaceOption);
        } catch (error) {
            throw toApiError(error);
        }
    },

    async listContentTypeOptions(): Promise<ContentTypeOption[]> {
        try {
            // The registry the Content Library reads, not a webhooks-owned
            // list: there is one source of truth for what types exist, and it
            // is code, so this plugin borrows it rather than storing its own.
            const { data } =
                await apiClient.get<ContentTypeSummaryResponse[]>(
                    '/content-schema'
                );
            return data.map(toContentTypeOption);
        } catch (error) {
            throw toApiError(error);
        }
    }
};
