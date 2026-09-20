import { defineMessages, useIntl } from 'react-intl';
import { BookOpen, Lock, X } from 'lucide-react';
import { Badge, cn } from '@orthacms/design-system';

const messages = defineMessages({
    remove: {
        id: 'copilot.skill.remove',
        defaultMessage: 'Remove the {title} skill'
    },
    alwaysOn: {
        id: 'copilot.skill.alwaysOn',
        defaultMessage: 'Always on in this workspace'
    }
});

export interface SkillChipProps {
    /** What the chip reads. */
    title: string;
    /**
     * True for a skill the workspace applies to every run. It gets a lock
     * instead of an `×`, because the person cannot take it off from here — it
     * is configuration, and pretending otherwise would offer a control that
     * silently does nothing on the next turn.
     */
    alwaysOn?: boolean;
    /** Drops the skill from the next turn. Omitted on a sent turn's chips. */
    onRemove?: () => void;
    /** Extra classes for the surface that hosts it. */
    className?: string;
}

/**
 * One skill, as a chip — staged in the composer and, unchanged, on the turn it
 * was sent with.
 *
 * The same component for both for the reason `AttachmentChip` is: a skill does
 * not change once sent, and two components would be two chances for the staged
 * and the sent rendering to drift apart. What differs is only whether there is
 * an `×`.
 */
export function SkillChip({
    title,
    alwaysOn = false,
    onRemove,
    className
}: SkillChipProps) {
    const intl = useIntl();

    return (
        <Badge
            variant="secondary"
            className={cn('gap-1 font-normal', onRemove && 'pr-1', className)}
        >
            <BookOpen className="size-3 shrink-0" />
            <span className="max-w-40 truncate">{title}</span>
            {alwaysOn ? (
                <Lock
                    className="size-3 shrink-0 opacity-60"
                    aria-label={intl.formatMessage(messages.alwaysOn)}
                />
            ) : null}
            {onRemove ? (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={intl.formatMessage(messages.remove, { title })}
                    className="hover:bg-muted-foreground/20 ml-0.5 rounded-sm p-0.5"
                >
                    <X className="size-3" />
                </button>
            ) : null}
        </Badge>
    );
}
