import { Link } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { useHasPermission } from '@orthacms/identity-admin';
import {
    Badge,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Skeleton
} from '@orthacms/design-system';
import { useActivityLog } from '../../../application/useActivityLog';
import { activityDateTime } from '../../activityDateTime';
import { formatActivityAction } from '../../activityMessages';

/** Intl descriptors for {@link RecentActivityPanel}, co-located here. */
const messages = defineMessages({
    title: {
        id: 'activity.home.title',
        defaultMessage: 'Recent activity'
    },
    viewAll: {
        id: 'activity.home.viewAll',
        defaultMessage: 'View all'
    },
    system: {
        id: 'activity.home.system',
        defaultMessage: 'System'
    },
    empty: {
        id: 'activity.home.empty',
        defaultMessage: 'No activity yet.'
    },
    error: {
        id: 'activity.home.error',
        defaultMessage: 'Couldn’t load activity.'
    }
});

/** Permission gating the activity feed (mirrors the Activity page + nav item). */
const ACTIVITY_READ = 'activity:read';

/** How many recent events the home panel shows. */
const PREVIEW_SIZE = 6;

/**
 * The home dashboard's Recent activity panel: the latest audit events (actor +
 * the localized action label + time) with a "View all" link to the Activity log.
 * Backed by the real `GET /api/activity`. Renders nothing when the user lacks
 * `activity:read`, so a viewer without audit access never sees an empty panel.
 */
export function RecentActivityPanel() {
    const intl = useIntl();
    const canRead = useHasPermission(ACTIVITY_READ);
    const { data, isPending, isError } = useActivityLog(
        { page: 1, pageSize: PREVIEW_SIZE },
        canRead
    );

    if (!canRead) {
        return null;
    }

    const events = data?.items ?? [];

    return (
        <Card className="shadow-none">
            <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle asChild className="text-base">
                    <h2>{intl.formatMessage(messages.title)}</h2>
                </CardTitle>
                <Link
                    to="/activity"
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                    {intl.formatMessage(messages.viewAll)}
                </Link>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
                {isPending ? (
                    Array.from({ length: 4 }).map((_, index) => (
                        <div
                            key={index}
                            className="flex items-center gap-3 px-2 py-2"
                        >
                            <div className="flex flex-1 flex-col gap-1.5">
                                <Skeleton className="h-4 w-48" />
                                <Skeleton className="h-3 w-24" />
                            </div>
                        </div>
                    ))
                ) : isError ? (
                    <p
                        role="alert"
                        className="px-2 py-6 text-center text-sm text-destructive"
                    >
                        {intl.formatMessage(messages.error)}
                    </p>
                ) : events.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                        {intl.formatMessage(messages.empty)}
                    </p>
                ) : (
                    events.map((event) => (
                        <div
                            key={event.id}
                            className="flex items-center gap-3 px-2 py-2"
                        >
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="flex items-center gap-2">
                                    <span className="truncate text-sm font-medium">
                                        {event.actor?.email ??
                                            intl.formatMessage(messages.system)}
                                    </span>
                                    {/* The localized action label, the same
                                        one the Activity table's Action column
                                        shows. This used to print the raw
                                        `domain.action` wire token, so the two
                                        surfaces a reader compares side by side
                                        named the same event differently — and
                                        the panel's half was untranslatable. */}
                                    <Badge
                                        variant="secondary"
                                        className="shrink-0 text-[11px] font-normal"
                                    >
                                        {formatActivityAction(intl, event.kind)}
                                    </Badge>
                                </span>
                            </div>
                            <time
                                className="shrink-0 text-xs text-muted-foreground"
                                dateTime={activityDateTime(event.at)}
                            >
                                {intl.formatDate(event.at, {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </time>
                        </div>
                    ))
                )}
            </CardContent>
        </Card>
    );
}
