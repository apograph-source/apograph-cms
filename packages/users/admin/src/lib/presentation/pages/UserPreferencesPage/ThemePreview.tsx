import { cn } from '@orthacms/design-system';

/**
 * A tiny, non-interactive mock of the admin chrome — a dark sidebar rail beside
 * a content canvas with a couple of placeholder rows — rendered in a **fixed**
 * light or dark palette (never the app tokens), so each theme card previews the
 * look it applies regardless of the theme currently in effect. `system` shows
 * the two halves side by side.
 */
export function ThemePreview({
    variant
}: {
    variant: 'light' | 'dark' | 'system';
}) {
    if (variant === 'system') {
        return (
            <div className="flex h-16 w-full overflow-hidden rounded-md border border-border">
                <div className="w-1/2 overflow-hidden border-r border-border">
                    <Panel tone="light" edge={false} />
                </div>
                <div className="w-1/2 overflow-hidden">
                    <Panel tone="dark" edge={false} />
                </div>
            </div>
        );
    }
    return (
        <div className="h-16 w-full overflow-hidden rounded-md border border-border">
            <Panel tone={variant} edge />
        </div>
    );
}

/** One themed panel: a rail + canvas with placeholder bars, in a fixed tone. */
function Panel({ tone, edge }: { tone: 'light' | 'dark'; edge: boolean }) {
    const dark = tone === 'dark';
    return (
        <div
            className={cn(
                'flex h-full w-full',
                edge && 'rounded-[3px]',
                dark ? 'bg-neutral-900' : 'bg-white'
            )}
        >
            <div className="flex w-1/3 flex-col gap-1 bg-neutral-800 p-1.5">
                <span className="h-1 w-3/4 rounded-full bg-orange-400/90" />
                <span className="h-1 w-full rounded-full bg-white/25" />
                <span className="h-1 w-2/3 rounded-full bg-white/25" />
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-2">
                <span
                    className={cn(
                        'h-1.5 w-1/2 rounded-full',
                        dark ? 'bg-neutral-500' : 'bg-neutral-300'
                    )}
                />
                <span
                    className={cn(
                        'h-4 w-full rounded-sm border',
                        dark
                            ? 'border-neutral-700 bg-neutral-800'
                            : 'border-neutral-200 bg-neutral-50'
                    )}
                />
                <span
                    className={cn(
                        'h-4 w-full rounded-sm border',
                        dark
                            ? 'border-neutral-700 bg-neutral-800'
                            : 'border-neutral-200 bg-neutral-50'
                    )}
                />
            </div>
        </div>
    );
}
