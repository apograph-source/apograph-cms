import { defineMessages, useIntl } from 'react-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
    Button,
    Pagination,
    PaginationContent,
    PaginationItem,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@orthacms/design-system';

const messages = defineMessages({
    rowsPerPage: {
        id: 'segments.pagination.rowsPerPage',
        defaultMessage: 'Rows per page'
    },
    range: {
        id: 'segments.pagination.range',
        defaultMessage: '{from}–{to} of {total}'
    },
    previous: {
        id: 'segments.pagination.previous',
        defaultMessage: 'Previous page'
    },
    next: { id: 'segments.pagination.next', defaultMessage: 'Next page' },
    page: {
        id: 'segments.pagination.page',
        defaultMessage: 'Page {page} of {pageCount}'
    }
});

/** The selectable page sizes, smallest first. The server caps at 100. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/**
 * The footer bar shared by the audience directory and the entry editor's Access
 * tab: a rows-per-page selector, an "{from}–{to} of {total}" readout, and
 * previous/next once there is more than one page.
 *
 * One component for both surfaces on purpose. They are two views of the same
 * list — the directory manages the vocabulary and the tab decides against it —
 * and a reader moving between them should not meet two different pagers.
 *
 * Real buttons rather than link-styled anchors, like every other paginated table
 * here: the page is component state, not a URL, and buttons disable cleanly at
 * either end.
 */
export function SegmentsPagination({
    page,
    pageCount,
    pageSize,
    total,
    onPageChange,
    onPageSizeChange
}: {
    page: number;
    pageCount: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
}) {
    const intl = useIntl();
    const rowsLabel = intl.formatMessage(messages.rowsPerPage);
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);

    return (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                    {rowsLabel}
                </span>
                <Select
                    value={String(pageSize)}
                    onValueChange={(value) => onPageSizeChange(Number(value))}
                >
                    <SelectTrigger
                        className="h-8 w-[72px] rounded-lg shadow-none"
                        aria-label={rowsLabel}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg shadow-none">
                        <SelectGroup>
                            {PAGE_SIZE_OPTIONS.map((size) => (
                                <SelectItem key={size} value={String(size)}>
                                    {size}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>

            <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                    {intl.formatMessage(messages.range, { from, to, total })}
                </span>
                {pageCount > 1 ? (
                    <Pagination className="mx-0 w-auto">
                        <PaginationContent className="gap-3">
                            <PaginationItem>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-8 shadow-none"
                                    disabled={page <= 1}
                                    onClick={() => onPageChange(page - 1)}
                                    aria-label={intl.formatMessage(
                                        messages.previous
                                    )}
                                >
                                    <ChevronLeft />
                                </Button>
                            </PaginationItem>
                            <PaginationItem>
                                <span className="text-sm text-muted-foreground">
                                    {intl.formatMessage(messages.page, {
                                        page,
                                        pageCount
                                    })}
                                </span>
                            </PaginationItem>
                            <PaginationItem>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-8 shadow-none"
                                    disabled={page >= pageCount}
                                    onClick={() => onPageChange(page + 1)}
                                    aria-label={intl.formatMessage(
                                        messages.next
                                    )}
                                >
                                    <ChevronRight />
                                </Button>
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                ) : null}
            </div>
        </div>
    );
}
