import { Injectable } from '@nestjs/common';
import { InjectDatabase, type Database } from '@orthacms/database';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { secretHint } from '../domain/webhook-secret';
import type {
    WebhookEndpointView,
    WebhookLastDeliveryView
} from '../domain/webhook-views';
import type { DeliveryStatus } from '@orthacms/webhooks-domain';
import { webhookDeliveries } from './schema/webhook-deliveries';
import {
    webhookEndpoints,
    webhookEndpointWorkspaces
} from './schema/webhook-endpoints';

/** The fields a create or update writes. */
export interface EndpointWriteModel {
    name: string;
    url: string;
    enabled: boolean;
    eventKinds: string[];
    contentTypes: string[];
    allWorkspaces: boolean;
    workspaceIds: string[];
    headers: Record<string, string>;
}

/** An endpoint as the delivery path needs it — secret included. */
export interface EndpointWithSecret {
    id: string;
    name: string;
    url: string;
    secret: string;
    headers: Record<string, string>;
    enabled: boolean;
}

/** The subscription-relevant columns, for fan-out. */
export interface EndpointSubscriptionRow {
    id: string;
    enabled: boolean;
    allWorkspaces: boolean;
    workspaceIds: string[];
    eventKinds: string[];
    contentTypes: string[];
}

/** Reads and writes over the two endpoint tables. */
@Injectable()
export class WebhookEndpointRepository {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /**
     * Every enabled endpoint with its workspace set, for fan-out.
     *
     * One query with an aggregated sub-select rather than a join: a join would
     * return one row per workspace and force the caller to regroup, and this
     * runs on every content write.
     */
    async listSubscriptions(): Promise<EndpointSubscriptionRow[]> {
        const rows = await this.db
            .select({
                id: webhookEndpoints.id,
                enabled: webhookEndpoints.enabled,
                allWorkspaces: webhookEndpoints.allWorkspaces,
                eventKinds: webhookEndpoints.eventKinds,
                contentTypes: webhookEndpoints.contentTypes,
                workspaceIds: sql<
                    string[]
                >`coalesce((select array_agg(${webhookEndpointWorkspaces.workspaceId}) from ${webhookEndpointWorkspaces} where ${webhookEndpointWorkspaces.endpointId} = ${webhookEndpoints.id}), '{}')`
            })
            .from(webhookEndpoints)
            .where(eq(webhookEndpoints.enabled, true));

        return rows.map((row) => ({
            id: row.id,
            enabled: row.enabled,
            allWorkspaces: row.allWorkspaces,
            workspaceIds: row.workspaceIds ?? [],
            eventKinds: asStringArray(row.eventKinds),
            contentTypes: asStringArray(row.contentTypes)
        }));
    }

    /** The endpoint the worker is about to POST to, or null when it is gone. */
    async findForDelivery(id: string): Promise<EndpointWithSecret | null> {
        const [row] = await this.db
            .select({
                id: webhookEndpoints.id,
                name: webhookEndpoints.name,
                url: webhookEndpoints.url,
                secret: webhookEndpoints.secret,
                headers: webhookEndpoints.headers,
                enabled: webhookEndpoints.enabled
            })
            .from(webhookEndpoints)
            .where(eq(webhookEndpoints.id, id))
            .limit(1);

        if (!row) return null;
        return { ...row, headers: asHeaderMap(row.headers) };
    }

    /** Every endpoint, newest first, each with its last delivery. */
    async list(): Promise<WebhookEndpointView[]> {
        const rows = await this.db
            .select()
            .from(webhookEndpoints)
            .orderBy(desc(webhookEndpoints.createdAt));

        if (rows.length === 0) return [];

        const ids = rows.map((row) => row.id);
        const [workspaces, lastDeliveries] = await Promise.all([
            this.workspacesFor(ids),
            this.lastDeliveriesFor(ids)
        ]);

        return rows.map((row) =>
            toView(
                row,
                workspaces.get(row.id) ?? [],
                lastDeliveries.get(row.id) ?? null
            )
        );
    }

    /** One endpoint, or null. */
    async findById(id: string): Promise<WebhookEndpointView | null> {
        const [row] = await this.db
            .select()
            .from(webhookEndpoints)
            .where(eq(webhookEndpoints.id, id))
            .limit(1);
        if (!row) return null;

        const [workspaces, lastDeliveries] = await Promise.all([
            this.workspacesFor([id]),
            this.lastDeliveriesFor([id])
        ]);

        return toView(
            row,
            workspaces.get(id) ?? [],
            lastDeliveries.get(id) ?? null
        );
    }

    /**
     * Creates an endpoint and its workspace set in one transaction, so an
     * endpoint can never exist with half its subscription.
     */
    async create(
        model: EndpointWriteModel,
        secret: string,
        createdBy: string | null
    ): Promise<string> {
        return this.db.transaction(async (tx) => {
            const [row] = await tx
                .insert(webhookEndpoints)
                .values({
                    name: model.name,
                    url: model.url,
                    secret,
                    secretHint: secretHint(secret),
                    enabled: model.enabled,
                    eventKinds: model.eventKinds,
                    contentTypes: model.contentTypes,
                    allWorkspaces: model.allWorkspaces,
                    headers: model.headers,
                    createdBy
                })
                .returning({ id: webhookEndpoints.id });

            await this.replaceWorkspaces(tx, row.id, model);
            return row.id;
        });
    }

    /** Applies a full write model to an existing endpoint. */
    async update(id: string, model: EndpointWriteModel): Promise<void> {
        await this.db.transaction(async (tx) => {
            await tx
                .update(webhookEndpoints)
                .set({
                    name: model.name,
                    url: model.url,
                    enabled: model.enabled,
                    eventKinds: model.eventKinds,
                    contentTypes: model.contentTypes,
                    allWorkspaces: model.allWorkspaces,
                    headers: model.headers,
                    // Re-enabling by hand clears the auto-disable state, so the
                    // reason shown in the UI can never outlive the condition.
                    disabledReason: model.enabled ? null : undefined,
                    consecutiveFailures: model.enabled ? 0 : undefined,
                    updatedAt: new Date()
                })
                .where(eq(webhookEndpoints.id, id));

            await this.replaceWorkspaces(tx, id, model);
        });
    }

    /** Rotates the signing secret. */
    async replaceSecret(id: string, secret: string): Promise<void> {
        await this.db
            .update(webhookEndpoints)
            .set({
                secret,
                secretHint: secretHint(secret),
                updatedAt: new Date()
            })
            .where(eq(webhookEndpoints.id, id));
    }

    /** Deletes the endpoint; its workspaces and deliveries cascade. */
    async delete(id: string): Promise<void> {
        await this.db
            .delete(webhookEndpoints)
            .where(eq(webhookEndpoints.id, id));
    }

    /** Whether an endpoint with this id exists. */
    async exists(id: string): Promise<boolean> {
        const [row] = await this.db
            .select({ id: webhookEndpoints.id })
            .from(webhookEndpoints)
            .where(eq(webhookEndpoints.id, id))
            .limit(1);
        return row !== undefined;
    }

    /** Clears the consecutive-failure count after a delivery succeeded. */
    async recordSuccess(id: string): Promise<void> {
        await this.db
            .update(webhookEndpoints)
            .set({ consecutiveFailures: 0 })
            .where(eq(webhookEndpoints.id, id));
    }

    /**
     * Counts one dead delivery against the endpoint and switches it off once
     * `threshold` of them have arrived in a row.
     *
     * The increment and the test are one statement so two workers finishing
     * failed deliveries at the same moment cannot both read the old count and
     * both decide not to disable.
     *
     * @returns whether this failure switched the endpoint off.
     */
    async recordFailure(id: string, threshold: number): Promise<boolean> {
        const reason = `Disabled automatically after ${threshold} consecutive failed deliveries.`;
        const [row] = await this.db
            .update(webhookEndpoints)
            .set({
                consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
                enabled: sql`case when ${webhookEndpoints.consecutiveFailures} + 1 >= ${threshold} then false else ${webhookEndpoints.enabled} end`,
                disabledReason: sql`case when ${webhookEndpoints.consecutiveFailures} + 1 >= ${threshold} then ${reason} else ${webhookEndpoints.disabledReason} end`
            })
            .where(eq(webhookEndpoints.id, id))
            .returning({ enabled: webhookEndpoints.enabled });

        return row !== undefined && !row.enabled;
    }

    /** Replaces an endpoint's workspace rows to match `model`. */
    private async replaceWorkspaces(
        tx: Database,
        endpointId: string,
        model: EndpointWriteModel
    ): Promise<void> {
        await tx
            .delete(webhookEndpointWorkspaces)
            .where(eq(webhookEndpointWorkspaces.endpointId, endpointId));

        // "All workspaces" is the flag, not a row per workspace: enumerating
        // them would silently stop covering the next workspace created.
        if (model.allWorkspaces || model.workspaceIds.length === 0) return;

        await tx.insert(webhookEndpointWorkspaces).values(
            model.workspaceIds.map((workspaceId) => ({
                endpointId,
                workspaceId
            }))
        );
    }

    /** Workspace ids per endpoint, for a set of endpoints. */
    private async workspacesFor(
        endpointIds: string[]
    ): Promise<Map<string, string[]>> {
        const rows = await this.db
            .select()
            .from(webhookEndpointWorkspaces)
            .where(inArray(webhookEndpointWorkspaces.endpointId, endpointIds));

        const grouped = new Map<string, string[]>();
        for (const row of rows) {
            const list = grouped.get(row.endpointId) ?? [];
            list.push(row.workspaceId);
            grouped.set(row.endpointId, list);
        }
        return grouped;
    }

    /**
     * The most recent delivery per endpoint.
     *
     * `DISTINCT ON` rather than a window function or N queries: one index scan
     * over `(endpoint_id, created_at)` answers the whole list page.
     */
    private async lastDeliveriesFor(
        endpointIds: string[]
    ): Promise<Map<string, WebhookLastDeliveryView>> {
        const rows = await this.db
            .selectDistinctOn([webhookDeliveries.endpointId], {
                id: webhookDeliveries.id,
                endpointId: webhookDeliveries.endpointId,
                status: webhookDeliveries.status,
                eventKind: webhookDeliveries.eventKind,
                statusCode: webhookDeliveries.lastStatusCode,
                createdAt: webhookDeliveries.createdAt
            })
            .from(webhookDeliveries)
            .where(inArray(webhookDeliveries.endpointId, endpointIds))
            .orderBy(
                webhookDeliveries.endpointId,
                desc(webhookDeliveries.createdAt)
            );

        return new Map(
            rows.map((row) => [
                row.endpointId,
                {
                    id: row.id,
                    status: row.status as DeliveryStatus,
                    eventKind: row.eventKind,
                    statusCode: row.statusCode,
                    createdAt: row.createdAt.toISOString()
                }
            ])
        );
    }
}

/** Row + its relations → the API shape. */
function toView(
    row: typeof webhookEndpoints.$inferSelect,
    workspaceIds: string[],
    lastDelivery: WebhookLastDeliveryView | null
): WebhookEndpointView {
    return {
        id: row.id,
        name: row.name,
        url: row.url,
        secretHint: row.secretHint,
        enabled: row.enabled,
        eventKinds: asStringArray(row.eventKinds),
        contentTypes: asStringArray(row.contentTypes),
        allWorkspaces: row.allWorkspaces,
        workspaceIds: row.allWorkspaces ? [] : workspaceIds,
        headers: asHeaderMap(row.headers),
        disabledReason: row.disabledReason,
        consecutiveFailures: row.consecutiveFailures,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        lastDelivery
    };
}

/**
 * A `jsonb` column read back as a string array.
 *
 * Drizzle types `jsonb` as `unknown`, and a row written before a column's shape
 * settled — or by hand — could hold anything. Coercing here keeps every reader
 * from repeating the check, and an unexpected shape degrades to "empty", which
 * for these two columns means "everything" rather than a crash.
 */
function asStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}

/** A `jsonb` column read back as a header map, dropping non-string values. */
function asHeaderMap(value: unknown): Record<string, string> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {};
    }
    const headers: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'string') headers[key] = item;
    }
    return headers;
}
