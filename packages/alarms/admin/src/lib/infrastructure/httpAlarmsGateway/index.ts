import { apiClient } from '@orthacms/utils-admin';
import type {
    AlarmFinding,
    AlarmFindingList,
    AlarmRule,
    AlarmRulePreview,
    AlarmScanResult,
    AlarmSummary
} from '../../types/alarm';
import type {
    AlarmsGateway,
    CreateAlarmRuleInput,
    UpdateAlarmRuleInput
} from '../alarmsGateway';
import type { FindingsListParams } from '../alarmsKeys';
import {
    toAlarmFindingList,
    toAlarmRule,
    toAlarmRulePreview,
    toAlarmScanResult,
    toAlarmSummary,
    toFindingsByEntry,
    type AlarmFindingListResponse,
    type AlarmFindingsByEntryResponse,
    type AlarmRulePreviewResponse,
    type AlarmRuleResponse,
    type AlarmScanResponse,
    type AlarmSummaryResponse
} from '../alarmMapper';

/**
 * The {@link AlarmsGateway} over the shared axios client.
 *
 * The workspace is never passed explicitly — `apiClient` attaches
 * `X-Workspace-Id` from the open workspace on every request, which is what the
 * server's `WorkspaceGuard` reads. Threading it through these signatures would
 * be a second source of truth for the same fact.
 */
export const httpAlarmsGateway: AlarmsGateway = {
    async listRules(): Promise<AlarmRule[]> {
        const { data } =
            await apiClient.get<AlarmRuleResponse[]>('/alarms/rules');
        return data.map(toAlarmRule);
    },

    async createRule(
        input: CreateAlarmRuleInput
    ): Promise<{ rule: AlarmRule; scan: AlarmScanResult }> {
        const { data } = await apiClient.post<{
            rule: AlarmRuleResponse;
            scan: AlarmScanResponse;
        }>('/alarms/rules', input);
        return {
            rule: toAlarmRule(data.rule),
            scan: toAlarmScanResult(data.scan)
        };
    },

    async updateRule(
        id: string,
        input: UpdateAlarmRuleInput
    ): Promise<AlarmRule> {
        const { data } = await apiClient.patch<AlarmRuleResponse>(
            `/alarms/rules/${id}`,
            input
        );
        return toAlarmRule(data);
    },

    async deleteRule(id: string): Promise<void> {
        await apiClient.delete(`/alarms/rules/${id}`);
    },

    async rescanRule(id: string): Promise<AlarmScanResult> {
        const { data } = await apiClient.post<AlarmScanResponse>(
            `/alarms/rules/${id}/rescan`
        );
        return toAlarmScanResult(data);
    },

    async previewRule(
        contentType: string,
        filter: Record<string, unknown>
    ): Promise<AlarmRulePreview> {
        const { data } = await apiClient.post<AlarmRulePreviewResponse>(
            '/alarms/rules/preview',
            { contentType, filter }
        );
        return toAlarmRulePreview(data);
    },

    async listFindings(params: FindingsListParams): Promise<AlarmFindingList> {
        const { data } = await apiClient.get<AlarmFindingListResponse>(
            '/alarms/findings',
            { params }
        );
        return toAlarmFindingList(data);
    },

    async findingsByEntry(
        entryIds: readonly string[]
    ): Promise<Record<string, AlarmFinding[]>> {
        if (entryIds.length === 0) return {};
        const { data } = await apiClient.get<AlarmFindingsByEntryResponse>(
            '/alarms/findings/by-entry',
            { params: { entryIds: entryIds.join(',') } }
        );
        return toFindingsByEntry(data);
    },

    async summary(): Promise<AlarmSummary> {
        const { data } = await apiClient.get<AlarmSummaryResponse>(
            '/alarms/findings/summary'
        );
        return toAlarmSummary(data);
    }
};
