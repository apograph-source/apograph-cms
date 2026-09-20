import { Outlet, useParams } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    Container,
    Skeleton
} from '@orthacms/design-system';
import { ApiError, HTTP_STATUS, useDocumentTitle } from '@orthacms/utils-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { PageTopBar, type PageTopBarCrumb } from '@orthacms/shell-admin';
import { Users } from 'lucide-react';
import { useUserDetail } from '../../../application/useUserDetail';
import type { UserDetailContext } from '../../userDetailContext';
import { BackLink } from '../BackLink';
import { MembersNoAccess } from '../MembersNoAccess';
import { UserHero } from './UserHero';
import { UserDetailTabs } from './UserDetailTabs';
import { UserStatsStrip } from './UserStatsStrip';

/** Intl descriptors for {@link UserDetailLayout}, co-located with the component. */
const messages = defineMessages({
    documentTitle: {
        id: 'users.detail.documentTitle',
        defaultMessage: 'Member'
    },
    back: {
        id: 'users.detail.back',
        defaultMessage: 'Back to members'
    },
    crumbMembers: {
        id: 'users.detail.crumbMembers',
        defaultMessage: 'Members'
    },
    notFound: {
        id: 'users.detail.notFound',
        defaultMessage: 'This member no longer exists.'
    },
    error: {
        id: 'users.detail.error',
        defaultMessage: 'Couldn’t load this member. Please try again.'
    }
});

/**
 * The user detail page shell, mounted at `/users/:id/*`. Fetches the member
 * once and shares it with every tab through the Outlet context, so a tab read
 * is free. Renders the back link, identity hero, stats strip, and the underline
 * tab bar above the active tab. Loading shows skeletons; a 404 shows a
 * dedicated "no longer exists" state; any other error is retryable by the
 * tabs' own queries falling back here.
 *
 * Gated on `users:read` (the same permission the roster needs): without it the
 * page shows the shared no-access state and fetches nothing.
 */
export function UserDetailLayout() {
    const intl = useIntl();
    const { id = '' } = useParams();
    const canRead = useHasPermission('users:read');
    const {
        data: member,
        isPending,
        isError,
        error
    } = useUserDetail(id, canRead);

    // Titled here rather than in each of the seven tabs: the page is *this
    // member*, and their name is the thing that tells one open tab from another
    // (WCAG 2.4.2, `ORT-140`). Falls back to a generic label until the read
    // lands, so the title never claims a name the page is not showing.
    useDocumentTitle(
        member?.name ?? intl.formatMessage(messages.documentTitle)
    );

    if (!canRead) {
        return (
            <>
                <PageTopBar
                    icon={Users}
                    iconClassName="bg-success-soft text-success-soft-foreground"
                    crumbs={[
                        {
                            key: 'members',
                            label: intl.formatMessage(messages.crumbMembers),
                            to: '/users'
                        }
                    ]}
                />
                <Container>
                    <MembersNoAccess />
                </Container>
            </>
        );
    }

    const back = (
        <BackLink to="/users" label={intl.formatMessage(messages.back)} />
    );

    if (isPending) {
        return (
            <>
                <PageTopBar
                    icon={Users}
                    iconClassName="bg-success-soft text-success-soft-foreground"
                    crumbs={[
                        {
                            key: 'members',
                            label: intl.formatMessage(messages.crumbMembers),
                            to: '/users'
                        }
                    ]}
                />
                <Container className="space-y-6">
                    {back}
                    <Skeleton className="h-24 w-full rounded-xl" />
                    <Skeleton className="h-20 w-full rounded-xl" />
                    <Skeleton className="h-64 w-full rounded-xl" />
                </Container>
            </>
        );
    }

    if (isError) {
        const status = error instanceof ApiError ? error.status : null;
        const message =
            status === HTTP_STATUS.NOT_FOUND
                ? messages.notFound
                : messages.error;
        return (
            <>
                <PageTopBar
                    icon={Users}
                    iconClassName="bg-success-soft text-success-soft-foreground"
                    crumbs={[
                        {
                            key: 'members',
                            label: intl.formatMessage(messages.crumbMembers),
                            to: '/users'
                        }
                    ]}
                />
                <Container className="space-y-6">
                    {back}
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>
                            {intl.formatMessage(message)}
                        </AlertDescription>
                    </Alert>
                </Container>
            </>
        );
    }

    const context: UserDetailContext = { member };

    const crumbs: PageTopBarCrumb[] = [
        {
            key: 'members',
            label: intl.formatMessage(messages.crumbMembers),
            to: '/users'
        },
        { key: member.id, label: member.name }
    ];

    return (
        <>
            <PageTopBar
                icon={Users}
                iconClassName="bg-success-soft text-success-soft-foreground"
                crumbs={crumbs}
            />
            <Container className="space-y-6">
                {back}
                <UserHero member={member} />
                <UserStatsStrip member={member} />
                <div className="flex flex-col gap-6">
                    <UserDetailTabs member={member} />
                    {/*
                     * Key the tab subtree by member id so navigating straight from
                     * one member's detail to another's (e.g. the account menu's
                     * "My profile" from a roster member) remounts the active tab.
                     * Without this React reuses the same instance across the `:id`
                     * change — the layout never unmounts the Outlet when the target
                     * member is already cached (`isPending` stays false) — leaving a
                     * tab's `useState(member.…)` seeded from the previous member,
                     * which Save would then write back onto the wrong user.
                     */}
                    <div key={member.id} className="min-w-0">
                        <Outlet context={context} />
                    </div>
                </div>
            </Container>
        </>
    );
}
