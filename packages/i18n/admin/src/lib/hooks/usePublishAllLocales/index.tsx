import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Languages } from 'lucide-react';
import { useHasPermission } from '@orthacms/identity-admin';
import {
    BulkPublishDialog,
    type EntryMenuEntry,
    type EntrySlotContext
} from '@orthacms/content-admin';
import { CONTENT_PUBLISH } from '../../constants';
import { localeName } from '../../domain/localePolicy';
import { useEntryLocales } from '../../api/useEntryLocales';
import { useLocales } from '../../api/useLocales';

const messages = defineMessages({
    action: {
        id: 'i18n.menu.publishAllLocales',
        defaultMessage: 'Publish all locales'
    },
    title: {
        id: 'i18n.menu.publishAllTitle',
        defaultMessage:
            'Publish {count, plural, one {# locale} other {# locales}} of this record?'
    },
    body: {
        id: 'i18n.menu.publishAllBody',
        defaultMessage:
            'Every locale of this record is checked below. Only the ones that pass will publish — the others stay as they are.'
    }
});

/**
 * The **Publish all locales** item for the entry editor's ⋯ menu.
 *
 * A record's locale siblings are entries of the *same* content type, so this
 * needs no endpoint of its own: it hands their ids to content's existing bulk
 * publish pre-flight (`BulkPublishDialog`), whose dry run is already the answer
 * to "which of these can actually publish". The rows are named by locale rather
 * than by title, since every sibling carries the same record title.
 *
 * Hidden unless the type is localized **and** publishable, the record is saved,
 * the user may publish, and there is more than one locale to act on.
 */
export function usePublishAllLocales(
    context: EntrySlotContext
): EntryMenuEntry | null {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    const canPublish = useHasPermission(CONTENT_PUBLISH);
    const { locales } = useLocales();

    const { schema, entry, isCreate } = context;
    const applies =
        !!schema.i18n && !!schema.publishable && !isCreate && !!entry;
    // Gated on `applies`, so a non-i18n or unsaved record issues no request.
    const entryLocales = useEntryLocales(schema.name, entry?.id, applies);

    const siblings = (entryLocales.data?.items ?? []).filter(
        (item) => item.entry
    );
    const ids = siblings
        .map((item) => item.entry?.id)
        .filter((id): id is string => !!id);

    if (!applies || !canPublish || ids.length < 2) return null;

    const nameFor = (id: string) => {
        const slug = siblings.find((item) => item.entry?.id === id)?.locale;
        return slug ? (localeName(locales, slug) ?? slug) : undefined;
    };

    return {
        label: intl.formatMessage(messages.action),
        icon: Languages,
        onSelect: () => setOpen(true),
        overlay: (
            <BulkPublishDialog
                open={open}
                onOpenChange={setOpen}
                typeName={schema.name}
                ids={ids}
                labels={{
                    title: intl.formatMessage(messages.title, {
                        count: ids.length
                    }),
                    body: intl.formatMessage(messages.body)
                }}
                labelFor={nameFor}
                onPublished={() => void entryLocales.refetch()}
            />
        )
    };
}
