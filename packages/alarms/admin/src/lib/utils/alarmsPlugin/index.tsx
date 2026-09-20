import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import {
    ENTRY_SIDEBAR_WIDGET_SLOT,
    RECORDS_COLUMN_SLOT,
    RECORDS_TOOLBAR_SLOT,
    type ContentTypeDetail,
    type EntryRecord
} from '@orthacms/content-admin';
import {
    WORKSPACE_NAV_SLOT,
    WORKSPACE_ROUTE_SLOT
} from '@orthacms/workspaces-admin';
import { COPILOT_TOOL_RESULT_SLOT } from '@orthacms/copilot-admin';
import { BellRing } from 'lucide-react';
import { AlarmsSkeleton } from '../../presentation/components/AlarmsSkeleton';
import { AlarmsColumnCell } from '../../presentation/components/AlarmsColumnCell';
import { EntryAlarmsWidget } from '../../presentation/components/EntryAlarmsWidget';
import { SaveFilterAsRuleAction } from '../../presentation/components/SaveFilterAsRuleAction';
import { FindingsToolResult } from '../../presentation/components/FindingsToolResult';
import { useFindingsByEntry } from '../../application/useFindingsByEntry';
import { alarmsColumnMessages } from '../alarmsColumnMessages';

// Lazy so each page is its own chunk, fetched when a user first opens alarms.
const AlarmsPage = lazy(() =>
    import('../../presentation/pages/AlarmsPage').then((module) => ({
        default: module.AlarmsPage
    }))
);

const AlarmRuleEditorPage = lazy(() =>
    import('../../presentation/pages/AlarmRuleEditorPage').then((module) => ({
        default: module.AlarmRuleEditorPage
    }))
);

/** Admin-side alarms plugin shape — a named alias of {@link AdminPlugin}. */
export type AlarmsAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side alarms plugin.
 *
 * It lives **strictly inside a workspace**: alarms are per-workspace content
 * rules, so it contributes a workspace route and a workspace nav entry rather
 * than a top-level route and a global sidebar item.
 *
 * The three content slots are what make the feature reach editors who never
 * open the alarms page at all — and none of them requires a line of change in
 * `content-admin`:
 *
 * - `ENTRY_SIDEBAR_WIDGET_SLOT` — the findings for the record being edited.
 *   The surface the whole feature exists for.
 * - `RECORDS_COLUMN_SLOT` — an optional Checks column in the records table.
 * - `RECORDS_TOOLBAR_SLOT` — "Save as rule", which is how rules are actually
 *   created: from a filter someone has already built and already looked at.
 *
 * It also fills the copilot's `COPILOT_TOOL_RESULT_SLOT`, so
 * `admin_alarms_findings` reads as a list of linked records with their ages
 * rather than as a JSON array. The copilot package learns nothing about alarms
 * for it — the same inversion as the content slots above.
 *
 * @example
 * ```tsx
 * createAdmin({
 *   plugins: [
 *     IdentityPlugin(),
 *     ShellPlugin(),
 *     WorkspacesPlugin(),
 *     ContentPlugin(),
 *     AlarmsPlugin()
 *   ]
 * });
 * ```
 */
export function AlarmsPlugin(): AlarmsAdminPlugin {
    return {
        name: 'alarms',
        slots: [
            {
                slot: WORKSPACE_ROUTE_SLOT,
                items: [
                    {
                        path: 'alarms',
                        // Well after content: landing on the workspace base
                        // should open the library, not a list of problems.
                        order: 60,
                        element: (
                            <Suspense fallback={<AlarmsSkeleton />}>
                                <AlarmsPage />
                            </Suspense>
                        )
                    },
                    {
                        // Before the `:ruleId` route below. React Router v6
                        // ranks a static segment above a dynamic one regardless
                        // of declaration order, so this is belt and braces —
                        // but the editor also takes `mode` as a prop rather
                        // than sniffing the param, so neither route can be
                        // mistaken for the other.
                        path: 'alarms/rules/new',
                        order: 61,
                        element: (
                            <Suspense fallback={<AlarmsSkeleton />}>
                                <AlarmRuleEditorPage mode="create" />
                            </Suspense>
                        )
                    },
                    {
                        path: 'alarms/rules/:ruleId',
                        order: 62,
                        element: (
                            <Suspense fallback={<AlarmsSkeleton />}>
                                <AlarmRuleEditorPage />
                            </Suspense>
                        )
                    }
                ]
            },
            {
                slot: WORKSPACE_NAV_SLOT,
                items: [
                    {
                        labelId: 'alarms.nav.label',
                        defaultLabel: 'Alarms',
                        to: 'alarms',
                        order: 40,
                        icon: BellRing,
                        permission: 'alarms:read'
                    }
                ]
            },
            {
                slot: ENTRY_SIDEBAR_WIDGET_SLOT,
                items: [
                    {
                        id: 'alarms.entry.checks',
                        // Below the built-in Details and publish blocks: a
                        // finding is context for the record, not the first
                        // thing you need when you open one.
                        order: 40,
                        Component: EntryAlarmsWidget
                    }
                ]
            },
            {
                slot: RECORDS_COLUMN_SLOT,
                items: [
                    {
                        id: 'alarms.records.checks',
                        label: alarmsColumnMessages.column,
                        // Applies to every collection: any type can have rules.
                        appliesTo: () => true,
                        // One batch request per page, and only when the column
                        // is actually switched on — extension columns are
                        // hidden by default and this hook runs regardless, so
                        // ignoring `isVisible` would fetch on every page of
                        // every list for data nobody is looking at.
                        useRowsData: (
                            entries: EntryRecord[],
                            _schema: ContentTypeDetail,
                            _workspaceId: string,
                            isVisible: boolean
                        ) =>
                            useFindingsByEntry(
                                entries.map((entry: EntryRecord) => entry.id),
                                isVisible
                            ),
                        Cell: AlarmsColumnCell
                    }
                ]
            },
            {
                slot: RECORDS_TOOLBAR_SLOT,
                items: [
                    {
                        id: 'alarms.records.saveAsRule',
                        Component: SaveFilterAsRuleAction
                    }
                ]
            },
            {
                slot: COPILOT_TOOL_RESULT_SLOT,
                items: [
                    {
                        id: 'alarms.copilot.findings',
                        toolName: 'admin_alarms_findings',
                        Component: FindingsToolResult
                    }
                ]
            }
        ]
    };
}
