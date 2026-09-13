import { defineMessages, useIntl } from 'react-intl';
import { cn } from '@apograph/design-system';

const messages = defineMessages({
    days: {
        id: 'protection.queue.age.days',
        defaultMessage: '{days, plural, one {# day} other {# days}} waiting'
    },
    hours: {
        id: 'protection.queue.age.hours',
        defaultMessage: '{hours, plural, one {# hour} other {# hours}} waiting'
    },
    fresh: { id: 'protection.queue.age.fresh', defaultMessage: 'Just now' },
    overdue: { id: 'protection.queue.age.overdue', defaultMessage: 'overdue' }
});

/** Whole days between `iso` and `now`, floored; clock skew reads as 0. */
export function ageInDays(iso: string, now = Date.now()): number {
    const started = Date.parse(iso);
    if (Number.isNaN(started)) return 0;
    return Math.max(0, Math.floor((now - started) / 86_400_000));
}

/** Whole hours, for the under-a-day case. */
function ageInHours(iso: string, now = Date.now()): number {
    const started = Date.parse(iso);
    if (Number.isNaN(started)) return 0;
    return Math.max(0, Math.floor((now - started) / 3_600_000));
}

/**
 * How long an ask has been waiting.
 *
 * **The warning tone is never the only signal.** A request past
 * `overdueAfterDays` is coloured *and* carries the word "overdue" in
 * its text, so the fact survives a greyscale screen, a colour-blind reader and
 * a screen reader alike. It is the rule a queue gets wrong most easily, because
 * "this one is old" feels like something red says by itself.
 *
 * The exact moment rides `<time datetime>` rather than the rounded phrase, so
 * nothing is lost to the rounding.
 */
export function RequestAge({
    createdAt,
    overdueAfterDays
}: {
    createdAt: string;
    /**
     * After how long an ask reads as overdue — **the server's threshold, sent
     * with the queue**, not a constant restated here.
     *
     * It used to be a `3` in this file and a `3` in
     * `protection-insights.query.ts`, which is two numbers that must agree and
     * nothing making them: changing the server's to 7 left this queue calling
     * five-day asks overdue while the Insights card said "waiting longer than 7
     * days", with every suite green. The card already takes its threshold off
     * the wire for exactly that reason; this is the same rule applied to the
     * page the card links to.
     */
    overdueAfterDays: number;
}) {
    const intl = useIntl();
    const days = ageInDays(createdAt);
    const hours = ageInHours(createdAt);
    const overdue = days >= overdueAfterDays;

    const waited = days
        ? intl.formatMessage(messages.days, { days })
        : hours
          ? intl.formatMessage(messages.hours, { hours })
          : intl.formatMessage(messages.fresh);

    return (
        <time
            dateTime={createdAt}
            className={cn(
                'text-sm',
                overdue
                    ? 'text-warning-soft-foreground'
                    : 'text-muted-foreground'
            )}
        >
            {overdue
                ? `${waited} — ${intl.formatMessage(messages.overdue)}`
                : waited}
        </time>
    );
}
