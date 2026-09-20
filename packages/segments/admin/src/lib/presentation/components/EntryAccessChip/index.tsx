import { defineMessages, useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import { Globe, Lock } from 'lucide-react';
import { ENTRY_MODE, type EntrySlotContext } from '@orthacms/content-admin';
import { Badge, Skeleton } from '@orthacms/design-system';
import { isOpen } from '../../../domain/types';
import { useEntryAccess, useSegments } from '../../../application/hooks';

const messages = defineMessages({
    open: { id: 'segments.chip.open', defaultMessage: 'Everyone' },
    restricted: {
        id: 'segments.chip.restricted',
        defaultMessage: 'Restricted'
    },
    title: {
        id: 'segments.chip.title',
        defaultMessage: 'Who can read this entry — open the Access tab'
    }
});

/**
 * The entry header's access chip.
 *
 * It lives beside the title rather than in the properties rail because the
 * moment access matters is the moment before somebody publishes something they
 * believe is public — and that is a moment spent writing, looking at the title,
 * not auditing a column of properties. A link rather than a popover: the tab is
 * one click away and holds the whole answer, so a hover card would be a second
 * rendering of it to keep in step.
 *
 * It renders **nothing** when no segment exists. With none the feature is inert
 * server-side, and a badge claiming anything about access would be a claim
 * about a system that is not running.
 */
export function EntryAccessChip({
    workspaceId,
    entry,
    mode,
    typePath
}: EntrySlotContext) {
    const intl = useIntl();
    // One row is all this needs: the chip says *whether* the entry is
    // restricted, never by whom, so it asks whether the workspace has any
    // audience at all rather than pulling a page of them into every entry open.
    const segments = useSegments({ workspaceId, pageSize: 1 });
    const access = useEntryAccess(workspaceId, entry?.id, entry?.updatedAt);

    // Nothing configured here, no entry yet, or the caller cannot read this.
    if (!segments.data?.total || !entry) {
        return null;
    }
    if (access.isPending) {
        return <Skeleton className="h-5 w-20 rounded-full" />;
    }
    if (!access.data) {
        return null;
    }

    const open = isOpen(access.data);
    // Spelled out rather than a relative link: a **single** page's editor is
    // mounted on the type itself, so its tabs are static segments under
    // `typePath`, while a collection row nests them under the entry id.
    const tabPath =
        mode === ENTRY_MODE.Single
            ? `${typePath}/access`
            : `${typePath}/${entry.id}/access`;

    return (
        <Link
            to={tabPath}
            title={intl.formatMessage(messages.title)}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            <Badge variant={open ? 'secondary' : 'warning'}>
                {open ? (
                    <Globe className="size-3" aria-hidden />
                ) : (
                    <Lock className="size-3" aria-hidden />
                )}
                {intl.formatMessage(open ? messages.open : messages.restricted)}
            </Badge>
        </Link>
    );
}
