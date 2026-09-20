import { useForm } from '@tanstack/react-form';
import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Field,
    FieldDescription,
    FieldGroup,
    InputField,
    Spinner,
    cn
} from '@orthacms/design-system';
import type { InviteDetails } from '../../../../types/auth';
import { PASSWORD_MIN_LENGTH } from '../../../domain/value-objects/password';
import { AuthField } from '../AuthField';
import { AuthAlert } from '../AuthAlert';
import { SsoProviders } from '../SsoProviders';
import { useAcceptInviteSchema } from './useAcceptInviteSchema';

/** Intl descriptors for {@link AcceptInviteForm}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'identity.acceptInvite.title',
        defaultMessage: 'Set your password'
    },
    descriptionNamed: {
        id: 'identity.acceptInvite.descriptionNamed',
        defaultMessage:
            'Welcome, {name}. Your account is ready — choose a password and you’re in.'
    },
    description: {
        id: 'identity.acceptInvite.description',
        defaultMessage:
            'Your account is ready. Choose a password and you’re in.'
    },
    nameLabel: {
        id: 'identity.acceptInvite.nameLabel',
        defaultMessage: 'Name'
    },
    emailLabel: {
        id: 'identity.acceptInvite.emailLabel',
        defaultMessage: 'Email'
    },
    prefilledHint: {
        id: 'identity.acceptInvite.prefilledHint',
        defaultMessage:
            'Set by whoever invited you. If it looks wrong, ask them for a new invite.'
    },
    namePrefilledHint: {
        id: 'identity.acceptInvite.namePrefilledHint',
        defaultMessage:
            'Set by whoever invited you. You can change it later in your profile.'
    },
    passwordLabel: {
        id: 'identity.acceptInvite.passwordLabel',
        defaultMessage: 'Password'
    },
    passwordPlaceholder: {
        id: 'identity.acceptInvite.passwordPlaceholder',
        defaultMessage: '••••••••••••'
    },
    passwordHint: {
        id: 'identity.acceptInvite.passwordHint',
        defaultMessage:
            'At least {min} characters. A short phrase you’ll actually remember beats a scrambled word you won’t.'
    },
    confirmLabel: {
        id: 'identity.acceptInvite.confirmLabel',
        defaultMessage: 'Confirm password'
    },
    confirmPlaceholder: {
        id: 'identity.acceptInvite.confirmPlaceholder',
        defaultMessage: 'Type it once more'
    },
    submit: {
        id: 'identity.acceptInvite.submit',
        defaultMessage: 'Create my account'
    },
    submitting: {
        id: 'identity.acceptInvite.submitting',
        defaultMessage: 'Setting up your account…'
    },
    signedInNote: {
        id: 'identity.acceptInvite.signedInNote',
        defaultMessage:
            'Once you’re done we’ll sign you in on this device. The invite link stops working after this.'
    },
    ssoSeparator: {
        id: 'identity.acceptInvite.sso.separator',
        defaultMessage: 'or accept with'
    },
    errorTitle: {
        id: 'identity.acceptInvite.errorTitle',
        defaultMessage: 'Couldn’t finish setting up'
    }
});

/** The values {@link AcceptInviteForm} submits once the schema passes. */
export type AcceptInviteFormValues = {
    /** The chosen password. */
    password: string;
    /** The re-typed password; the server checks the match too. */
    confirmPassword: string;
};

/** Props for the {@link AcceptInviteForm} component. */
type AcceptInviteFormProps = Omit<React.ComponentProps<'div'>, 'onSubmit'> & {
    /** Who the invite is for; rendered read-only, never collected. */
    invite: InviteDetails;
    /**
     * The raw token from the invite link. Needed here, not just by the page's
     * submit handler, because the single-sign-on buttons carry it in their
     * `href` — accepting with a work account is a full-page navigation, so the
     * token has to be part of the URL rather than of a request body.
     */
    token: string;
    /** Called when the form is submitted with valid values. */
    onSubmit?: (values: AcceptInviteFormValues) => void;
    /** Whether a submission is in flight; swaps the button for a spinner. */
    isPending?: boolean;
    /** Error message to surface in the destructive alert, if any. */
    error?: string;
};

/**
 * The form an invitee completes to turn their pending account into a real one.
 * Presentation-only: field state is TanStack Form's, submission is delegated to
 * `onSubmit`, and `isPending`/`error` drive the button and alert — no API call
 * lives here.
 *
 * The email and name come from the invite and are shown **read-only**: the
 * inviting admin already decided both, and letting someone edit the email on
 * the way in would let them claim a different identity than the one that was
 * invited. So the only thing collected is a password, typed twice.
 */
export function AcceptInviteForm({
    className,
    invite,
    token,
    onSubmit,
    isPending = false,
    error,
    ...props
}: AcceptInviteFormProps) {
    const intl = useIntl();
    const acceptInviteSchema = useAcceptInviteSchema();

    const form = useForm({
        defaultValues: { password: '', confirmPassword: '' },
        // `onChange` validates as the user types and also runs on submit, so an
        // empty form flags both fields when the button is pressed. Don't also
        // set `onSubmit` to the same schema — each error would render twice.
        validators: { onChange: acceptInviteSchema },
        onSubmit: ({ value }) => onSubmit?.(value)
    });

    return (
        <div className={cn('flex flex-col gap-6', className)} {...props}>
            <Card>
                <CardHeader className="text-center">
                    <CardTitle asChild className="text-xl">
                        <h1>{intl.formatMessage(messages.title)}</h1>
                    </CardTitle>
                    <CardDescription>
                        {invite.name
                            ? intl.formatMessage(messages.descriptionNamed, {
                                  name: invite.name
                              })
                            : intl.formatMessage(messages.description)}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form
                        noValidate
                        onSubmit={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            form.handleSubmit();
                        }}
                    >
                        <FieldGroup>
                            {error && (
                                <AuthAlert
                                    title={intl.formatMessage(
                                        messages.errorTitle
                                    )}
                                    message={error}
                                />
                            )}

                            {invite.name && (
                                <InputField
                                    id="accept-invite-name"
                                    label={intl.formatMessage(
                                        messages.nameLabel
                                    )}
                                    value={invite.name}
                                    // `readOnly`, not `disabled`: the value
                                    // stays focusable and announced, so a
                                    // screen-reader user can read what they're
                                    // signing up as. It just can't be changed.
                                    readOnly
                                    // Each read-only field carries its own
                                    // reason. A field that announces "read only"
                                    // without saying why leaves the invitee
                                    // guessing whether they are stuck; and the
                                    // recovery differs per field — a wrong name
                                    // is fixable later, a wrong email is not, so
                                    // one shared sentence on the email alone
                                    // (the previous shape) left this field mute.
                                    description={intl.formatMessage(
                                        messages.namePrefilledHint
                                    )}
                                />
                            )}

                            <InputField
                                id="accept-invite-email"
                                type="email"
                                label={intl.formatMessage(messages.emailLabel)}
                                value={invite.email}
                                readOnly
                                description={intl.formatMessage(
                                    messages.prefilledHint
                                )}
                            />

                            <form.Field name="password">
                                {(field) => (
                                    <AuthField
                                        field={field}
                                        id="accept-invite-password"
                                        type="password"
                                        autoComplete="new-password"
                                        label={intl.formatMessage(
                                            messages.passwordLabel
                                        )}
                                        placeholder={intl.formatMessage(
                                            messages.passwordPlaceholder
                                        )}
                                        description={intl.formatMessage(
                                            messages.passwordHint,
                                            { min: PASSWORD_MIN_LENGTH }
                                        )}
                                    />
                                )}
                            </form.Field>

                            <form.Field name="confirmPassword">
                                {(field) => (
                                    <AuthField
                                        field={field}
                                        id="accept-invite-confirm-password"
                                        type="password"
                                        autoComplete="new-password"
                                        label={intl.formatMessage(
                                            messages.confirmLabel
                                        )}
                                        placeholder={intl.formatMessage(
                                            messages.confirmPlaceholder
                                        )}
                                    />
                                )}
                            </form.Field>

                            <Field className="gap-5">
                                <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={isPending}
                                >
                                    {isPending ? (
                                        <>
                                            <Spinner aria-hidden="true" />
                                            <span className="sr-only">
                                                {intl.formatMessage(
                                                    messages.submitting
                                                )}
                                            </span>
                                        </>
                                    ) : (
                                        intl.formatMessage(messages.submit)
                                    )}
                                </Button>
                                <FieldDescription className="text-center">
                                    {intl.formatMessage(messages.signedInNote)}
                                </FieldDescription>
                            </Field>

                            {/* Accepting with a work account instead of a
                                password. The server checks that the address the
                                provider vouches for is the one that was
                                invited, and activates the account with no
                                credential — so the provider becomes the only
                                way in, which is what this button chooses.
                                Renders nothing when no provider is
                                registered. */}
                            <SsoProviders
                                inviteToken={token}
                                separatorLabel={intl.formatMessage(
                                    messages.ssoSeparator
                                )}
                            />
                        </FieldGroup>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
