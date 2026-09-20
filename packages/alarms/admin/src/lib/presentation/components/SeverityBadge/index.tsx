import { useIntl } from 'react-intl';
import { Badge, cn } from '@orthacms/design-system';
import type { AlarmSeverity } from '../../../types/alarm';
import { severityLook } from '../../severityLook';

/** Props for {@link SeverityBadge}. */
export type SeverityBadgeProps = {
    /** Which severity to render. */
    severity: AlarmSeverity;
    /** Render the glyph without the word — for a dense row. */
    iconOnly?: boolean;
    className?: string;
};

/**
 * Severity as shape, colour **and** a word.
 *
 * The shape is doing real work, not decoration: the design system's
 * `destructive` and `warning` are ΔE 0.9 apart under deuteranopia, so a reader
 * who cannot separate red from orange has only the glyph and the text to go on.
 * See `severityLook` for the measurement and the rest of the reasoning.
 *
 * It declares no messages of its own — the severity words live in
 * `severityLook` so the badge, the records column and the copilot's strip
 * cannot end up calling the same severity three different things.
 */
export function SeverityBadge({
    severity,
    iconOnly = false,
    className
}: SeverityBadgeProps) {
    const intl = useIntl();
    const { chip, Icon, label } = severityLook(severity);
    const word = intl.formatMessage(label);

    return (
        <Badge
            variant="outline"
            className={cn(chip, 'gap-1 font-medium', className)}
        >
            <Icon aria-hidden="true" className="size-3" />
            {/* Visually hidden when the row has no space for it, never
                dropped: colour and shape are two encodings, and the word is
                the one a screen reader gets. */}
            <span className={iconOnly ? 'sr-only' : undefined}>{word}</span>
        </Badge>
    );
}
