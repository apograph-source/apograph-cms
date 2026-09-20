import { defineMessages, useIntl } from 'react-intl';
import {
    Button,
    Field,
    FieldDescription,
    Spinner
} from '@orthacms/design-system';

/** Intl descriptors for {@link LoginActions}, co-located with the component. */
const messages = defineMessages({
    loginButton: {
        id: 'identity.login.button',
        defaultMessage: 'Login'
    },
    loginButtonPending: {
        id: 'identity.login.buttonPending',
        defaultMessage: 'Signing in…'
    },
    inviteOnly: {
        id: 'identity.login.inviteOnly',
        defaultMessage:
            'Accounts are created by invitation — ask an administrator to send you one.'
    }
});

/**
 * Props for {@link LoginActions}.
 */
type LoginActionsProps = {
    /**
     * Whether a submission is in flight; the button shows a spinner and is
     * disabled. The button is **not** disabled for an empty/invalid form —
     * submitting an invalid form surfaces the field errors instead.
     */
    isPending: boolean;
};

/**
 * Submit button (a spinner replaces the label while submitting) followed by a
 * note on how accounts come about. The extra `gap-5` widens the spacing between
 * the button and the note below it.
 *
 * The note is plain text, not a "Sign up" control: there is no self-service
 * sign-up to route to, and there cannot be one — an account exists because an
 * admin invited it (`/identity/accept-invite`). Offering the control anyway
 * (previously a `<button>` with no handler) told a keyboard or screen-reader
 * user the page was broken; saying how to get an account tells them what to do.
 */
export function LoginActions({ isPending }: LoginActionsProps) {
    const intl = useIntl();

    return (
        <Field className="gap-5">
            <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? (
                    <>
                        <Spinner aria-hidden="true" />
                        <span className="sr-only">
                            {intl.formatMessage(messages.loginButtonPending)}
                        </span>
                    </>
                ) : (
                    intl.formatMessage(messages.loginButton)
                )}
            </Button>
            <FieldDescription className="text-center">
                {intl.formatMessage(messages.inviteOnly)}
            </FieldDescription>
        </Field>
    );
}
