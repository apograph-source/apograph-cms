import { type ReactNode } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { ConfirmDialog } from '@orthacms/design-system';
import { UnsavedChangesProvider } from '@orthacms/utils-admin';

const messages = defineMessages({
    title: {
        id: 'app.unsaved.title',
        defaultMessage: 'Discard your unsaved changes?'
    },
    body: {
        id: 'app.unsaved.body',
        defaultMessage:
            'You have edits on this page that haven’t been saved. Leaving now loses them.'
    },
    confirm: {
        id: 'app.unsaved.confirm',
        defaultMessage: 'Leave and discard'
    },
    cancel: {
        id: 'app.unsaved.cancel',
        defaultMessage: 'Keep editing'
    }
});

/**
 * Mounts the app-wide unsaved-changes guard and supplies its confirm dialog.
 *
 * The guard itself is copy-free (it lives in `utils-admin`, which owns no
 * strings); this host binds it to the design-system dialog and the app's single
 * `IntlProvider`, so every form in every plugin gets the same prompt without
 * each one re-implementing it.
 */
export function UnsavedChangesGuard({ children }: { children: ReactNode }) {
    const intl = useIntl();
    return (
        <UnsavedChangesProvider
            dialog={({ open, onOpenChange, onConfirm }) => (
                <ConfirmDialog
                    open={open}
                    onOpenChange={onOpenChange}
                    title={intl.formatMessage(messages.title)}
                    description={intl.formatMessage(messages.body)}
                    confirmLabel={intl.formatMessage(messages.confirm)}
                    cancelLabel={intl.formatMessage(messages.cancel)}
                    confirmVariant="destructive"
                    onConfirm={onConfirm}
                />
            )}
        >
            {children}
        </UnsavedChangesProvider>
    );
}
