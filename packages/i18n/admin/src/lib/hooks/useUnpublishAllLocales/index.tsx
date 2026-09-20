import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Undo2 } from 'lucide-react';
import { ConfirmDialog, toast } from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import {
    ENTRY_STATUS,
    useBulkEntryActions,
    type EntryMenuEntry,
    type EntrySlotContext
} from '@orthacms/content-admin';
import { CONTENT_PUBLISH } from '../../constants';
import { localeName } from '../../domain/localePolicy';
import { useEntryLocales } from '../../api/useEntryLocales';
import { useLocales } from '../../api/useLocales';

const messages = defineMessages({
    action: {
        id: 'i18n.menu.unpublishAllLocales',
        defaultMessage: 'Unpublish all locales'
    },
    title: {
        id: 'i18n.menu.unpublishAllTitle',
        defaultMessage:
            'Unpublish {count, plural, one {# live locale} other {# live locales}}?'
    },
    body: {
        id: 'i18n.menu.unpublishAllBody',
        defaultMessage:
            'This takes {locales} offline. The content is kept as a draft and can be published again.'
    },
    confirm: {
        id: 'i18n.menu.unpublishAllConfirm',
        defaultMessage: 'Unpublish'
    },
    done: {
        id: 'i18n.menu.unpublishAllDone',
        defaultMessage:
            '{count, plural, one {# locale unpublished} other {# locales unpublished}}.'
    },
    failed: {
        id: 'i18n.menu.unpublishAllFailed',
        defaultMessage: 'Couldn’t unpublish. Please try again.'
    }
});

/**
 * The **Unpublish all locales** item for the entry editor's ⋯ menu.
 *
 * Unlike publishing, unpublishing has no pre-flight to run — the server accepts
 * it unconditionally — so this is a plain confirmation naming the locales that
 * are currently live, then content's bulk unpublish over their ids (they are
 * entries of the same type, so no endpoint of its own is needed).
 *
 * Hidden unless the type is localized **and** publishable, the record is saved,
 * the user may publish, and at least one locale is actually live.
 */
export function useUnpublishAllLocales(
    context: EntrySlotContext
): EntryMenuEntry | null {
    const intl = useIntl();
    const [open, setOpen] = useState(false);
    const canPublish = useHasPermission(CONTENT_PUBLISH);
    const { locales } = useLocales();

    const { schema, entry, isCreate } = context;
    const applies =
        !!schema.i18n && !!schema.publishable && !isCreate && !!entry;
    const entryLocales = useEntryLocales(schema.name, entry?.id, applies);
    const { unpublish } = useBulkEntryActions(schema.name);

    // Only what is actually live can be taken offline.
    const live = (entryLocales.data?.items ?? []).filter(
        (item) => item.entry?.status === ENTRY_STATUS.Published
    );
    const ids = live
        .map((item) => item.entry?.id)
        .filter((id): id is string => !!id);

    if (!applies || !canPublish || ids.length === 0) return null;

    const names = live
        .map((item) => localeName(locales, item.locale) ?? item.locale)
        .join(', ');

    return {
        label: intl.formatMessage(messages.action),
        icon: Undo2,
        disabled: unpublish.isPending,
        onSelect: () => setOpen(true),
        overlay: (
            <ConfirmDialog
                open={open}
                onOpenChange={setOpen}
                title={intl.formatMessage(messages.title, {
                    count: ids.length
                })}
                description={intl.formatMessage(messages.body, {
                    locales: names
                })}
                confirmLabel={intl.formatMessage(messages.confirm)}
                confirmVariant="destructive"
                busy={unpublish.isPending}
                onConfirm={() => {
                    unpublish
                        .mutateAsync(ids)
                        .then(() => {
                            toast.success(
                                intl.formatMessage(messages.done, {
                                    count: ids.length
                                })
                            );
                            void entryLocales.refetch();
                        })
                        .catch(() =>
                            toast.error(intl.formatMessage(messages.failed))
                        )
                        .finally(() => setOpen(false));
                }}
            />
        )
    };
}
