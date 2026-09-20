import { Alert, AlertDescription } from '@orthacms/design-system';

/** Props for the {@link AuthNotice} component. */
type AuthNoticeProps = {
    /** The user-facing explanation. */
    message: string;
};

/**
 * The standing explanation of **how the visitor got to this screen** — today,
 * that the session they were using ended underneath them and the app replaced
 * the page they were on.
 *
 * Deliberately not {@link AuthAlert}, and the differences are the point:
 *
 * - **It does not take focus.** `AuthLayout` has already moved focus to the
 *   screen's `<h1>` on arrival, which is the right landing place; a second
 *   focus move on the same mount would fight it, and the two effects would race
 *   on ordering (a child's runs first, so the layout would win anyway and the
 *   notice would be skipped past). A reader continuing from the heading meets
 *   this next in DOM order, which is where the explanation belongs.
 * - **It is not destructive.** Nothing the visitor just did failed. It is
 *   `warning`, the same tint the toast that announced it uses.
 *
 * `Alert` carries `role="alert"`, so it is announced if it appears while the
 * page is already up. Mounted at arrival it is usually the focused heading's
 * neighbour rather than a live update — the announcement for that case is the
 * toast `AuthProvider` fires, which reaches the visitor before this page is
 * even mounted.
 */
export function AuthNotice({ message }: AuthNoticeProps) {
    return (
        <Alert variant="warning">
            <AlertDescription>{message}</AlertDescription>
        </Alert>
    );
}
