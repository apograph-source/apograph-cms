import type { ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Button } from '@orthacms/design-system';

/** Intl descriptors for {@link CollectionRecordsSelectionBar}, co-located. */
const messages = defineMessages({
    count: {
        id: 'content.records.selection.count',
        defaultMessage: '{count, plural, one {# selected} other {# selected}}'
    },
    clear: {
        id: 'content.records.selection.clear',
        defaultMessage: 'Clear'
    }
});

/**
 * The selection summary bar shown above the table once one or more rows are
 * selected: a "{n} selected" count, then **Clear**, then the caller's bulk
 * `actions` (a ⋯ menu holding publish / delete / restore, composed per view +
 * permission).
 *
 * Clear comes first, and outside that menu, because it is the way *out* of a
 * state the user may have entered by accident — burying the undo behind the
 * same menu as Delete would be the wrong shape.
 *
 * The count here is **visual only** — the bar mounts and unmounts with the
 * selection, so it can't be a reliable live region; the spoken announcement
 * lives in a persistent region in `LoadedRecordsView`.
 */
export function CollectionRecordsSelectionBar({
    count,
    actions,
    onClear
}: {
    /** Number of currently selected records. */
    count: number;
    /** Bulk action controls for the current selection, after Clear. */
    actions?: ReactNode;
    /** Clears the selection. */
    onClear: () => void;
}) {
    const intl = useIntl();

    return (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-2">
            <span className="text-sm font-medium">
                {intl.formatMessage(messages.count, { count })}
            </span>
            <div className="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    className="shadow-none"
                    onClick={onClear}
                >
                    {intl.formatMessage(messages.clear)}
                </Button>
                {actions}
            </div>
        </div>
    );
}
