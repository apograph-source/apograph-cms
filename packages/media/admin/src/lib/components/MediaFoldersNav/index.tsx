import { defineMessages, useIntl } from 'react-intl';
import { Button, cn } from '@orthacms/design-system';
import { FolderPlus, Home, Images } from 'lucide-react';
import { ROOT_FOLDER_ID } from '../../constants';
import type { MediaFolder } from '../../types/mediaFolder';
import { MediaFolderTreeItem } from './MediaFolderTreeItem';

/** Intl descriptors for {@link MediaFoldersNav}, co-located. */
const messages = defineMessages({
    nav: { id: 'media.nav.nav', defaultMessage: 'Folders' },
    heading: { id: 'media.nav.heading', defaultMessage: 'Library' },
    allMedia: { id: 'media.nav.allMedia', defaultMessage: 'All media' },
    allCount: {
        id: 'media.nav.allCount',
        defaultMessage: '{count, plural, one {# item} other {# items}}'
    },
    newFolder: { id: 'media.nav.newFolder', defaultMessage: 'New folder' }
});

/**
 * The Media Library's folder sidebar — a **flat** nav region sitting flush on the
 * page background (mirroring the Content Library sidebar), not a bordered island.
 * The page supplies the divider (`lg:border-r`) via `className`, so the mobile
 * drawer copy renders without one. An "All media" root entry sits above the
 * folder tree, where any folder with sub-folders is collapsible; a New folder
 * action closes the list. Highlights the open folder and dispatches navigation /
 * create up to the page.
 */
export function MediaFoldersNav({
    folders,
    currentFolderId,
    counts,
    rootCount,
    onNavigate,
    onNewFolder,
    canCreate,
    className
}: {
    folders: MediaFolder[];
    currentFolderId: string;
    counts: Map<string, number>;
    /** Item count shown against the "All media" root row. */
    rootCount: number;
    onNavigate: (folderId: string) => void;
    onNewFolder: () => void;
    canCreate: boolean;
    className?: string;
}) {
    const intl = useIntl();
    const topLevel = folders
        .filter((f) => f.parentId === ROOT_FOLDER_ID)
        .sort((a, b) => a.name.localeCompare(b.name));
    const rootActive = currentFolderId === ROOT_FOLDER_ID;

    return (
        <nav
            aria-label={intl.formatMessage(messages.nav)}
            className={cn(
                'flex h-full w-60 shrink-0 flex-col overflow-hidden',
                className
            )}
        >
            <div className="flex items-center gap-2 p-2">
                <Images className="size-4 text-muted-foreground" aria-hidden />
                <h2 className="text-sm font-semibold tracking-[-0.01em]">
                    {intl.formatMessage(messages.heading)}
                </h2>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2">
                <ul className="space-y-0.5">
                    <li>
                        <button
                            type="button"
                            onClick={() => onNavigate(ROOT_FOLDER_ID)}
                            aria-current={rootActive ? 'true' : undefined}
                            className={cn(
                                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                rootActive
                                    ? 'bg-primary/10 font-medium text-primary'
                                    : 'text-foreground hover:bg-accent'
                            )}
                        >
                            <Home
                                className={cn(
                                    'size-4 shrink-0',
                                    rootActive
                                        ? 'text-primary'
                                        : 'text-muted-foreground'
                                )}
                                aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate">
                                {intl.formatMessage(messages.allMedia)}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {intl.formatMessage(messages.allCount, {
                                    count: rootCount
                                })}
                            </span>
                        </button>
                    </li>
                    {topLevel.map((folder) => (
                        <MediaFolderTreeItem
                            key={folder.id}
                            folder={folder}
                            folders={folders}
                            currentFolderId={currentFolderId}
                            counts={counts}
                            onNavigate={onNavigate}
                        />
                    ))}
                </ul>
            </div>

            {canCreate ? (
                <div className="p-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full justify-start shadow-none"
                        onClick={onNewFolder}
                    >
                        <FolderPlus aria-hidden />
                        {intl.formatMessage(messages.newFolder)}
                    </Button>
                </div>
            ) : null}
        </nav>
    );
}
