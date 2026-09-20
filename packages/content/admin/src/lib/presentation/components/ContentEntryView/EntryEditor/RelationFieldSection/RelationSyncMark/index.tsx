import { defineMessages, useIntl } from 'react-intl';
import { Globe, Languages, Merge } from 'lucide-react';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@orthacms/design-system';
import type { RelationLocaleSync } from '../../../../../../domain/types/contentType';

const messages = defineMessages({
    sharedName: {
        id: 'content.relations.sync.sharedName',
        defaultMessage: 'Shared across locales'
    },
    sharedHint: {
        id: 'content.relations.sync.sharedHint',
        defaultMessage:
            'These links belong to the record, not to one language. Changing them here changes them in every locale of this record.'
    },
    mirroredName: {
        id: 'content.relations.sync.mirroredName',
        defaultMessage: 'Follows translations'
    },
    mirroredHint: {
        id: 'content.relations.sync.mirroredHint',
        defaultMessage:
            'This relation targets a localized collection. Pick a record here and every other locale links that record’s own translation. Only records in this locale can be picked, and a locale whose translation is missing stays unlinked.'
    },
    perLocaleName: {
        id: 'content.relations.sync.perLocaleName',
        defaultMessage: 'This locale only'
    },
    perLocaleHint: {
        id: 'content.relations.sync.perLocaleHint',
        defaultMessage:
            'These links belong to this locale alone. Other locales of this record keep their own, and nothing here changes them.'
    }
});

/**
 * Icon + copy per mode — one lookup, so the three can't drift apart.
 *
 * **The globe means "per locale" here because that is what it means
 * everywhere else.** `LocalizedFieldMark` marks a `localized` field — one whose
 * value differs per locale — with a globe, and `none` is that same idea for
 * links: each locale keeps its own. The globe used to sit on `shared`, which
 * reads as the opposite (globe = global = one for all), so a reader who had
 * learnt the glyph on the General tab was told the reverse on the Relations
 * one. Whichever way round it is argued, it cannot be both.
 *
 * `shared` takes `Merge` — every locale converging on one set of links, which
 * is exactly what editing it does. Not `Layers` or `Link2`: both are already
 * spoken for elsewhere in the admin (Workspaces' nav, and links themselves).
 */
const MARKS = {
    shared: {
        Icon: Merge,
        name: messages.sharedName,
        hint: messages.sharedHint
    },
    mirrored: {
        Icon: Languages,
        name: messages.mirroredName,
        hint: messages.mirroredHint
    },
    none: {
        Icon: Globe,
        name: messages.perLocaleName,
        hint: messages.perLocaleHint
    }
} as const;

/**
 * Marks how a relation behaves across the record's other languages — the one
 * thing about a relation on a localized type that a reader cannot infer from
 * the card.
 *
 * It labels the *field*, not each linked row: every link on the row is already
 * in the record's own locale (the picker offers nothing else), so repeating one
 * identical locale down every row would be noise. What isn't obvious is whether
 * assigning something here also assigns it in German — and, for a mirrored
 * relation, why the picker hides records the user knows exist.
 *
 * Renders nothing when the type has no locales: `localeSync` is absent there,
 * and every relation would report the same inert answer.
 */
export function RelationSyncMark({ mode }: { mode?: RelationLocaleSync }) {
    const intl = useIntl();
    if (!mode) return null;
    const { Icon, name, hint } = MARKS[mode];
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    className="inline-flex shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Icon aria-hidden className="size-3.5" />
                    <span className="sr-only">{intl.formatMessage(name)}</span>
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
                {intl.formatMessage(hint)}
            </TooltipContent>
        </Tooltip>
    );
}
