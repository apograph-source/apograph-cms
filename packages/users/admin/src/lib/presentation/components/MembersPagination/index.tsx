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

/** Intl descriptors for {@link MembersPagination}, co-located with the component. */
const messages = defineMessages({
    rowsPerPage: {
        id: 'users.pagination.rowsPerPage',
        defaultMessage: 'Rows per page'
    },
    range: {
        id: 'users.pagination.range',
        defaultMessage: '{from}–{to} of {total}'
    },
    previous: {
        id: 'users.pagination.previous',
        defaultMessage: 'Previous page'
    },
    next: {
        id: 'users.pagination.next',
        defaultMessage: 'Next page'
    },
    page: {
        id: 'users.pagination.page',
        defaultMessage: 'Page {page} of {pageCount}'
    }
});

/** The selectable page sizes, smallest first. The server caps at the largest. */
export const PAGE_SIZE_OPTIONS = [5, 10, 25, 100];

/**
 * The table's footer bar: a rows-per-page selector and an "{from}–{to} of
 * {total}" readout, with previous/next controls once there's more than one
 * page. Real buttons (not link-styled anchors) since page state is client
 * state, not a URL — they disable cleanly at either end.
 */
export function MembersPagination({
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
