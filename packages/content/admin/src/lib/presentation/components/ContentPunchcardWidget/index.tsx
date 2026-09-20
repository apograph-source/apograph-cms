import { defineMessages, useIntl } from 'react-intl';
import {
    HeatGrid,
    RampLegend,
    WidgetCard,
    type HeatRow
} from '@orthacms/insights-admin';
import { useContentPunchcard } from '../../../application/useContentInsights';

/** Intl descriptors for the punchcard widget, co-located here. */
const messages = defineMessages({
    title: {
        id: 'content.insights.punchcard.title',
        defaultMessage: 'When the work happens'
    },
    description: {
        id: 'content.insights.punchcard.description',
        defaultMessage: 'Saves by weekday and hour (UTC)'
    },
    quiet: { id: 'content.insights.punchcard.quiet', defaultMessage: 'quiet' },
    busy: { id: 'content.insights.punchcard.busy', defaultMessage: 'busy' },
    cell: {
        id: 'content.insights.punchcard.cell',
        defaultMessage: '{day} {hour}:00 — {count, number} saves'
    },
    ariaLabel: {
        id: 'content.insights.punchcard.ariaLabel',
        defaultMessage:
            'Editing activity by weekday and hour. {total, number} saves in the period, busiest slot {max, number}.'
    },
    footer: {
        id: 'content.insights.punchcard.footer',
        defaultMessage:
            'Hours are UTC — the grouping happens in the database, so shifting the labels would mislabel the buckets.'
    },
    mon: { id: 'content.insights.punchcard.mon', defaultMessage: 'Mon' },
    tue: { id: 'content.insights.punchcard.tue', defaultMessage: 'Tue' },
    wed: { id: 'content.insights.punchcard.wed', defaultMessage: 'Wed' },
    thu: { id: 'content.insights.punchcard.thu', defaultMessage: 'Thu' },
    fri: { id: 'content.insights.punchcard.fri', defaultMessage: 'Fri' },
    sat: { id: 'content.insights.punchcard.sat', defaultMessage: 'Sat' },
    sun: { id: 'content.insights.punchcard.sun', defaultMessage: 'Sun' }
});

/** ISO weekday order — 1 = Monday, matching Postgres `isodow`. */
const WEEKDAYS = [
    messages.mon,
    messages.tue,
    messages.wed,
    messages.thu,
    messages.fri,
    messages.sat,
    messages.sun
] as const;

/**
 * Working hours the grid covers.
 *
 * A full 24 columns would be mostly empty at any realistic team size, shrinking
 * every cell to keep space for hours nothing happens in. Activity outside this
 * window is not lost — it is simply not plotted, which the caption's UTC note
 * covers.
 */
const FIRST_HOUR = 7;
const LAST_HOUR = 20;
const HOURS = Array.from(
    { length: LAST_HOUR - FIRST_HOUR + 1 },
    (_, index) => FIRST_HOUR + index
);

/**
 * Editing activity by weekday and hour, from the revision store — every save,
 * not just the moments something went live.
 */
export function ContentPunchcardWidget() {
    const intl = useIntl();
    const { data, isPending, isError } = useContentPunchcard();

    // The server sends only non-empty slots (most of a 7 x 24 grid is zero), so
    // the dense grid is rebuilt here from a sparse list.
    const counts = new Map(
        (data?.cells ?? []).map((cell) => [
            `${cell.weekday}:${cell.hour}`,
            cell.count
        ])
    );
    const max = data?.max ?? 0;

    const rows: HeatRow[] = WEEKDAYS.map((descriptor, index) => {
        const weekday = index + 1;
        const day = intl.formatMessage(descriptor);
        return {
            id: `d${weekday}`,
            label: day,
            cells: HOURS.map((hour) => {
                const count = counts.get(`${weekday}:${hour}`) ?? 0;
                return {
                    id: `h${hour}`,
                    // Normalised against the busiest slot: a punchcard's story
                    // is relative business, not absolute volume.
                    intensity: max > 0 ? count / max : 0,
                    title: intl.formatMessage(messages.cell, {
                        day,
                        hour,
                        count
                    })
                };
            })
        };
    });

    return (
        <WidgetCard
            title={intl.formatMessage(messages.title)}
            description={intl.formatMessage(messages.description)}
            footer={intl.formatMessage(messages.footer)}
            isPending={isPending}
            isError={isError}
            isEmpty={(data?.total ?? 0) === 0}
            skeletonRows={7}
        >
            <div className="flex flex-col gap-3">
                <HeatGrid
                    columns={HOURS.map(String)}
                    rows={rows}
                    labelWidth="2.5rem"
                    ariaLabel={intl.formatMessage(messages.ariaLabel, {
                        total: data?.total ?? 0,
                        max
                    })}
                />
                <RampLegend
                    lowLabel={intl.formatMessage(messages.quiet)}
                    highLabel={intl.formatMessage(messages.busy)}
                />
            </div>
        </WidgetCard>
    );
}
