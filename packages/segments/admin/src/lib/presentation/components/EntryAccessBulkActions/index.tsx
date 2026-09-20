import { defineMessages, useIntl } from 'react-intl';
import { Check, Ban, Eraser } from 'lucide-react';
import { Button } from '@orthacms/design-system';
import { SEGMENT_STATE, type SegmentState } from '../../../domain/types';

const messages = defineMessages({
    legend: {
        id: 'segments.bulk.legend',
        defaultMessage: 'Set every audience to'
    },
    allow: { id: 'segments.bulk.allow', defaultMessage: 'Can see' },
    deny: { id: 'segments.bulk.deny', defaultMessage: 'Cannot see' },
    clear: { id: 'segments.bulk.clear', defaultMessage: 'Clear all' },
    scopeAll: {
        id: 'segments.bulk.scopeAll',
        defaultMessage:
            'Applies to all {count} audiences, not just the ones on this page.'
    },
    scopeSearch: {
        id: 'segments.bulk.scopeSearch',
        defaultMessage:
            'Applies to the {count} audiences matching your search, not just the ones on this page.'
    },
    truncated: {
        id: 'segments.bulk.truncated',
        defaultMessage:
            'There are more audiences than an entry can name at once, so setting them all is unavailable. Narrow the list with the search first.'
    }
});

/**
 * "Set every audience to Can see / Cannot see / Clear" for the entry's Access
 * tab.
 *
 * **Every audience means every one the filter matched, not this page's.** The
 * ids come from the list response rather than the rows on screen, because a
 * control called "set every audience" that quietly set ten of forty would be
 * worse than no control: the mistake is invisible until a reader is turned away.
 *
 * When more matched than an entry may name on one side, the controls are
 * disabled with the reason rather than doing part of the job — that many could
 * not be stored anyway, so offering it would be offering a save that 400s.
 *
 * **Clear all** is here beside the other two because "start again" is the way
 * out of a bulk action somebody applied by accident, and it is the one thing
 * that cannot be reached by setting rows one at a time in fewer moves.
 */
export function EntryAccessBulkActions({
    count,
    searching,
    truncated,
    disabled,
    onApply
}: {
    /** How many audiences the current filter matched. */
    count: number;
    /** Whether a search is narrowing that set — it changes what "every" means. */
    searching: boolean;
    /** Whether the matched set is larger than an entry can name. */
    truncated: boolean;
    disabled?: boolean;
    /** Apply one state to every matched audience. */
    onApply: (state: SegmentState) => void;
}) {
    const intl = useIntl();
    const locked = disabled || truncated || count === 0;

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
                {intl.formatMessage(messages.legend)}
            </span>
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shadow-none"
                    disabled={locked}
                    onClick={() => onApply(SEGMENT_STATE.Allow)}
                >
                    <Check aria-hidden />
                    {intl.formatMessage(messages.allow)}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shadow-none"
                    disabled={locked}
                    onClick={() => onApply(SEGMENT_STATE.Deny)}
                >
                    <Ban aria-hidden />
                    {intl.formatMessage(messages.deny)}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    disabled={locked}
                    onClick={() => onApply(SEGMENT_STATE.Unset)}
                >
                    <Eraser aria-hidden />
                    {intl.formatMessage(messages.clear)}
                </Button>
            </div>
            <p className="basis-full text-xs text-muted-foreground">
                {truncated
                    ? intl.formatMessage(messages.truncated)
                    : intl.formatMessage(
                          searching ? messages.scopeSearch : messages.scopeAll,
                          { count }
                      )}
            </p>
        </div>
    );
}
