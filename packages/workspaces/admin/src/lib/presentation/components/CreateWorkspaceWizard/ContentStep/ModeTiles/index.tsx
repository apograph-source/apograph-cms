import { defineMessages, useIntl } from 'react-intl';
import { cn, RadioGroup, RadioGroupItem } from '@orthacms/design-system';
import type { ContentMode } from '../../../../../domain/types/wizard';

const messages = defineMessages({
    groupLabel: {
        id: 'workspaces.create.content.modeLabel',
        defaultMessage: 'Content access'
    },
    allTitle: {
        id: 'workspaces.create.content.allTitle',
        defaultMessage: 'All content'
    },
    allDescription: {
        id: 'workspaces.create.content.allDescription',
        defaultMessage:
            'Access every collection and page, including ones added later.'
    },
    specificTitle: {
        id: 'workspaces.create.content.specificTitle',
        defaultMessage: 'Specific content'
    },
    specificDescription: {
        id: 'workspaces.create.content.specificDescription',
        defaultMessage: 'Choose exactly which collections and pages to grant.'
    }
});

const TILES: {
    value: ContentMode;
    title: typeof messages.allTitle;
    description: typeof messages.allDescription;
}[] = [
    {
        value: 'all',
        title: messages.allTitle,
        description: messages.allDescription
    },
    {
        value: 'specific',
        title: messages.specificTitle,
        description: messages.specificDescription
    }
];

/** Props for {@link ModeTiles}. */
export type ModeTilesProps = {
    /** Current content mode. */
    value: ContentMode;
    /** Called when a tile is chosen. */
    onChange: (mode: ContentMode) => void;
};

/** Two radio tiles choosing between full access and a specific selection. */
export function ModeTiles({ value, onChange }: ModeTilesProps) {
    const intl = useIntl();

    return (
        <RadioGroup
            value={value}
            onValueChange={(next) => onChange(next as ContentMode)}
            aria-label={intl.formatMessage(messages.groupLabel)}
            className="grid gap-3 sm:grid-cols-2"
        >
            {TILES.map((tile) => {
                const selected = value === tile.value;
                return (
                    <label
                        key={tile.value}
                        className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
                            selected
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-accent'
                        )}
                    >
                        <RadioGroupItem value={tile.value} className="mt-0.5" />
                        <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium">
                                {intl.formatMessage(tile.title)}
                            </span>
                            <span className="text-sm text-muted-foreground">
                                {intl.formatMessage(tile.description)}
                            </span>
                        </div>
                    </label>
                );
            })}
        </RadioGroup>
    );
}
