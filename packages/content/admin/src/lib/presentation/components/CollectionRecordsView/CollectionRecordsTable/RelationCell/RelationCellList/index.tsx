import { type UIEvent } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { ExternalLink } from 'lucide-react';
import { Badge, Spinner } from '@orthacms/design-system';
import type {
    ContentField,
    RelationFieldView
} from '../../../../../../domain/types/contentType';
import { ENTRY_STATUS } from '../../../../../../domain/constants';
import { contentEntryPath } from '../../../../../../domain/contentEntryPath';
import { handleFor } from '../../../../../../domain/relationHandle';
import { useRelationFieldLinks } from '../../../../../../application/useRelationFieldLinks';

/** Co-located labels for the popover's list. */
const messages = defineMessages({
    heading: {
        id: 'content.records.relation.heading',
        defaultMessage: 'Linked records'
    },
    count: {
        id: 'content.records.relation.count',
        defaultMessage: '{shown} of {total}'
    },
    open: {
        id: 'content.records.relation.open',
        defaultMessage: 'Open {title} in a new tab'
    },
    error: {
        id: 'content.records.relation.error',
        defaultMessage: "Couldn't load linked records."
    },
    unavailable: {
        id: 'content.records.relation.unavailable',
        defaultMessage: 'Unavailable record'
    }
});

/** Distance from the bottom (px) at which the next page is fetched. */
const SCROLL_THRESHOLD = 120;

/**
 * The open popover's body: the linked records, each an external link to its own
 * editor.
 *
 * Two-tier by design. The list response's capped `preview` renders immediately,
 * so the popover never opens empty; for a **many/inverse** relation the links
 * query then takes over and **scroll-paginates** the rest
 * (`GET /content/:type/:id/relations/:field`, one page at a time). A single
 * relation holds at most one link, so it skips the query entirely and renders
 * the preview alone.
 *
 * Mounted only while the popover is open (Radix unmounts closed content), so a
 * table full of relation cells registers no idle queries.
 */
export function RelationCellList({
    field,
    target,
    preview,
    typeName,
    recordId,
    workspaceId
}: {
    /** The relation field being listed. */
    field: ContentField;
    /** Machine name of the target content type (`field.relation.to`). */
    target: string;
    /** The server's capped preview for this row + field. */
    preview: RelationFieldView | undefined;
    /** Machine name of the type being listed (the link owner's type). */
    typeName: string;
    /** The row's entry id (the link owner). */
    recordId: string;
    /** Open workspace, for building the related record's path. */
    workspaceId: string;
}) {
    const intl = useIntl();
    // Only link-managed relations can exceed one page; a single relation's FK
    // preview is already the whole story. And even then, only when the server's
    // capped preview actually truncated — with fewer links than the cap, page 1
    // of the links query would return byte-identical data to what is already on
    // screen, so opening the popover would cost a round trip for nothing.
    const truncated =
        preview === undefined || preview.items.length < preview.total;
    const paginated =
        Boolean(field.relation?.many || field.relation?.inverse) && truncated;
    const links = useRelationFieldLinks(
        typeName,
        recordId,
        field.name,
        paginated
    );

    // Fall back to the preview until the live query has data, so opening shows
    // records instantly rather than a spinner.
    const loaded = paginated && links.data !== undefined;
    const items = loaded ? links.items : (preview?.items ?? []);
    const total = loaded ? links.total : (preview?.total ?? 0);

    const onScroll = (event: UIEvent<HTMLUListElement>) => {
        const el = event.currentTarget;
        if (
            el.scrollHeight - el.scrollTop - el.clientHeight <=
                SCROLL_THRESHOLD &&
            links.hasNextPage &&
            !links.isFetchingNextPage
        ) {
            links.fetchNextPage();
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground">
                <span>{intl.formatMessage(messages.heading)}</span>
                <span>
                    {intl.formatMessage(messages.count, {
                        shown: items.length,
                        total
                    })}
                </span>
            </div>
            {links.isError ? (
                <p className="px-2 py-1.5 text-xs text-destructive">
                    {intl.formatMessage(messages.error)}
                </p>
            ) : null}
            {/* A real list, so assistive tech announces the item count rather
                than a run of unrelated links in a scrolling box. */}
            <ul
                className="flex max-h-56 list-none flex-col overflow-y-auto"
                onScroll={onScroll}
            >
                {items.map((item) => (
                    <li key={item.id}>
                        {item.missing ? (
                            // The target is soft-deleted or otherwise not
                            // resolvable: the link still exists, but there is
                            // nothing to open — and rendering its raw id would
                            // be exactly the FK leak the cell exists to avoid.
                            <span className="flex items-center gap-2 px-2 py-1.5 text-sm italic text-muted-foreground">
                                {intl.formatMessage(messages.unavailable)}
                            </span>
                        ) : (
                            <a
                                href={contentEntryPath(
                                    workspaceId,
                                    target,
                                    item.id
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={intl.formatMessage(messages.open, {
                                    title: item.title
                                })}
                                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                            >
                                <span className="truncate text-sm font-medium">
                                    {item.title}
                                </span>
                                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                                    /{handleFor(item.title, item.slug)}
                                </span>
                                {item.status ? (
                                    <Badge
                                        variant={
                                            item.status ===
                                            ENTRY_STATUS.Published
                                                ? 'success'
                                                : 'secondary'
                                        }
                                    >
                                        {item.status}
                                    </Badge>
                                ) : null}
                                <ExternalLink
                                    className="size-3.5 shrink-0 text-muted-foreground"
                                    aria-hidden
                                />
                            </a>
                        )}
                    </li>
                ))}
                {links.isFetchingNextPage ? (
                    <li className="flex justify-center py-2">
                        <Spinner aria-hidden />
                    </li>
                ) : null}
            </ul>
        </div>
    );
}
