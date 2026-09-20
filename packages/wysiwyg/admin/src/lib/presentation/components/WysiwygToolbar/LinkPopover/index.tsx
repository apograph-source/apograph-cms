import { useEffect, useId, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import type { Editor } from '@tiptap/react';
import { Link2 } from 'lucide-react';
import {
    Button,
    Input,
    Label,
    Popover,
    PopoverContent,
    PopoverTrigger
} from '@orthacms/design-system';
import { useLiveEditorState } from '../../../hooks/useLiveEditorState';
import { ToolbarMenuTrigger } from '../ToolbarMenuTrigger';

const messages = defineMessages({
    label: { id: 'wysiwyg.link.label', defaultMessage: 'Link' },
    url: { id: 'wysiwyg.link.url', defaultMessage: 'URL' },
    placeholder: {
        id: 'wysiwyg.link.placeholder',
        defaultMessage: 'https://example.com'
    },
    apply: { id: 'wysiwyg.link.apply', defaultMessage: 'Apply' },
    remove: { id: 'wysiwyg.link.remove', defaultMessage: 'Remove link' }
});

/**
 * The link editor. Opens prefilled with the href at the caret, so pressing it
 * on an existing link edits that link instead of silently starting a new one.
 *
 * Three cases, because they behave differently and a single `setLink` only
 * covers the first: text is selected (mark it), the caret sits in a link
 * (`extendMarkRange` grows the selection to the whole link, so editing the URL
 * doesn't split it in two), or nothing is selected at all — where the URL is
 * inserted as its own linked text, since marking a zero-width selection would
 * look like the button did nothing.
 */
export function LinkPopover({ editor }: { editor: Editor }) {
    const intl = useIntl();
    const inputId = useId();
    const [open, setOpen] = useState(false);
    const [url, setUrl] = useState('');

    const href = useLiveEditorState(
        editor,
        (instance) => {
            const value = instance.getAttributes('link')['href'];
            return typeof value === 'string' ? value : '';
        },
        ''
    );

    // Reseed from the document each time the popover opens — not on every
    // `href` change, which would overwrite what the user is mid-way through
    // typing as `autolink` re-evaluates the text behind them.
    useEffect(() => {
        if (open) setUrl(href);
    }, [open, href]);

    const apply = () => {
        const next = url.trim();
        setOpen(false);
        if (next === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
        }
        if (editor.state.selection.empty && !editor.isActive('link')) {
            editor
                .chain()
                .focus()
                .insertContent({
                    type: 'text',
                    text: next,
                    marks: [{ type: 'link', attrs: { href: next } }]
                })
                .run();
            return;
        }
        editor
            .chain()
            .focus()
            .extendMarkRange('link')
            .setLink({ href: next })
            .run();
    };

    const remove = () => {
        setOpen(false);
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <ToolbarMenuTrigger
                    label={intl.formatMessage(messages.label)}
                    icon={Link2}
                    active={href !== ''}
                />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
                <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        // Stop the submit here. This form is portalled in the
                        // DOM but still sits inside the entry editor's `<form>`
                        // in the **React tree**, and React bubbles synthetic
                        // events along that tree — so without this, saving a
                        // URL/alt submitted the whole record (publishing it, on
                        // a publishable type).
                        event.stopPropagation();
                        apply();
                    }}
                >
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor={inputId}>
                            {intl.formatMessage(messages.url)}
                        </Label>
                        <Input
                            id={inputId}
                            type="url"
                            value={url}
                            autoFocus
                            placeholder={intl.formatMessage(
                                messages.placeholder
                            )}
                            onChange={(event) => setUrl(event.target.value)}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        {href !== '' ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={remove}
                            >
                                {intl.formatMessage(messages.remove)}
                            </Button>
                        ) : null}
                        <Button type="submit" size="sm">
                            {intl.formatMessage(messages.apply)}
                        </Button>
                    </div>
                </form>
            </PopoverContent>
        </Popover>
    );
}
