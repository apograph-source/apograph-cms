import { useIntl } from 'react-intl';
import { cn } from '@orthacms/design-system';
import type { InsightsWidgetSize } from '../../slots/insightsSlots';
import type { InsightsBand } from '../../../utils/resolveInsightsLayout';
import { useInsightsRange } from '../../../hooks/useInsightsRange';
import { WidgetBoundary } from '../WidgetBoundary';

/**
 * Column span per size, written as whole literal class strings because
 * Tailwind scans source text and never emits an interpolated class name.
 *
 * Sizes only take effect from `lg` up. Below that every widget goes full width
 * (with `sm` allowed a half row at `md`): a heat grid or a five-row bar list
 * compressed into a third of a phone screen stops being readable, and a
 * dashboard that can't be read on the device in someone's hand isn't a smaller
 * dashboard, it's a broken one.
 */
const SIZE_SPAN: Record<InsightsWidgetSize, string> = {
    xs: 'col-span-6 lg:col-span-3',
    sm: 'col-span-12 md:col-span-6 lg:col-span-4',
    md: 'col-span-12 lg:col-span-6',
    lg: 'col-span-12 lg:col-span-8',
    full: 'col-span-12'
};

/** The span a widget with no declared size gets — half a row. */
const DEFAULT_SIZE: InsightsWidgetSize = 'md';

/**
 * Column span for a contributed widget's `size`, falling back to the default
 * for anything not in the table.
 *
 * A bare `SIZE_SPAN[size]` yielded `undefined` for a typo'd size, `cn` dropped
 * it, and the widget landed in one column of twelve — a sliver, with no error
 * anywhere. `Object.hasOwn` also keeps a size naming an `Object.prototype`
 * member (`constructor`, `toString`) from reading back a truthy non-string.
 * The type says this can't happen; the contributor writing it is in another
 * package and may not be compiling against that type.
 */
function spanFor(size: InsightsWidgetSize | undefined): string {
    if (size && Object.hasOwn(SIZE_SPAN, size)) return SIZE_SPAN[size];
    return SIZE_SPAN[DEFAULT_SIZE];
}

/** Props for {@link InsightsSectionBand}. */
export type InsightsSectionBandProps = {
    /** The section and its visible widgets. */
    band: InsightsBand;
};

/**
 * One labelled band of the Insights page: a heading and the grid of widgets
 * under it.
 *
 * Each widget is mounted inside its own {@link WidgetBoundary} so a throw from
 * one contributing package can't take the others down — these components come
 * from packages the Insights plugin has no visibility into.
 */
export function InsightsSectionBand({ band }: InsightsSectionBandProps) {
    const intl = useIntl();
    const { range } = useInsightsRange();
    const { section } = band;
    const Icon = section.icon;

    const heading = intl.formatMessage({
        id: section.titleId,
        defaultMessage: section.defaultTitle
    });
    const description = section.defaultDescription
        ? intl.formatMessage({
              id: section.descriptionId ?? `${section.titleId}.description`,
              defaultMessage: section.defaultDescription
          })
        : null;

    return (
        <section
            className="flex flex-col gap-3"
            data-section-id={section.id}
            data-section-fallback={band.isFallback ? 'true' : undefined}
        >
            <div className="border-b pb-1">
                <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                    {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
                    {heading}
                </h2>
                {description ? (
                    <p className="mt-1 pb-1 text-xs normal-case tracking-normal text-muted-foreground">
                        {description}
                    </p>
                ) : null}
            </div>

            <div className="grid grid-cols-12 gap-3">
                {band.widgets.map((widget) => (
                    <div
                        key={widget.id}
                        data-widget-id={widget.id}
                        className={cn(spanFor(widget.size))}
                    >
                        <WidgetBoundary
                            title={intl.formatMessage({
                                id: widget.titleId,
                                defaultMessage: widget.defaultTitle
                            })}
                            // The range is the page's one "ask again" action,
                            // so a widget that threw on one window's data gets
                            // another chance on the next rather than staying
                            // broken until the page is remounted.
                            resetKey={range}
                        >
                            <widget.Component />
                        </WidgetBoundary>
                    </div>
                ))}
            </div>
        </section>
    );
}
