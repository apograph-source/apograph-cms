import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Plus } from 'lucide-react';
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    toast
} from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import { useAddWorkspaceMember } from '../../../application/useAddWorkspaceMember';
import { useRemoveWorkspaceMember } from '../../../application/useRemoveWorkspaceMember';
import { useUserDetailContext } from '../../userDetailContext';
import { AddToWorkspacesDialog } from '../../components/AddToWorkspacesDialog';
import { ConfirmDialog } from '@orthacms/design-system';
import { WorkspaceMembershipCard } from '../../components/WorkspaceMembershipCard';
import type { MemberWorkspace } from '../../../domain/types/member';

/** Intl descriptors for {@link UserWorkspacesPage}. */
const messages = defineMessages({
    title: { id: 'users.workspaces.title', defaultMessage: 'Workspaces' },
    description: {
        id: 'users.workspaces.description',
        defaultMessage: 'The workspaces this member can access.'
    },
    add: { id: 'users.workspaces.add', defaultMessage: 'Add to workspace' },
    empty: {
        id: 'users.workspaces.empty',
        defaultMessage: 'This member isn’t in any workspace yet.'
    },
    confirmTitle: {
        id: 'users.workspaces.confirmTitle',
        defaultMessage: 'Remove from {name}?'
    },
    confirmBody: {
        id: 'users.workspaces.confirmBody',
        defaultMessage:
            'They’ll lose access to this workspace. You can add them back later.'
    },
    confirmRemove: {
        id: 'users.workspaces.confirmRemove',
        defaultMessage: 'Remove'
    },
    added: {
        id: 'users.workspaces.added',
        defaultMessage:
            'Added to {count, plural, one {# workspace} other {# workspaces}}.'
    },
    removed: {
        id: 'users.workspaces.removed',
        defaultMessage: 'Removed from {name}.'
    },
    addFailed: {
        id: 'users.workspaces.addFailed',
        defaultMessage: 'Couldn’t add to the workspaces. Please try again.'
    },
    removeFailed: {
        id: 'users.workspaces.removeFailed',
        defaultMessage: 'Couldn’t remove from the workspace. Please try again.'
    }
});

/**
 * The Workspaces tab: the member's workspace memberships, with add (a
 * multi-select dialog) and per-card remove (confirmed). Memberships come from
 * the shared detail record; mutations invalidate it so the list refreshes.
 * Editing requires `users:update`.
 */
export function UserWorkspacesPage() {
    const intl = useIntl();
    const { member } = useUserDetailContext();
    const canManage = useHasPermission('users:update');
    const addMember = useAddWorkspaceMember();
    const removeMember = useRemoveWorkspaceMember();

    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<MemberWorkspace | null>(null);

    const onAdd = async (workspaceIds: string[]) => {
        // Add each workspace independently so one failure (e.g. a 409 from an
        // already-member race, or a transient network error) doesn't mask the
        // ones that did commit. `Promise.all` would reject on the first failure
        // and report total failure even though some adds succeeded.
        const results = await Promise.allSettled(
            workspaceIds.map((workspaceId) =>
                addMember.mutateAsync({ userId: member.id, workspaceId })
            )
        );
        const added = results.filter(
            (result) => result.status === 'fulfilled'
        ).length;

        // Close once anything landed (the successful mutations have already
        // invalidated the detail, so the list reflects them); keep the dialog
        // open only when every add failed, so the admin can retry.
        if (added > 0) {
            setAdding(false);
            toast.success(intl.formatMessage(messages.added, { count: added }));
        }
        if (added < workspaceIds.length) {
            toast.error(intl.formatMessage(messages.addFailed));
        }
    };

    const onRemove = () => {
        if (!removing) {
            return;
        }
        removeMember.mutate(
            { userId: member.id, workspaceId: removing.id },
            {
                onSuccess: () => {
                    toast.success(
                        intl.formatMessage(messages.removed, {
                            name: removing.name
                        })
                    );
                    setRemoving(null);
                },
                onError: () => {
                    toast.error(intl.formatMessage(messages.removeFailed));
                    setRemoving(null);
                }
            }
        );
    };

    return (
        <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="space-y-1.5">
                    <CardTitle>{intl.formatMessage(messages.title)}</CardTitle>
                    <CardDescription>
                        {intl.formatMessage(messages.description)}
                    </CardDescription>
                </div>
                {canManage ? (
                    <Button size="sm" onClick={() => setAdding(true)}>
                        <Plus aria-hidden className="size-4" />
                        {intl.formatMessage(messages.add)}
                    </Button>
                ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
                {member.workspaces.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {intl.formatMessage(messages.empty)}
                    </p>
                ) : (
                    member.workspaces.map((workspace) => (
                        <WorkspaceMembershipCard
                            key={workspace.id}
                            workspace={workspace}
                            onRemove={canManage ? setRemoving : undefined}
                            removing={
                                removeMember.isPending &&
                                removing?.id === workspace.id
                            }
                        />
                    ))
                )}
            </CardContent>

            <AddToWorkspacesDialog
                open={adding}
                onOpenChange={setAdding}
                existingIds={member.workspaces.map((workspace) => workspace.id)}
                busy={addMember.isPending}
                onAdd={onAdd}
            />

            <ConfirmDialog
                open={removing !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setRemoving(null);
                    }
                }}
                busy={removeMember.isPending}
                title={intl.formatMessage(messages.confirmTitle, {
                    name: removing?.name ?? ''
                })}
                description={intl.formatMessage(messages.confirmBody)}
                confirmLabel={intl.formatMessage(messages.confirmRemove)}
                confirmVariant="destructive"
                onConfirm={onRemove}
            />
        </Card>
    );
}
