import { Fragment } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { cn } from '@orthacms/design-system';
import {
    toneBackground,
    toneForIntensity,
    toneInk
} from '../../../utils/chartTone';

/** Intl descriptors for the grid's table fallback, co-located here. */
const messages = defineMessages({
    tableView: {
        id: 'insights.heatGrid.tableView',
        defaultMessage: 'Table view'
    }
});

/** One cell of a {@link HeatGrid}. */
export type HeatCell = {
    /** Stable key within the row. */
    id: string;
    /** Magnitude, normalised to 0–1 by the caller. */
    intensity: number;
    /** Accessible description, surfaced on hover and to assistive tech. */
    title: string;
    /** Optional text printed in the cell (only legible on a tall enough cell). */
    text?: string;
};

/** One labelled row of a {@link HeatGrid}. */
export type HeatRow = {
    /** Stable key. */
    id: string;
    /** Row label, shown at the left. */
    label: string;
    /** Cells, in the order of {@link HeatGridProps.columns}. */
    cells: HeatCell[];
};

/** Props for {@link HeatGrid}. */
export type HeatGridProps = {
    /** Column headings, left to right. */
    columns: string[];
    /** The rows, top to bottom. */
    rows: HeatRow[];
    /** Describes the whole grid for assistive tech. */
    ariaLabel: string;
    /** Width of the row-label column. Defaults to `6.5rem`. */
    labelWidth?: string;
    /** Height of a cell. Defaults to `1.375rem` (punchcard density). */
    cellHeight?: string;
};

/**
 * A two-dimensional heat grid — the form for "when" and "which combination"
 * questions that a bar list flattens away.
 *
 * Intensity is normalised **by the caller**, not here, because only the caller
 * knows whether the denominator should be the grid's own maximum (a punchcard,
 * where relative business is the story) or a fixed 100% (coverage, where the
 * story is distance from complete). Normalising internally would silently make
 * every grid a relative one.
 */
export function HeatGrid({
    columns,
    rows,
    ariaLabel,
    labelWidth = '6.5rem',
    cellHeight = '1.375rem'
}: HeatGridProps) {
    const intl = useIntl();
    const template = `${labelWidth} repeat(${columns.length}, minmax(0, 1fr))`;

    return (
        <div className="flex flex-col gap-2">
            <div
                className="grid gap-[3px]"
                style={{ gridTemplateColumns: template }}
                role="img"
                aria-label={ariaLabel}
            >
                <span />
                {columns.map((column) => (
                    <span
                        key={column}
                        className="text-center text-[10px] text-muted-foreground"
                    >
                        {column}
                    </span>
                ))}

                {rows.map((row) => (
                    <Fragment key={row.id}>
                        <span className="truncate pr-1.5 text-right text-[11px] text-muted-foreground">
                            {row.label}
                        </span>
                        {row.cells.map((cell) => {
                            const tone = toneForIntensity(cell.intensity);
                            return (
                                <span
                                    key={cell.id}
                                    title={cell.title}
                                    style={{ height: cellHeight }}
                                    className={cn(
                                        'grid min-w-0 place-items-center rounded-[3px] text-[11px] font-semibold tabular-nums',
                                        toneBackground(tone),
                                        toneInk(tone)
                                    )}
                                >
                                    {cell.text}
                                </span>
                            );
                        })}
                    </Fragment>
                ))}
            </div>

            {/* `role="img"` makes everything inside the grid presentational,
                so the column headings, the row labels and every cell's value
                are erased — a 7×24 punchcard reached a screen-reader user as
                one summary sentence, and the per-cell `title` tooltips were
                never keyboard-reachable in the first place. Same remedy
                `AreaTrend` already ships: the numbers exist as real text. */}
            <details className="text-xs">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                    {intl.formatMessage(messages.tableView)}
                </summary>
                <div className="mt-1.5 overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                        <caption className="sr-only">{ariaLabel}</caption>
                        <thead>
                            <tr>
                                <td className="border-b py-1 pr-3" />
                                {columns.map((column) => (
                                    <th
                                        key={column}
                                        scope="col"
                                        className="border-b py-1 px-1.5 text-right font-medium text-muted-foreground"
                                    >
                                        {column}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id}>
                                    <th
                                        scope="row"
                                        className="border-b py-1 pr-3 text-left font-medium text-muted-foreground"
                                    >
                                        {row.label}
                                    </th>
                                    {row.cells.map((cell) => (
                                        <td
                                            key={cell.id}
                                            className="border-b py-1 px-1.5 text-right tabular-nums"
                                        >
                                            {cell.title}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>
        </div>
    );
}
