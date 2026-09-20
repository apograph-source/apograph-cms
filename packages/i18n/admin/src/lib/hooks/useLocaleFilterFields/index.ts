import { defineMessages } from 'react-intl';
import {
    FIELD_TYPE,
    OP,
    type FilterEnumValue,
    type FilterField
} from '@orthacms/query-builder-admin';
import type { ContentTypeDetail } from '@orthacms/content-admin';
import { LOCALE_FILTER_FIELD } from '../../constants';
import { useLocales } from '../../api/useLocales';

const messages = defineMessages({
    hasLocale: {
        id: 'i18n.filter.hasLocale',
        defaultMessage: 'Has locale'
    },
    missingLocale: {
        id: 'i18n.filter.missingLocale',
        defaultMessage: 'Missing locale'
    },
    localeCount: {
        id: 'i18n.filter.localeCount',
        defaultMessage: 'Locale count'
    }
});

/**
 * The locale filter fields contributed to the records query-builder drawer
 * (via `RECORDS_FILTER_FIELDS_SLOT`): **Has locale** / **Missing locale**
 * (enums of the configured slugs) and **Locale count** (a number) — resolved
 * server-side by the i18n plugin's virtual-field subqueries, so "give me
 * every record missing its German translation" or "fewer than 3 locales" is
 * one saved filter. Empty for a non-i18n type (and until the locales load).
 */
export function useLocaleFilterFields(
    schema: ContentTypeDetail
): FilterField[] {
    const { locales } = useLocales();
    if (!schema.i18n || locales.length === 0) return [];
    const enumValues: FilterEnumValue[] = locales.map((locale) => ({
        value: locale.slug,
        label: {
            id: `i18n.filter.locale.${locale.slug}`,
            defaultMessage: locale.name
        }
    }));
    return [
        {
            id: LOCALE_FILTER_FIELD.HasLocale,
            label: messages.hasLocale,
            type: FIELD_TYPE.Enum,
            // These three are **virtual** fields answered by a subquery over
            // the translation group, not columns — so their operator set is
            // the subquery's, not the type's. Offering the rest built rules
            // the API rejects (`400 Operator "ne" is not supported on
            // "hasLocale"`), which reaches the user as "couldn't load this
            // collection" over a rule the drawer itself proposed.
            //
            // Negation is deliberately absent rather than merely unsupported:
            // `hasLocale ne "de"` negates *inside* the EXISTS, so it asks
            // "does the group hold some locale other than German" — which a
            // fully-translated record satisfies. `missingLocale` is the field
            // that expresses absence, and it is right there beside this one.
            operators: [OP.Equals, OP.IsOneOf],
            enumValues
        },
        {
            id: LOCALE_FILTER_FIELD.MissingLocale,
            label: messages.missingLocale,
            type: FIELD_TYPE.Enum,
            // `in` here means "missing **all** of these" (a `notExists` over
            // the union), which is the server's shape.
            operators: [OP.Equals, OP.IsOneOf],
            enumValues
        },
        {
            id: LOCALE_FILTER_FIELD.LocaleCount,
            label: messages.localeCount,
            // A count comparison, but not `between` and not null-ness: the
            // count subquery always returns a number, so "is empty" has no
            // meaning and the server refuses it.
            operators: [OP.Equals, OP.NotEquals, OP.Gt, OP.Gte, OP.Lt, OP.Lte],
            type: FIELD_TYPE.Number
        }
    ];
}
