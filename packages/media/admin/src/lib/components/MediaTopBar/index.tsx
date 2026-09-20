import { defineMessages, useIntl } from 'react-intl';
import { Image } from 'lucide-react';
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
    TopBar,
    TopBarIcon
} from '@orthacms/design-system';
import { ROOT_FOLDER_ID } from '../../constants';
import type { MediaFolder } from '../../types/mediaFolder';

/** Intl descriptors for {@link MediaTopBar}, co-located. */
const messages = defineMessages({
    nav: { id: 'media.topbar.nav', defaultMessage: 'Breadcrumb' },
    root: { id: 'media.topbar.root', defaultMessage: 'Media Library' }
});

/**
 * The page top bar over the Media Library — the teal `Image` tile (matching the
 * plugin's workspace-nav entry) beside a breadcrumb tracing the open location:
 * Media Library › each ancestor folder › the open folder. Sticky to the top of
 * the page, spanning the folder sidebar and the browser both, the same
 * page-context header every other admin page carries.
 *
 * Unlike the Content Library's bar this one is **not** route-derived: folder
 * navigation here is component state, not a URL segment, so the crumbs come from
 * the store's `breadcrumbs` and each one dispatches `onNavigate` rather than
 * linking. They are still `BreadcrumbLink`s over real `<button>`s — a control
 * that changes view without changing location is a button, not a link.
 */
export function MediaTopBar({
    breadcrumbs,
    onNavigate
}: {
    /** Ancestor chain of the open folder, root-first (excludes the root itself). */
    breadcrumbs: MediaFolder[];
    onNavigate: (folderId: string) => void;
}) {
    const intl = useIntl();

    const crumbs = [
        { id: ROOT_FOLDER_ID, name: intl.formatMessage(messages.root) },
        ...breadcrumbs.map((folder) => ({ id: folder.id, name: folder.name }))
    ];
    const last = crumbs.length - 1;

    return (
        <TopBar>
            <TopBarIcon className="bg-teal-soft text-teal-soft-foreground">
                <Image />
            </TopBarIcon>
            <Breadcrumb aria-label={intl.formatMessage(messages.nav)}>
                <BreadcrumbList className="flex-nowrap font-medium">
                    {crumbs.map((crumb, index) => [
                        index > 0 ? (
                            <BreadcrumbSeparator key={`${crumb.id}-sep`} />
                        ) : null,
                        <BreadcrumbItem
                            key={crumb.id}
                            className="min-w-0 whitespace-nowrap"
                        >
                            {index === last ? (
                                <BreadcrumbPage className="flex min-w-0 items-center font-medium">
                                    {crumb.name}
                                </BreadcrumbPage>
                            ) : (
                                <BreadcrumbLink asChild>
                                    <button
                                        type="button"
                                        onClick={() => onNavigate(crumb.id)}
                                    >
                                        {crumb.name}
                                    </button>
                                </BreadcrumbLink>
                            )}
                        </BreadcrumbItem>
                    ])}
                </BreadcrumbList>
            </Breadcrumb>
        </TopBar>
    );
}
