import { defineMessages, useIntl } from 'react-intl';
import { Film, Image as ImageIcon } from 'lucide-react';
import {
    DropdownMenuItem,
    DropdownMenuSeparator
} from '@orthacms/design-system';
import {
    WYSIWYG_MEDIA_KIND,
    type WysiwygMediaKind
} from '../../../../../domain/constants';
import type { WysiwygMediaSourceItem } from '../../../../slots/wysiwygSlots';

const messages = defineMessages({
    imageFromUrl: {
        id: 'wysiwyg.media.imageFromUrl',
        defaultMessage: 'Image from a URL…'
    },
    videoFromUrl: {
        id: 'wysiwyg.media.videoFromUrl',
        defaultMessage: 'Video from a URL…'
    }
});

/**
 * The Insert ▸ Media submenu: every contributed source, then the two built-in
 * URL entries.
 *
 * Contributed sources come **first** because they are the ones that keep an
 * asset in the library, which is what a CMS wants by default; naming a URL is
 * the escape hatch for a file that genuinely lives somewhere else, so it sits
 * below the rule.
 *
 * The items only *open* things. Every source's UI is mounted by the toolbar —
 * a menu's content unmounts the instant the menu closes, which is exactly when
 * a picker needs to appear.
 */
export function MediaItems({
    sources,
    onOpenSource,
    onOpenUrl
}: {
    /** Contributed sources, already ordered. */
    sources: readonly WysiwygMediaSourceItem[];
    onOpenSource: (id: string) => void;
    onOpenUrl: (kind: WysiwygMediaKind) => void;
}) {
    const intl = useIntl();

    return (
        <>
            {sources.map((source) => {
                const Icon = source.icon;
                return (
                    <DropdownMenuItem
                        key={source.id}
                        onSelect={() => onOpenSource(source.id)}
                    >
                        {Icon ? <Icon className="size-4" /> : null}
                        {intl.formatMessage(source.label)}
                    </DropdownMenuItem>
                );
            })}

            {sources.length > 0 ? <DropdownMenuSeparator /> : null}

            <DropdownMenuItem
                onSelect={() => onOpenUrl(WYSIWYG_MEDIA_KIND.Image)}
            >
                <ImageIcon className="size-4" />
                {intl.formatMessage(messages.imageFromUrl)}
            </DropdownMenuItem>
            <DropdownMenuItem
                onSelect={() => onOpenUrl(WYSIWYG_MEDIA_KIND.Video)}
            >
                <Film className="size-4" />
                {intl.formatMessage(messages.videoFromUrl)}
            </DropdownMenuItem>
        </>
    );
}
