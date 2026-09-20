import { useEffect, useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { Check, Copy } from 'lucide-react';
import {
    Field,
    FieldDescription,
    FieldLabel,
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    toast
} from '@orthacms/design-system';

/** How long the button shows its "copied" check before reverting. */
const COPIED_RESET_MS = 2000;

const messages = defineMessages({
    label: {
        id: 'workspaces.settings.general.workspaceIdLabel',
        defaultMessage: 'Workspace ID'
    },
    hint: {
        id: 'workspaces.settings.general.workspaceIdHint',
        defaultMessage:
            'Identifies this workspace to the API. Send it as the X-Workspace-Id header when a token covers more than one workspace.'
    },
    copy: {
        id: 'workspaces.settings.general.workspaceIdCopy',
        defaultMessage: 'Copy workspace ID'
    },
    copied: {
        id: 'workspaces.settings.general.workspaceIdCopied',
        defaultMessage: 'Workspace ID copied to clipboard'
    },
    copyFailed: {
        id: 'workspaces.settings.general.workspaceIdCopyFailed',
        defaultMessage:
            'Couldn’t reach the clipboard. Select the ID and copy it manually.'
    }
});

/** Props for {@link WorkspaceIdField}. */
export type WorkspaceIdFieldProps = {
    /** The workspace's stable id. */
    workspaceId: string;
};

/**
 * The workspace's id, shown read-only with a copy button — the value an
 * integrator needs for the public content API's `X-Workspace-Id` header, which
 * was otherwise only obtainable from the browser's address bar.
 *
 * Unlike the slug field beside it, the input is `readOnly` but **not**
 * `disabled`: a disabled input can't be focused or selected, so it could
 * neither be copied by keyboard nor read by a screen reader's forms mode —
 * which would defeat the point of the field. Focusing it selects the whole id,
 * so manual copying works even where the Clipboard API is unavailable (an
 * insecure origin, or denied permission — the failure path this handles).
 */
export function WorkspaceIdField({ workspaceId }: WorkspaceIdFieldProps) {
    const intl = useIntl();
    const [copied, setCopied] = useState(false);
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Clear a pending reset on unmount so the timeout can't fire into an
    // unmounted component (this section remounts whenever the workspace list
    // refetches, since the page keys it by workspace id).
    useEffect(
        () => () => {
            if (resetTimer.current) {
                clearTimeout(resetTimer.current);
            }
        },
        []
    );

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(workspaceId);
            setCopied(true);
            toast.success(intl.formatMessage(messages.copied));
            if (resetTimer.current) {
                clearTimeout(resetTimer.current);
            }
            resetTimer.current = setTimeout(
                () => setCopied(false),
                COPIED_RESET_MS
            );
        } catch {
            // Clipboard access can be denied (insecure origin, permissions).
            // The id is selectable in the field, so say so rather than
            // failing silently.
            toast.error(intl.formatMessage(messages.copyFailed));
        }
    };

    return (
        <Field>
            <FieldLabel htmlFor="settings-workspace-id">
                {intl.formatMessage(messages.label)}
            </FieldLabel>
            <InputGroup>
                <InputGroupInput
                    id="settings-workspace-id"
                    value={workspaceId}
                    readOnly
                    className="font-mono"
                    onFocus={(event) => event.currentTarget.select()}
                />
                <InputGroupAddon align="inline-end">
                    <InputGroupButton
                        size="icon-xs"
                        onClick={copy}
                        aria-label={intl.formatMessage(messages.copy)}
                    >
                        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    </InputGroupButton>
                </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
                {intl.formatMessage(messages.hint)}
            </FieldDescription>
        </Field>
    );
}
