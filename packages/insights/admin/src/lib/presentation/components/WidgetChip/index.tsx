import type { ComponentType, ReactNode } from 'react';
import { cn } from '@orthacms/design-system';

/** Tone of a {@link WidgetChip} — semantic state, never a data series. */
export type WidgetChipTone = 'ok' | 'warn';

/** Props for {@link WidgetChip}. */
export type WidgetChipProps = {
    /** Whether the figure is reassuring or wants attention. */
    tone: WidgetChipTone;
    /** Leading icon, so the tone is never the only signal. */
    icon?: ComponentType<{ className?: string }>;
    /** The chip's text — short, and a number wherever possible. */
    children: ReactNode;
};

/**
 * The small pill in a widget's top-right corner, carrying the one number the
 * widget most wants read.
 *
 * Its tone comes from the **status** palette, which the charts never draw from.
 * That separation is deliberate: if a chip could be painted in a series colour,
 * a reader would reasonably connect it to a bar of the same colour below it. It
 * also always ships an icon, so the state survives for readers who can't
 * separate the two hues.
 */
export function WidgetChip({ tone, icon: Icon, children }: WidgetChipProps) {
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                tone === 'warn'
                    ? 'bg-warning-soft text-warning-soft-foreground'
                    : 'bg-success-soft text-success-soft-foreground'
            )}
        >
            {Icon ? <Icon className="size-3 shrink-0" /> : null}
            {children}
        </span>
    );
}
