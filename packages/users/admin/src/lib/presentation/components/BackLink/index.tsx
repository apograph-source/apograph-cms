import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@orthacms/design-system';

/**
 * A muted "back" link with a leading arrow — the detail page's return path to
 * the members roster. The arrow is decorative; the text label carries the
 * destination for assistive tech.
 */
export function BackLink({
    to,
    label,
    className
}: {
    /** Destination path. */
    to: string;
    /** Visible, accessible label (e.g. "Back to members"). */
    label: string;
    /** Extra classes. */
    className?: string;
}) {
    return (
        <Link
            to={to}
            className={cn(
                'inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
                className
            )}
        >
            <ArrowLeft aria-hidden className="size-4" />
            {label}
        </Link>
    );
}
