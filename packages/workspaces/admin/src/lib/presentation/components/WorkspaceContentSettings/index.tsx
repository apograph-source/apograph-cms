import { useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Plus } from 'lucide-react';
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Spinner,
    toast
} from '@orthacms/design-system';
import type { Workspace } from '../../../domain/types/workspace';
import type { ContentType } from '../../../domain/types/wizard';
import { isConflict } from '../../../infrastructure/isConflict';
import { useContentTypes } from '../../../application/useContentTypes';
import { useAddWorkspaceContent } from '../../../application/useAddWorkspaceContent';
import { useRemoveWorkspaceContent } from '../../../application/useRemoveWorkspaceContent';
import { AddContentDialog } from './AddContentDialog';
import { RemoveContentDialog } from './RemoveContentDialog';
import { GrantedContentGroup } from './GrantedContentGroup';
import type { GrantedContent } from './GrantedContentRow';

const messages = defineMessages({
    title: {
        id: 'workspaces.settings.content.title',
        defaultMessage: 'Content types'
    },
    description: {
        id: 'workspaces.settings.content.description',
        defaultMessage:
            'The collections and pages this workspace can work with. Its Content Library is scoped to these.'
    },
    collections: {
        id: 'workspaces.settings.content.collections',
        defaultMessage: 'Collections'
    },
    pages: {
        id: 'workspaces.settings.content.pages',
        defaultMessage: 'Pages'
    },
    collectionsEmpty: {
        id: 'workspaces.settings.content.collectionsEmpty',
        defaultMessage: 'No collections granted yet.'
    },
    pagesEmpty: {
        id: 'workspaces.settings.content.pagesEmpty',
        defaultMessage: 'No pages granted yet.'
    },
    addCollections: {
        id: 'workspaces.settings.content.addCollections',
        defaultMessage: 'Add collections'
    },
    addPages: {
        id: 'workspaces.settings.content.addPages',
        defaultMessage: 'Add pages'
    },
    addCollectionsBody: {
        id: 'workspaces.settings.content.addCollectionsBody',
        defaultMessage:
            'Search and select the multi-entry collections to grant this workspace.'
    },
    addPagesBody: {
        id: 'workspaces.settings.content.addPagesBody',
        defaultMessage:
            'Search and select the standalone pages to grant this workspace.'
    },
    readOnly: {
        id: 'workspaces.settings.content.readOnly',
        defaultMessage:
            'You have read-only access and can’t change content types.'
    },
    loadError: {
        id: 'workspaces.settings.content.loadError',
        defaultMessage: 'Couldn’t load the content-type catalogue.'
    },
    added: {
        id: 'workspaces.settings.content.added',
        defaultMessage:
            '{count, plural, one {Content type added.} other {# content types added.}}'
    },
    addError: {
        id: 'workspaces.settings.content.addError',
        defaultMessage: 'Couldn’t add those content types. Please try again.'
    },
    removed: {
        id: 'workspaces.settings.content.removed',
        defaultMessage: 'Content type removed.'
    },
    removeError: {
        id: 'workspaces.settings.content.removeError',
        defaultMessage: 'Couldn’t remove that content type. Please try again.'
    },
    notEmpty: {
        id: 'workspaces.settings.content.notEmpty',
        defaultMessage:
            'This content type still has entries in the workspace. Delete them first, then remove it.'
    }
});

/**
 * Classifies a content type as a **page** (a standalone `single`) rather than a
 * multi-entry collection. The single source of this rule, shared by the granted
 * rows and the add dialog. An unknown (stale) type is treated as a collection —
 * the default bucket.
 */
export const isPage = (type?: ContentType) => type?.kind === 'single';

/** Props for {@link WorkspaceContentSettings}. */
export type WorkspaceContentSettingsProps = {
    /** The workspace whose content grants are managed. */
    workspace: Workspace;
    /** Whether the current user may manage content (holds `workspaces:update`). */
    canUpdate: boolean;
};

/**
 * The Content-types settings tab: the granted collections and pages shown as
 * two titled groups (each row with its title + description), granted through a
 * **separate search + multi-select dialog per kind** (Add collections / Add
 * pages), and revoked through a dialog that **blocks** the action while the type
 * still holds entries. Gated on `workspaces:update`.
 */
export function WorkspaceContentSettings({
    workspace,
    canUpdate
}: WorkspaceContentSettingsProps) {
    const intl = useIntl();
    const catalog = useContentTypes();
    const addContent = useAddWorkspaceContent();
    const removeContent = useRemoveWorkspaceContent();
    const [addCollectionsOpen, setAddCollectionsOpen] = useState(false);
    const [addPagesOpen, setAddPagesOpen] = useState(false);
    const [pendingRemoval, setPendingRemoval] = useState<GrantedContent | null>(
        null
    );

    const types = useMemo(() => catalog.data ?? [], [catalog.data]);
    const byName = useMemo(() => {
        const map = new Map<string, ContentType>();
        for (const type of types) map.set(type.name, type);
        return map;
    }, [types]);

    const grantedSet = new Set(workspace.content);
    const granted: GrantedContent[] = workspace.content.map((slug) => ({
        slug,
        type: byName.get(slug)
    }));
    // An unknown (stale) slug can't be classed by kind — it falls under
    // Collections, the default bucket.
    const grantedCollections = granted.filter((g) => !isPage(g.type));
    const grantedPages = granted.filter((g) => isPage(g.type));
    const availableCollections = types.filter(
        (type) => !isPage(type) && !grantedSet.has(type.name)
    );
    const availablePages = types.filter(
        (type) => isPage(type) && !grantedSet.has(type.name)
    );

    /** Grants the chosen slugs; returns whether it succeeded (to close on ok). */
    const grant = async (slugs: string[]): Promise<boolean> => {
        // The grant endpoint is per-slug; fan out and reconcile once. Use
        // allSettled so one failure doesn't discard the grants that did land —
        // report how many succeeded and only flag the rest as failed.
        const results = await Promise.allSettled(
            slugs.map((slug) =>
                addContent.mutateAsync({ workspaceId: workspace.id, slug })
            )
        );
        const succeeded = results.filter(
            (result) => result.status === 'fulfilled'
        ).length;
        const failed = slugs.length - succeeded;

        if (succeeded > 0) {
            toast.success(
                intl.formatMessage(messages.added, { count: succeeded })
            );
        }
        if (failed > 0) {
            toast.error(intl.formatMessage(messages.addError));
        }
        // Close only when everything landed; on a partial failure the dialog
        // stays open so the still-ungranted types (the list refetched them out)
        // remain visible for a retry.
        return failed === 0;
    };

    const confirmRemoval = async () => {
        if (!pendingRemoval) return;
        const { slug } = pendingRemoval;
        try {
            await removeContent.mutateAsync({
                workspaceId: workspace.id,
                slug
            });
            toast.success(intl.formatMessage(messages.removed));
        } catch (error) {
            // The dialog blocks a non-empty revoke up front; this 409 is only a
            // safety net for an entry created between the check and the confirm.
            (isConflict(error) ? toast.warning : toast.error)(
                intl.formatMessage(
                    isConflict(error) ? messages.notEmpty : messages.removeError
                )
            );
        } finally {
            setPendingRemoval(null);
        }
    };

    const removalLabel =
        pendingRemoval?.type?.label ??
        pendingRemoval?.type?.name ??
        pendingRemoval?.slug ??
        '';

    return (
        <Card>
            <CardHeader>
                <CardTitle asChild>
                    <h2>{intl.formatMessage(messages.title)}</h2>
                </CardTitle>
                <CardDescription>
                    {intl.formatMessage(messages.description)}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
                {catalog.isError ? (
                    <p className="text-sm text-destructive">
                        {intl.formatMessage(messages.loadError)}
                    </p>
                ) : null}

                {canUpdate ? (
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setAddCollectionsOpen(true)}
                            disabled={catalog.isPending || catalog.isError}
                        >
                            <Plus className="size-4" />
                            {intl.formatMessage(messages.addCollections)}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setAddPagesOpen(true)}
                            disabled={catalog.isPending || catalog.isError}
                        >
                            <Plus className="size-4" />
                            {intl.formatMessage(messages.addPages)}
                        </Button>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.readOnly)}
                    </p>
                )}

                {catalog.isPending && granted.length === 0 ? (
                    <p className="flex items-center gap-2 rounded-xl border px-3 py-4 text-sm text-muted-foreground">
                        <Spinner className="size-4" />
                    </p>
                ) : (
                    <>
                        <GrantedContentGroup
                            heading={intl.formatMessage(messages.collections)}
                            items={grantedCollections}
                            emptyLabel={intl.formatMessage(
                                messages.collectionsEmpty
                            )}
                            canRemove={canUpdate}
                            onRemove={setPendingRemoval}
                        />
                        <GrantedContentGroup
                            heading={intl.formatMessage(messages.pages)}
                            items={grantedPages}
                            emptyLabel={intl.formatMessage(messages.pagesEmpty)}
                            canRemove={canUpdate}
                            onRemove={setPendingRemoval}
                        />
                    </>
                )}
            </CardContent>

            <AddContentDialog
                open={addCollectionsOpen}
                onOpenChange={setAddCollectionsOpen}
                title={intl.formatMessage(messages.addCollections)}
                description={intl.formatMessage(messages.addCollectionsBody)}
                available={availableCollections}
                onConfirm={async (slugs) => {
                    if (await grant(slugs)) setAddCollectionsOpen(false);
                }}
                busy={addContent.isPending}
            />

            <AddContentDialog
                open={addPagesOpen}
                onOpenChange={setAddPagesOpen}
                title={intl.formatMessage(messages.addPages)}
                description={intl.formatMessage(messages.addPagesBody)}
                available={availablePages}
                onConfirm={async (slugs) => {
                    if (await grant(slugs)) setAddPagesOpen(false);
                }}
                busy={addContent.isPending}
            />

            <RemoveContentDialog
                workspaceId={workspace.id}
                slug={pendingRemoval?.slug ?? null}
                label={removalLabel}
                onClose={() => setPendingRemoval(null)}
                onConfirm={confirmRemoval}
                busy={removeContent.isPending}
            />
        </Card>
    );
}
