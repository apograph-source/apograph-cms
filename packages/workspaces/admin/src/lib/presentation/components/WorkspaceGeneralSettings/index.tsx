import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    Input,
    Spinner,
    Textarea,
    toast,
    type AvatarColor
} from '@orthacms/design-system';
import { initialsOf } from '@orthacms/utils-admin';
import type { Workspace } from '../../../domain/types/workspace';
import { useWorkspaceProfileSchema } from '../../hooks/useWorkspaceProfileSchema';
import { useUpdateWorkspace } from '../../../application/useUpdateWorkspace';
import { DESCRIPTION_MAX, NAME_MAX } from '../../../domain/workspaceLimits';
import { ColorSwatchRow } from '../ColorSwatchRow';
import { WorkspaceAvatar } from '../WorkspaceAvatar';
import { WorkspaceIdField } from './WorkspaceIdField';

const messages = defineMessages({
    title: {
        id: 'workspaces.settings.general.title',
        defaultMessage: 'General'
    },
    description: {
        id: 'workspaces.settings.general.description',
        defaultMessage:
            'Your workspace name, description, and avatar color. These are visible to everyone with access.'
    },
    nameLabel: {
        id: 'workspaces.settings.general.nameLabel',
        defaultMessage: 'Name'
    },
    nameHint: {
        id: 'workspaces.settings.general.nameHint',
        defaultMessage: 'A short, recognizable name for this workspace.'
    },
    descriptionLabel: {
        id: 'workspaces.settings.general.descriptionLabel',
        defaultMessage: 'Description'
    },
    descriptionHint: {
        id: 'workspaces.settings.general.descriptionHint',
        defaultMessage: 'Optional. What this workspace is for.'
    },
    slugLabel: {
        id: 'workspaces.settings.general.slugLabel',
        defaultMessage: 'URL slug'
    },
    slugHint: {
        id: 'workspaces.settings.general.slugHint',
        defaultMessage:
            'The workspace’s stable identifier. It can’t be changed after creation.'
    },
    readOnly: {
        id: 'workspaces.settings.general.readOnly',
        defaultMessage:
            'You have read-only access. Ask an administrator to change these details.'
    },
    save: {
        id: 'workspaces.settings.general.save',
        defaultMessage: 'Save changes'
    },
    saving: {
        id: 'workspaces.settings.general.saving',
        defaultMessage: 'Saving…'
    },
    saved: {
        id: 'workspaces.settings.general.saved',
        defaultMessage: 'Workspace details saved.'
    },
    error: {
        id: 'workspaces.settings.general.error',
        defaultMessage: 'Couldn’t save your changes. Please try again.'
    }
});

/** Props for {@link WorkspaceGeneralSettings}. */
export type WorkspaceGeneralSettingsProps = {
    /** The workspace being edited. */
    workspace: Workspace;
    /** Whether the current user may edit (holds `workspaces:update`). */
    canUpdate: boolean;
};

/**
 * The General settings tab: edit the workspace name, description, and avatar
 * color. Name/description use TanStack Form + the localized
 * {@link useWorkspaceProfileSchema}; the color is a small piece of local state
 * (a radio row, not a text field). The slug is shown read-only (it's immutable).
 * When the user lacks `workspaces:update` the fields are disabled and the save
 * action is hidden.
 */
export function WorkspaceGeneralSettings({
    workspace,
    canUpdate
}: WorkspaceGeneralSettingsProps) {
    const intl = useIntl();
    const schema = useWorkspaceProfileSchema();
    const update = useUpdateWorkspace();
    const [color, setColor] = useState<AvatarColor>(workspace.color);
    // The last saved color — the color dirty baseline. It re-baselines on save
    // success (before the list refetches and remounts this keyed component) so
    // a color-only save clears the dirty state and can't be PATCHed twice.
    const [savedColor, setSavedColor] = useState<AvatarColor>(workspace.color);
    const colorDirty = color !== savedColor;

    const form = useForm({
        defaultValues: {
            name: workspace.name,
            description: workspace.description
        },
        validators: { onChange: schema },
        onSubmit: async ({ value }) => {
            try {
                await update.mutateAsync({
                    id: workspace.id,
                    name: value.name.trim(),
                    description: value.description.trim(),
                    color
                });
                // Re-baseline both the form and the color to the saved values so
                // the section reads clean immediately — before the invalidated
                // list refetches and remounts this component — preventing a
                // duplicate PATCH if Save is clicked again.
                form.reset(value);
                setSavedColor(color);
                toast.success(intl.formatMessage(messages.saved));
            } catch {
                toast.error(intl.formatMessage(messages.error));
            }
        }
    });

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
            <form
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    form.handleSubmit();
                }}
            >
                <CardContent>
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                        <form.Subscribe selector={(state) => state.values.name}>
                            {(name) => (
                                <div className="flex shrink-0 justify-center sm:pt-1">
                                    <WorkspaceAvatar
                                        className="size-16 text-lg"
                                        initials={initialsOf(name) || '—'}
                                        color={color}
                                    />
                                </div>
                            )}
                        </form.Subscribe>

                        <FieldGroup className="flex-1">
                            <form.Field name="name">
                                {(field) => {
                                    const invalid =
                                        field.state.meta.isTouched &&
                                        field.state.meta.errors.length > 0;
                                    return (
                                        <Field data-invalid={invalid}>
                                            <FieldLabel htmlFor="settings-name">
                                                {intl.formatMessage(
                                                    messages.nameLabel
                                                )}
                                            </FieldLabel>
                                            <Input
                                                id="settings-name"
                                                value={field.state.value}
                                                onChange={(event) =>
                                                    field.handleChange(
                                                        event.target.value
                                                    )
                                                }
                                                onBlur={field.handleBlur}
                                                maxLength={NAME_MAX}
                                                disabled={!canUpdate}
                                                aria-invalid={invalid}
                                            />
                                            {invalid ? (
                                                <FieldError
                                                    errors={
                                                        field.state.meta.errors
                                                    }
                                                />
                                            ) : (
                                                <FieldDescription>
                                                    {intl.formatMessage(
                                                        messages.nameHint
                                                    )}
                                                </FieldDescription>
                                            )}
                                        </Field>
                                    );
                                }}
                            </form.Field>

                            <form.Field name="description">
                                {(field) => {
                                    const invalid =
                                        field.state.meta.isTouched &&
                                        field.state.meta.errors.length > 0;
                                    return (
                                        <Field data-invalid={invalid}>
                                            <FieldLabel htmlFor="settings-description">
                                                {intl.formatMessage(
                                                    messages.descriptionLabel
                                                )}
                                            </FieldLabel>
                                            <Textarea
                                                id="settings-description"
                                                value={field.state.value}
                                                onChange={(event) =>
                                                    field.handleChange(
                                                        event.target.value
                                                    )
                                                }
                                                onBlur={field.handleBlur}
                                                maxLength={DESCRIPTION_MAX}
                                                rows={3}
                                                disabled={!canUpdate}
                                                aria-invalid={invalid}
                                            />
                                            {invalid ? (
                                                <FieldError
                                                    errors={
                                                        field.state.meta.errors
                                                    }
                                                />
                                            ) : (
                                                <FieldDescription>
                                                    {intl.formatMessage(
                                                        messages.descriptionHint
                                                    )}
                                                </FieldDescription>
                                            )}
                                        </Field>
                                    );
                                }}
                            </form.Field>

                            <ColorSwatchRow
                                value={color}
                                onChange={(next) => canUpdate && setColor(next)}
                            />

                            <Field>
                                <FieldLabel htmlFor="settings-slug">
                                    {intl.formatMessage(messages.slugLabel)}
                                </FieldLabel>
                                {/* `readOnly` but NOT `disabled`, matching
                                    `WorkspaceIdField` below: a disabled input
                                    can't be focused, so the slug could be
                                    neither selected nor copied by keyboard, and
                                    screen readers skip disabled controls in
                                    browse mode — the label was reachable but the
                                    value never was. The slug is the workspace's
                                    stable public identifier, not decoration. */}
                                <Input
                                    id="settings-slug"
                                    value={workspace.slug}
                                    readOnly
                                    className="bg-muted text-muted-foreground"
                                />
                                <FieldDescription>
                                    {intl.formatMessage(messages.slugHint)}
                                </FieldDescription>
                            </Field>

                            <WorkspaceIdField workspaceId={workspace.id} />
                        </FieldGroup>
                    </div>
                </CardContent>

                {canUpdate ? (
                    <CardFooter className="justify-end border-t pt-6">
                        <form.Subscribe
                            selector={(state) => ({
                                canSubmit: state.canSubmit,
                                isDirty: state.isDirty,
                                isSubmitting: state.isSubmitting
                            })}
                        >
                            {({ canSubmit, isDirty, isSubmitting }) => (
                                <Button
                                    type="submit"
                                    disabled={
                                        !canSubmit ||
                                        (!isDirty && !colorDirty) ||
                                        isSubmitting
                                    }
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Spinner />
                                            {intl.formatMessage(
                                                messages.saving
                                            )}
                                        </>
                                    ) : (
                                        intl.formatMessage(messages.save)
                                    )}
                                </Button>
                            )}
                        </form.Subscribe>
                    </CardFooter>
                ) : (
                    <CardFooter className="border-t pt-6">
                        <p className="text-sm text-muted-foreground">
                            {intl.formatMessage(messages.readOnly)}
                        </p>
                    </CardFooter>
                )}
            </form>
        </Card>
    );
}
