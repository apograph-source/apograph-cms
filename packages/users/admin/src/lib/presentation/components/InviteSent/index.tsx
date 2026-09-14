import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import { CircleCheck } from 'lucide-react';
import { useUnsavedChanges } from '@apograph/utils-admin';
import {
    Button,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    WizardStepCard
} from '@apograph/design-system';
import { InviteLinkPanel } from '../InviteLinkPanel';

/** Intl descriptors for {@link InviteSent}, co-located with the component. */
const messages = defineMessages({
    title: {
        id: 'users.inviteSent.title',
        defaultMessage: 'Invite created for {email}'
    },
    description: {
        id: 'users.inviteSent.description',
        defaultMessage:
            'Their account exists but is dormant until they accept. Pass the link below to them yourself — it is the only copy, and it is not readable again.'
    },
    descriptionMailed: {
        id: 'users.inviteSent.descriptionMailed',
        defaultMessage:
            'Their account exists but is dormant until they accept. The invitation is on its way to {email}; there is no link to copy, because only one copy of it should exist.'
    },
    mailedHint: {
        id: 'users.inviteSent.mailedHint',
        defaultMessage:
            'If it does not arrive, resend the invite from their row — that issues a fresh link and invalidates this one.'
    },
    nextTitle: {
        id: 'users.inviteSent.nextTitle',
        defaultMessage: 'What happens when they open it'
    },
    nextOpen: {
        id: 'users.inviteSent.nextOpen',
        defaultMessage:
            'They land on a page that already knows their name and email — the only thing they choose is a password.'
    },
    nextRole: {
        id: 'users.inviteSent.nextRole',
        defaultMessage:
            'Their account activates with the {role} role and the workspace access you picked. Nothing they type can change either.'
    },
    nextSignedIn: {
        id: 'users.inviteSent.nextSignedIn',
        defaultMessage:
            'They’re signed in immediately, and the link stops working. If it expires first, resend the invite from their row.'
    },
    backToMembers: {
        id: 'users.inviteSent.backToMembers',
        defaultMessage: 'Back to members'
    }
});

/** Props for {@link InviteSent}. */
type InviteSentProps = {
    /** The invitee's email. */
    email: string;
    /**
     * The invite link to hand over, or `null` when the server emailed it — the
     * two ways an invitation reaches somebody, and the component says which
     * happened rather than rendering a link to nowhere.
     */
    link: string | null;
    /** Human-readable label of the role granted on acceptance. */
    roleLabel: string;
};

/**
 * The invite wizard's final step: the invite exists, and here is the link.
 *
 * It is a step rather than a toast-then-redirect because the link is shown
 * **once** — the server keeps only its hash, so navigating away before copying
 * it means resending the invite. The copy spells out what the invitee will see,
 * since the admin can't preview the page they're sending someone to.
 */
export function InviteSent({ email, link, roleLabel }: InviteSentProps) {
    const intl = useIntl();
    const [copied, setCopied] = useState(false);

    // Until the link is captured, treat leaving this step as losing unsaved
    // work — because it is: the token exists only in this component's state and
    // is never re-fetchable. The app-wide guard covers every exit (links,
    // programmatic navigation, and reload via `beforeunload`), which is the
    // only one a component here could not intercept for itself.
    //
    // An emailed invitation has nothing to lose, so it does not hold the admin
    // on the page: a confirmation that warns about leaving would be teaching
    // the wrong lesson about which of these two outcomes is dangerous.
    useUnsavedChanges(link !== null && !copied, 'users.invite.link');

    return (
        <WizardStepCard>
            <CardHeader>
                {/* A real `h2`: the page's `h1` is the step name, and the
                    "what happens next" list below is an `h3` — without this the
                    outline would jump a level. */}
                <CardTitle asChild className="flex items-center gap-2">
                    <h2>
                        <CircleCheck
                            aria-hidden
                            className="size-5 shrink-0 text-success-soft-foreground"
                        />
                        {intl.formatMessage(messages.title, { email })}
                    </h2>
                </CardTitle>
                <CardDescription>
                    {link
                        ? intl.formatMessage(messages.description)
                        : intl.formatMessage(messages.descriptionMailed, {
                              email
                          })}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-8">
                {link ? (
                    <InviteLinkPanel
                        link={link}
                        email={email}
                        onCopied={() => setCopied(true)}
                    />
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {intl.formatMessage(messages.mailedHint)}
                    </p>
                )}

                <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-medium">
                        {intl.formatMessage(messages.nextTitle)}
                    </h3>
                    <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
                        <li>{intl.formatMessage(messages.nextOpen)}</li>
                        <li>
                            {intl.formatMessage(messages.nextRole, {
                                role: roleLabel
                            })}
                        </li>
                        <li>{intl.formatMessage(messages.nextSignedIn)}</li>
                    </ul>
                </div>

                <Button asChild className="self-start">
                    <Link to="/users">
                        {intl.formatMessage(messages.backToMembers)}
                    </Link>
                </Button>
            </CardContent>
        </WizardStepCard>
    );
}
