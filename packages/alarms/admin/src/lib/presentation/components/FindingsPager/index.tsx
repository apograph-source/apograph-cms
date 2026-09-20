import { defineMessages, useIntl } from 'react-intl';
import { Button } from '@orthacms/design-system';

const messages = defineMessages({
    prev: { id: 'alarms.pager.prev', defaultMessage: 'Previous' },
    next: { id: 'alarms.pager.next', defaultMessage: 'Next' },
    pageOf: {
        id: 'alarms.pager.pageOf',
        defaultMessage: 'Page {page} of {pages}'
    },
    prevLabel: {
        id: 'alarms.pager.prevLabel',
        defaultMessage: 'Previous page of {label}'
    },
    nextLabel: {
        id: 'alarms.pager.nextLabel',
        defaultMessage: 'Next page of {label}'
    }
});

/** Props for {@link FindingsPager}. */
export type FindingsPagerProps = {
    /** Current 1-based page. */
    page: number;
    /** How many pages there are. */
    pageCount: number;
    /** Go to a page. */
    onPage: (next: number) => void;
    /**
     * What this pager pages through, for the buttons' accessible names.
     *
     * Several pagers can be on screen at once — one per expanded alarm — and
     * "Next" repeated four times leaves a screen-reader user unable to tell
     * which list they are about to advance.
     */
    label: string;
};

/** Previous / Next over a page count, or nothing when there is one page. */
export function FindingsPager({
    page,
    pageCount,
    onPage,
    label
}: FindingsPagerProps) {
    const intl = useIntl();
    if (pageCount <= 1) return null;

    return (
        <div className="flex items-center justify-end gap-3">
            <span className="text-sm tabular-nums text-muted-foreground">
                {intl.formatMessage(messages.pageOf, {
                    page,
                    pages: pageCount
                })}
            </span>
            <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                aria-label={intl.formatMessage(messages.prevLabel, { label })}
                onClick={() => onPage(page - 1)}
            >
                {intl.formatMessage(messages.prev)}
            </Button>
            <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                aria-label={intl.formatMessage(messages.nextLabel, { label })}
                onClick={() => onPage(page + 1)}
            >
                {intl.formatMessage(messages.next)}
            </Button>
        </div>
    );
}
