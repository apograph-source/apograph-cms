import type { ReactNode } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
import { Library } from 'lucide-react';
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
import { PageActions } from '@orthacms/shell-admin';
import type { ContentType } from '../../../domain/types/contentType';
import {
    CONTENT_SEGMENT,
    HISTORY_SEGMENT,
    ENTRY_TAB_SLUGS,
    NEW_SEGMENT,
    TRASH_SEGMENT,
    TYPE_PARAM
} from '../../../domain/constants';
import { EntryTitleCrumb } from './EntryTitleCrumb';

/** Intl descriptors for {@link ContentTopBar}, co-located here. */
const messages = defineMessages({
    nav: {
        id: 'content.topbar.nav',
        defaultMessage: 'Breadcrumb'
    },
    root: {
        id: 'content.topbar.root',
        defaultMessage: 'Content'
    },
    collections: {
        id: 'content.topbar.collections',
        defaultMessage: 'Collections'
    },
    pages: {
        id: 'content.topbar.pages',
        defaultMessage: 'Pages'
    },
    newRecord: {
        id: 'content.topbar.newRecord',
        defaultMessage: 'New record'
    },
    trash: {
        id: 'content.topbar.trash',
        defaultMessage: 'Trash'
    },
    history: {
        id: 'content.topbar.history',
        defaultMessage: 'History'
    }
});

/** One resolved crumb: a label, and an optional link target. */
type Crumb = {
    /** Stable key for the list item. */
    key: string;
    /** The crumb's visible label. */
    label: ReactNode;
    /** Where the crumb links; omitted for plain (group) and leaf crumbs. */
    to?: string;
};

/**
 * The incident.io-style top bar over the Content Library work area: an icon
 * tile plus a breadcrumb tracing the open location — Content › the kind
 * group (Collections / Pages) › the type's label › the open record (its
 * display title), "New record", or "Trash". Sticky to the top of the pane so
 * it stays put while the records or editor scroll beneath it. Route-derived
 * (one `useMatch` on the library's own pattern), so it needs no per-page
 * wiring.
 */
export function ContentTopBar({
    types,
    basePath
}: {
    /** The workspace's granted content types (for the type crumb's label). */
    types: ContentType[];
    /** Absolute base path for the library (`/workspaces/:id/content`). */
    basePath: string;
}) {
    const intl = useIntl();
    const match = useMatch(
        `/workspaces/:workspaceId/${CONTENT_SEGMENT}/:${TYPE_PARAM}/*`
    );
    const typeName = match?.params[TYPE_PARAM];
    const splat = match?.params['*'] ?? '';

    const crumbs: Crumb[] = [
        { key: 'root', label: intl.formatMessage(messages.root), to: basePath }
    ];

    if (typeName === HISTORY_SEGMENT) {
        crumbs.push({
            key: HISTORY_SEGMENT,
            label: intl.formatMessage(messages.history)
        });
    } else if (typeName === TRASH_SEGMENT) {
        crumbs.push({
            key: TRASH_SEGMENT,
            label: intl.formatMessage(messages.trash)
        });
    } else if (typeName) {
        const type = types.find((candidate) => candidate.name === typeName);
        if (type) {
            // The kind group the type belongs to, mirroring the sidebar's
            // Collections / Pages split. A grouping, not a route — no link.
            crumbs.push({
                key: `kind-${type.kind}`,
                label: intl.formatMessage(
                    type.kind === 'collection'
                        ? messages.collections
                        : messages.pages
                )
            });
        }
        crumbs.push({
            key: typeName,
            label: type?.label ?? typeName,
            to: `${basePath}/${typeName}`
        });

        // The leaf under the type: create form, trash view, or an open record.
        // A **single** page's editor is mounted on the type itself, so its tab
        // slug is the whole splat (`/home/relations`) — that's the open tab, not
        // a record id, and must not be resolved as one.
        const first = splat.split('/')[0];
        const leaf = ENTRY_TAB_SLUGS.some((slug) => slug === first)
            ? ''
            : first;
        if (leaf === NEW_SEGMENT) {
            crumbs.push({
                key: NEW_SEGMENT,
                label: intl.formatMessage(messages.newRecord)
            });
        } else if (leaf === TRASH_SEGMENT) {
            crumbs.push({
                key: TRASH_SEGMENT,
                label: intl.formatMessage(messages.trash)
            });
        } else if (leaf) {
            crumbs.push({
                key: leaf,
                label: <EntryTitleCrumb typeName={typeName} entryId={leaf} />
            });
        }
    }

    const last = crumbs.length - 1;

    return (
        <TopBar>
            <TopBarIcon className="bg-brand-soft text-brand-soft-foreground">
                <Library />
            </TopBarIcon>
            {/* `min-w-0 overflow-hidden`: the trail gives way before the actions
                region does, so a long breadcrumb on a narrow screen truncates
                instead of pushing Publish + ⋯ off the end of the bar. */}
            <Breadcrumb
                aria-label={intl.formatMessage(messages.nav)}
                className="min-w-0 overflow-hidden"
            >
                <BreadcrumbList className="flex-nowrap font-medium">
                    {crumbs.map((crumb, index) => [
                        index > 0 ? (
                            <BreadcrumbSeparator
                                key={`${crumb.key}-sep`}
                                className="hidden sm:flex"
                            />
                        ) : null,
                        // Below `sm` only the open record survives: the trail
                        // would otherwise shrink past its own text and the
                        // crumbs would overlap each other.
                        <BreadcrumbItem
                            key={crumb.key}
                            className={
                                index === last
                                    ? 'min-w-0 whitespace-nowrap'
                                    : 'hidden min-w-0 whitespace-nowrap sm:inline-flex'
                            }
                        >
                            {index === last ? (
                                <BreadcrumbPage className="flex min-w-0 items-center truncate font-medium">
                                    {crumb.label}
                                </BreadcrumbPage>
                            ) : crumb.to ? (
                                <BreadcrumbLink asChild>
                                    <Link to={crumb.to}>{crumb.label}</Link>
                                </BreadcrumbLink>
                            ) : (
                                <span>{crumb.label}</span>
                            )}
                        </BreadcrumbItem>
                    ])}
                </BreadcrumbList>
            </Breadcrumb>
            {/* The shell's page-actions region — the open entry editor portals
                its Publish + ⋯ in here, and the Properties panel's expand
                button appears here while that panel is collapsed. Last child on
                purpose: the region is `ml-auto`. */}
            <PageActions />
        </TopBar>
    );
}
