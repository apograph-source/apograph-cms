import type { ReactNode } from 'react';
import { defineMessages, FormattedMessage } from 'react-intl';
import { Card, CardContent, Skeleton, cn } from '@orthacms/design-system';
import { Sparkline } from '../Sparkline';

/** Intl descriptors for the stat tile, co-located here. */
const messages = defineMessages({
    unavailable: {
        id: 'insights.stat.unavailable',
        defaultMessage: 'Unavailable —'
    }
});

/** Props for {@link StatWidget}. */
export type StatWidgetProps = {
    /** What is being counted. */
    label: ReactNode;
    /** The headline figure, pre-formatted. */
    value: ReactNode;
    /** Unit shown smaller beside the value (e.g. `GB`). */
    unit?: string;
    /** Change against the previous period, pre-formatted. */
    delta?: ReactNode;
    /** Whether the change is meaningful movement — drives the delta's colour. */
    deltaTone?: 'up' | 'flat';
    /** Recent history for the sparkline, oldest first. At least two points. */
    history?: number[];
    /** True while the query is in flight. */
    isPending?: boolean;
    /** True when the query failed. */
    isError?: boolean;
};

/**
 * A headline figure with its change and a sparkline — the top band of the
 * Insights page.
 *
 * Its own card rather than the design-system `StatTile`, which takes only a
 * label, a value and an icon. A bare number on a dashboard is close to useless:
 * "1,284 entries" answers nothing without "up from what?", which is what the
 * delta and the sparkline are for.
 */
export function StatWidget({
    label,
    value,
    unit,
    delta,
    deltaTone = 'up',
    history,
    isPending = false,
    isError = false
}: StatWidgetProps) {
    return (
        <Card className="shadow-none">
            <CardContent className="flex flex-col gap-1 p-4">
                {isPending ? (
                    <>
                        <Skeleton className="h-7 w-20" />
                        <Skeleton className="mt-1 h-4 w-24" />
                    </>
                ) : isError ? (
                    <>
                        {/* An unreachable count must not render as a real
                            figure — an em dash reads as "unknown", a 0 reads as
                            "none", and those are opposite facts. */}
                        <span
                            className="text-2xl font-semibold tracking-[-0.02em]"
                            aria-hidden="true"
                        >
                            —
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {/* The em dash is `aria-hidden` (a screen reader
                                reads "—" as nothing or as "dash"), so without
                                this the tile announced its label and no value
                                at all — indistinguishable from a card that
                                simply has none. The distinction the em dash
                                exists to draw has to be drawn in text too. */}
                            <span className="sr-only">
                                <FormattedMessage
                                    {...messages.unavailable}
                                />{' '}
                            </span>
                            {label}
                        </span>
                    </>
                ) : (
                    <>
                        <span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">
                            {value}
                            {unit ? (
                                <span className="ml-1 text-[0.6em] font-medium text-muted-foreground">
                                    {unit}
                                </span>
                            ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {label}
                        </span>
                        {delta || history ? (
                            <span className="mt-1 flex items-end justify-between gap-2">
                                <span
                                    className={cn(
                                        'text-[11px] font-medium',
                                        deltaTone === 'up'
                                            ? 'text-success'
                                            : 'text-muted-foreground'
                                    )}
                                >
                                    {delta}
                                </span>
                                {history && history.length > 1 ? (
                                    <Sparkline
                                        values={history}
                                        muted={deltaTone === 'flat'}
                                    />
                                ) : null}
                            </span>
                        ) : null}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
