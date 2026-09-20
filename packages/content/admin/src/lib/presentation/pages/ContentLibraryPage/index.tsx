import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Container
} from '@orthacms/design-system';
import { History, Trash2 } from 'lucide-react';
import { useHasPermission } from '@orthacms/identity-admin';
import { useCurrentWorkspace } from '@orthacms/workspaces-admin';
import { useContentTypes } from '../../../application/useContentTypes';
import { ContentTopBar } from '../../components/ContentTopBar';
import { ContentTypeView } from '../../components/ContentTypeView';
import { ContentWelcome } from '../../components/ContentWelcome';
import { ContentComingSoon } from '../../components/ContentComingSoon';
import { ContentEntryRoute } from '../../components/ContentEntryRoute';
import { ContentLibraryError } from '../../components/ContentLibraryError';
import { ContentLibraryEmpty } from '../../components/ContentLibraryEmpty';
import { ContentLibraryPageSkeleton } from '../../components/ContentLibrarySkeleton';
import { ContentOverlays } from '../../components/ContentOverlays';
import {
    CONTENT_READ,
    CONTENT_SEGMENT,
    ENTRY_MODE,
    ENTRY_PARAM,
    ENTRY_TAB_SLUGS,
    HISTORY_SEGMENT,
    NEW_SEGMENT,
    TAB_PARAM,
    TRASH_SEGMENT,
    TYPE_PARAM
} from '../../../domain/constants';
import { useDocumentTitle } from '@orthacms/utils-admin';

/** Intl descriptors for the page-level states, co-located here. */
const messages = defineMessages({
    documentTitle: {
        id: 'content.library.documentTitle',
        defaultMessage: 'Content Library'
    },
    forbiddenTitle: {
        id: 'content.library.forbiddenTitle',
        defaultMessage: 'No access'
    },
    forbiddenBody: {
        id: 'content.library.forbiddenBody',
        defaultMessage: 'You don’t have permission to view content here.'
    },
    historyTitle: {
        id: 'content.history.title',
        defaultMessage: 'History'
    },
    historyBody: {
        id: 'content.history.body',
        defaultMessage: 'A timeline of content changes is coming soon.'
    },
    trashTitle: {
        id: 'content.trash.title',
        defaultMessage: 'Trash'
    },
    trashBody: {
        id: 'content.trash.body',
        defaultMessage: 'Deleted entries will be recoverable here soon.'
    }
});

/**
 * The Content Library work area, mounted inside the workspace shell at
 * `/workspaces/:id/content/*`. The content-type nav and the ⌘K search palette
 * now live in the app sidebar (the Content section, `ContentNavSection`); this
 * page owns only the work-area island — an outlet driven by nested routes (a
 * welcome landing and the selected `:typeName` view / entry editor).
 */
export function ContentLibraryPage() {
    const intl = useIntl();
    // Names this route in the tab strip, the window list, the history
    // and a screen reader's window announcement. Every private route but
    // Workspaces was still titled a bare "Admin" (WCAG 2.4.2, `ORT-140`).
    useDocumentTitle(intl.formatMessage(messages.documentTitle));
    const workspace = useCurrentWorkspace();
    const canRead = useHasPermission(CONTENT_READ);
    const {
        data: types,
        isPending,
        isError,
        refetch
    } = useContentTypes(canRead);

    if (!canRead) {
        return (
            <ContentPane>
                <Container className="py-8">
                    <Alert role="alert">
                        <AlertTitle>
                            {intl.formatMessage(messages.forbiddenTitle)}
                        </AlertTitle>
                        <AlertDescription>
                            {intl.formatMessage(messages.forbiddenBody)}
                        </AlertDescription>
                    </Alert>
                </Container>
            </ContentPane>
        );
    }

    if (isError) {
        return (
            <ContentPane>
                <ContentLibraryError onRetry={() => void refetch()} />
            </ContentPane>
        );
    }

    if (isPending) {
        // The full-page skeleton, not an empty pane: it carries the sr-only
        // <h1> the `page-has-heading-one` axe rule needs (an empty pane has no
        // heading at all) and marks itself `aria-busy` so the route announcer
        // reads the settled page name rather than the loading placeholder.
        return <ContentLibraryPageSkeleton />;
    }

    // Scope the global content-type catalogue to the slugs this workspace was
    // granted at creation — collections and pages are linked per workspace.
    const granted = new Set(workspace.content);
    const scopedTypes = types.filter((type) => granted.has(type.name));

    if (scopedTypes.length === 0) {
        return (
            <ContentPane>
                <ContentLibraryEmpty />
            </ContentPane>
        );
    }

    const basePath = `/workspaces/${workspace.id}/${CONTENT_SEGMENT}`;

    return (
        <ContentPane>
            {/* Outside the routes on purpose: a viewport-level cover has to
                outlive the view it covers (the editor unmounts itself while a
                record loads). */}
            <ContentOverlays />
            <ContentTopBar types={scopedTypes} basePath={basePath} />
            <Routes>
                <Route
                    index
                    element={<ContentWelcome workspaceName={workspace.name} />}
                />
                <Route
                    path={HISTORY_SEGMENT}
                    element={
                        <ContentComingSoon
                            icon={History}
                            title={intl.formatMessage(messages.historyTitle)}
                            description={intl.formatMessage(
                                messages.historyBody
                            )}
                        />
                    }
                />
                <Route
                    path={TRASH_SEGMENT}
                    element={
                        <ContentComingSoon
                            icon={Trash2}
                            title={intl.formatMessage(messages.trashTitle)}
                            description={intl.formatMessage(messages.trashBody)}
                        />
                    }
                />
                <Route
                    path={`:${TYPE_PARAM}`}
                    element={<ContentTypeView types={scopedTypes} />}
                />
                {/* A **single** page's editor is mounted on the type itself, so
                    its tab hangs directly off `:typeName`. Each slug is spelled
                    out as a static segment, which React Router ranks above the
                    `:entryId` route below — the same trick `new` and `trash`
                    already rely on. (On a collection these paths simply render
                    the records table; nothing links to them.) */}
                {ENTRY_TAB_SLUGS.map((slug) => (
                    <Route
                        key={slug}
                        path={`:${TYPE_PARAM}/${slug}`}
                        element={<ContentTypeView types={scopedTypes} />}
                    />
                ))}
                {/* A collection's trash view. The static `trash` segment
                    outranks `:entryId`, so the order is safe. */}
                <Route
                    path={`:${TYPE_PARAM}/${TRASH_SEGMENT}`}
                    element={<ContentTypeView types={scopedTypes} trashed />}
                />
                {/* Create + entry-edit forms. The static `new` segment outranks
                    `:entryId`, so the order is safe. */}
                <Route
                    path={`:${TYPE_PARAM}/${NEW_SEGMENT}`}
                    element={
                        <ContentEntryRoute
                            types={scopedTypes}
                            mode={ENTRY_MODE.Create}
                        />
                    }
                />
                <Route
                    path={`:${TYPE_PARAM}/${NEW_SEGMENT}/:${TAB_PARAM}`}
                    element={
                        <ContentEntryRoute
                            types={scopedTypes}
                            mode={ENTRY_MODE.Create}
                        />
                    }
                />
                <Route
                    path={`:${TYPE_PARAM}/:${ENTRY_PARAM}`}
                    element={
                        <ContentEntryRoute
                            types={scopedTypes}
                            mode={ENTRY_MODE.Edit}
                        />
                    }
                />
                {/* The open tab as a route segment, so it survives a remount
                    (e.g. switching locale re-targets the editor at the sibling's
                    id). Omitted = the default tab, keeping the bare entry URL
                    the canonical short link. */}
                <Route
                    path={`:${TYPE_PARAM}/:${ENTRY_PARAM}/:${TAB_PARAM}`}
                    element={
                        <ContentEntryRoute
                            types={scopedTypes}
                            mode={ENTRY_MODE.Edit}
                        />
                    }
                />
                <Route path="*" element={<Navigate to="." replace />} />
            </Routes>
        </ContentPane>
    );
}

/**
 * The Content Library work area: fills the workspace shell's height beside the
 * app sidebar and scrolls its content independently. Sized with `flex-1`
 * against the shell's `min-h-svh` column — NOT its own `h-svh` — so there is
 * exactly one viewport measurement in the chain; a second, independently
 * rounded one can end up 1px taller (visibly at browser zoom ≠ 100%) and give
 * the document a phantom scrollbar beside the pane's own. Flush to the canvas
 * (no muted board or bordered island) — the records table and the entry
 * editor render directly on the background and bring their own gutters. When
 * the sidebar is collapsed, the reveal trigger renders inline in the
 * `ContentTopBar` (the `TopBar` primitive owns that).
 */
function ContentPane({ children }: { children?: ReactNode }) {
    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
            {children}
        </div>
    );
}
