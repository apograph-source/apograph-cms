import { useCallback } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@orthacms/identity-admin';
import { initialsOf } from '@orthacms/utils-admin';
import { toast } from '@orthacms/design-system';
import { Slug } from '../../domain/slug';
import type { WorkspaceMember } from '../../domain/types/workspace';
import type { WizardSnapshot } from '../../domain/types/wizard';
import { buildCreateWorkspaceBody } from '../../infrastructure/buildCreateWorkspaceBody';
import { isConflict } from '../../infrastructure/isConflict';
import { useCreateWorkspace } from '../useCreateWorkspace';

/** Toast copy for the create-workspace use case. */
const messages = defineMessages({
    success: {
        id: 'workspaces.create.success',
        defaultMessage: 'Workspace "{name}" created.'
    },
    error: {
        id: 'workspaces.create.error',
        defaultMessage: 'Could not create workspace. Please try again.'
    },
    conflict: {
        id: 'workspaces.create.errorConflict',
        defaultMessage:
            'That slug is already taken. Pick a different one on the Basics step.'
    },
    invalidSlug: {
        id: 'workspaces.create.errorInvalidSlug',
        defaultMessage:
            'That slug isn’t valid. Use lowercase letters, numbers, and hyphens only.'
    }
});

/** What {@link useCreateWorkspaceFlow} returns. */
export type CreateWorkspaceFlow = {
    /**
     * Runs the create-workspace use case for a full wizard snapshot: validates
     * the slug through the {@link Slug} value object, derives the creator from
     * the session, POSTs via the create mutation (optimistic insert +
     * invalidation), then toasts and navigates to the list. Errors are caught
     * and surfaced as a toast, so the caller just awaits.
     */
    submit: (snapshot: WizardSnapshot) => Promise<void>;
    /** Whether a submission is currently in flight. */
    submitting: boolean;
};

/**
 * The create-workspace use-case hook. Orchestrates the multi-step wizard's
 * submission — slug VO validation → create → toast + navigate — so the wizard
 * page stays layout + fields and owns none of the flow. Availability is enforced
 * by the page's continue gate; the {@link Slug} guard here is the last check
 * before the request.
 */
export function useCreateWorkspaceFlow(): CreateWorkspaceFlow {
    const intl = useIntl();
    const navigate = useNavigate();
    const auth = useAuth();
    const user = 'user' in auth ? auth.user : undefined;
    const createMutation = useCreateWorkspace();

    const submit = useCallback(
        async (snapshot: WizardSnapshot): Promise<void> => {
            let slugGuarded = false;
            try {
                // Guard the shape through the domain VO before hitting the API.
                Slug.create(snapshot.data.slug.trim());
                slugGuarded = true;

                const displayName = user?.name ?? user?.email ?? 'You';
                const creator: WorkspaceMember = {
                    id: user?.id ?? 'me',
                    name: displayName,
                    email: user?.email ?? '',
                    initials: initialsOf(displayName),
                    color: snapshot.data.color
                };

                const created = await createMutation.mutateAsync({
                    body: buildCreateWorkspaceBody(snapshot),
                    creator
                });
                toast.success(
                    intl.formatMessage(messages.success, { name: created.name })
                );
                navigate('/workspaces');
            } catch (error) {
                // Narrow the outcome rather than collapsing every failure onto
                // "Please try again" — for a taken slug that advice is actively
                // wrong, since retrying can never succeed. `isConflict` is the
                // same 409 narrowing the settings dialogs already use.
                if (!slugGuarded) {
                    toast.error(intl.formatMessage(messages.invalidSlug));
                } else if (isConflict(error)) {
                    toast.error(intl.formatMessage(messages.conflict));
                } else {
                    toast.error(intl.formatMessage(messages.error));
                }
            }
        },
        [user, createMutation, intl, navigate]
    );

    return { submit, submitting: createMutation.isPending };
}
