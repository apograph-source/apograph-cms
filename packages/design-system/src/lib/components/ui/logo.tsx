import { HexagonIcon } from 'lucide-react';
import { cn } from '../../utils';

/** Brand-mark sizes: `sm` for inline/toolbar use, `lg` for hero/landing use. */
const sizes = {
    sm: { badge: 'size-6', icon: 'size-4', radius: 'rounded-md' },
    lg: { badge: 'size-14', icon: 'size-7', radius: 'rounded-[14px]' }
} as const;

/**
 * Props for the {@link Logo} component.
 */
type LogoProps = React.ComponentProps<'div'> & {
    /** Whether to show the "Ortha CMS" text label. Defaults to true. */
    showLabel?: boolean;
    /** Brand-mark size. Defaults to `sm`. */
    size?: keyof typeof sizes;
};

/**
 * Ortha CMS brand logo. Renders the hexagon icon badge
 * with an optional text label.
 */
export function Logo({
    className,
    showLabel = true,
    size = 'sm',
    ...props
}: LogoProps) {
    return (
        <div
            className={cn('flex items-center gap-2 font-medium', className)}
            {...props}
        >
            <div
                className={cn(
                    'flex items-center justify-center bg-primary text-primary-foreground',
                    sizes[size].badge,
                    sizes[size].radius
                )}
            >
                <HexagonIcon className={sizes[size].icon} aria-hidden="true" />
            </div>
            {showLabel ? (
                <span>Ortha CMS</span>
            ) : (
                <span className="sr-only">Ortha CMS</span>
            )}
        </div>
    );
}
