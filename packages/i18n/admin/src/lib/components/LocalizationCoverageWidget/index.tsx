import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Check, Languages } from 'lucide-react';
import {
    BarRows,
    WidgetCard,
    WidgetChip,
    toneBackground,
    type BarRowSpec
} from '@orthacms/insights-admin';
import { useLocalizationCoverage } from '../../api/useLocalizationCoverage';
import { CoverageFigure } from './CoverageFigure';
import { CoverageModeToggle, type CoverageMode } from './CoverageModeToggle';

/** Intl descriptors for the coverage widget, co-located here. */
const messages = defineMessages({
    title: {
        id: 'i18n.insights.coverage.title',
        defaultMessage: 'Translation coverage'
    },
    description: {
        id: 'i18n.insights.coverage.description',
        defaultMessage: 'How far each language has been taken'
    },
    descriptionByType: {
        id: 'i18n.insights.coverage.descriptionByType',
        defaultMessage: 'Where the outstanding translation work sits'
    },
    complete: {
        id: 'i18n.insights.coverage.complete',
        defaultMessage: 'Fully translated'
    },
    pending: {
        id: 'i18n.insights.coverage.pending',
        defaultMessage: '{count, number} to translate'
    },
    localized: {
        id: 'i18n.insights.coverage.localized',
        defaultMessage: 'Localized'
    },
    localizedHint: {
        id: 'i18n.insights.coverage.localizedHint',
        defaultMessage: 'in every language'
    },
    notLocalized: {
        id: 'i18n.insights.coverage.notLocalized',
        defaultMessage: 'Not localized'
    },
    notLocalizedHint: {
        id: 'i18n.insights.coverage.notLocalizedHint',
        defaultMessage: 'no translations started'
    },
    requires: {
        id: 'i18n.insights.coverage.requires',
        defaultMessage: 'Needs translation'
    },
    requiresHint: {
        id: 'i18n.insights.coverage.requiresHint',
        defaultMessage: 'missing at least one'
    },
    translatedLegend: {
        id: 'i18n.insights.coverage.translatedLegend',
        defaultMessage: 'Translated'
    },
    missingLegend: {
        id: 'i18n.insights.coverage.missingLegend',
        defaultMessage: 'Missing'
    },
    doneLegend: {
        id: 'i18n.insights.coverage.doneLegend',
        defaultMessage: 'Fully localized'
    },
    outstandingLegend: {
        id: 'i18n.insights.coverage.outstandingLegend',
        defaultMessage: 'Needs translation'
    },
    defaultLocale: {
        id: 'i18n.insights.coverage.defaultLocale',
        defaultMessage: '{name} (default)'
    },
    empty: {
        id: 'i18n.insights.coverage.empty',
        defaultMessage: 'No localized content in this workspace yet.'
    },
    // Each segment label is the bar's own text alternative, so it is a whole
    // sentence and it agrees in number — these are read aloud, not hovered.
    tipTranslated: {
        id: 'i18n.insights.coverage.tipTranslated',
        defaultMessage:
            '{locale} — {count, number} {count, plural, one {record} other {records}} translated'
    },
    tipMissing: {
        id: 'i18n.insights.coverage.tipMissing',
        defaultMessage:
            '{locale} — {count, number} {count, plural, one {record} other {records}} missing'
    },
    tipTypeDone: {
        id: 'i18n.insights.coverage.tipTypeDone',
        defaultMessage:
            '{type} — {count, number} {count, plural, one {record} other {records}} in every language'
    },
    tipTypeOutstanding: {
        id: 'i18n.insights.coverage.tipTypeOutstanding',
        defaultMessage:
            '{type} — {count, number} {count, plural, one {record} other {records}} still to translate'
    },
    footer: {
        id: 'i18n.insights.coverage.footer',
        defaultMessage:
            'Across {records, number} localized {records, plural, one {record} other {records}} in {types, number} {types, plural, one {content type} other {content types}}.'
    }
});

/**
 * How much of the workspace's localized content has been translated, broken
 * down **by language or by content type**.
 *
 * Two questions off one payload, which is why they are a view swap rather than
 * two cards: "which language is behind?" and "which content type is the work
 * in?" are asked by the same person a moment apart, and splitting them across
 * cards would put the shared headline figures on one of them arbitrarily. The
 * three figures are workspace-wide and stay put when the axis changes.
 *
 * **The unit is a record, not a row.** A localized entry is one row per
 * language sharing a translation group, so a bar counting rows would report a
 * workspace of 40 stories in 3 languages as 120 things and make every share
 * here meaningless. Everything below counts groups.
 *
 * The three figures are deliberately **not** a partition. "Not localized" is a
 * subset of "needs translation" — a record in one of four languages both has no
 * translations and needs some — because those are two different jobs: starting
 * a translation and finishing one. Rendering them as slices of a pie would be
 * the wrong chart for the same reason it would be the wrong sentence.
 */
export function LocalizationCoverageWidget() {
    const intl = useIntl();
    const [mode, setMode] = useState<CoverageMode>('locale');
    const { data, isPending, isError } = useLocalizationCoverage();

    const records = data?.records ?? 0;
    const locales = data?.locales ?? [];
    const types = data?.types ?? [];
    const requires = data?.requiresLocalization ?? 0;

    const localeRows: BarRowSpec[] = locales.map((locale) => {
        const name = locale.isDefault
            ? intl.formatMessage(messages.defaultLocale, { name: locale.name })
            : locale.name;
        return {
            id: locale.locale,
            label: name,
            segments: [
                {
                    id: 'translated',
                    value: locale.translated,
                    tone: 'series-1',
                    label: intl.formatMessage(messages.tipTranslated, {
                        locale: name,
                        count: locale.translated
                    })
                },
                {
                    id: 'missing',
                    value: locale.missing,
                    tone: 'series-2',
                    label: intl.formatMessage(messages.tipMissing, {
                        locale: name,
                        count: locale.missing
                    })
                }
            ],
            readout: intl.formatNumber(locale.translated),
            secondary: share(locale.translated, records)
        };
    });

    const typeRows: BarRowSpec[] = types.map((type) => ({
        id: type.name,
        label: type.label,
        segments: [
            {
                id: 'localized',
                value: type.localized,
                tone: 'series-1',
                label: intl.formatMessage(messages.tipTypeDone, {
                    type: type.label,
                    count: type.localized
                })
            },
            {
                id: 'outstanding',
                value: type.requiresLocalization,
                tone: 'series-2',
                label: intl.formatMessage(messages.tipTypeOutstanding, {
                    type: type.label,
                    count: type.requiresLocalization
                })
            }
        ],
        readout: intl.formatNumber(type.localized),
        secondary: share(type.localized, type.records)
    }));

    // Nothing localized at all: the card has no coverage to report, which is
    // not the same as having reported full coverage.
    const isEmpty = records === 0;
    const byLocale = mode === 'locale';
    // Every bar is scaled against one denominator so lengths compare. By locale
    // that is the workspace's record count (each language could reach all of
    // them); by type it is the biggest type, so a row's length reads as how much
    // content that type holds and its blue portion as how much is done.
    const max = byLocale
        ? records
        : Math.max(...types.map((type) => type.records), 0);

    return (
        <WidgetCard
            title={intl.formatMessage(messages.title)}
            // The subtitle moves with the axis too — left on the locale copy it
            // would describe a chart that is no longer on screen.
            description={intl.formatMessage(
                byLocale ? messages.description : messages.descriptionByType
            )}
            // No chip on an empty workspace. `requires === 0` is true both when
            // every record is translated and when there are no records at all,
            // and the second is not an achievement — a workspace that has never
            // been written to was handing itself a green "Fully translated".
            action={
                isEmpty ? undefined : requires === 0 ? (
                    <WidgetChip tone="ok" icon={Check}>
                        {intl.formatMessage(messages.complete)}
                    </WidgetChip>
                ) : (
                    <WidgetChip tone="warn" icon={Languages}>
                        {intl.formatMessage(messages.pending, {
                            count: requires
                        })}
                    </WidgetChip>
                )
            }
            footer={intl.formatMessage(messages.footer, {
                records,
                types: types.length
            })}
            isPending={isPending}
            isError={isError}
            isEmpty={isEmpty}
            // The shared empty copy says "for this period", and this widget
            // takes no range — an untranslated record is untranslated whenever
            // it was written.
            emptyMessage={intl.formatMessage(messages.empty)}
            skeletonRows={4}
        >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-6">
                <div className="grid grid-cols-3 gap-3 lg:grid-cols-1 lg:gap-4">
                    <CoverageFigure
                        value={data?.localized ?? 0}
                        label={intl.formatMessage(messages.localized)}
                        hint={intl.formatMessage(messages.localizedHint)}
                    />
                    <CoverageFigure
                        value={data?.notLocalized ?? 0}
                        label={intl.formatMessage(messages.notLocalized)}
                        hint={intl.formatMessage(messages.notLocalizedHint)}
                    />
                    <CoverageFigure
                        value={requires}
                        label={intl.formatMessage(messages.requires)}
                        hint={intl.formatMessage(messages.requiresHint)}
                    />
                </div>

                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                                <span
                                    className={`block size-2 rounded-[2px] ${toneBackground('series-1')}`}
                                />
                                {intl.formatMessage(
                                    byLocale
                                        ? messages.translatedLegend
                                        : messages.doneLegend
                                )}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <span
                                    className={`block size-2 rounded-[2px] ${toneBackground('series-2')}`}
                                />
                                {intl.formatMessage(
                                    byLocale
                                        ? messages.missingLegend
                                        : messages.outstandingLegend
                                )}
                            </span>
                        </div>
                        <CoverageModeToggle value={mode} onChange={setMode} />
                    </div>
                    <BarRows
                        rows={byLocale ? localeRows : typeRows}
                        max={max}
                    />
                </div>
            </div>
        </WidgetCard>
    );
}

/**
 * A count as a whole-percent share of its total, or nothing when there is none.
 *
 * `0%` and `100%` are **reserved for the real thing**. Plain rounding printed
 * "0%" beside a visible bar (3 of 609 translated) and "100%" beside a card
 * whose own chip said work remained (608 of 609) — the two readings a coverage
 * figure exists to distinguish, so a rounded near-miss is clamped to 1% / 99%
 * instead of claiming the boundary.
 *
 * `total <= 0` yields nothing rather than `NaN%` — the server sends counts and
 * never divides, so every division on this card happens here.
 */
function share(value: number, total: number): string | undefined {
    if (total <= 0) return undefined;
    if (value <= 0) return '0%';
    if (value >= total) return '100%';
    const rounded = Math.round((value / total) * 100);
    return `${Math.min(99, Math.max(1, rounded))}%`;
}
