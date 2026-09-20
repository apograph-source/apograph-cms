import { defineMessages, useIntl } from 'react-intl';
import type { RecordsColumnCellContext } from '@orthacms/content-admin';
import type { LocaleSummariesData } from '../../api/useLocaleSummaries';
import { LocaleBadge } from './LocaleBadge';

const messages = defineMessages({
    loading: { id: 'i18n.column.loading', defaultMessage: '…' },
    loadingLabel: {
        id: 'i18n.column.loadingLabel',
        defaultMessage: 'Loading locales…'
    },
    failed: { id: 'i18n.column.failed', defaultMessage: 'Unavailable' },
    failedLabel: {
        id: 'i18n.column.failedLabel',
        defaultMessage: 'This record’s locales couldn’t be loaded'
    }
});

/**
 * The records table's **Locales** cell: one status-tinted badge per live
 * locale of the row's translation group, each linking to that locale's
 * editor. Data arrives batched per page via the column item's `useRowsData`
 * ({@link useLocaleSummaries}) — never a request per row.
 *
 * Three outcomes, three renderings. "Loading", "we couldn't ask" and "no other
 * locales" used to be a lone ellipsis, an empty cell and an empty cell — two of
 * them indistinguishable, and the ellipsis inaudible. Each now carries text a
 * screen reader can read.
 */
export function LocalesColumnCell({
    entry,
    data,
    typePath
}: RecordsColumnCellContext) {
    const intl = useIntl();
    const summaries = data as LocaleSummariesData | undefined;
    if (!entry.localeGroupId) return null;
    if (!summaries || summaries.isPending) {
        return (
            <span
                role="status"
                className="text-sm text-muted-foreground"
                aria-label={intl.formatMessage(messages.loadingLabel)}
            >
                <span aria-hidden>{intl.formatMessage(messages.loading)}</span>
            </span>
        );
    }
    if (summaries.isError) {
        return (
            <span
                className="text-xs text-muted-foreground"
                title={intl.formatMessage(messages.failedLabel)}
            >
                {intl.formatMessage(messages.failed)}
            </span>
        );
    }
    const members = summaries.groups[entry.localeGroupId] ?? [];
    return (
        <span className="flex flex-wrap items-center gap-1">
            {members.map((member) => (
                <LocaleBadge
                    key={member.locale}
                    item={member}
                    typePath={typePath}
                />
            ))}
        </span>
    );
}
