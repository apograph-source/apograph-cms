import { defineMessages, useIntl } from 'react-intl';
import {
    Badge,
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@ortha/design-system';
import {
    entryStatusView,
    ENTRY_STATUS_VIEW,
    ENTRY_STATUS_VIEW_VARIANT,
    type EntryStatusView
} from '../../../domain/entryStatusView';
import type { EntryRecord } from '../../../domain/types/contentType';

const messages = defineMessages({
    new: { id: 'content.status.new', defaultMessage: 'Not saved yet' },
    draft: { id: 'content.status.draft', defaultMessage: 'Draft' },
    modified: { id: 'content.status.modified', defaultMessage: 'Modified' },
    published: { id: 'content.status.published', defaultMessage: 'Published' },
    /** Only the ambiguous state needs explaining; the other three read plainly. */
    modifiedHint: {
        id: 'content.status.modifiedHint',
        defaultMessage:
            'Published, with saved changes that aren’t live yet. Publish to make them live.'
    }
});

/**
 * The localized label of each publish state.
 *
 * **Exported**, because the state also has to reach users who never see the
 * badge: a locale badge in the i18n plugin's column shows a slug and puts the
 * state in the link's accessible name instead. Interpolating the raw
 * `EntryStatusView` there printed a lowercase English identifier
 * ("…(modified)") in every UI language. One state, one wording, wherever it is
 * said.
 */
export const ENTRY_STATUS_VIEW_LABEL: Record<
    EntryStatusView,
    (typeof messages)[keyof typeof messages]
> = {
    [ENTRY_STATUS_VIEW.New]: messages.new,
    [ENTRY_STATUS_VIEW.Draft]: messages.draft,
    [ENTRY_STATUS_VIEW.Modified]: messages.modified,
    [ENTRY_STATUS_VIEW.Published]: messages.published
};

const LABEL = ENTRY_STATUS_VIEW_LABEL;

/**
 * One record's publish state as a badge — the single rendering of
 * {@link entryStatusView}, shared by the records table's Status column and the
 * editor's Details card so the same record can't read two different ways in the
 * two places a writer looks at it.
 *
 * The label is **localized**; the table used to print the raw wire value
 * (`draft` / `published`, lowercase and untranslated), which stopped being an
 * option once a third state existed that no column value spells.
 */
export function EntryStatusBadge({
    entry,
    isCreate = false,
    explainModified = true
}: {
    entry?: Pick<EntryRecord, 'status' | 'publishedAt'>;
    /**
     * Force the "not saved yet" state. A create form may carry values seeded
     * from a published sibling (the translation prefill), which would otherwise
     * read as that sibling's state for a row that doesn't exist yet.
     */
    isCreate?: boolean;
    /**
     * Whether **Modified** may carry its tooltip. Set `false` when the badge is
     * rendered **inside another control** — a menu item, a link, a row-wide
     * button.
     *
     * The tooltip's trigger is a real `<button>`, and a control inside a
     * control is a WCAG failure (`nested-interactive`): the inner one is
     * unreachable, and what the outer one does on activation stops being
     * predictable. The badge then states the four words on its own, which is
     * what such a row needs; the sentence explaining **Modified** stays where
     * the reader acts on that record — its own editor and the records table.
     */
    explainModified?: boolean;
}) {
    const intl = useIntl();
    const view = isCreate ? ENTRY_STATUS_VIEW.New : entryStatusView(entry);
    const badge = (
        <Badge variant={ENTRY_STATUS_VIEW_VARIANT[view]}>
            {intl.formatMessage(LABEL[view])}
        </Badge>
    );

    if (view !== ENTRY_STATUS_VIEW.Modified || !explainModified) return badge;

    // "Modified" is the repo's most confusing status and the one sentence that
    // disambiguates it used to live in a native `title` on the badge: mouse-only,
    // not dismissible, not hoverable (1.4.13), and announced to nobody — the
    // badge said "Modified" and stopped there (`ORT-90`).
    //
    // The trigger is a real `<button>` because Radix needs a focusable element to
    // open on focus, and because a keyboard user has to be able to *reach* the
    // explanation at all. It is inert as a control — there is nothing to activate
    // — so it only ever opens the tooltip.
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={(event) => event.preventDefault()}
                    className="inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {badge}
                </button>
            </TooltipTrigger>
            <TooltipContent>
                {intl.formatMessage(messages.modifiedHint)}
            </TooltipContent>
        </Tooltip>
    );
}
