import type { ComponentType } from 'react';
import { defineMessages, useIntl, type MessageDescriptor } from 'react-intl';
import type { Editor } from '@tiptap/react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger
} from '@orthacms/design-system';
import {
    MEDIA_ALIGNS,
    WYSIWYG_MEDIA_KINDS,
    asMediaAlign,
    type MediaAlign
} from '../../../../domain/constants';
import { useLiveEditorState } from '../../../hooks/useLiveEditorState';
import { ToolbarMenuTrigger } from '../ToolbarMenuTrigger';

const messages = defineMessages({
    label: { id: 'wysiwyg.align.label', defaultMessage: 'Alignment' },
    left: { id: 'wysiwyg.toolbar.alignLeft', defaultMessage: 'Align left' },
    center: {
        id: 'wysiwyg.toolbar.alignCenter',
        defaultMessage: 'Align center'
    },
    right: { id: 'wysiwyg.toolbar.alignRight', defaultMessage: 'Align right' },
    justify: { id: 'wysiwyg.toolbar.alignJustify', defaultMessage: 'Justify' }
});

/** The four alignments, in reading order, with the icon that stands for each. */
const ALIGNMENTS: readonly {
    value: string;
    message: MessageDescriptor;
    icon: ComponentType<{ className?: string }>;
}[] = [
    { value: 'left', message: messages.left, icon: AlignLeft },
    { value: 'center', message: messages.center, icon: AlignCenter },
    { value: 'right', message: messages.right, icon: AlignRight },
    { value: 'justify', message: messages.justify, icon: AlignJustify }
];

/** What the menu is aiming at, and where that thing currently sits. */
type Target = {
    /** True while a media node is selected — a different command, and no justify. */
    readonly media: boolean;
    /** The alignment in effect, as one of `ALIGNMENTS`' values. */
    readonly value: string;
};

const AT_REST: Target = { media: false, value: 'left' };

/**
 * Alignment, as one menu rather than four toggles.
 *
 * They are mutually exclusive — a block has exactly one alignment — so a radio
 * group is the honest control anyway, and it costs the bar one slot instead of
 * four. The trigger carries the current alignment's icon, so the collapsed form
 * still says which one is in effect.
 *
 * ### Media is aligned by a different mechanism, behind the same control
 *
 * `setTextAlign` writes a `text-align`, which positions a block's inline
 * *children*. An image **is** the block, so that property lands on it and moves
 * nothing — picking "centre" on a selected image used to do visibly nothing at
 * all. Media therefore carries its own `align` attribute and moves by its
 * margins (see `MEDIA_ALIGN`), and this menu switches to that command whenever
 * the selection is on a media node.
 *
 * It stays one control because it is one decision to the author. What changes is
 * the option list: media drops "Justify", which spreads the words of a line and
 * has nothing to do to a picture.
 */
export function AlignMenu({ editor }: { editor: Editor }) {
    const intl = useIntl();
    const target = useLiveEditorState<Target>(
        editor,
        (instance) => {
            const media = WYSIWYG_MEDIA_KINDS.find((name) =>
                instance.isActive(name)
            );
            if (media) {
                return {
                    media: true,
                    value: asMediaAlign(instance.getAttributes(media)['align'])
                };
            }
            return {
                media: false,
                value:
                    ALIGNMENTS.find((item) =>
                        instance.isActive({ textAlign: item.value })
                    )?.value ?? 'left'
            };
        },
        AT_REST
    );

    const options = target.media
        ? ALIGNMENTS.filter((item) =>
              MEDIA_ALIGNS.includes(item.value as MediaAlign)
          )
        : ALIGNMENTS;

    const active =
        options.find((item) => item.value === target.value) ?? ALIGNMENTS[0];

    const apply = (next: string) => {
        const chain = editor.chain().focus();
        if (target.media) chain.setMediaAlign(asMediaAlign(next)).run();
        else chain.setTextAlign(next).run();
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <ToolbarMenuTrigger
                    label={intl.formatMessage(messages.label)}
                    icon={active.icon}
                />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuRadioGroup
                    value={target.value}
                    onValueChange={apply}
                >
                    {options.map((item) => (
                        <DropdownMenuRadioItem
                            key={item.value}
                            value={item.value}
                        >
                            <item.icon className="size-4" />
                            {intl.formatMessage(item.message)}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
