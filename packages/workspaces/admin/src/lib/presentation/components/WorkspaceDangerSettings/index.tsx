import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    ConfirmDialog,
    Separator,
    toast
} from '@orthacms/design-system';
import type { Workspace } from '../../../domain/types/workspace';
import { useSetWorkspaceStatus } from '../../../application/useSetWorkspaceStatus';
import { useDeleteWorkspace } from '../../../application/useDeleteWorkspace';
import { isConflict } from '../../../infrastructure/isConflict';
import { DeleteWorkspaceDialog } from './DeleteWorkspaceDialog';

const messages = defineMessages({
    title: {
        id: 'workspaces.settings.danger.title',
        defaultMessage: 'Danger zone'
    },
    description: {
        id: 'workspaces.settings.danger.description',
        defaultMessage:
            'Archiving hides a workspace from everyday use; deleting is permanent. Proceed carefully.'
    },
    archiveHeading: {
        id: 'workspaces.settings.danger.archiveHeading',
        defaultMessage: 'Archive workspace'
    },
    archiveBody: {
        id: 'workspaces.settings.danger.archiveBody',
        defaultMessage:
            'Mark this workspace archived. Its content and members are kept; you can unarchive it any time.'
    },
    unarchiveHeading: {
        id: 'workspaces.settings.danger.unarchiveHeading',
        defaultMessage: 'Unarchive workspace'
    },
    unarchiveBody: {
        id: 'workspaces.settings.danger.unarchiveBody',
        defaultMessage: 'This workspace is archived. Restore it to active use.'
    },
    archiveAction: {
        id: 'workspaces.settings.danger.archiveAction',
        defaultMessage: 'Archive'
    },
    unarchiveAction: {
        id: 'workspaces.settings.danger.unarchiveAction',
        defaultMessage: 'Unarchive'
    },
    deleteHeading: {
        id: 'workspaces.settings.danger.deleteHeading',
        defaultMessage: 'Delete workspace'
    },
    deleteBody: {
        id: 'workspaces.settings.danger.deleteBody',
        defaultMessage:
            'Permanently delete this workspace, its memberships, and its content grants. This cannot be undone.'
    },
    deleteAction: {
        id: 'workspaces.settings.danger.deleteAction',
        defaultMessage: 'Delete workspace'
    },
    archiveConfirmTitle: {
        id: 'workspaces.settings.danger.archiveConfirmTitle',
        defaultMessage: 'Archive “{name}”?'
    },
    archiveConfirmBody: {
        id: 'workspaces.settings.danger.archiveConfirmBody',
        defaultMessage:
            'The workspace will be hidden from the default view. Members keep their access and you can unarchive it later.'
    },
    archived: {
        id: 'workspaces.settings.danger.archived',
        defaultMessage: 'Workspace archived.'
    },
    unarchived: {
        id: 'workspaces.settings.danger.unarchived',
        defaultMessage: 'Workspace restored.'
    },
    statusError: {
        id: 'workspaces.settings.danger.statusError',
        defaultMessage:
            'Couldn’t change the workspace status. Please try again.'
    },
    deleted: {
        id: 'workspaces.settings.danger.deleted',
        defaultMessage: 'Workspace deleted.'
    },
    deleteError: {
        id: 'workspaces.settings.danger.deleteError',
        defaultMessage: 'Couldn’t delete the workspace. Please try again.'
    },
    deleteNotEmpty: {
        id: 'workspaces.settings.danger.deleteNotEmpty',
        defaultMessage:
            'This workspace still has content. Delete all records first, then delete the workspace.'
    }
});

/** Props for {@link WorkspaceDangerSettings}. */
export type WorkspaceDangerSettingsProps = {
    /** The workspace being managed. */
    workspace: Workspace;
    /** Whether the user may archive/unarchive (holds `workspaces:update`). */
    canUpdate: boolean;
    /** Whether the user may delete (holds `workspaces:delete`). */
    canDelete: boolean;
};

/**
 * The Danger-zone settings tab: archive/unarchive (`workspaces:update`) and
 * permanently delete (`workspaces:delete`), each behind a typed confirmation.
 * On delete the user is sent back to the workspaces grid (the shell route is
 * gone).
 */
export function WorkspaceDangerSettings({
    workspace,
    canUpdate,
    canDelete
}: WorkspaceDangerSettingsProps) {
    const intl = useIntl();
    const navigate = useNavigate();
    const setStatus = useSetWorkspaceStatus();
    const remove = useDeleteWorkspace();
    const [confirmingArchive, setConfirmingArchive] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const isArchived = workspace.status === 'Archived';

    const toggleArchive = async () => {
        try {
            await setStatus.mutateAsync({
                id: workspace.id,
                status: isArchived ? 'Active' : 'Archived'
            });
            toast.success(
                intl.formatMessage(
                    isArchived ? messages.unarchived : messages.archived
                )
            );
        } catch {
            toast.error(intl.formatMessage(messages.statusError));
        } finally {
            setConfirmingArchive(false);
        }
    };

    const confirmDelete = async () => {
        try {
            await remove.mutateAsync(workspace.id);
            toast.success(intl.formatMessage(messages.deleted));
            navigate('/workspaces');
        } catch (error) {
            // The dialog blocks a non-empty delete up front; this 409 is only a
            // safety net for content created between the check and the confirm.
            (isConflict(error) ? toast.warning : toast.error)(
                intl.formatMessage(
                    isConflict(error)
                        ? messages.deleteNotEmpty
                        : messages.deleteError
                )
            );
            setConfirmingDelete(false);
        }
    };

    return (
        <Card className="border-destructive/40">
            <CardHeader>
                <CardTitle asChild className="text-destructive">
                    <h2>{intl.formatMessage(messages.title)}</h2>
                </CardTitle>
                <CardDescription>
                    {intl.formatMessage(messages.description)}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {canUpdate ? (
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-col">
                            <span className="text-sm font-medium">
                                {intl.formatMessage(
                                    isArchived
                                        ? messages.unarchiveHeading
                                        : messages.archiveHeading
                                )}
                            </span>
                            <span className="text-sm text-muted-foreground">
                                {intl.formatMessage(
                                    isArchived
                                        ? messages.unarchiveBody
                                        : messages.archiveBody
                                )}
                            </span>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            className="shrink-0"
                            disabled={setStatus.isPending}
                            onClick={() => {
                                // Unarchiving is low-risk, so it applies
                                // directly; archiving asks first.
                                if (isArchived) {
                                    toggleArchive();
                                } else {
                                    setConfirmingArchive(true);
                                }
                            }}
                        >
                            {intl.formatMessage(
                                isArchived
                                    ? messages.unarchiveAction
                                    : messages.archiveAction
                            )}
                        </Button>
                    </div>
                ) : null}

                {canUpdate && canDelete ? <Separator /> : null}

                {canDelete ? (
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-col">
                            <span className="text-sm font-medium">
                                {intl.formatMessage(messages.deleteHeading)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                                {intl.formatMessage(messages.deleteBody)}
                            </span>
                        </div>
                        <Button
                            type="button"
                            variant="destructive"
                            className="shrink-0"
                            disabled={remove.isPending}
                            onClick={() => setConfirmingDelete(true)}
                        >
                            {intl.formatMessage(messages.deleteAction)}
                        </Button>
                    </div>
                ) : null}
            </CardContent>

            <ConfirmDialog
                open={confirmingArchive}
                onOpenChange={setConfirmingArchive}
                title={intl.formatMessage(messages.archiveConfirmTitle, {
                    name: workspace.name
                })}
                description={intl.formatMessage(messages.archiveConfirmBody)}
                confirmLabel={intl.formatMessage(messages.archiveAction)}
                busy={setStatus.isPending}
                onConfirm={toggleArchive}
            />

            <DeleteWorkspaceDialog
                workspace={confirmingDelete ? workspace : null}
                onClose={() => setConfirmingDelete(false)}
                onConfirm={confirmDelete}
                busy={remove.isPending}
            />
        </Card>
    );
}
