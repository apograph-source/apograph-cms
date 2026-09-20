import type { ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Card, CardContent, Skeleton } from '@orthacms/design-system';

/** Intl descriptors for the shared widget shell, co-located here. */
const messages = defineMessages({
    error: {
        id: 'insights.widget.error',
        defaultMessage: "This didn't load. Refresh to try again."
    },
    empty: {
        id: 'insights.widget.empty',
        defaultMessage: 'Nothing to show for this period yet.'
    },
    loading: {
        id: 'insights.widget.loading',
        defaultMessage: 'Loading {title}…'
    }
});

/** Props for {@link WidgetCard}. */
export type WidgetCardProps = {
    /**
     * The widget's name. Rendered as an `h3` — the page owns the `h1` and each
     * band owns its `h2`, so `h3` keeps the outline unbroken. It was an `h4`,
     * which skipped a level: axe's `heading-order` rule is best-practice and
     * the harness scans only the WCAG tag set, so nothing caught it.
     */
    title: ReactNode;
    /** One line under the title saying what is being measured. */
    description?: ReactNode;
    /** Top-right accent, typically a `WidgetChip` driven by the loaded data. */
    action?: ReactNode;
    /** A closing line of interpretation under the body. */
    footer?: ReactNode;
    /** True while the widget's query is in flight. */
    isPending?: boolean;
    /** True when the query failed. Takes precedence over `isEmpty`. */
    isError?: boolean;
    /** True when the query succeeded but there is nothing to plot. */
    isEmpty?: boolean;
    /**
     * Overrides the shared empty copy. The default names "this period", which
     * is right for the range-scoped widgets and wrong for one that takes no
     * range — a rangeless widget should not invent a window to be empty in.
     */
    emptyMessage?: ReactNode;
    /** How many skeleton rows to show while pending. */
    skeletonRows?: number;
    /** The widget body. Only rendered once data is loaded and non-empty. */
    children: ReactNode;
};

/**
 * The shared shell every Insights widget renders inside: a bordered card with a
 * header, and the **four-branch state ladder** — pending, error, empty, data —
 * resolved in one place.
 *
 * Centralising the ladder is the point. A failed load rendered as an empty state
 * is the most misleading thing a dashboard can do: "nothing needs attention" and
 * "we couldn't ask" look identical and mean opposite things. Owning the branches
 * here means no contributed widget can collapse them by accident.
 */
export function WidgetCard({
    title,
    description,
    action,
    footer,
    isPending = false,
    isError = false,
    isEmpty = false,
    emptyMessage,
    skeletonRows = 4,
    children
}: WidgetCardProps) {
    const intl = useIntl();
    const hasData = !isPending && !isError;

    return (
        <Card className="h-full shadow-none">
            <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold tracking-[-0.005em]">
                            {title}
                        </h3>
                        {description ? (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {description}
                            </p>
                        ) : null}
                    </div>
                    {/* Suppressed until there is data behind it — a "156 over a
                        year" chip beside a skeleton asserts a number the widget
                        has not actually loaded. */}
                    {action && hasData ? action : null}
                </div>

                {isPending ? (
                    // `role="status"` + an `sr-only` label, per the design
                    // system's `Skeleton` contract: bare placeholder bars are
                    // invisible to assistive tech, so the transition into
                    // loading was silent on a page that puts nine widgets into
                    // it at once. Named by title so nine simultaneous
                    // announcements say which card each one is.
                    <div
                        role="status"
                        className="flex flex-col gap-2.5"
                        data-testid="widget-skeleton"
                    >
                        <span className="sr-only">
                            {intl.formatMessage(messages.loading, { title })}
                        </span>
                        {Array.from({ length: skeletonRows }, (_, index) => (
                            <Skeleton key={index} className="h-4 w-full" />
                        ))}
                    </div>
                ) : isError ? (
                    <p
                        role="alert"
                        className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-4 text-sm text-destructive"
                    >
                        {intl.formatMessage(messages.error)}
                    </p>
                ) : isEmpty ? (
                    // The error branch announces and this one did not, so the
                    // ladder told a screen-reader user about failure and
                    // stayed silent about success-with-no-data — the exact
                    // pair the whole design exists to tell apart. Polite
                    // rather than assertive: nothing is wrong.
                    <p
                        role="status"
                        className="py-4 text-sm text-muted-foreground"
                    >
                        {emptyMessage ?? intl.formatMessage(messages.empty)}
                    </p>
                ) : (
                    children
                )}

                {footer && hasData && !isEmpty ? (
                    <p className="mt-auto pt-1 text-xs text-muted-foreground">
                        {footer}
                    </p>
                ) : null}
            </CardContent>
        </Card>
    );
}
