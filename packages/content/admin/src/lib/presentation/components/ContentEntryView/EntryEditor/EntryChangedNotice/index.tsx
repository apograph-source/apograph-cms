import { defineMessages, useIntl } from 'react-intl';
import { History } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button
} from '@apograph/design-system';

const messages = defineMessages({
    title: {
        id: 'content.editor.changedElsewhereTitle',
        defaultMessage: 'This record changed while you were editing'
    },
    body: {
        id: 'content.editor.changedElsewhereBody',
        defaultMessage:
            'A newer version was saved elsewhere, and your unsaved edits have been kept. Saving overwrites that newer version with what is on this screen; the version it replaces stays in History.'
    },
    discardHint: {
        id: 'content.editor.changedElsewhereDiscardHint',
        defaultMessage:
            'Loading the newer version replaces this record’s fields and drops your unsaved changes to them.'
    },
    discard: {
        id: 'content.editor.changedElsewhereDiscard',
        defaultMessage: 'Load the newer version'
    }
});

/**
 * The banner over an entry editor whose record changed underneath it — a
 * background refetch brought values the form **refused** to seed over the
 * author's unsaved edits (`useEntryForm`, `ORT-230`).
 *
 * It is the design-system `Alert` precisely where `ReadOnlyNotice` beside it is
 * not: that one is page furniture present from first paint, this is an **event**
 * that happened while the author was looking at something else, so its
 * `role="alert"` live region is what tells a screen-reader user at all. It takes
 * no focus — the author is mid-sentence, and moving the caret out of the field
 * they are typing in to announce news about the server would be a worse
 * interruption than the one it reports.
 *
 * **Who** saved it is deliberately unsaid: `EntryRecord` carries `updatedAt` and
 * no `updatedBy`, and naming a colleague we would have to guess at is worse than
 * impersonal wording. So is claiming the conflict is resolved — saves are
 * last-write-wins (`SaveEntryInput` carries no version; real optimistic
 * concurrency is its own ticket), so the copy says what the next Save will
 * actually do, and where the overwritten version can be found afterwards
 * (`content:I-08`/`I-09`/`I-11` — history is append-only, so it is recoverable).
 *
 * **The control says "load", not "discard everything".** What it runs reloads
 * the **values form** and nothing else: staged relation links and the presave
 * steps' staging are owned above the form and are deliberately out of the
 * refusal's scope, so they survive it and ride the next Save. A button reading
 * "discard mine" would promise a clean slate this does not hand over, which is
 * the same kind of lie as the silent overwrite it exists to report — so the
 * label names what arrives and the sentence beside it names what goes.
 */
export function EntryChangedNotice({ onDiscard }: { onDiscard: () => void }) {
    const intl = useIntl();

    return (
        <Alert variant="warning" className="mb-6">
            <History className="size-4" aria-hidden />
            <AlertTitle>{intl.formatMessage(messages.title)}</AlertTitle>
            <AlertDescription>
                <p>{intl.formatMessage(messages.body)}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <span className="min-w-0">
                        {intl.formatMessage(messages.discardHint)}
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shadow-none"
                        onClick={onDiscard}
                    >
                        {intl.formatMessage(messages.discard)}
                    </Button>
                </div>
            </AlertDescription>
        </Alert>
    );
}
