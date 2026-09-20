import type { ReactNode } from 'react';
import {
    Alert,
    AlertDescription,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Spinner
} from '@orthacms/design-system';

/** Props for {@link BlockingConfirmDialog}. */
export type BlockingConfirmDialogProps = {
    /** Whether the dialog is open. */
    open: boolean;
    /** Dialog heading. */
    title: ReactNode;
    /** Supporting copy under the heading. */
    description: ReactNode;
    /** Whether the backing entry-count query is still loading. */
    isChecking: boolean;
    /** Whether the entry-count query errored (blocks the action). */
    isError: boolean;
    /** The entry count once known; `undefined` while checking/errored. */
    count: number | undefined;
    /** Shown while the count is loading. */
    checkingLabel: string;
    /** Shown when the count couldn't be read. */
    checkErrorLabel: string;
    /** Shown when the count is `> 0` — the caller formats it with the count. */
    blockedLabel: ReactNode;
    /** Label for the destructive confirm button. */
    confirmLabel: string;
    /** Label for the cancel button. */
    cancelLabel: string;
    /** Close callback; ignored while the action is in flight. */
    onClose: () => void;
    /** Runs the destructive action (reachable only once the count is zero). */
    onConfirm: () => void;
    /** Whether the destructive action is in flight. */
    busy?: boolean;
};

/**
 * The shared "block-before-you-act" confirm dialog: on open the caller reads an
 * entry-count query, and this renders the checking / error / blocked states and
 * **enables the destructive button only once the count is known to be zero**.
 * Used for both revoking a content grant and deleting a workspace, which differ
 * only in their copy and which count hook backs them.
 */
export function BlockingConfirmDialog({
    open,
    title,
    description,
    isChecking,
    isError,
    count,
    checkingLabel,
    checkErrorLabel,
    blockedLabel,
    confirmLabel,
    cancelLabel,
    onClose,
    onConfirm,
    busy = false
}: BlockingConfirmDialogProps) {
    const hasEntries = typeof count === 'number' && count > 0;
    const canConfirm = open && !isError && !isChecking && count === 0;

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                {isChecking ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner className="size-4" />
                        {checkingLabel}
                    </p>
                ) : isError ? (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{checkErrorLabel}</AlertDescription>
                    </Alert>
                ) : hasEntries ? (
                    <Alert variant="destructive" role="alert">
                        <AlertDescription>{blockedLabel}</AlertDescription>
                    </Alert>
                ) : null}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={busy}>
                        {cancelLabel}
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={!canConfirm || busy}
                    >
                        {busy ? <Spinner /> : null}
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
