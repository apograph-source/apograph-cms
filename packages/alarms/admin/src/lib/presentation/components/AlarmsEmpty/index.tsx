import type { ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Button } from '@orthacms/design-system';
import type { LucideIcon } from 'lucide-react';

const messages = defineMessages({
    action: { id: 'alarms.empty.action', defaultMessage: 'New alarm' }
});

/** Props for {@link AlarmsEmpty}. */
export type AlarmsEmptyProps = {
    /** The state's icon — the same one the thing it is about uses elsewhere. */
    icon: LucideIcon;
    /** The headline. */
    title: ReactNode;
    /** One sentence saying what this means and, where useful, what to do. */
    description: ReactNode;
    /** Offer "New alarm" — only when the caller may create one. */
    onCreate?: () => void;
};

/**
 * The centred empty state the alarms page uses for all of its nothing-here
 * cases.
 *
 * It used to be an `Alert` — a full-width bordered banner with a tick in the
 * corner, which is the shape of a *notification about something that just
 * happened*, not of a page with nothing on it. On a wide screen it read as a
 * warning strip stretched across an otherwise blank page. This is the same
 * centred figure the rest of the admin uses (`ApiTokensEmpty`, `ActivityEmpty`,
 * the content library's), so a workspace with nothing flagged looks like every
 * other quiet page in the product rather than like a system message.
 */
export function AlarmsEmpty({
    icon: Icon,
    title,
    description,
    onCreate
}: AlarmsEmptyProps) {
    const intl = useIntl();
    return (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <Icon className="size-10 text-muted-foreground" aria-hidden />
            <h2 className="text-lg font-medium">{title}</h2>
            <p className="max-w-md text-sm text-muted-foreground">
                {description}
            </p>
            {onCreate ? (
                <Button className="mt-2" onClick={onCreate}>
                    {intl.formatMessage(messages.action)}
                </Button>
            ) : null}
        </div>
    );
}
