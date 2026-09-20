import { cn } from '@orthacms/design-system';

/** One label/value pair in the detail panel's definition list. */
export function DetailRow({
    label,
    value,
    mono
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <>
            <dt className="font-medium text-muted-foreground">{label}</dt>
            <dd
                className={cn(
                    'min-w-0 break-words',
                    mono && 'font-mono text-xs'
                )}
            >
                {value}
            </dd>
        </>
    );
}
