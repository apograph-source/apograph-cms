import { useEffect, useMemo, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import {
    Alert,
    AlertDescription,
    Button,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Skeleton,
    SkeletonRegion,
    Spinner
} from '@orthacms/design-system';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { useAlarmFindings } from '../../../../application/useAlarmFindings';
import type { AlarmRule } from '../../../../types/alarm';
import { severityLook } from '../../../severityLook';
import { FindingRow } from '../../FindingRow';
import { FindingsPager } from '../../FindingsPager';

const messages = defineMessages({
    count: {
        id: 'alarms.group.count',
        defaultMessage: '{count, plural, one {# record} other {# records}}'
    },
    toggle: {
        id: 'alarms.group.toggle',
        defaultMessage:
            '{severity}: {name} — {count, plural, one {# record} other {# records}}'
    },
    listLabel: {
        id: 'alarms.group.listLabel',
        defaultMessage: 'Records flagged by {name}'
    },
    recheck: { id: 'alarms.group.recheck', defaultMessage: 'Re-check' },
    recheckLabel: {
        id: 'alarms.group.recheckLabel',
        defaultMessage: 'Re-check {name} against the whole collection'
    },
    error: {
        id: 'alarms.group.error',
        defaultMessage:
            'These records could not be loaded, so this is not a statement that the list is empty.'
    },
    gone: {
        id: 'alarms.group.gone',
        defaultMessage: 'Nothing here any more — these records were fixed.'
    },
    loading: {
        id: 'alarms.group.loading',
        defaultMessage: 'Loading the records {name} has flagged…'
    }
});

/** Findings shown per page inside one group. */
const GROUP_PAGE_SIZE = 10;

/** Props for {@link FindingGroup}. */
export type FindingGroupProps = {
    /** The alarm this group is about. */
    rule: AlarmRule;
    /**
     * How many records this alarm currently flags.
     *
     * **Taken from the alarm, never from the page of findings below it.** A
     * header reading "3 records" over a first page of three, when there are
     * ninety, is the exact misinformation grouping exists to prevent.
     */
    count: number;
    /** Whether this group starts expanded. */
    defaultOpen: boolean;
    /** Whether the caller may rescan (i.e. holds `alarms:manage`). */
    canManage: boolean;
    /** Re-run this alarm over its whole collection. */
    onRescan: (rule: AlarmRule) => void;
    /** A rescan of this alarm is in flight. */
    isRescanning: boolean;
};

/**
 * One alarm and the records it has flagged, collapsed by default.
 *
 * **Why grouping rather than a flat list.** A workspace with a thousand flagged
 * records gave forty pages of rows in which nothing said which alarm was
 * responsible, and every row repeated the same sentence. What a person actually
 * does with findings is one alarm at a time — "fourteen articles link to a
 * draft author" is one pass, while fourteen rows about fourteen articles is
 * fourteen context switches. The page claimed to group by rule in its own
 * documentation and never did; this is that claim implemented.
 *
 * **The records load when the group is opened**, not on mount. A workspace with
 * twenty alarms would otherwise fire twenty list requests to draw a screen on
 * which nineteen of them are collapsed.
 *
 * **Each group pages on its own**, ten at a time. A group is a work queue you
 * go down, and a shared pager would make "page 3" mean nothing in particular.
 */
export function FindingGroup({
    rule,
    count,
    defaultOpen,
    canManage,
    onRescan,
    isRescanning
}: FindingGroupProps) {
    const intl = useIntl();
    const [open, setOpen] = useState(defaultOpen);
    const [page, setPage] = useState(1);
    const { Icon, ink, label } = severityLook(rule.severity);

    const findings = useAlarmFindings(
        { state: 'open', ruleId: rule.id, page, pageSize: GROUP_PAGE_SIZE },
        open
    );

    const pageCount = useMemo(
        () => Math.max(1, Math.ceil(count / GROUP_PAGE_SIZE)),
        [count]
    );

    // Muting the last row of a trailing page leaves this group's page past the
    // end, and the refetch lands on an empty list with the pager hidden — the
    // same stranding the flat list had, once per group.
    useEffect(() => {
        if (page > pageCount) setPage(pageCount);
    }, [page, pageCount]);

    const items = findings.data?.items ?? [];

    return (
        <Collapsible
            open={open}
            onOpenChange={setOpen}
            className="rounded-xl border bg-card"
        >
            {/* The trigger covers the chevron and the wording only. Re-check
                is a second action on the same row, and a `<button>` cannot
                contain another one — nesting it would produce invalid markup
                that browsers repair by hoisting it out of the trigger, which
                is exactly where a click would then not toggle anything. */}
            <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <CollapsibleTrigger
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    // The severity leads the name because `aria-label` on a
                    // button **replaces** its descendant text in the accessible
                    // name: an `sr-only` word inside the trigger is not read at
                    // all, so the severity has to be part of the label itself
                    // or a screen-reader user never hears it (WCAG 1.4.1).
                    aria-label={intl.formatMessage(messages.toggle, {
                        severity: intl.formatMessage(label),
                        name: rule.name,
                        count
                    })}
                >
                    <ChevronRight
                        aria-hidden="true"
                        className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${
                            open ? 'rotate-90' : ''
                        }`}
                    />
                    <Icon
                        aria-hidden="true"
                        className={`size-4 shrink-0 ${ink}`}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                            {rule.name}
                        </span>
                        {/* What an editor reads on the record itself. It is
                            constant across this group, which is exactly why it
                            belongs on the header and not on every row. */}
                        <span className="truncate text-xs text-muted-foreground">
                            {rule.findingTitle}
                        </span>
                    </span>
                </CollapsibleTrigger>

                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {intl.formatMessage(messages.count, { count })}
                </span>

                {/* Beside the count rather than only on the Alarms tab: this is
                    where someone reads a number they doubt, and "is that still
                    true?" is the question they have here. The accessible name
                    says which alarm, because several of these are on screen at
                    once. */}
                {canManage ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        disabled={isRescanning}
                        aria-label={intl.formatMessage(messages.recheckLabel, {
                            name: rule.name
                        })}
                        onClick={() => onRescan(rule)}
                    >
                        {isRescanning ? (
                            <Spinner />
                        ) : (
                            <RefreshCw aria-hidden="true" />
                        )}
                        {intl.formatMessage(messages.recheck)}
                    </Button>
                ) : null}
            </div>

            <CollapsibleContent>
                <div className="border-t">
                    {findings.isError ? (
                        <Alert variant="destructive" className="m-4 w-auto">
                            <AlertDescription>
                                {intl.formatMessage(messages.error)}
                            </AlertDescription>
                        </Alert>
                    ) : findings.isPending ? (
                        // Named and announced, not two grey bars. This is the
                        // group's own wait — the page-level skeleton is long
                        // gone by the time anyone expands one — and without a
                        // `SkeletonRegion` it is the one state here with no
                        // words at all, which makes it indistinguishable from
                        // "nothing flagged" to anyone not looking at it.
                        <SkeletonRegion
                            label={intl.formatMessage(messages.loading, {
                                name: rule.name
                            })}
                        >
                            <div className="flex flex-col gap-2 p-4">
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                        </SkeletonRegion>
                    ) : items.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                            {intl.formatMessage(messages.gone)}
                        </p>
                    ) : (
                        <>
                            <ul
                                className="divide-y divide-border"
                                aria-label={intl.formatMessage(
                                    messages.listLabel,
                                    { name: rule.name }
                                )}
                            >
                                {items.map((finding) => (
                                    <FindingRow
                                        key={`${finding.ruleId}:${finding.entryId}`}
                                        finding={finding}
                                    />
                                ))}
                            </ul>
                            {/* The wrapper is conditional, not just its
                                contents. `FindingsPager` renders nothing at one
                                page, but a padded box around nothing is still a
                                padded box — it left ~28px of dead space under
                                the last row of every group small enough not to
                                need paging, which is most of them. */}
                            {pageCount > 1 ? (
                                <div className="px-4 pb-4 pt-3">
                                    <FindingsPager
                                        page={page}
                                        pageCount={pageCount}
                                        onPage={setPage}
                                        label={rule.name}
                                    />
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
