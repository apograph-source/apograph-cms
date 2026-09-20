import { defineMessages, useIntl } from 'react-intl';
import { Check, Pin } from 'lucide-react';
import { DropdownMenuItem, cn } from '@orthacms/design-system';
import type { SavedView } from '../../../../domain/types/savedView';

/** Intl descriptors for {@link ViewRow}, co-located. */
const messages = defineMessages({
    defaultBadge: {
        id: 'content.views.row.defaultBadge',
        defaultMessage: 'Your default view'
    }
});

/** Props for {@link ViewRow}. */
export type ViewRowProps = {
    /** The view this row selects. */
    view: SavedView;
    /** Whether it is the view currently applied. */
    active: boolean;
    /** Applies the view. */
    onSelect: (view: SavedView) => void;
};

/**
 * One selectable view in the switcher's menu.
 *
 * The tick keeps its space when inactive (`invisible`, not unmounted) so the
 * labels line up column-wise and switching a view doesn't shift the whole list
 * sideways under the pointer.
 */
export function ViewRow({ view, active, onSelect }: ViewRowProps) {
    const intl = useIntl();
    return (
        <DropdownMenuItem onSelect={() => onSelect(view)}>
            <Check
                aria-hidden
                className={cn(
                    'size-3.5',
                    active ? 'text-primary' : 'invisible'
                )}
            />
            <span className="flex-1 truncate">{view.name}</span>
            {view.isDefault ? (
                <Pin
                    aria-label={intl.formatMessage(messages.defaultBadge)}
                    className="size-3.5 text-muted-foreground"
                />
            ) : null}
        </DropdownMenuItem>
    );
}
