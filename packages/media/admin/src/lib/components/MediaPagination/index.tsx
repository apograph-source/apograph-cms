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
import { ASSETS_PAGE_SIZE_OPTIONS } from '../../constants';

/** Intl descriptors for {@link MediaPagination}, co-located here. */
const messages = defineMessages({
    perPage: {
        id: 'media.pagination.perPage',
        defaultMessage: 'Assets per page'
    },
    range: {
        id: 'media.pagination.range',
        defaultMessage: '{from}–{to} of {total}'
    },
    previous: {
        id: 'media.pagination.previous',
        defaultMessage: 'Previous page'
    },
    next: {
        id: 'media.pagination.next',
        defaultMessage: 'Next page'
    },
    page: {
        id: 'media.pagination.page',
        defaultMessage: 'Page {page} of {pageCount}'
    }
});

/**
 * The grid's footer bar: an assets-per-page selector and an "{from}–{to} of
 * {total}" readout, with previous/next controls once there is more than one
 * page. Mirrors the Members and Activity pagers so the three list surfaces
 * behave the same.
 *
 * Real buttons rather than link-styled anchors, because the page is component
 * state and not yet a URL — they disable cleanly at either end. (Moving this
 * state into the query string belongs with the folder-deep-linking work, which
 * has to put the open folder there too.)
 *
 * Rendered even at one page, so the per-page control and the count stay put
 * instead of appearing and vanishing as a filter narrows the folder.
 */
export function MediaPagination({
    page,
    pageCount,
    pageSize,
    total,
    onPageChange,
    onPageSizeChange
}: {
    /** 1-based current page. */
    page: number;
    /** How many pages the current search and filter produce; at least 1. */
    pageCount: number;
    pageSize: number;
    /** Assets matching across the whole folder — not the number on screen. */
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
}) {
    const intl = useIntl();
    const perPageLabel = intl.formatMessage(messages.perPage);
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);

    return (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                    {perPageLabel}
                </span>
                <Select
                    value={String(pageSize)}
                    onValueChange={(value) => onPageSizeChange(Number(value))}
                >
                    <SelectTrigger
                        className="h-8 w-[72px] rounded-lg shadow-none"
                        aria-label={perPageLabel}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-lg shadow-none">
                        <SelectGroup>
                            {ASSETS_PAGE_SIZE_OPTIONS.map((size) => (
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
