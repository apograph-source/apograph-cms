import type { ReactNode } from 'react';
import { cn } from '@orthacms/design-system';
import { toneBackground, type ChartTone } from '../../../utils/chartTone';

/** One fill within a {@link BarRowSpec}'s track. */
export type BarSegment = {
    /** Stable key within the row. */
    id: string;
    /** Magnitude, on the same scale as the chart's `max`. */
    value: number;
    /** Which palette role paints it. */
    tone: ChartTone;
    /** Accessible description, surfaced on hover and to assistive tech. */
    label: string;
};

/** One labelled row of a {@link BarRows} chart. */
export type BarRowSpec = {
    /** Stable key. */
    id: string;
    /** Row label, shown at the left. */
    label: string;
    /** The fills, left to right. One segment for a plain bar; two for a split. */
    segments: BarSegment[];
    /** The right-hand readout — the row's value in ink, not inside the fill. */
    readout: ReactNode;
    /** An optional second readout column (e.g. a share of total). */
    secondary?: ReactNode;
};

/** Props for {@link BarRows}. */
export type BarRowsProps = {
    /** The rows, in display order. */
    rows: BarRowSpec[];
    /**
     * Denominator every bar is scaled against. Pass the same value for all rows
     * so lengths are comparable — a per-row max would make every bar full width
     * and encode nothing.
     */
    max: number;
    /** Extra classes for the list container. */
    className?: string;
};

/**
 * A horizontal bar list — the workhorse form for "which of these is biggest".
 *
 * Two deliberate constraints:
 *
 * - **No text inside the fills.** Every value sits in the readout column in an
 *   ink colour. A number printed on a bar has to stay legible against whichever
 *   palette step it lands on, in both themes; moving it out sidesteps the whole
 *   class of contrast bugs rather than managing it.
 * - **Square at the baseline, rounded at the data end.** The rounding marks
 *   where the value *stops*; rounding the origin too would blur where it starts.
 *
 * A **zero segment is dropped, not drawn**. Segments carry a 3px floor so a
 * small-but-real value stays visible, and that floor turned an absent category
 * into a sliver of colour — a locale with nothing missing rendered a tick of the
 * "missing" hue, which is the chart stating the opposite of its data. Filtering
 * here rather than at each call site means no contributed widget has to know.
 *
 * **Each track is a `role="img"` named by its own segments.** A native `title`
 * is not keyboard-reachable and not dismissible (1.4.13), and a row's readout
 * column states only the first series — so on a split bar the second value
 * reached the user through hue alone (1.4.1) inside a graphic with no
 * accessible name (1.1.1). Every segment already carries a full sentence in
 * `label`; joining them is the alternative. Doing it here fixes every widget
 * that renders this form, which is the one on the Insights page that was
 * missing what its sibling charts already had.
 */
export function BarRows({ rows, max, className }: BarRowsProps) {
    // A zero or negative denominator would make every width NaN%, which renders
    // as a full-width bar — the most wrong possible output. Fall back to 1 so
    // empty data draws nothing instead.
    const denominator = max > 0 ? max : 1;

    return (
        <div className={cn('flex flex-col gap-2.5', className)}>
            {rows.map((row) => (
                <div
                    key={row.id}
                    className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2.5"
                >
                    <span className="truncate text-xs text-muted-foreground">
                        {row.label}
                    </span>

                    <div
                        role="img"
                        // Every drawn segment, in order. Dropped (zero) segments
                        // are named too — "0 missing" is information the bar
                        // cannot draw but the row still means.
                        aria-label={row.segments
                            .map((segment) => segment.label)
                            .join('. ')}
                        className="flex h-3.5 min-w-0 gap-0.5"
                    >
                        {row.segments
                            .filter((segment) => segment.value > 0)
                            .map((segment) => (
                                <span
                                    key={segment.id}
                                    title={segment.label}
                                    style={{
                                        width: `${Math.max(
                                            0,
                                            Math.min(
                                                100,
                                                (segment.value / denominator) *
                                                    100
                                            )
                                        )}%`
                                    }}
                                    className={cn(
                                        'min-w-[3px] rounded-none last:rounded-r',
                                        toneBackground(segment.tone)
                                    )}
                                />
                            ))}
                    </div>

                    <span className="flex items-baseline justify-end gap-2 text-xs tabular-nums">
                        <span className="text-foreground">{row.readout}</span>
                        {row.secondary ? (
                            <span className="w-9 text-right text-muted-foreground">
                                {row.secondary}
                            </span>
                        ) : null}
                    </span>
                </div>
            ))}
        </div>
    );
}
