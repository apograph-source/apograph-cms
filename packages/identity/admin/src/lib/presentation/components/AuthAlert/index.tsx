import { useEffect, useRef } from 'react';
import { Alert, AlertTitle, AlertDescription } from '@orthacms/design-system';

/** Props for the {@link AuthAlert} component. */
type AuthAlertProps = {
    /** Constant heading naming what failed (e.g. "Authentication failed"). */
    title: string;
    /** The mapped, user-facing explanation. */
    message: string;
};

/**
 * The submission-failure banner shared by the sign-in and accept-invite forms:
 * a destructive `Alert` that **takes focus** when it appears.
 *
 * `Alert` already carries `role="alert"`, so the text is announced on insertion.
 * That alone was not enough. Focus stayed on the submit button, which sits
 * *after* the banner in DOM order, so a keyboard user had to Shift+Tab back
 * through both fields to reach it — and the banner is not in the tab order at
 * all, so in practice it was only reachable in browse mode. A screen-reader user
 * who happened to be mid-utterance, or who arrowed away before the live region
 * spoke, lost the message with no way back short of re-reading the page.
 *
 * Moving focus here fixes both: the message is read at the moment it appears,
 * and the user is standing next to it, so the fields they need to correct are
 * one Tab away.
 *
 * **Render this conditionally** — it focuses on mount and whenever `message`
 * changes, so it must not be mounted while there is nothing to say. Two
 * consecutive failures unmount it in between (the mutation clears its error
 * while the retry is in flight), and the `message` dependency covers the case
 * where one failure is replaced by a different one without that gap.
 *
 * The `role="alert"` is kept even though focus moves here: the e2e page objects
 * anchor on it, and a duplicated announcement is a better failure than a silent
 * one.
 */
export function AuthAlert({ title, message }: AuthAlertProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        ref.current?.focus();
    }, [message]);

    return (
        // `tabIndex={-1}` makes the banner programmatically focusable without
        // adding a stop to the tab order — the user is placed here, but nobody
        // tabbing through the form has to pass through it. `outline-none` for
        // the same reason the heading drops its ring: the browser paints one for
        // this programmatic focus, and a second box inside the banner's own
        // destructive border is noise on something that is not interactive.
        // Nothing reachable by Tab loses an indicator.
        <Alert
            ref={ref}
            tabIndex={-1}
            variant="destructive"
            className="focus:outline-none"
        >
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
        </Alert>
    );
}
