import { defineMessages, useIntl } from 'react-intl';
import type { Editor } from '@tiptap/react';
import { Pilcrow } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger
} from '@orthacms/design-system';
import { useLiveEditorState } from '../../../hooks/useLiveEditorState';
import { ToolbarMenuTrigger } from '../ToolbarMenuTrigger';

const messages = defineMessages({
    label: { id: 'wysiwyg.blockType.label', defaultMessage: 'Text style' },
    paragraph: {
        id: 'wysiwyg.blockType.paragraph',
        defaultMessage: 'Paragraph'
    },
    heading1: { id: 'wysiwyg.blockType.heading1', defaultMessage: 'Heading 1' },
    heading2: { id: 'wysiwyg.blockType.heading2', defaultMessage: 'Heading 2' },
    heading3: { id: 'wysiwyg.blockType.heading3', defaultMessage: 'Heading 3' },
    heading4: { id: 'wysiwyg.blockType.heading4', defaultMessage: 'Heading 4' },
    codeBlock: {
        id: 'wysiwyg.blockType.codeBlock',
        defaultMessage: 'Code block'
    },
    // Short forms for the trigger only. The full names above stay in the menu,
    // where there is room to read them; the trigger has to survive on a bar
    // that must not wrap, and "Heading 2" spent 60px saying what "H2" says.
    shortParagraph: {
        id: 'wysiwyg.blockType.shortParagraph',
        defaultMessage: 'Text'
    },
    shortHeading1: {
        id: 'wysiwyg.blockType.shortHeading1',
        defaultMessage: 'H1'
    },
    shortHeading2: {
        id: 'wysiwyg.blockType.shortHeading2',
        defaultMessage: 'H2'
    },
    shortHeading3: {
        id: 'wysiwyg.blockType.shortHeading3',
        defaultMessage: 'H3'
    },
    shortHeading4: {
        id: 'wysiwyg.blockType.shortHeading4',
        defaultMessage: 'H4'
    },
    shortCodeBlock: {
        id: 'wysiwyg.blockType.shortCodeBlock',
        defaultMessage: 'Code'
    }
});

/** The block types the menu switches between, in the order it lists them. */
const BLOCK_TYPE = {
    Paragraph: 'paragraph',
    Heading1: 'heading-1',
    Heading2: 'heading-2',
    Heading3: 'heading-3',
    Heading4: 'heading-4',
    CodeBlock: 'code-block'
} as const;

type BlockType = (typeof BLOCK_TYPE)[keyof typeof BLOCK_TYPE];

/** Heading levels, paired with the menu value and label that stand for them. */
const HEADINGS: readonly {
    level: 1 | 2 | 3 | 4;
    value: BlockType;
    message: typeof messages.heading1;
    short: typeof messages.heading1;
}[] = [
    {
        level: 1,
        value: BLOCK_TYPE.Heading1,
        message: messages.heading1,
        short: messages.shortHeading1
    },
    {
        level: 2,
        value: BLOCK_TYPE.Heading2,
        message: messages.heading2,
        short: messages.shortHeading2
    },
    {
        level: 3,
        value: BLOCK_TYPE.Heading3,
        message: messages.heading3,
        short: messages.shortHeading3
    },
    {
        level: 4,
        value: BLOCK_TYPE.Heading4,
        message: messages.heading4,
        short: messages.shortHeading4
    }
];

/**
 * The block-type picker: paragraph, the four heading levels, or a code block.
 * A radio group rather than a list of toggles, because these are genuinely
 * exclusive — a block is exactly one of them, and the trigger shows which.
 */
export function BlockTypeMenu({ editor }: { editor: Editor }) {
    const intl = useIntl();
    const current = useLiveEditorState(
        editor,
        (instance): BlockType => {
            if (instance.isActive('codeBlock')) return BLOCK_TYPE.CodeBlock;
            const heading = HEADINGS.find((item) =>
                instance.isActive('heading', { level: item.level })
            );
            return heading?.value ?? BLOCK_TYPE.Paragraph;
        },
        BLOCK_TYPE.Paragraph
    );

    const apply = (next: string) => {
        if (next === BLOCK_TYPE.CodeBlock) {
            editor.chain().focus().setCodeBlock().run();
            return;
        }
        // Step out of a code block first, in its own transaction. A code block
        // holds plain text, so a chained `setHeading` is validated against the
        // pre-chain state and refused; converting to a paragraph and *then*
        // setting the heading always lands.
        if (editor.isActive('codeBlock')) {
            editor.chain().focus().setParagraph().run();
        }
        const heading = HEADINGS.find((item) => item.value === next);
        if (heading) {
            editor.chain().focus().setHeading({ level: heading.level }).run();
        } else {
            editor.chain().focus().setParagraph().run();
        }
    };

    const label = intl.formatMessage(messages.label);
    const currentLabel = intl.formatMessage(
        HEADINGS.find((item) => item.value === current)?.short ??
            (current === BLOCK_TYPE.CodeBlock
                ? messages.shortCodeBlock
                : messages.shortParagraph)
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <ToolbarMenuTrigger
                    label={label}
                    icon={Pilcrow}
                    value={currentLabel}
                />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuRadioGroup value={current} onValueChange={apply}>
                    <DropdownMenuRadioItem value={BLOCK_TYPE.Paragraph}>
                        {intl.formatMessage(messages.paragraph)}
                    </DropdownMenuRadioItem>
                    {HEADINGS.map((item) => (
                        <DropdownMenuRadioItem
                            key={item.value}
                            value={item.value}
                        >
                            {intl.formatMessage(item.message)}
                        </DropdownMenuRadioItem>
                    ))}
                    <DropdownMenuRadioItem value={BLOCK_TYPE.CodeBlock}>
                        {intl.formatMessage(messages.codeBlock)}
                    </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
