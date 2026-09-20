import { defineMessages, useIntl } from 'react-intl';
import type { RecordsColumnCellContext } from '@orthacms/content-admin';
import type { AlarmFinding, AlarmSeverity } from '../../../types/alarm';
import { severityLook } from '../../severityLook';

const messages = defineMessages({
    none: { id: 'alarms.column.none', defaultMessage: 'Nothing flagged' },
    loading: { id: 'alarms.column.loading', defaultMessage: 'Checking…' },
    failed: { id: 'alarms.column.failed', defaultMessage: 'Not checked' },
    summary: {
        id: 'alarms.column.summary',
        defaultMessage:
            '{severities}. {count, plural, one {# check flagged} other {# checks flagged}}: {titles}'
    }
});

/** Severity order, most severe first. */
const ORDER: readonly AlarmSeverity[] = ['error', 'warn', 'info'];

/**
 * The records table's Checks cell: one glyph per severity present, plus a count.
 *
 * Deliberately not a badge per finding — a row is one line and a busy record
 * would push the rest of the table off screen.
 *
 * **Glyphs rather than coloured dots.** Three dots would put the whole meaning
 * of the cell into hue, and the two hues that matter most here are ΔE 0.9 apart
 * under deuteranopia (see `severityLook`) — so an error and a warning would be
 * the same dot to a large minority of readers. Distinct shapes carry it
 * instead, with colour agreeing rather than deciding, the count as text, and
 * the whole cell summarised for a screen reader.
 */
export function AlarmsColumnCell({ entry, data }: RecordsColumnCellContext) {
    const intl = useIntl();
    // `useRowsData` returns the whole query result, so the cell can tell three
    // outcomes apart. "Still loading", "we could not ask" and "nothing flagged"
    // would otherwise all render as an empty cell — and only the last of them
    // is reassuring.
    const result = data as
        | {
              data?: Record<string, AlarmFinding[]>;
              isPending: boolean;
              isError: boolean;
          }
        | undefined;

    if (result?.isPending) {
        return (
            <span className="text-muted-foreground">
                {intl.formatMessage(messages.loading)}
            </span>
        );
    }

    if (result?.isError) {
        return (
            <span className="text-muted-foreground">
                {intl.formatMessage(messages.failed)}
            </span>
        );
    }

    const findings = (result?.data?.[entry.id] ?? []).filter(
        (finding) => finding.state === 'open'
    );

    if (findings.length === 0) {
        return (
            <span className="text-muted-foreground">
                {intl.formatMessage(messages.none)}
            </span>
        );
    }

    const present = ORDER.filter((severity) =>
        findings.some((finding) => finding.severity === severity)
    );
    const label = intl.formatMessage(messages.summary, {
        // The severities in words. The glyphs beside them are `aria-hidden`
        // and their colours are decoration, so without this the cell says how
        // many checks are flagged and never how badly — severity would be
        // carried by shape and hue alone, which is the one thing this
        // invariant forbids.
        severities: present
            .map((severity) => intl.formatMessage(severityLook(severity).label))
            .join(', '),
        count: findings.length,
        titles: findings.map((finding) => finding.title).join(', ')
    });

    return (
        <span className="inline-flex items-center gap-1.5" title={label}>
            <span
                className="inline-flex items-center gap-0.5"
                aria-hidden="true"
            >
                {present.map((severity) => {
                    const { Icon, ink } = severityLook(severity);
                    return (
                        <Icon key={severity} className={`size-3.5 ${ink}`} />
                    );
                })}
            </span>
            <span className="tabular-nums">{findings.length}</span>
            <span className="sr-only">{label}</span>
        </span>
    );
}
