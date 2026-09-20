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
import type { PasswordResetDetails } from '../../../../types/auth';
import { PASSWORD_MIN_LENGTH } from '../../../domain/value-objects/password';
import { AuthField } from '../AuthField';
import { AuthAlert } from '../AuthAlert';
import { useResetPasswordSchema } from './useResetPasswordSchema';

/** Intl descriptors for {@link ResetPasswordForm}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'identity.resetPassword.title',
        defaultMessage: 'Choose a new password'
    },
    descriptionNamed: {
        id: 'identity.resetPassword.descriptionNamed',
        defaultMessage:
            'Hi {name} — set a new password and you can sign in with it right away.'
    },
    description: {
        id: 'identity.resetPassword.description',
        defaultMessage:
            'Set a new password and you can sign in with it right away.'
    },
    emailLabel: {
        id: 'identity.resetPassword.emailLabel',
        defaultMessage: 'Email'
    },
    emailHint: {
        id: 'identity.resetPassword.emailHint',
        defaultMessage:
            'The account this link resets. If this isn’t your address, close this page and ask an administrator for a link of your own.'
    },
    passwordLabel: {
        id: 'identity.resetPassword.passwordLabel',
        defaultMessage: 'New password'
    },
    passwordPlaceholder: {
        id: 'identity.resetPassword.passwordPlaceholder',
        defaultMessage: '••••••••••••'
    },
    passwordHint: {
        id: 'identity.resetPassword.passwordHint',
        defaultMessage:
            'At least {min} characters. A short phrase you’ll actually remember beats a scrambled word you won’t.'
    },
    confirmLabel: {
        id: 'identity.resetPassword.confirmLabel',
        defaultMessage: 'Confirm new password'
    },
    confirmPlaceholder: {
        id: 'identity.resetPassword.confirmPlaceholder',
        defaultMessage: 'Type it once more'
    },
    submit: {
        id: 'identity.resetPassword.submit',
        defaultMessage: 'Set new password'
    },
    submitting: {
        id: 'identity.resetPassword.submitting',
        defaultMessage: 'Setting your new password…'
    },
    signOutNote: {
        id: 'identity.resetPassword.signOutNote',
        defaultMessage:
            'This signs the account out everywhere, including any device you left signed in. The link stops working after this.'
    },
    errorTitle: {
        id: 'identity.resetPassword.errorTitle',
        defaultMessage: 'Couldn’t set your new password'
    }
});

/** The values {@link ResetPasswordForm} submits once the schema passes. */
export type ResetPasswordFormValues = {
    /** The chosen password. */
    password: string;
    /** The re-typed password; the server checks the match too. */
    confirmPassword: string;
};

/** Props for the {@link ResetPasswordForm} component. */
type ResetPasswordFormProps = Omit<React.ComponentProps<'div'>, 'onSubmit'> & {
    /** Which account the link resets; rendered read-only, never collected. */
    reset: PasswordResetDetails;
    /** Called when the form is submitted with valid values. */
    onSubmit?: (values: ResetPasswordFormValues) => void;
    /** Whether a submission is in flight; swaps the button for a spinner. */
    isPending?: boolean;
    /** Error message to surface in the destructive alert, if any. */
    error?: string;
};

/**
 * The form someone completes to set a new password from a reset link.
 * Presentation-only: field state is TanStack Form's, submission is delegated to
 * `onSubmit`, and `isPending`/`error` drive the button and alert — no API call
 * lives here.
 *
 * The email is shown **read-only**, taken from the link rather than typed. It is
 * not a field to fill in: which account is being reset is decided by the token,
 * and an editable box would only invite someone to think they can point the
 * link at a different address. Showing it is still worth the space — a reset
 * link arrives out-of-band, so confirming whose account it opens is the one
 * check the person following it can actually make.
 */
export function ResetPasswordForm({
    className,
    reset,
    onSubmit,
    isPending = false,
    error,
    ...props
}: ResetPasswordFormProps) {
    const intl = useIntl();
    const resetPasswordSchema = useResetPasswordSchema();

    const form = useForm({
        defaultValues: { password: '', confirmPassword: '' },
        // `onChange` validates as the user types and also runs on submit, so an
        // empty form flags both fields when the button is pressed. Don't also
        // set `onSubmit` to the same schema — each error would render twice.
        validators: { onChange: resetPasswordSchema },
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
                        {reset.name
                            ? intl.formatMessage(messages.descriptionNamed, {
                                  name: reset.name
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

                            <InputField
                                id="reset-password-email"
                                type="email"
                                label={intl.formatMessage(messages.emailLabel)}
                                value={reset.email}
                                // `readOnly`, not `disabled`: the value stays
                                // focusable and announced, so a screen-reader
                                // user can read whose account they are about to
                                // change. It just can't be changed.
                                readOnly
                                description={intl.formatMessage(
                                    messages.emailHint
                                )}
                            />

                            <form.Field name="password">
                                {(field) => (
                                    <AuthField
                                        field={field}
                                        id="reset-password-password"
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
                                        id="reset-password-confirm-password"
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
                                    {intl.formatMessage(messages.signOutNote)}
                                </FieldDescription>
                            </Field>
                        </FieldGroup>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
