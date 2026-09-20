import { useMemo, type ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { DesignSystemLabelsProvider } from '@orthacms/design-system';

/** Intl descriptors for the design system's own chrome, co-located here. */
const messages = defineMessages({
    close: {
        id: 'designSystem.close',
        defaultMessage: 'Close'
    }
});

/**
 * Translates the design system's built-in chrome strings and hands them down
 * through its labels context.
 *
 * The library ships English defaults and no i18n runtime — deliberately, it is
 * consumed outside this app too. That left every dialog's and sheet's close
 * button announcing "Close" in a German session, because localizing it meant
 * passing `closeLabel` at each of twenty-odd call sites and no consumer did
 * (`ORT-159`). Doing it once here means a new dialog is localized by existing,
 * rather than by remembering.
 *
 * A call site that passes its own `closeLabel` still wins — this is the default
 * underneath, not a ceiling.
 */
export function DesignSystemLabels({ children }: { children: ReactNode }) {
    const intl = useIntl();

    // Memoized because the context value is an object: a fresh one per render
    // would re-render every dialog and sheet in the tree for nothing.
    const labels = useMemo(
        () => ({ close: intl.formatMessage(messages.close) }),
        [intl]
    );

    return (
        <DesignSystemLabelsProvider labels={labels}>
            {children}
        </DesignSystemLabelsProvider>
    );
}
