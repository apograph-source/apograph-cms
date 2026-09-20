import { defineMessages, useIntl } from 'react-intl';
import { Info } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@ortha/design-system';
import {
    EntrySidebarRow,
    type EntrySlotContext
} from '@ortha/content-admin';
import { LOCALE_GROUP_PARAM } from '../../constants';

const messages = defineMessages({
    groupIdLabel: {
        id: 'i18n.widget.groupIdLabel',
        defaultMessage: 'Translation group'
    },
    groupIdHelp: {
        id: 'i18n.widget.groupIdHelp',
        defaultMessage:
            'Every locale of this record shares one translation-group id — it’s how the CMS links a record’s translations together. Assigned automatically when the first locale is saved.'
    },
    groupIdHelpLabel: {
        id: 'i18n.widget.groupIdHelpLabel',
        defaultMessage: 'What is the translation group?'
    },
    groupIdPending: {
        id: 'i18n.widget.groupIdPending',
        defaultMessage: 'Assigned when this record is saved.'
    }
});

/**
 * The **translation group id** as one row of the entry editor's Details block,
 * contributed through `ENTRY_DETAILS_ROW_SLOT`. It sits beneath the entry id
 * because that is what it is — the other identifier of the record in front of
 * you, shared by every locale of it — and a read-only line does not earn a
 * block of the rail to itself.
 *
 * Renders an `EntrySidebarRow` (a `<dt>`/`<dd>` pair) and nothing else: the
 * slot's rows render inside Details' own `<dl>`, so a `<section>` here would be
 * invalid markup. A fresh create has no group yet and says so.
 *
 * The group id comes from the saved entry, else the editor's slot `params` —
 * the i18n entry-params contribution declares `localeGroupId` as a create-body
 * key, so a translation draft carries it before anything is saved.
 */
export function LocaleDetailsRow({ schema, entry, params }: EntrySlotContext) {
    const intl = useIntl();

    // Also gated by the slot item's `appliesTo`; kept so the component is
    // correct wherever it is mounted.
    if (!schema.i18n) return null;

    const groupId = entry?.localeGroupId ?? params[LOCALE_GROUP_PARAM];

    return (
        <EntrySidebarRow
            label={intl.formatMessage(messages.groupIdLabel)}
            stacked
        >
            <div className="flex items-start gap-1.5">
                {groupId ? (
                    <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
                        {groupId}
                    </span>
                ) : (
                    <span className="text-xs italic text-muted-foreground">
                        {intl.formatMessage(messages.groupIdPending)}
                    </span>
                )}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            aria-label={intl.formatMessage(
                                messages.groupIdHelpLabel
                            )}
                            className="inline-flex shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <Info aria-hidden className="size-3.5" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[16rem]">
                        {intl.formatMessage(messages.groupIdHelp)}
                    </TooltipContent>
                </Tooltip>
            </div>
        </EntrySidebarRow>
    );
}
