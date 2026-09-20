import { useForm } from '@tanstack/react-form';
import { defineMessages, useIntl } from 'react-intl';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    FieldGroup,
    cn
} from '@orthacms/design-system';
import type { LoginCredentials } from '../../../../types/auth';
import { useLoginSchema } from './useLoginSchema';
import { AuthField } from '../AuthField';
import { AuthAlert } from '../AuthAlert';
import { AuthNotice } from '../AuthNotice';
import { LoginActions } from './LoginActions';
import { SsoProviders } from '../SsoProviders';

/** Intl descriptors for {@link LoginForm}, co-located with the component. */
const messages = defineMessages({
    authFailedTitle: {
        id: 'identity.login.authFailedTitle',
        defaultMessage: 'Authentication failed'
    },
    loginTitle: {
        id: 'identity.login.title',
        defaultMessage: 'Welcome back'
    },
    loginDescription: {
        id: 'identity.login.description',
        defaultMessage: 'Login to your account to continue'
    },
    emailLabel: {
        id: 'identity.login.emailLabel',
        defaultMessage: 'Email'
    },
    emailPlaceholder: {
        id: 'identity.login.emailPlaceholder',
        defaultMessage: 'm@example.com'
    },
    passwordLabel: {
        id: 'identity.login.passwordLabel',
        defaultMessage: 'Password'
    },
    passwordPlaceholder: {
        id: 'identity.login.passwordPlaceholder',
        defaultMessage: '••••••••'
    }
});

/**
 * Props for the {@link LoginForm} component. The native `div` `onSubmit` is
 * omitted so the prop can carry the typed login credentials instead.
 */
type LoginFormProps = Omit<React.ComponentProps<'div'>, 'onSubmit'> & {
    /**
     * Called when the form is submitted with valid field values. UI-only for
     * now — the real authentication call is wired in later (#8).
     */
    onSubmit?: (credentials: LoginCredentials) => void;
    /** Whether a submission is in flight; disables the button and swaps its label. */
    isPending?: boolean;
    /** Error message to surface in the destructive alert, if any. */
    error?: string;
    /**
     * A standing explanation of how the visitor got here — today, that the
     * session they were using ended underneath them. Unlike {@link error} it is
     * not a failure of anything they just did, so it neither takes focus nor
     * renders as destructive; it sits where a reader continuing from the
     * heading meets it.
     */
    notice?: string;
    /**
     * Where a successful sign-in should land — the location the gate was aiming
     * at. Only the single-sign-on links need it: the password form posts and
     * the page navigates afterwards, while an SSO link leaves this page
     * entirely and has to carry the destination with it.
     */
    redirectTo?: string;
};

/**
 * Login form with card wrapper and email/password fields. Uses TanStack Form
 * for field state. Presentation-only: submission is delegated to the `onSubmit`
 * prop, with `isPending`/`error` driving the button and alert. No API call
 * lives here.
 *
 * Every control on the card does something. Password recovery, sign-up, and the
 * terms/privacy pages have no routes yet, so they are absent rather than
 * rendered as buttons that swallow the click — a control that announces itself
 * as operable has to be operable (WCAG 4.1.2), and a keyboard user who tabs
 * into a dead stop mid-credential-flow reasonably concludes the page is broken.
 */
export function LoginForm({
    className,
    onSubmit,
    isPending = false,
    error,
    notice,
    redirectTo,
    ...props
}: LoginFormProps) {
    const intl = useIntl();
    const loginSchema = useLoginSchema();

    const form = useForm({
        defaultValues: { email: '', password: '' },
        // `onChange` validates as the user types and **also runs on submit**
        // (TanStack's submit pass includes the change validator), so an empty
        // form flags its required fields when Login is pressed. Don't also set
        // `onSubmit` to the same schema — both would run on submit and each
        // field would show its error twice.
        validators: { onChange: loginSchema },
        onSubmit: ({ value }) => onSubmit?.(value)
    });

    return (
        <div className={cn('flex flex-col gap-6', className)} {...props}>
            <Card>
                <CardHeader className="text-center">
                    <CardTitle asChild className="text-xl">
                        <h1>{intl.formatMessage(messages.loginTitle)}</h1>
                    </CardTitle>
                    <CardDescription>
                        {intl.formatMessage(messages.loginDescription)}
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
                            {/* Above the error, and never focused: the notice
                                explains why the page changed under the visitor,
                                which is context for the whole screen, while an
                                error is about the submission they just made.
                                AuthLayout has already put focus on the heading
                                a reader continues from, so stealing it here
                                would fight the arrival, not help it. */}
                            {notice && <AuthNotice message={notice} />}

                            {/* Mounted only when there is a message: AuthAlert
                                takes focus as it appears, so it must not sit
                                mounted-and-empty. */}
                            {error && (
                                <AuthAlert
                                    title={intl.formatMessage(
                                        messages.authFailedTitle
                                    )}
                                    message={error}
                                />
                            )}

                            <form.Field name="email">
                                {(field) => (
                                    <AuthField
                                        field={field}
                                        id="login-email"
                                        type="email"
                                        autoComplete="email"
                                        label={intl.formatMessage(
                                            messages.emailLabel
                                        )}
                                        placeholder={intl.formatMessage(
                                            messages.emailPlaceholder
                                        )}
                                    />
                                )}
                            </form.Field>

                            <form.Field name="password">
                                {(field) => (
                                    <AuthField
                                        field={field}
                                        id="login-password"
                                        type="password"
                                        autoComplete="current-password"
                                        label={intl.formatMessage(
                                            messages.passwordLabel
                                        )}
                                        placeholder={intl.formatMessage(
                                            messages.passwordPlaceholder
                                        )}
                                    />
                                )}
                            </form.Field>

                            <LoginActions isPending={isPending} />

                            {/* After the password form, not before it. The
                                credential form is what every deployment has;
                                the providers are what some of them add, and a
                                visitor arriving to sign in with a password
                                should not have to read past a list of buttons
                                to find the field they came for. Renders
                                nothing when no provider is registered. */}
                            <SsoProviders redirectTo={redirectTo} />
                        </FieldGroup>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
