import { defineMessages, useIntl } from 'react-intl';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    cn
} from '@orthacms/design-system';
import { ChevronRight, Folder } from 'lucide-react';
import type { MediaFolder } from '../../../types/mediaFolder';

/** Intl descriptors for {@link MediaFolderTreeItem}, co-located. */
const messages = defineMessages({
    toggle: { id: 'media.tree.toggle', defaultMessage: 'Toggle {name}' },
    count: {
        id: 'media.tree.count',
        defaultMessage: '{count, plural, one {# item} other {# items}}'
    }
});

/**
 * One folder in the sidebar tree. A folder with sub-folders is a
 * design-system `Collapsible` (a chevron toggles its children under a left tree
 * line; Radix manages `aria-expanded`), starting expanded; a leaf folder gets a
 * matching spacer so names align. The name is a separate button that navigates
 * into the folder — clicking it never toggles the group — and the open folder is
 * highlighted. Navigation dispatches up.
 */
export function MediaFolderTreeItem({
    folder,
    folders,
    currentFolderId,
    counts,
    onNavigate
}: {
    folder: MediaFolder;
    folders: MediaFolder[];
    currentFolderId: string;
    counts: Map<string, number>;
    onNavigate: (folderId: string) => void;
}) {
    const intl = useIntl();
    const children = folders
        .filter((f) => f.parentId === folder.id)
        .sort((a, b) => a.name.localeCompare(b.name));
    const hasChildren = children.length > 0;
    const active = currentFolderId === folder.id;

    const nameButton = (
        <button
            type="button"
            onClick={() => onNavigate(folder.id)}
            aria-current={active ? 'true' : undefined}
            className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'font-medium text-primary' : 'text-foreground'
            )}
        >
            <Folder
                className={cn(
                    'size-4 shrink-0',
                    active ? 'text-primary' : 'text-muted-foreground'
                )}
                aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {intl.formatMessage(messages.count, {
                    count: counts.get(folder.id) ?? 0
                })}
            </span>
        </button>
    );

    if (!hasChildren) {
        return (
            <li>
                <div
                    className={cn(
                        'flex items-center gap-0.5 rounded-md pl-1 transition-colors',
                        active ? 'bg-primary/10' : 'hover:bg-accent'
                    )}
                >
                    <span className="size-6 shrink-0" aria-hidden />
                    {nameButton}
                </div>
            </li>
        );
    }

    return (
        <li>
            <Collapsible defaultOpen className="group/folder">
                <div
                    className={cn(
                        'flex items-center gap-0.5 rounded-md pl-1 transition-colors',
                        active ? 'bg-primary/10' : 'hover:bg-accent'
                    )}
                >
                    <CollapsibleTrigger asChild>
                        <button
                            type="button"
                            aria-label={intl.formatMessage(messages.toggle, {
                                name: folder.name
                            })}
                            className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <ChevronRight className="size-3.5 transition-transform duration-200 group-data-[state=open]/folder:rotate-90" />
                        </button>
                    </CollapsibleTrigger>
                    {nameButton}
                </div>
                <CollapsibleContent>
                    <ul className="ml-[0.85rem] mt-0.5 space-y-0.5 border-l border-border pl-1.5">
                        {children.map((child) => (
                            <MediaFolderTreeItem
                                key={child.id}
                                folder={child}
                                folders={folders}
                                currentFolderId={currentFolderId}
                                counts={counts}
                                onNavigate={onNavigate}
                            />
                        ))}
                    </ul>
                </CollapsibleContent>
            </Collapsible>
        </li>
    );
}
