import type { ComponentType } from 'react';
import { useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Activity,
    Archive,
    ArchiveRestore,
    Ban,
    Building2,
    CircleCheck,
    FileText,
    FolderPlus,
    Image,
    KeyRound,
    LogIn,
    LogOut,
    MailX,
    Pencil,
    Send,
    ShieldCheck,
    Trash2,
    UserMinus,
    UserPlus
} from 'lucide-react';
import {
    Alert,
    AlertDescription,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Skeleton,
    cn
} from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import {
    formatActivityAction,
    useActivityLog,
    type ActivityEvent
} from '@orthacms/activity-admin';
import { MembersPagination } from '../../components/MembersPagination';
import { useUserDetailContext } from '../../userDetailContext';

/** Default page size for the per-user activity timeline (a pagination option). */
const DEFAULT_PAGE_SIZE = 25;

/** Intl descriptors for {@link UserActivityPage}. */
const messages = defineMessages({
    title: { id: 'users.activity.title', defaultMessage: 'Activity' },
    description: {
        id: 'users.activity.description',
        defaultMessage: 'A timeline of changes to this member’s account.'
    },
    empty: {
        id: 'users.activity.empty',
        defaultMessage: 'No recorded activity yet.'
    },
    error: {
        id: 'users.activity.error',
        defaultMessage: 'Couldn’t load activity. Please try again.'
    },
    retry: { id: 'users.activity.retry', defaultMessage: 'Retry' },
    system: { id: 'users.activity.system', defaultMessage: 'System' },
    by: { id: 'users.activity.by', defaultMessage: 'by {actor}' }
});

type ActivityIcon = ComponentType<{
    className?: string;
    'aria-hidden'?: boolean;
}>;

/**
 * Per-kind **presentation** — an icon and a tinted chip class, so an invite
 * reads differently from a suspension at a glance. The *label* is not here on
 * purpose: it comes from `activity-admin`'s `formatActivityAction`, the one
 * kind→label catalogue in the admin.
 *
 * This map used to own labels too, and it knew twelve kinds. The tab's query is
 * "everything about *or by* this member", so it surfaces every kind the actor
 * touched — and each of the other nineteen rendered as a raw dotted wire token
 * (`media.asset.uploaded`, `token.created`, `workspace.content_granted`) in a
 * member's timeline. A second catalogue is a second thing to forget; a missing
 * icon here only costs a neutral chip.
 */
const KIND_STYLE: Record<string, { icon: ActivityIcon; className: string }> = {
    'user.invited': {
        icon: UserPlus,
        className: 'bg-blue-500/10 text-blue-600'
    },
    'user.invite_resent': {
        icon: Send,
        className: 'bg-blue-500/10 text-blue-600'
    },
    'user.invite_revoked': {
        icon: MailX,
        className: 'bg-rose-500/10 text-rose-600'
    },
    'user.activated': {
        icon: CircleCheck,
        className: 'bg-emerald-500/10 text-emerald-600'
    },
    'user.profile_updated': {
        icon: Pencil,
        className: 'bg-indigo-500/10 text-indigo-600'
    },
    'user.role_changed': {
        icon: ShieldCheck,
        className: 'bg-violet-500/10 text-violet-600'
    },
    'user.suspended': {
        icon: Ban,
        className: 'bg-amber-500/10 text-amber-600'
    },
    'user.reactivated': {
        icon: CircleCheck,
        className: 'bg-emerald-500/10 text-emerald-600'
    },
    'user.password_changed': {
        icon: KeyRound,
        className: 'bg-violet-500/10 text-violet-600'
    },
    'user.password_reset_issued': {
        icon: KeyRound,
        className: 'bg-amber-500/10 text-amber-600'
    },
    'user.signed_in': {
        icon: LogIn,
        className: 'bg-slate-500/10 text-slate-600'
    },
    'user.signed_out': {
        icon: LogOut,
        className: 'bg-slate-500/10 text-slate-600'
    },
    'workspace.created': {
        icon: Building2,
        className: 'bg-teal-500/10 text-teal-600'
    },
    'workspace.updated': {
        icon: Pencil,
        className: 'bg-teal-500/10 text-teal-600'
    },
    'workspace.archived': {
        icon: Archive,
        className: 'bg-amber-500/10 text-amber-600'
    },
    'workspace.unarchived': {
        icon: ArchiveRestore,
        className: 'bg-emerald-500/10 text-emerald-600'
    },
    'workspace.deleted': {
        icon: Trash2,
        className: 'bg-rose-500/10 text-rose-600'
    },
    'workspace.member_added': {
        icon: UserPlus,
        className: 'bg-teal-500/10 text-teal-600'
    },
    'workspace.member_removed': {
        icon: UserMinus,
        className: 'bg-rose-500/10 text-rose-600'
    },
    'workspace.content_granted': {
        icon: ShieldCheck,
        className: 'bg-teal-500/10 text-teal-600'
    },
    'workspace.content_revoked': {
        icon: ShieldCheck,
        className: 'bg-rose-500/10 text-rose-600'
    },
    'entry.published': {
        icon: FileText,
        className: 'bg-emerald-500/10 text-emerald-600'
    },
    'entry.unpublished': {
        icon: FileText,
        className: 'bg-amber-500/10 text-amber-600'
    },
    'token.created': {
        icon: KeyRound,
        className: 'bg-violet-500/10 text-violet-600'
    },
    'token.revoked': {
        icon: KeyRound,
        className: 'bg-rose-500/10 text-rose-600'
    },
    'media.asset.uploaded': {
        icon: Image,
        className: 'bg-blue-500/10 text-blue-600'
    },
    'media.asset.updated': {
        icon: Pencil,
        className: 'bg-indigo-500/10 text-indigo-600'
    },
    'media.asset.moved': {
        icon: FolderPlus,
        className: 'bg-indigo-500/10 text-indigo-600'
    },
    'media.asset.deleted': {
        icon: Trash2,
        className: 'bg-rose-500/10 text-rose-600'
    },
    'media.folder.created': {
        icon: FolderPlus,
        className: 'bg-blue-500/10 text-blue-600'
    },
    'media.folder.renamed': {
        icon: Pencil,
        className: 'bg-indigo-500/10 text-indigo-600'
    },
    'media.folder.deleted': {
        icon: Trash2,
        className: 'bg-rose-500/10 text-rose-600'
    }
};

const FALLBACK_STYLE = {
    icon: Activity as ActivityIcon,
    className: 'bg-muted text-muted-foreground'
};

/** One timeline entry. */
function ActivityRow({ event }: { event: ActivityEvent }) {
    const intl = useIntl();
    const style = KIND_STYLE[event.kind];
    const title = formatActivityAction(intl, event.kind);
    const Icon = style?.icon ?? FALLBACK_STYLE.icon;
    const chipClassName = style?.className ?? FALLBACK_STYLE.className;
    const actor = event.actor?.email ?? intl.formatMessage(messages.system);

    return (
        <li className="flex items-center gap-3 border-b py-3 last:border-b-0">
            <span
                aria-hidden
                className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    chipClassName
                )}
            >
                <Icon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">
                    {intl.formatDate(event.at, {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                    })}{' '}
                    {intl.formatMessage(messages.by, { actor })}
                </p>
            </div>
        </li>
    );
}

/**
 * The Activity tab: a timeline of audit events whose subject is this member,
 * reusing the activity plugin's `useActivityLog` with a pinned `subjectId`
 * filter. Gated on `activity:read` (the rail hides it otherwise). Paginated
 * with the shared members pagination control.
 */
export function UserActivityPage() {
    const intl = useIntl();
    const { member } = useUserDetailContext();
    const canRead = useHasPermission('activity:read');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

    // The member's personal log: events *about* them (`subjectType=user` and
    // `subjectId=:id` — e.g. they were added/removed from a workspace, their
    // role changed) OR events they *performed* (`actorId=:id` — e.g. they
    // created a workspace, signed in). Serialised to the wire filter grammar the
    // activity endpoint already parses.
    const filter = useMemo(
        () =>
            JSON.stringify({
                or: [
                    {
                        and: [
                            { field: 'subjectType', op: 'eq', value: 'user' },
                            { field: 'subjectId', op: 'eq', value: member.id }
                        ]
                    },
                    { field: 'actorId', op: 'eq', value: member.id }
                ]
            }),
        [member.id]
    );

    const { data, isPending, isError, refetch } = useActivityLog(
        { filter, page, pageSize },
        canRead
    );

    const total = data?.total ?? 0;
    const effectivePageSize = data?.pageSize ?? pageSize;
    const pageCount = Math.max(1, Math.ceil(total / effectivePageSize));
    const events = data?.items ?? [];

    return (
        <Card>
            <CardHeader>
                <CardTitle>{intl.formatMessage(messages.title)}</CardTitle>
                <CardDescription>
                    {intl.formatMessage(messages.description)}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {isPending ? (
                    <>
                        <Skeleton className="h-12 w-full rounded-lg" />
                        <Skeleton className="h-12 w-full rounded-lg" />
                        <Skeleton className="h-12 w-full rounded-lg" />
                    </>
                ) : isError ? (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                            <span>{intl.formatMessage(messages.error)}</span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => refetch()}
                            >
                                {intl.formatMessage(messages.retry)}
                            </Button>
                        </AlertDescription>
                    </Alert>
                ) : events.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        {intl.formatMessage(messages.empty)}
                    </p>
                ) : (
                    <>
                        <ul>
                            {events.map((event) => (
                                <ActivityRow key={event.id} event={event} />
                            ))}
                        </ul>
                        <MembersPagination
                            page={page}
                            pageCount={pageCount}
                            pageSize={effectivePageSize}
                            total={total}
                            onPageChange={setPage}
                            onPageSizeChange={(next) => {
                                setPageSize(next);
                                setPage(1);
                            }}
                        />
                    </>
                )}
            </CardContent>
        </Card>
    );
}
