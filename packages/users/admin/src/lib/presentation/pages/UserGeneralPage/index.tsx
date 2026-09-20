import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
    InputField,
    Spinner,
    toast
} from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import { useUpdateMember } from '../../../application/useUpdateMember';
import { useUserDetailContext } from '../../userDetailContext';

/** Server-side cap on the display name (mirrors the users plugin). */
const NAME_MAX_LENGTH = 80;

/** Intl descriptors for {@link UserGeneralPage}, co-located with the component. */
const messages = defineMessages({
    title: { id: 'users.general.title', defaultMessage: 'General' },
    description: {
        id: 'users.general.description',
        defaultMessage: 'The member’s display name and contact email.'
    },
    nameLabel: { id: 'users.general.nameLabel', defaultMessage: 'Full name' },
    nameTooLong: {
        id: 'users.general.nameTooLong',
        defaultMessage: 'Keep the name under {max} characters.'
    },
    emailLabel: { id: 'users.general.emailLabel', defaultMessage: 'Email' },
    emailHint: {
        id: 'users.general.emailHint',
        defaultMessage:
            'Email is the sign-in identifier and can’t be changed here.'
    },
    save: { id: 'users.general.save', defaultMessage: 'Save changes' },
    discard: { id: 'users.general.discard', defaultMessage: 'Discard' },
    saved: {
        id: 'users.general.saved',
        defaultMessage: 'Saved changes to {name}.'
    },
    failed: {
        id: 'users.general.failed',
        defaultMessage: 'Couldn’t save the changes. Please try again.'
    }
});

/**
 * The General tab: edit the member's display name; the email is read-only. The
 * Save/Discard pair only enables on a real change. Edit controls require
 * `users:update`; without it the fields render disabled.
 */
export function UserGeneralPage() {
    const intl = useIntl();
    const { member } = useUserDetailContext();
    const canManage = useHasPermission('users:update');
    const update = useUpdateMember();

    const [name, setName] = useState(member.name);
    const trimmed = name.trim();
    const tooLong = trimmed.length > NAME_MAX_LENGTH;
    const dirty = trimmed !== member.name.trim();
    const canSave = canManage && dirty && trimmed.length > 0 && !tooLong;

    const save = () => {
        if (!canSave) {
            return;
        }
        update.mutate(
            { id: member.id, name: trimmed },
            {
                onSuccess: (saved) => {
                    setName(saved.name);
                    toast.success(
                        intl.formatMessage(messages.saved, { name: saved.name })
                    );
                },
                onError: () => {
                    toast.error(intl.formatMessage(messages.failed));
                }
            }
        );
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{intl.formatMessage(messages.title)}</CardTitle>
                <CardDescription>
                    {intl.formatMessage(messages.description)}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <InputField
                    id="user-general-name"
                    label={intl.formatMessage(messages.nameLabel)}
                    value={name}
                    maxLength={NAME_MAX_LENGTH + 1}
                    disabled={!canManage || update.isPending}
                    onChange={(event) => setName(event.target.value)}
                    error={
                        tooLong
                            ? intl.formatMessage(messages.nameTooLong, {
                                  max: NAME_MAX_LENGTH
                              })
                            : undefined
                    }
                />
                <InputField
                    id="user-general-email"
                    label={intl.formatMessage(messages.emailLabel)}
                    value={member.email}
                    description={intl.formatMessage(messages.emailHint)}
                    readOnly
                    disabled
                />
            </CardContent>
            {canManage ? (
                <CardFooter className="justify-end gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => setName(member.name)}
                        disabled={!dirty || update.isPending}
                    >
                        {intl.formatMessage(messages.discard)}
                    </Button>
                    <Button
                        onClick={save}
                        disabled={!canSave || update.isPending}
                    >
                        {update.isPending ? <Spinner /> : null}
                        {intl.formatMessage(messages.save)}
                    </Button>
                </CardFooter>
            ) : null}
        </Card>
    );
}
