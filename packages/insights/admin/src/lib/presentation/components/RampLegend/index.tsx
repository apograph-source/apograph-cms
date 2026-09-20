import type { ReactNode } from 'react';
import { cn } from '@orthacms/design-system';
import { SEQUENTIAL_TONES, toneBackground } from '../../../utils/chartTone';

/** Props for {@link RampLegend}. */
export type RampLegendProps = {
    /** What the lightest end of the ramp means (e.g. "quiet", "0%"). */
    lowLabel: string;
    /** What the deepest end means (e.g. "busy", "100%"). */
    highLabel: string;
    /** An optional reading of the data, pushed to the right. */
    children?: ReactNode;
};

/**
 * The scale that makes a heat grid readable — without it a reader can see that
 * one cell differs from another but not what either means.
 *
 * The endpoint labels say *low* and *high* rather than naming a colour, because
 * the ramp's direction flips between themes: the busiest cell is the darkest in
 * light mode and the brightest in dark. Any caption written about this scale has
 * to be phrased the same way — "colour intensifies with age", never "darker
 * means older".
 */
export function RampLegend({ lowLabel, highLabel, children }: RampLegendProps) {
    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{lowLabel}</span>
            <span className="flex gap-[2px]">
                {SEQUENTIAL_TONES.map((tone) => (
                    <span
                        key={tone}
                        className={cn(
                            'block h-2 w-4 rounded-[2px]',
                            toneBackground(tone)
                        )}
                    />
                ))}
            </span>
            <span>{highLabel}</span>
            {children ? <span className="ml-auto">{children}</span> : null}
        </div>
    );
}
