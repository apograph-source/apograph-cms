import { Component, type ErrorInfo, type ReactNode } from 'react';
import { defineMessages, FormattedMessage } from 'react-intl';
import { Card, CardContent } from '@orthacms/design-system';

/**
 * Intl descriptors for the boundary's fallback, co-located here.
 *
 * A class component can't call `useIntl`, and rendering `<FormattedMessage>`
 * is the supported route — which is why this one string spent so long as an
 * English literal, the only untranslated user-facing branch in the package.
 */
const messages = defineMessages({
    failed: {
        id: 'insights.widget.boundary.failed',
        defaultMessage:
            'This widget stopped working. The rest of the page is unaffected.'
    }
});

/** Props for {@link WidgetBoundary}. */
export type WidgetBoundaryProps = {
    /** The widget's name, so a failed card still says which one broke. */
    title: string;
    /**
     * Changing this clears a recorded failure and re-mounts the widget.
     *
     * Without it a single throw was permanent for the life of the page: a
     * mapper that tripped over one range's data kept its card broken even
     * after the user picked a range whose data is fine. The page passes the
     * selected range, so "change the range" is the recovery affordance a
     * failed card otherwise doesn't have.
     */
    resetKey?: string;
    /** The widget being isolated. */
    children: ReactNode;
};

type WidgetBoundaryState = { failed: boolean; resetKey?: string };

/**
 * Isolates one contributed widget so a throw inside it cannot unmount the whole
 * Insights page.
 *
 * This matters more here than on a normal page: the widgets come from *other
 * packages*, and the Insights plugin has no way to review what they render. One
 * mapper hitting an unexpected null in `media-admin` must not take down the
 * content and team sections with it.
 *
 * Deliberately a class component — React still offers no hook equivalent of
 * `componentDidCatch`, and a render-phase throw is exactly what needs catching.
 */
export class WidgetBoundary extends Component<
    WidgetBoundaryProps,
    WidgetBoundaryState
> {
    override state: WidgetBoundaryState = { failed: false };

    static getDerivedStateFromError(): Pick<WidgetBoundaryState, 'failed'> {
        return { failed: true };
    }

    static getDerivedStateFromProps(
        props: WidgetBoundaryProps,
        state: WidgetBoundaryState
    ): WidgetBoundaryState | null {
        if (state.resetKey === props.resetKey) return null;
        // A new reset key means "try again", so drop the recorded failure
        // rather than keeping a card broken for a cause that has passed.
        return { failed: false, resetKey: props.resetKey };
    }

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        // Named so the console says which contributed widget threw; without the
        // title a stack from a lazily-loaded chunk is close to unattributable.
        console.error(
            `[insights] widget "${this.props.title}" failed to render`,
            error,
            info.componentStack
        );
    }

    override render(): ReactNode {
        if (!this.state.failed) return this.props.children;

        return (
            <Card className="h-full shadow-none">
                <CardContent className="flex h-full flex-col gap-2 p-4">
                    <h3 className="text-sm font-semibold tracking-[-0.005em]">
                        {this.props.title}
                    </h3>
                    <p
                        role="alert"
                        className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-4 text-sm text-destructive"
                    >
                        <FormattedMessage {...messages.failed} />
                    </p>
                </CardContent>
            </Card>
        );
    }
}
