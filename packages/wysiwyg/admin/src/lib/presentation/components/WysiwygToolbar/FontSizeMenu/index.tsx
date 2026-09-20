import { defineMessages, useIntl, type MessageDescriptor } from 'react-intl';
import type { Editor } from '@tiptap/react';
import { CaseSensitive } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger
} from '@orthacms/design-system';
import { FONT_SIZES } from '../../../../domain/constants';
import { useLiveEditorState } from '../../../hooks/useLiveEditorState';
import { ToolbarMenuTrigger } from '../ToolbarMenuTrigger';

const messages = defineMessages({
    label: { id: 'wysiwyg.fontSize.label', defaultMessage: 'Text size' },
    default: { id: 'wysiwyg.fontSize.default', defaultMessage: 'Default' },
    small: { id: 'wysiwyg.fontSize.small', defaultMessage: 'Small' },
    normal: { id: 'wysiwyg.fontSize.normal', defaultMessage: 'Normal' },
    medium: { id: 'wysiwyg.fontSize.medium', defaultMessage: 'Medium' },
    large: { id: 'wysiwyg.fontSize.large', defaultMessage: 'Large' },
    xlarge: { id: 'wysiwyg.fontSize.xlarge', defaultMessage: 'Extra large' }
});

/** Each size step's label, by the id the palette declares. */
const SIZE_LABELS: Record<string, MessageDescriptor> = {
    default: messages.default,
    small: messages.small,
    normal: messages.normal,
    medium: messages.medium,
    large: messages.large,
    xlarge: messages.xlarge
};

/** The radio value standing for "no explicit size" (a radio group needs one). */
const DEFAULT_VALUE = 'default';

/**
 * The text-size picker. Sets a `font-size` on the `textStyle` mark, so a size
 * applies to the **selected run**, not the whole block — that is what makes it
 * different from the heading levels next to it, and why both controls exist.
 *
 * "Default" clears the mark rather than setting `1rem`: an unmarked run
 * inherits from its block, so a heading stays heading-sized instead of being
 * pinned to body size the moment someone opens this menu.
 */
export function FontSizeMenu({ editor }: { editor: Editor }) {
    const intl = useIntl();
    const current = useLiveEditorState(
        editor,
        (instance) => {
            const size = instance.getAttributes('textStyle')['fontSize'];
            return typeof size === 'string' ? size : DEFAULT_VALUE;
        },
        DEFAULT_VALUE
    );

    const apply = (next: string) => {
        if (next === DEFAULT_VALUE)
            editor.chain().focus().unsetFontSize().run();
        else editor.chain().focus().setFontSize(next).run();
    };

    const activeId =
        FONT_SIZES.find((size) => size.value === current)?.id ?? DEFAULT_VALUE;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <ToolbarMenuTrigger
                    label={intl.formatMessage(messages.label)}
                    icon={CaseSensitive}
                    active={activeId !== DEFAULT_VALUE}
                />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuRadioGroup value={current} onValueChange={apply}>
                    {FONT_SIZES.map((size) => (
                        <DropdownMenuRadioItem
                            key={size.id}
                            value={size.value ?? DEFAULT_VALUE}
                        >
                            <span style={{ fontSize: size.value }}>
                                {intl.formatMessage(SIZE_LABELS[size.id])}
                            </span>
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
