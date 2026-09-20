import { defineMessages, useIntl } from 'react-intl';
import { Check, Cpu } from 'lucide-react';
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger
} from '@orthacms/design-system';
import {
    modelChoiceKey,
    useCopilotModels,
    type CopilotModelChoice
} from '../../application/useCopilotModels';

const messages = defineMessages({
    label: {
        id: 'copilot.model.label',
        defaultMessage: 'Model'
    },
    choose: {
        id: 'copilot.model.choose',
        defaultMessage: 'Choose a model'
    },
    none: {
        id: 'copilot.model.none',
        defaultMessage: 'No models configured'
    }
});

export interface ModelPickerProps {
    /**
     * The backend showing now — `useEffectiveModelChoice`'s answer, so it is
     * the first catalogue entry until somebody picks. `null` only while the
     * catalogue is still loading, which is also when this renders nothing.
     */
    value: CopilotModelChoice | null;
    /** Called when the user picks a different backend. */
    onChange(choice: CopilotModelChoice): void;
}

/**
 * Picks which registered backend the next turn runs on.
 *
 * The choice is **sent per turn** — a different model on the next message is all
 * it takes, which is what lets a conversation start on a cheap model and
 * escalate when the question gets hard. Phase 0 made this possible by having a
 * provider serve a *list* of models and by exposing `catalogue()`; this is that
 * decision paying off.
 *
 * What it is **not** is forgotten. A pick is remembered on the chat (so
 * collapsing a window or leaving the Agents view keeps it), seeded into the next
 * chat this tab starts, and written onto the thread — so reopening a saved
 * conversation tomorrow, in another tab, offers the same backend. None of that
 * pins anything: the thread's memory only decides what this picker *starts* on.
 *
 * **Every option is a real model.** There is no "Default" row any more, and
 * there is nothing for it to mean: a chat with no pick opens on the first entry
 * in the catalogue and sends the turn naming it, so the header always says what
 * is about to answer. "Default" named no model at all, and the deployment
 * setting behind it (`config.defaultProvider`) is gone with it — the first
 * provider `plugins.ts` registers is the default, and it is `items[0]` here.
 *
 * Renders nothing when the deployment offers a single backend: a picker with
 * one option is noise. It also renders nothing while the catalogue is loading,
 * rather than a disabled control that shifts the header once it arrives.
 */
export function ModelPicker({ value, onChange }: ModelPickerProps) {
    const intl = useIntl();
    const { data } = useCopilotModels();
    const items = data?.items ?? [];

    if (items.length <= 1) {
        return null;
    }

    const current = value ? modelChoiceKey(value) : null;

    return (
        // `modal={false}`, like every other menu in the admin: a modal one
        // `aria-hidden`s the page root, which holds focusable content, and axe
        // fails it as `aria-hidden-focus`. It is doubly wrong here — the chat
        // surfaces this sits in are non-modal on purpose, and a picker for the
        // *next* turn has no business trapping the page behind it.
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    // `min-w-0` so this is the control that gives way when the
                    // row runs out of room: it shares the composer's bottom-left
                    // with the paperclip and the skills button, both `shrink-0`
                    // and both short, while a model id is long and the one label
                    // that reads fine abbreviated. Without it the button holds
                    // its content width and the row wraps instead — which is
                    // what a panel dragged down to `MIN_PANEL_WIDTH` (320px)
                    // does on every deployment offering more than one backend.
                    className="text-muted-foreground h-8 min-w-0 gap-1.5 px-2 text-xs"
                    aria-label={intl.formatMessage(messages.choose)}
                    title={intl.formatMessage(messages.choose)}
                >
                    <Cpu className="size-3.5 shrink-0" />
                    <span className="max-w-32 truncate">{value?.model}</span>
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>
                    {intl.formatMessage(messages.label)}
                </DropdownMenuLabel>

                {items.map((choice) => {
                    const key = modelChoiceKey(choice);
                    return (
                        <DropdownMenuItem
                            key={key}
                            onSelect={() => onChange(choice)}
                        >
                            <Check
                                className={
                                    current === key
                                        ? 'size-3.5'
                                        : 'size-3.5 opacity-0'
                                }
                            />
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate text-sm">
                                    {choice.model}
                                </span>
                                <span className="text-muted-foreground text-[11px]">
                                    {choice.provider}
                                </span>
                            </span>
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
