import { useEffect, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import { Globe, Lock, Search, ShieldCheck } from 'lucide-react';
import { ChangedBadge, type EntryTabContext } from '@orthacms/content-admin';
import { useHasPermission } from '@orthacms/identity-admin';
import { useDebouncedValue } from '@orthacms/utils-admin';
import { Badge, Button, Input, Skeleton } from '@orthacms/design-system';
import {
    isOpen,
    sameAccess,
    stateOf,
    withState,
    withStates,
    OPEN_ACCESS,
    type EntryAccess,
    type EntryAccessStaging,
    type SegmentState
} from '../../../domain/types';
import {
    SEGMENTS_MANAGE,
    useEntryAccess,
    useSegments
} from '../../../application/hooks';
import { ENTRY_ACCESS_PRESAVE_ID } from '../../../application/useEntryAccessPresave';
import { SegmentStateControl } from '../SegmentStateControl';
import { SegmentsPagination } from '../SegmentsPagination';
import { EntryAccessBulkActions } from '../EntryAccessBulkActions';

const messages = defineMessages({
    heading: {
        id: 'segments.entryTab.heading',
        defaultMessage: 'Who can read this'
    },
    body: {
        id: 'segments.entryTab.body',
        defaultMessage:
            'Set each audience to “Can see” or “Cannot see”. Leave one unset and it follows the rest: with nothing set to “Can see”, everybody reads the entry; set one, and only the audiences you named do. “Cannot see” always wins.'
    },
    open: {
        id: 'segments.entryTab.open',
        defaultMessage: 'Readable by everyone'
    },
    restricted: {
        id: 'segments.entryTab.restricted',
        defaultMessage: 'Restricted'
    },
    pending: {
        id: 'segments.entryTab.pending',
        defaultMessage: 'Applied when you save the entry.'
    },
    everyLocale: {
        id: 'segments.entryTab.everyLocale',
        defaultMessage:
            'This applies to every language of the record, like a shared field — not to this translation alone.'
    },
    readOnly: {
        id: 'segments.entryTab.readOnly',
        defaultMessage:
            'You can see who reads this, but changing it needs the “segments:manage” permission.'
    },
    noneHere: {
        id: 'segments.entryTab.noneHere',
        defaultMessage:
            'No audience is offered in this workspace yet. Open Segments to create one, or to widen where an existing one applies.'
    },
    noMatches: {
        id: 'segments.entryTab.noMatches',
        defaultMessage: 'No audience matches “{query}”.'
    },
    search: {
        id: 'segments.entryTab.search',
        defaultMessage: 'Search audiences'
    },
    manage: { id: 'segments.entryTab.manage', defaultMessage: 'Segments' },
    tags: { id: 'segments.entryTab.tags', defaultMessage: 'Tags: {tags}' },
    elsewhere: {
        id: 'segments.entryTab.elsewhere',
        defaultMessage:
            '{count, plural, one {# more decision} other {# more decisions}} on audiences this list does not show. They still apply.'
    }
});

/** Rows per page before anyone changes it. */
const DEFAULT_PAGE_SIZE = 10;

/**
 * The entry editor's **Access** tab — the whole feature, from an editor's side.
 *
 * One row per audience, each with the three-state control. There is nothing else
 * on this tab because there is nothing else in the model: no rule to pick, no
 * level to inherit from, no window. What is set here is what a reader is matched
 * against on the next request.
 *
 * **The list is scoped to the open workspace**, so an editor is offered the
 * audiences their workspace was given rather than the whole installation's
 * vocabulary. Decisions already made on audiences the list does not show — one a
 * search hides, one narrowed away from this workspace since — are **kept** and
 * counted below it. Dropping them would rewrite who can read published content
 * from a screen that never mentioned them.
 *
 * **It has no Save button, on purpose.** Who may read a record is part of the
 * record, so it rides the editor's own Save / Publish like a field does —
 * staged here, sent in the save body, written by the server inside the save's
 * own transaction and captured by the revision it appends.
 *
 * The staging lives **above this component** ({@link EntryAccessStaging},
 * reached through `presave`) because editor tabs are routes: this panel unmounts
 * the moment the user switches tab, and an unsaved decision must not go with it.
 */
export function EntryAccessTab({
    workspaceId,
    schema,
    entry,
    readOnly,
    presave
}: EntryTabContext) {
    const intl = useIntl();
    // Two gates, and they are not the same one. `readOnly` says the caller may
    // not edit this entry's *values*; `segments:manage` says they may not
    // change who reads it. An editor with `content:update` and neither should
    // be able to rewrite the article and not to publish it to a new audience.
    const canManage = useHasPermission(SEGMENTS_MANAGE);

    const [query, setQuery] = useState('');
    const debounced = useDebouncedValue(query, 250);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    // A narrowed search almost always has fewer pages than the one before it,
    // so staying on page four is how a reader lands on "no matches" for a term
    // that matches plenty.
    useEffect(() => setPage(1), [debounced, pageSize]);

    const segments = useSegments({
        query: debounced || undefined,
        workspaceId,
        page,
        pageSize
    });
    const saved = useEntryAccess(workspaceId, entry?.id, entry?.updatedAt);
    const staging = presave[ENTRY_ACCESS_PRESAVE_ID] as
        | EntryAccessStaging
        | undefined;

    // What the entry is set to now, and what the next save will make of it. On a
    // create there is nothing saved to read, so the base is open access — which
    // is what an entry that nobody has restricted is.
    const savedAccess = saved.data ?? OPEN_ACCESS;
    const draft = staging?.draft ?? savedAccess;
    const dirty = Boolean(staging?.draft);

    // The read is disabled without an entry id, so it never resolves on a create
    // — waiting on it there would leave the tab on skeletons forever.
    if (segments.isPending || (entry && saved.isPending)) {
        return (
            <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-24 w-full" />
            </div>
        );
    }

    const list = segments.data?.items ?? [];
    const total = segments.data?.total ?? 0;
    const matchedIds = segments.data?.ids ?? [];
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const locked = readOnly || !canManage || !staging;

    // Nothing offered here at all — a different situation from a search that
    // matched nothing, and it needs a different sentence: the first is a setup
    // step, the second is a typo.
    if (total === 0 && !debounced) {
        return (
            <div className="flex flex-col items-start gap-3">
                <p className="max-w-xl text-sm text-muted-foreground">
                    {intl.formatMessage(messages.noneHere)}
                </p>
                <Button variant="outline" size="sm" asChild>
                    <Link to="/segments">
                        <ShieldCheck aria-hidden />
                        {intl.formatMessage(messages.manage)}
                    </Link>
                </Button>
            </div>
        );
    }

    /** Decisions on audiences this list does not cover — kept, and counted. */
    const listed = new Set(matchedIds);
    const elsewhere = [...draft.allow, ...draft.deny].filter(
        (id) => !listed.has(id)
    ).length;

    const stage = (next: EntryAccess) => {
        // Staging what is already stored would light the Changed badge and cost
        // a write for a round trip back to where the entry started.
        staging?.stage(sameAccess(next, savedAccess) ? null : next);
    };

    return (
        <div className="flex flex-col gap-5">
            <div>
                {/* `<h2>`, not `<h3>` — the same call `FieldGroup` and
                    `RelationFieldSection` make. This is a top-level section of
                    the entry editor, whose header is the page's `<h1>`, so an
                    `<h3>` jumped a level and axe's `heading-order` said so. */}
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                    {intl.formatMessage(messages.heading)}
                    <Badge variant={isOpen(draft) ? 'secondary' : 'warning'}>
                        {isOpen(draft) ? (
                            <Globe className="size-3" aria-hidden />
                        ) : (
                            <Lock className="size-3" aria-hidden />
                        )}
                        {intl.formatMessage(
                            isOpen(draft) ? messages.open : messages.restricted
                        )}
                    </Badge>
                    {dirty ? <ChangedBadge /> : null}
                </h2>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                    {intl.formatMessage(messages.body)}
                </p>
                {/* Said on screen, because it is the one thing here that is not
                    about the record in front of the editor. Who may read a
                    record is a fact about the record, not about its German
                    wording — so this travels like a shared field, and an editor
                    restricting the English article is restricting every
                    language of it. */}
                {schema.i18n ? (
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                        {intl.formatMessage(messages.everyLocale)}
                    </p>
                ) : null}
            </div>

            {/* Search left, the directory link right, on one row — the link is
                the way *out* of this screen, so it belongs at the far edge
                rather than beside the heading, where it competed with the
                restricted/open badge for the eye. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-56">
                    <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                    />
                    <Input
                        className="pl-8"
                        type="search"
                        value={query}
                        aria-label={intl.formatMessage(messages.search)}
                        placeholder={intl.formatMessage(messages.search)}
                        onChange={(event) => setQuery(event.target.value)}
                    />
                </div>
                <Button variant="outline" size="sm" asChild>
                    <Link to="/segments">
                        <ShieldCheck aria-hidden />
                        {intl.formatMessage(messages.manage)}
                    </Link>
                </Button>
            </div>

            {locked ? null : (
                <EntryAccessBulkActions
                    count={total}
                    searching={Boolean(debounced)}
                    truncated={segments.data?.idsTruncated ?? false}
                    onApply={(state: SegmentState) =>
                        stage(withStates(draft, matchedIds, state))
                    }
                />
            )}

            {total === 0 ? (
                <p className="text-sm text-muted-foreground">
                    {intl.formatMessage(messages.noMatches, {
                        query: debounced
                    })}
                </p>
            ) : (
                <>
                    <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
                        {list.map((segment) => (
                            <li
                                key={segment.id}
                                className="flex flex-wrap items-center justify-between gap-3 p-4"
                            >
                                <div className="min-w-0">
                                    <span className="text-sm font-medium">
                                        {segment.label}
                                    </span>
                                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                        {intl.formatMessage(messages.tags, {
                                            tags:
                                                segment.tags.join(', ') ||
                                                segment.key
                                        })}
                                    </p>
                                </div>
                                <SegmentStateControl
                                    name={segment.label}
                                    value={stateOf(draft, segment.id)}
                                    disabled={locked}
                                    onChange={(state) =>
                                        stage(
                                            withState(draft, segment.id, state)
                                        )
                                    }
                                />
                            </li>
                        ))}
                    </ul>

                    <SegmentsPagination
                        page={page}
                        pageCount={pageCount}
                        pageSize={pageSize}
                        total={total}
                        onPageChange={setPage}
                        onPageSizeChange={setPageSize}
                    />
                </>
            )}

            {elsewhere > 0 ? (
                <p className="text-xs text-muted-foreground">
                    {intl.formatMessage(messages.elsewhere, {
                        count: elsewhere
                    })}
                </p>
            ) : null}

            <p className="text-xs text-muted-foreground">
                {intl.formatMessage(
                    locked ? messages.readOnly : messages.pending
                )}
            </p>
        </div>
    );
}
