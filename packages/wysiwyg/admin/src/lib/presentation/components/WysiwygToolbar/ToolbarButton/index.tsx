import type { ComponentType } from 'react';
import {
    Button,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    cn
} from '@orthacms/design-system';

/**
 * One icon control in the editor toolbar. The icon is decorative, so the label
 * carries the accessible name and doubles as the tooltip — the two can't drift
 * into a button that reads one thing and announces another.
 *
 * A toggle (bold, a list, an alignment) passes `active`, which renders as
 * `aria-pressed` **and** the filled background: on/off has to be perceivable
 * without color alone. A plain action (undo, insert a table) leaves `active`
 * undefined and gets no pressed state at all, because "pressed" would be a lie.
 */
export function ToolbarButton({
    label,
    icon: Icon,
    active,
    disabled = false,
    onClick
}: {
    /** Accessible name and tooltip text. */
    label: string;
    /** Decorative icon (`aria-hidden` via the button's accessible name). */
    icon: ComponentType<{ className?: string }>;
    /** Toggle state — omit entirely for a non-toggle action. */
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                        'size-8 shrink-0 rounded-md',
                        active && 'bg-accent text-accent-foreground'
                    )}
                    aria-label={label}
                    aria-pressed={active}
                    disabled={disabled}
                    // Keep the caret where it is. Pressing a toolbar button
                    // would otherwise move focus out of the editor and collapse
                    // the selection, so the command would run on nothing — the
                    // classic "I selected a word, hit Bold, and nothing
                    // happened". The click still fires; only the focus move is
                    // suppressed.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={onClick}
                >
                    <Icon />
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}
