import { Badge, CommandItem } from '@orthacms/design-system';
import type { ContentType } from '../../../../domain/types/contentType';

type ContentSearchItemProps = {
    /** The content type this result represents. */
    type: ContentType;
    /** The kind label shown on the trailing badge (Collection / Page). */
    badge: string;
    /** Invoked with the type when the result is chosen. */
    onSelect: (type: ContentType) => void;
};

/**
 * A single result row in the {@link ContentSearchDialog} palette: a two-line
 * label/description with a trailing kind badge. The searchable `value` folds in
 * the machine name and description so cmdk matches on all of them.
 */
export function ContentSearchItem({
    type,
    badge,
    onSelect
}: ContentSearchItemProps) {
    return (
        <CommandItem
            // cmdk filters on `value`; include the machine name + description so
            // they're all searchable.
            value={`${type.label} ${type.name} ${type.description ?? ''}`}
            onSelect={() => onSelect(type)}
        >
            <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{type.label}</span>
                <span className="truncate text-xs text-muted-foreground">
                    {type.description ?? type.name}
                </span>
            </div>
            <Badge variant="secondary" className="ml-auto">
                {badge}
            </Badge>
        </CommandItem>
    );
}
