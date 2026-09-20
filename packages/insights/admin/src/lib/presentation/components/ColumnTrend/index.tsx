import { cn } from '@orthacms/design-system';
import { toneBackground } from '../../../utils/chartTone';
import type { TrendPoint } from '../AreaTrend';

/** Props for {@link ColumnTrend}. */
export type ColumnTrendProps = {
    /** The series, oldest first. */
    points: TrendPoint[];
    /** Describes the whole series for assistive tech. */
    ariaLabel: string;
    /** Formats one column's hover description. */
    describe: (point: TrendPoint) => string;
};

/**
 * A compact column chart for counted events over time.
 *
 * Columns rather than a line because the values are **discrete tallies** — 61
 * uploads in a week is a count of separate things, and a line drawn between two
 * such counts implies intermediate values that were never measured.
 *
 * The final column takes the deepest ramp step: on a dashboard the newest bar is
 * the one being looked for, and emphasis costs nothing here because the ramp
 * already encodes nothing else.
 */
export function ColumnTrend({ points, ariaLabel, describe }: ColumnTrendProps) {
    const max = Math.max(...points.map((point) => point.value), 0);
    const denominator = max > 0 ? max : 1;

    if (!points.length) return null;

    return (
        <div className="flex flex-col gap-1.5">
            <div
                className="flex h-24 items-end gap-[3px]"
                role="img"
                aria-label={ariaLabel}
            >
                {points.map((point, index) => (
                    <span
                        key={point.label}
                        title={describe(point)}
                        style={{
                            height: `${Math.max(3, (point.value / denominator) * 100)}%`
                        }}
                        className={cn(
                            'min-h-[3px] flex-1 rounded-t',
                            toneBackground(
                                index === points.length - 1 ? 'q5' : 'q3'
                            )
                        )}
                    />
                ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{points[0].label}</span>
                <span className="tabular-nums">
                    {points[points.length - 1].label} ·{' '}
                    {points[points.length - 1].value}
                </span>
            </div>
        </div>
    );
}
