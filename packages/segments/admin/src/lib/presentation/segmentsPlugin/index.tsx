import { Suspense, lazy } from 'react';
import type { AdminPlugin } from '@orthacms/bootstrap-admin';
import { SIDEBAR_NAV_SLOT } from '@orthacms/shell-admin';
import {
    ENTRY_HEADER_SLOT,
    ENTRY_PRESAVE_SLOT,
    ENTRY_TAB,
    ENTRY_TAB_SLOT,
    RECORDS_FILTER_FIELDS_SLOT,
    REVISION_EXTRA_SLOT
} from '@orthacms/content-admin';
import { ShieldCheck } from 'lucide-react';
import { SegmentsPageSkeleton } from '../components/SegmentsPageSkeleton';
import { SegmentEditorPageSkeleton } from '../components/SegmentEditorPageSkeleton';
import { SEGMENTS_READ } from '../../application/hooks';
import {
    ACCESS_EXTENSION_KEY,
    ENTRY_ACCESS_PRESAVE_ID,
    useEntryAccessPresave
} from '../../application/useEntryAccessPresave';
import { useAccessFilterFields } from '../../application/useAccessFilterFields';
import { EntryAccessChip } from '../components/EntryAccessChip';
import { EntryAccessTab } from '../components/EntryAccessTab';
import { RevisionAccessValue } from '../components/RevisionAccessValue';

// Lazy so the directory is code-split into its own chunk. The entry chip and
// tab are **not** lazy: they mount inside the editor, which is already a chunk
// of its own, and a suspense boundary around a badge in the title row is a
// flicker on every entry open.
const SegmentsPage = lazy(() =>
    import('../pages/SegmentsPage').then((module) => ({
        default: module.SegmentsPage
    }))
);
const SegmentEditorPage = lazy(() =>
    import('../pages/SegmentEditorPage').then((module) => ({
        default: module.SegmentEditorPage
    }))
);

/** Admin-side segments plugin shape — a named alias of {@link AdminPlugin}. */
export type SegmentsAdminPlugin = AdminPlugin;

/**
 * Creates the admin-side segments plugin — two surfaces and no more.
 *
 * The **directory** at `/segments` manages the vocabulary: the audiences
 * readers are divided into, created and edited on their own pages at
 * `/segments/new` and `/segments/:segmentId`. It is a top-level page rather than
 * a workspace one because an audience is installation-wide, like a content type
 * — the same customer whichever workspace's content they are reading. Which
 * workspaces may *use* one is a property of the audience, set on its page.
 *
 * The **entry editor** is where every decision is made: a chip in the title row
 * saying whether the entry is restricted, and the Access tab behind it with one
 * three-state control per audience. There is nothing between the two — no rule
 * library, no assignment screen — because there is nothing in the model
 * between them.
 *
 * @example
 * ```typescript
 * createAdmin({
 *   plugins: [ShellPlugin(), ContentPlugin(), SegmentsPlugin()],
 * });
 * ```
 */
export function SegmentsPlugin(): SegmentsAdminPlugin {
    return {
        name: 'segments',
        routes: [
            {
                path: '/segments',
                // A skeleton, not a spinner: the fallback is a whole page, and
                // a spinner in the middle of an empty one says only that
                // something is happening — then moves every control into place
                // when the chunk lands. See `SegmentsPageSkeleton`.
                element: (
                    <Suspense fallback={<SegmentsPageSkeleton />}>
                        <SegmentsPage />
                    </Suspense>
                )
            },
            // The static `new` segment is declared **before** `:segmentId` so it
            // wins the match — the same rule content's `:typeName/new` follows.
            {
                path: '/segments/new',
                element: (
                    <Suspense fallback={<SegmentEditorPageSkeleton />}>
                        <SegmentEditorPage />
                    </Suspense>
                )
            },
            {
                path: '/segments/:segmentId',
                element: (
                    <Suspense fallback={<SegmentEditorPageSkeleton />}>
                        <SegmentEditorPage />
                    </Suspense>
                )
            }
        ],
        slots: [
            {
                slot: SIDEBAR_NAV_SLOT,
                items: [
                    {
                        labelId: 'segments.nav.label',
                        defaultLabel: 'Segments',
                        to: '/segments',
                        group: 'directory',
                        order: 40,
                        icon: ShieldCheck,
                        iconColor: 'text-nav-purple',
                        // Without this the row is a dead link for anyone who
                        // cannot read the directory: the page renders its
                        // no-access state, so the nav would promise a
                        // destination it does not deliver.
                        permission: SEGMENTS_READ
                    }
                ]
            },
            {
                slot: ENTRY_HEADER_SLOT,
                items: [
                    { id: 'segments.entry.chip', Component: EntryAccessChip }
                ]
            },
            {
                slot: ENTRY_TAB_SLOT,
                items: [
                    {
                        id: 'segments.entry.tab',
                        slug: ENTRY_TAB.Access,
                        label: {
                            id: 'segments.entryTab.label',
                            defaultMessage: 'Access'
                        },
                        order: 20,
                        // Every type, unlike the Media tab: any entry can be
                        // restricted, and a schema says nothing about whether
                        // it should be. The tab renders its own "no audiences
                        // yet" state when none exists.
                        appliesTo: () => true,
                        Component: EntryAccessTab
                    }
                ]
            },
            {
                // Access rides the entry's own Save / Publish rather than a
                // button of its own — and it has to be staged here, above the
                // editor, because the tab that stages it is a route and unmounts
                // on every tab switch.
                slot: ENTRY_PRESAVE_SLOT,
                items: [
                    {
                        id: ENTRY_ACCESS_PRESAVE_ID,
                        usePresave: useEntryAccessPresave
                    }
                ]
            },
            {
                // …and because it rides the save, the version that save appends
                // captured it — so "what would restoring this change" can
                // finally include who could read it.
                slot: REVISION_EXTRA_SLOT,
                items: [
                    {
                        key: ACCESS_EXTENSION_KEY,
                        label: {
                            id: 'segments.revision.label',
                            defaultMessage: 'Who can read this'
                        },
                        Component: RevisionAccessValue
                    }
                ]
            },
            {
                // Filtering the records list by who can read a record. It joins
                // the list's own query builder rather than getting a screen of
                // its own, so an access question is one rule among the rest —
                // saveable as a view, replayable as an alarm rule.
                slot: RECORDS_FILTER_FIELDS_SLOT,
                items: [
                    {
                        id: 'segments.records.filterFields',
                        // The signature hands over the schema; these fields
                        // apply to every type, so it is unused. The workspace
                        // the hook needs comes from context — this renders
                        // inside the workspace shell.
                        useFields: () => useAccessFilterFields()
                    }
                ]
            }
        ]
    };
}
