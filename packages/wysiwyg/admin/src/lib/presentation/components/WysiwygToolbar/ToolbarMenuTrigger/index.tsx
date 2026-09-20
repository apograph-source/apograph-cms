import type { ComponentType, Ref } from 'react';
import { ChevronDown } from 'lucide-react';
import {
    Button,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn
} from '@orthacms/design-system';

/**
 * The button that opens one of the toolbar's dropdowns (text style, colors,
 * table, callout, columns). Shared so every menu in the bar opens from the same
 * shape: icon, optional current value, chevron.
 *
 * Rendered via `asChild` from a `DropdownMenuTrigger`/`PopoverTrigger`, so it
 * forwards the ref and every prop Radix puts on it — hence the loose `...rest`.
 */
export function ToolbarMenuTrigger({
    label,
    icon: Icon,
    value,
    active = false,
    ref,
    ...rest
}: {
    /** Accessible name and tooltip text (e.g. "Text style"). */
    label: string;
    icon: ComponentType<{ className?: string }>;
    /** The current selection, shown beside the icon (e.g. "Heading 2"). */
    value?: string;
    /** Whether the feature this menu drives is in effect at the caret. */
    active?: boolean;
    ref?: Ref<HTMLButtonElement>;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    ref={ref}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(
                        'h-8 shrink-0 gap-0.5 rounded-md px-1.5',
                        active && 'bg-accent text-accent-foreground'
                    )}
                    aria-label={label}
                    // See ToolbarButton: never let opening a menu collapse the
                    // selection the menu is about to act on.
                    onMouseDown={(event) => event.preventDefault()}
                    {...rest}
                >
                    <Icon />
                    {value ? (
                        <span className="max-w-28 truncate text-xs font-normal">
                            {value}
                        </span>
                    ) : null}
                    <ChevronDown className="!size-3 opacity-60" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
