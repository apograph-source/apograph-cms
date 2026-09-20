import type {
    AlarmFinding,
    AlarmFindingList,
    AlarmRule,
    AlarmRulePreview,
    AlarmScanResult,
    AlarmSeverity,
    AlarmSummary,
    FindingState
} from '../../types/alarm';

/**
 * The wire shapes `/api/alarms` returns.
 *
 * Restated here rather than imported from `@orthacms/alarms-server`: the admin
 * does not import server packages, and the anti-corruption layer is the point —
 * a column rename on the server surfaces as a compile error in this one file
 * rather than spreading through components.
 */
export type AlarmRuleResponse = {
    id: string;
    contentType: string;
    name: string;
    findingTitle: string;
    description: string | null;
    severity: string;
    filter: unknown;
    enabled: boolean;
    brokenReason: string | null;
    lastScanAt: string | null;
    openCount: number;
};

/** One finding on the wire. */
export type AlarmFindingResponse = {
    ruleId: string;
    ruleName: string;
    title: string;
    contentType: string;
    entryId: string;
    severity: string;
    state: string;
    firstSeenAt: string;
    lastSeenAt: string;
};

/** The findings page envelope. */
export type AlarmFindingListResponse = {
    items: AlarmFindingResponse[];
    total: number;
    page: number;
    pageSize: number;
};

/** The rescan report. */
export type AlarmScanResponse = {
    ruleId: string;
    scanned: number;
    opened: number;
    resolved: number;
    open: number;
};

/** The rule-editor preview. */
export type AlarmRulePreviewResponse = {
    matched: number;
    total: number;
    sampleIds: string[];
};

/** The workspace's counts. */
export type AlarmSummaryResponse = {
    open: Record<string, number>;
    openTotal: number;
};

/** The batch keyed by entry id. */
export type AlarmFindingsByEntryResponse = {
    byEntry: Record<string, AlarmFindingResponse[]>;
};

const SEVERITIES = new Set(['info', 'warn', 'error']);
const STATES = new Set(['open', 'resolved']);

/**
 * A severity the UI does not know reads as `warn`.
 *
 * The column is text server-side so that adding a severity is not a migration,
 * which means an unknown value is reachable. Falling back keeps the row visible;
 * throwing would take the whole page down for one bad record. Note this is a
 * **display** fallback only — the rule form never submits a severity it did not
 * receive, so a round-trip cannot silently rewrite one.
 */
function toSeverity(value: string): AlarmSeverity {
    return (SEVERITIES.has(value) ? value : 'warn') as AlarmSeverity;
}

/** Same reasoning as {@link toSeverity}, for the finding state. */
function toState(value: string): FindingState {
    return (STATES.has(value) ? value : 'open') as FindingState;
}

/** Maps a rule from the wire. */
export function toAlarmRule(dto: AlarmRuleResponse): AlarmRule {
    return {
        id: dto.id,
        contentType: dto.contentType,
        name: dto.name,
        findingTitle: dto.findingTitle,
        description: dto.description,
        severity: toSeverity(dto.severity),
        filter: dto.filter,
        enabled: dto.enabled,
        brokenReason: dto.brokenReason,
        lastScanAt: dto.lastScanAt,
        openCount: dto.openCount
    };
}

/** Maps a finding from the wire. */
export function toAlarmFinding(dto: AlarmFindingResponse): AlarmFinding {
    return {
        ruleId: dto.ruleId,
        ruleName: dto.ruleName,
        title: dto.title,
        contentType: dto.contentType,
        entryId: dto.entryId,
        severity: toSeverity(dto.severity),
        state: toState(dto.state),
        firstSeenAt: dto.firstSeenAt,
        lastSeenAt: dto.lastSeenAt
    };
}

/** Maps a page of findings from the wire. */
export function toAlarmFindingList(
    dto: AlarmFindingListResponse
): AlarmFindingList {
    return {
        items: dto.items.map(toAlarmFinding),
        total: dto.total,
        page: dto.page,
        pageSize: dto.pageSize
    };
}

/** Maps a rescan report from the wire. */
export function toAlarmScanResult(dto: AlarmScanResponse): AlarmScanResult {
    return { ...dto };
}

/** Maps a rule preview from the wire. */
export function toAlarmRulePreview(
    dto: AlarmRulePreviewResponse
): AlarmRulePreview {
    return { ...dto };
}

/** Maps the workspace counts, filling in any severity the server omitted. */
export function toAlarmSummary(dto: AlarmSummaryResponse): AlarmSummary {
    return {
        open: {
            error: dto.open?.['error'] ?? 0,
            warn: dto.open?.['warn'] ?? 0,
            info: dto.open?.['info'] ?? 0
        },
        openTotal: dto.openTotal
    };
}

/** Maps the by-entry batch, mapping each entry's findings. */
export function toFindingsByEntry(
    dto: AlarmFindingsByEntryResponse
): Record<string, AlarmFinding[]> {
    const byEntry: Record<string, AlarmFinding[]> = {};
    for (const [entryId, findings] of Object.entries(dto.byEntry ?? {})) {
        byEntry[entryId] = findings.map(toAlarmFinding);
    }
    return byEntry;
}
