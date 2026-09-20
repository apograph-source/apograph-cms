import { useEffect, useId, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import type { Editor } from '@tiptap/react';
import { isWellFormedLanguageTag } from '@orthacms/content-domain';
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label
} from '@orthacms/design-system';

const messages = defineMessages({
    title: {
        id: 'wysiwyg.language.title',
        defaultMessage: 'Language of this passage'
    },
    description: {
        id: 'wysiwyg.language.description',
        defaultMessage:
            'Marks the selected text as being written in another language, so a screen reader announces it with that language’s pronunciation instead of the page’s.'
    },
    tag: { id: 'wysiwyg.language.tag', defaultMessage: 'Language tag' },
    placeholder: {
        id: 'wysiwyg.language.placeholder',
        defaultMessage: 'fr'
    },
    hint: {
        id: 'wysiwyg.language.hint',
        defaultMessage:
            'A BCP-47 tag — “fr”, “en-GB”, “zh-Hans”. Underscores and language names (“fr_FR”, “French”) are ignored by assistive tech.'
    },
    invalid: {
        id: 'wysiwyg.language.invalid',
        defaultMessage: 'Enter a valid BCP-47 tag, for example “fr” or “en-GB”.'
    },
    noSelection: {
        id: 'wysiwyg.language.noSelection',
        defaultMessage:
            'Select the passage first — a language marks text, so there is nothing to mark with the caret alone.'
    },
    cancel: { id: 'wysiwyg.language.cancel', defaultMessage: 'Cancel' },
    apply: { id: 'wysiwyg.language.apply', defaultMessage: 'Apply' },
    remove: { id: 'wysiwyg.language.remove', defaultMessage: 'Remove' }
});

/**
 * The language-of-parts control: name the language a selected passage is
 * written in (WCAG 3.1.2).
 *
 * A **dialog** rather than a toolbar popover, because it is opened from
 * {@link MoreMarksMenu} and a `DropdownMenuContent` unmounts the moment its
 * menu closes — which is exactly when the control is meant to appear. So the
 * toolbar mounts it for the editor's whole life and the menu item only asks for
 * it to open, the same inversion the media sources use.
 *
 * The tag is validated with the **kernel's** rule, so what the editor accepts
 * and what the server accepts are one definition: a tag this dialog takes can
 * never be one the save then refuses.
 *
 * With nothing selected the dialog says so rather than applying a mark to a
 * zero-width selection, which would look like the control did nothing.
 */
export function LanguageDialog({
    editor,
    open,
    onOpenChange
}: {
    editor: Editor;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const intl = useIntl();
    const inputId = useId();
    const hintId = useId();
    const [tag, setTag] = useState('');
    const [touched, setTouched] = useState(false);

    // Seed from the passage under the caret, so opening this on an already
    // marked run edits that marker instead of silently starting a new one.
    useEffect(() => {
        if (!open || editor.isDestroyed) return;
        const current = editor.getAttributes('language')['lang'];
        setTag(typeof current === 'string' ? current : '');
        setTouched(false);
    }, [open, editor]);

    const current = !editor.isDestroyed && editor.isActive('language');
    // A mark needs a range. An existing marker is the exception — the caret
    // inside one is enough to say which run "remove" is about.
    const hasRange =
        !editor.isDestroyed && (!editor.state.selection.empty || current);
    const valid = isWellFormedLanguageTag(tag);

    const apply = () => {
        setTouched(true);
        if (!valid || !hasRange) return;
        editor
            .chain()
            .focus()
            .extendMarkRange('language')
            .setLanguage(tag.trim())
            .run();
        onOpenChange(false);
    };

    const remove = () => {
        editor
            .chain()
            .focus()
            .extendMarkRange('language')
            .unsetLanguage()
            .run();
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {intl.formatMessage(messages.title)}
                    </DialogTitle>
                    <DialogDescription>
                        {intl.formatMessage(messages.description)}
                    </DialogDescription>
                </DialogHeader>

                <form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        // Portalled in the DOM but still inside the entry
                        // editor's `<form>` in the **React tree**, along which
                        // React bubbles synthetic events — without this, saving
                        // a language would submit (and publish) the record.
                        event.stopPropagation();
                        apply();
                    }}
                >
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={inputId}>
                            {intl.formatMessage(messages.tag)}
                        </Label>
                        <Input
                            id={inputId}
                            value={tag}
                            autoFocus
                            spellCheck={false}
                            aria-describedby={hintId}
                            aria-invalid={touched && !valid}
                            placeholder={intl.formatMessage(
                                messages.placeholder
                            )}
                            onChange={(event) => setTag(event.target.value)}
                        />
                        <p
                            id={hintId}
                            className="text-xs text-muted-foreground"
                        >
                            {intl.formatMessage(messages.hint)}
                        </p>
                        {touched && !valid ? (
                            <p
                                role="alert"
                                className="text-xs text-destructive"
                            >
                                {intl.formatMessage(messages.invalid)}
                            </p>
                        ) : null}
                        {!hasRange ? (
                            <p className="text-xs text-destructive">
                                {intl.formatMessage(messages.noSelection)}
                            </p>
                        ) : null}
                    </div>

                    <DialogFooter>
                        {current ? (
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={remove}
                            >
                                {intl.formatMessage(messages.remove)}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            {intl.formatMessage(messages.cancel)}
                        </Button>
                        <Button type="submit" disabled={!hasRange}>
                            {intl.formatMessage(messages.apply)}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
