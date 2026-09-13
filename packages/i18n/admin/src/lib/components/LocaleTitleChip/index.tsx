import { defineMessages, useIntl } from 'react-intl';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@apograph/design-system';
import type { EntrySlotContext } from '@apograph/content-admin';
import { LOCALE_PARAM } from '../../constants';
import {
    localeAttrs,
    localeName,
    resolveActiveLocale
} from '../../domain/localePolicy';
import { useLocales } from '../../api/useLocales';

const messages = defineMessages({
    label: {
        id: 'i18n.title.currentLocale',
        defaultMessage: 'Current locale: {name}'
    }
});

/**
 * A static chip beside the entry-editor title showing which **locale** the open
 * record is in — the uppercased code and display name (e.g. `EN · English`).
 * Contributed into the content library's title-row slot; renders nothing for a
 * non-i18n type or before the locales have loaded. The current locale is
 * resolved the same way the {@link LocaleWidget} does: the saved entry's locale,
 * else the `?locale=` param, else the default.
 *
 * The gate is the **schema**, not the locale list: on a saved localized record
 * the row's own `locale` is enough to name it, so a failed locale read costs
 * the display name, not the whole chip — the one place the open record's
 * language is stated should not disappear because a config read failed.
 */
export function LocaleTitleChip({ schema, entry }: EntrySlotContext) {
    const intl = useIntl();
    const [searchParams] = useSearchParams();
    const { locales, defaultLocale } = useLocales();

    if (!schema.i18n) return null;

    const slug = resolveActiveLocale({
        entryLocale: entry?.locale,
        urlLocale: searchParams.get(LOCALE_PARAM) ?? undefined,
        defaultSlug: defaultLocale?.slug
    });
    if (!slug) return null;

    const name = localeName(locales, slug);

    return (
        <Badge
            variant="outline"
            aria-label={intl.formatMessage(messages.label, {
                name: name ?? slug
            })}
        >
            {slug.toUpperCase()}
            {/* The display name is written *in* that locale, so it declares
                its own language and direction (`locale` is a BCP-47 tag by
                contract). The uppercased code above is a machine token and
                stays in the page's language.

                The separator sits **outside** the marked span, in the chip's
                own direction. Inside it, a right-to-left name dragged the ` · `
                to the wrong side of itself — the separator belongs to the chip's
                layout, not to the name (`ORT-86`). */}
            {name ? (
                <>
                    {' · '}
                    <span {...localeAttrs(locales, slug)}>{name}</span>
                </>
            ) : null}
        </Badge>
    );
}
