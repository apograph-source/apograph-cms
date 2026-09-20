import { defineMessages, useIntl } from 'react-intl';
import {
    Container,
    Skeleton,
    WizardPageSkeleton
} from '@orthacms/design-system';
import { WorkspaceSettingsTopBar } from '../WorkspaceSettingsTopBar';

/** Intl descriptors for the workspaces skeletons, co-located here. */
const messages = defineMessages({
    loading: {
        id: 'workspaces.skeleton.loading',
        defaultMessage: 'Loading workspaces…'
    },
    shellHeading: {
        id: 'workspaces.skeleton.shellHeading',
        defaultMessage: 'Loading workspace'
    },
    loadingForm: {
        id: 'workspaces.skeleton.loadingForm',
        defaultMessage: 'Loading…'
    },
    loadingContent: {
        id: 'workspaces.skeleton.loadingContent',
        defaultMessage: 'Loading content types…'
    },
    loadingSettings: {
        id: 'workspaces.skeleton.loadingSettings',
        defaultMessage: 'Loading workspace settings…'
    }
});

/** A single placeholder row mirroring {@link WorkspacesTable}'s row structure. */
function WorkspaceRowSkeleton() {
    return (
        <div className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
            <Skeleton className="size-9 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-1.5 h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-4 w-20 shrink-0" />
            <Skeleton className="h-5 w-16 shrink-0 rounded-xl" />
        </div>
    );
}

/**
 * The table placeholder shown while {@link useWorkspaces} resolves. Drops into
 * the page body in place of the real table (header + toolbar stay live), so it
 * owns the single `role="status"` announcement; the rows themselves are
 * `aria-hidden`.
 */
export function WorkspacesTableSkeleton({ count = 6 }: { count?: number }) {
    const intl = useIntl();

    return (
        <div role="status">
            <span className="sr-only">
                {intl.formatMessage(messages.loading)}
            </span>
            <div aria-hidden className="rounded-xl border">
                {Array.from({ length: count }).map((_, index) => (
                    <WorkspaceRowSkeleton key={index} />
                ))}
            </div>
        </div>
    );
}

/**
 * Full-page placeholder for the lazy-route `Suspense` fallback — before
 * {@link WorkspacesPage} mounts there is no header or toolbar yet, so this
 * sketches the whole page (header, toolbar, table) to hold the layout steady
 * while the chunk loads. Reuses {@link WorkspacesTableSkeleton} for the body.
 */
export function WorkspacesPageSkeleton() {
    return (
        <Container>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-4 w-80 max-w-full" />
                </div>
                <Skeleton className="h-9 w-36 shrink-0" />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-3">
                <Skeleton className="h-9 w-full sm:max-w-[360px]" />
                <Skeleton className="h-9 w-56" />
                <Skeleton className="ml-auto h-4 w-16" />
            </div>

            <WorkspacesTableSkeleton />
        </Container>
    );
}

/**
 * Placeholder for the workspace shell's content area — shown both as the
 * lazy-route `Suspense` fallback and while {@link useWorkspaces} resolves inside
 * the shell (the per-workspace nav lives in the app sidebar, injected once the
 * workspace resolves). Owns the single `role="status"` announcement.
 */
export function WorkspaceShellSkeleton() {
    const intl = useIntl();

    return (
        // `aria-busy` marks this as a loading placeholder so the host's route
        // announcer waits past the sr-only heading below and reads the settled
        // page name instead (see `RouteAnnouncer`).
        <div role="status" aria-busy="true" className="min-h-svh p-8">
            {/* The page's `<h1>`, visually hidden. The workspace shell is a lazy
                chunk behind this fallback (and re-shown while `useWorkspaces`
                resolves), so until the real page mounts there is no heading at
                all — failing `page-has-heading-one` and leaving the view
                unnavigable by heading (`ORT-167`). It names the state. */}
            <h1 className="sr-only">
                {intl.formatMessage(messages.shellHeading)}
            </h1>
            <span className="sr-only">
                {intl.formatMessage(messages.loading)}
            </span>
            <div aria-hidden>
                <Skeleton className="h-8 w-48" />
                <Skeleton className="mt-3 h-4 w-80 max-w-full" />
            </div>
        </div>
    );
}

/**
 * Lazy-route `Suspense` fallback for {@link CreateWorkspacePage}. Wraps the
 * shared {@link WizardPageSkeleton} so the `sr-only` status stays localized.
 */
export function CreateWorkspacePageSkeleton() {
    const intl = useIntl();

    return (
        <WizardPageSkeleton label={intl.formatMessage(messages.loadingForm)} />
    );
}

/** A placeholder resource section: a header row over a few selectable rows. */
function ResourceSectionSkeleton() {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <Skeleton className="size-5 rounded" />
                <Skeleton className="h-4 w-28" />
            </div>
            {Array.from({ length: 3 }).map((_, index) => (
                <div
                    key={index}
                    className="flex items-center gap-3 rounded-xl border p-3"
                >
                    <Skeleton className="size-5 shrink-0 rounded" />
                    <Skeleton className="h-4 w-40" />
                </div>
            ))}
        </div>
    );
}

/**
 * Section placeholder shown while {@link useContentTypes} resolves in the
 * create-workspace wizard's "specific content" mode — two resource sections
 * (collections and pages). Replaces the inline spinner so the step keeps its
 * shape. Owns a single `role="status"`; the sections are `aria-hidden`.
 */
export function ContentTypesSkeleton() {
    const intl = useIntl();

    return (
        <div role="status">
            <span className="sr-only">
                {intl.formatMessage(messages.loadingContent)}
            </span>
            <div aria-hidden className="flex flex-col gap-6">
                <ResourceSectionSkeleton />
                <ResourceSectionSkeleton />
            </div>
        </div>
    );
}

/**
 * Full-page placeholder for the workspace-settings lazy-route `Suspense`
 * fallback, mounted in the workspace shell at `/workspaces/:id/settings/*`.
 *
 * The bar is **real**, not a skeleton: it is the page's identity, it hosts the
 * sidebar-reveal trigger when the app sidebar is collapsed, and it derives its
 * crumbs from the URL rather than from data — so the very same
 * {@link WorkspaceSettingsTopBar} the page renders can paint before the chunk
 * arrives, already naming the section being opened. Below it the header, the
 * tab bar and the section card are sketched, so the page slots into a layout
 * that is already the right shape.
 */
export function WorkspaceSettingsPageSkeleton() {
    const intl = useIntl();

    return (
        <>
            <WorkspaceSettingsTopBar />
            <Container className="space-y-6 py-8" role="status">
                <span className="sr-only">
                    {intl.formatMessage(messages.loadingSettings)}
                </span>

                <div aria-hidden className="flex flex-col gap-2">
                    <Skeleton className="h-8 w-56" />
                    <Skeleton className="h-4 w-80 max-w-full" />
                </div>

                <div aria-hidden className="flex flex-col gap-6">
                    <div className="flex gap-2 border-b pb-2">
                        {/* Whole literal class strings — Tailwind scans source
                            text and never emits an interpolated width. */}
                        {['w-16', 'w-20', 'w-16', 'w-24'].map(
                            (width, index) => (
                                <div
                                    key={index}
                                    className="flex items-center gap-2 px-3 py-1.5"
                                >
                                    <Skeleton className="size-4 shrink-0 rounded" />
                                    <Skeleton className={`h-4 ${width}`} />
                                </div>
                            )
                        )}
                    </div>

                    <div className="flex min-w-0 flex-col gap-6 rounded-xl border p-6">
                        <div className="flex flex-col gap-2">
                            <Skeleton className="h-5 w-40" />
                            <Skeleton className="h-4 w-72 max-w-full" />
                        </div>
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="flex flex-col gap-2">
                                <Skeleton className="h-4 w-28" />
                                <Skeleton className="h-9 w-full" />
                            </div>
                        ))}
                        <div className="flex justify-end border-t pt-4">
                            <Skeleton className="h-9 w-28" />
                        </div>
                    </div>
                </div>
            </Container>
        </>
    );
}
