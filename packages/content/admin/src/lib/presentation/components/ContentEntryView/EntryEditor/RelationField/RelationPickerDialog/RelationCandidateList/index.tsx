import type { UIEvent } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Spinner } from '@orthacms/design-system';
import type { RelationCandidate } from '../../../../../../../application/useRelationCandidates';
import { RelationCandidateRow } from './RelationCandidateRow';

const messages = defineMessages({
    loading: {
        id: 'content.relations.picker.loading',
        defaultMessage: 'Loading…'
    },
    empty: {
        id: 'content.relations.picker.empty',
        defaultMessage: 'No records to choose from.'
    },
    noMatches: {
        id: 'content.relations.picker.noMatches',
        defaultMessage: 'No records match your search.'
    },
    loadError: {
        id: 'content.relations.picker.loadError',
        defaultMessage:
            'Couldn’t load records. Check your connection and retry.'
    }
});

/**
 * The scrollable candidate list of the relation picker: a loading spinner while
 * the schema resolves, an empty / no-matches message, else the rows
 * ({@link RelationCandidateRow}) as an accessible checkbox group (many-relation)
 * or radio group (single), with a lazy-load spinner pinned below. Scrolling near
 * the bottom fires `onScroll`, which the parent turns into a "load more" step.
 */
export function RelationCandidateList({
    items,
    isPending,
    isError,
    loadingMore,
    filtersActive,
    many,
    targetName,
    targetLabel,
    checkedIds,
    selectedId,
    onPick,
    onScroll
}: {
    items: RelationCandidate[];
    isPending: boolean;
    /** The candidate query failed — show an error, not the empty state. */
    isError: boolean;
    loadingMore: boolean;
    /** Whether a search/filter is active (drives the empty vs no-matches copy). */
    filtersActive: boolean;
    many: boolean;
    targetName: string;
    /** Accessible group label (the target type's human label). */
    targetLabel: string;
    /** Ids staged in a many-relation. */
    checkedIds: Set<string>;
    /** The current pick for a single relation. */
    selectedId?: string;
    onPick: (candidate: RelationCandidate) => void;
    onScroll: (event: UIEvent<HTMLDivElement>) => void;
}) {
    const intl = useIntl();

    return (
        <div
            onScroll={onScroll}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border"
            aria-busy={isPending || loadingMore}
        >
            {isError ? (
                <p className="flex flex-1 items-center justify-center px-4 text-center text-sm text-destructive">
                    {intl.formatMessage(messages.loadError)}
                </p>
            ) : isPending ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="size-4" />
                    {intl.formatMessage(messages.loading)}
                </div>
            ) : items.length === 0 ? (
                <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    {intl.formatMessage(
                        filtersActive ? messages.noMatches : messages.empty
                    )}
                </p>
            ) : (
                <>
                    <div
                        className="divide-y"
                        role={many ? 'group' : 'radiogroup'}
                        aria-label={targetLabel}
                    >
                        {items.map((candidate) => (
                            <RelationCandidateRow
                                key={candidate.id}
                                candidate={candidate}
                                many={many}
                                targetName={targetName}
                                checked={checkedIds.has(candidate.id)}
                                isSelected={
                                    !many && selectedId === candidate.id
                                }
                                onPick={() => onPick(candidate)}
                            />
                        ))}
                    </div>
                    {loadingMore ? (
                        <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
                            <Spinner className="size-4" />
                            {intl.formatMessage(messages.loading)}
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
}
