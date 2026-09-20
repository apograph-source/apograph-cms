import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { defineMessages, useIntl } from 'react-intl';
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
import { PageActions } from '../PageActions';

/** Intl descriptors for {@link PageTopBar}, co-located here. */
const messages = defineMessages({
    nav: {
        id: 'shell.topbar.nav',
        defaultMessage: 'Breadcrumb'
    }
});

/** One crumb in a {@link PageTopBar}: a label, and a link unless current. */
export type PageTopBarCrumb = {
    /** Stable key for the list item. */
    key: string;
    /** The crumb's visible label. */
    label: ReactNode;
    /** Where the crumb links; omit for the current (or a grouping) crumb. */
    to?: string;
};

/**
 * The shared incident.io-style page-context bar: a neutral icon tile beside a
 * breadcrumb, sticky to the top of the page. Pass the **same icon the page's
 * sidebar nav entry uses**, so the chrome and the bar always agree. The last
 * crumb renders as the current page; earlier crumbs link when given `to`.
 */
export function PageTopBar({
    icon: Icon,
    iconClassName,
    crumbs
}: {
    /** The page's icon — the same component its sidebar nav entry uses. */
    icon: ComponentType<{ className?: string }>;
    /** Optional tile override; the default is the neutral gray tile. */
    iconClassName?: string;
    /** The trail, root first; the last entry is the current page. */
    crumbs: PageTopBarCrumb[];
}) {
    const intl = useIntl();
    const last = crumbs.length - 1;

    return (
        <TopBar>
            <TopBarIcon className={iconClassName}>
                <Icon />
            </TopBarIcon>
            {/* `min-w-0 overflow-hidden`: the trail gives way before the actions
                region does, so a long breadcrumb on a narrow screen truncates
                instead of pushing Save/Publish off the end of the bar. */}
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
                        // Below `sm` only the current page survives: the trail
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
            {/* Last child on purpose — the region is `ml-auto`, so anything
                after it would be pushed off the bar's end. */}
            <PageActions />
        </TopBar>
    );
}
