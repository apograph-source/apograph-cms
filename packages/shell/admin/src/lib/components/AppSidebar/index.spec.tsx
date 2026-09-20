import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider, useSidebar } from '@orthacms/design-system';
import { wireSlotContributions } from '@orthacms/utils-admin';
import {
    SIDEBAR_FOOTER_SLOT,
    SIDEBAR_NAV_SLOT,
    type SidebarItem
} from '../../slots/sidebarSlots';
import {
    SidebarContentProvider,
    useSidebarContent
} from '../../utils/sidebarContent';
import { AppSidebar } from './index';

/**
 * What the sidebar swaps when a route takes over its contextual area, and what
 * it must not.
 *
 * The landmark is the part that is easy to get wrong in the tidy direction:
 * hoisting `<nav aria-label="Primary">` out of `GlobalSidebar` and into
 * `AppSidebar` looks like deduplication and reads fine on the global routes. It
 * leaves every workspace announcing its content nav as "Primary" — the wrong
 * name, on the one screen where the name is the only thing telling the two navs
 * apart. So the assertion is that the landmark *leaves* with the node that owns
 * it. (The other half — an override bringing its own — is the override author's
 * side of the contract; `workspaces-admin`'s `WorkspaceNav` supplies "Content
 * types", which `admin-e2e` resolves the workspace sidebar by.)
 *
 * The footer is the opposite promise: it sits outside the swappable area, so the
 * account menu and the copilot dock survive an override rather than vanishing
 * the moment someone opens a workspace.
 */

const auth = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('@orthacms/identity-admin', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@orthacms/identity-admin')>();
    return {
        ...actual,
        useAuth: () => ({
            status: actual.AuthStatus.Authenticated,
            user: {
                id: 'usr_1',
                email: 'ada@example.com',
                name: 'Ada',
                permissions: auth.permissions
            }
        }),
        useHasPermission: (permission: string) =>
            auth.permissions.includes(permission)
    };
});

function StubIcon({ className }: { className?: string }) {
    return <svg aria-hidden className={className} />;
}

const NAV: SidebarItem[] = [
    {
        labelId: 'shell.nav.home',
        defaultLabel: 'Home',
        to: '/',
        end: true,
        group: 'overview',
        order: 10,
        icon: StubIcon
    }
];

/** Stands in for the account menu — the footer's real occupant. */
function AccountMenu() {
    return <button type="button">Ada</button>;
}

/**
 * A route inside a workspace, doing what `WorkspaceNav` does: replacing the
 * contextual area with a nav that carries its own name.
 */
function WorkspaceRoute() {
    useSidebarContent(
        () => (
            <nav aria-label="Content types">
                <a href="/workspaces/w_1/content/article">Article</a>
            </nav>
        ),
        []
    );
    return null;
}

function renderSidebar({ inWorkspace = false } = {}) {
    wireSlotContributions([
        { slot: SIDEBAR_NAV_SLOT, items: NAV },
        {
            slot: SIDEBAR_FOOTER_SLOT,
            items: [{ id: 'account', order: 10, Component: AccountMenu }]
        }
    ]);

    render(
        <IntlProvider locale="en">
            <MemoryRouter initialEntries={['/']}>
                <SidebarContentProvider>
                    <SidebarProvider>
                        <AppSidebar />
                        {inWorkspace ? <WorkspaceRoute /> : null}
                    </SidebarProvider>
                </SidebarContentProvider>
            </MemoryRouter>
        </IntlProvider>
    );
}

beforeEach(() => {
    document.cookie = 'sidebar_state=; path=/; max-age=0';
});

afterEach(() => {
    wireSlotContributions([
        { slot: SIDEBAR_NAV_SLOT, items: [] },
        { slot: SIDEBAR_FOOTER_SLOT, items: [] }
    ]);
});

describe('AppSidebar', () => {
    it('names the global nav landmark Primary [shell:I-12]', () => {
        renderSidebar();

        expect(
            screen.getByRole('navigation', { name: 'Primary' })
        ).toBeTruthy();
    });

    it('takes the Primary landmark away with the node that owns it [shell:I-12]', () => {
        renderSidebar({ inWorkspace: true });

        expect(
            screen.queryByRole('navigation', { name: 'Primary' })
        ).toBeNull();
        expect(
            screen.getByRole('navigation', { name: 'Content types' })
        ).toBeTruthy();
        // And the global nav really is gone, not merely unnamed — an override
        // rendered *beside* `GlobalSidebar` would leave two navs on screen.
        expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
    });

    it('keeps the footer outside the swappable area [shell:I-13]', () => {
        renderSidebar({ inWorkspace: true });

        // The account menu and the copilot dock live here; an override that took
        // the footer with it would sign the user out of every affordance they
        // have the moment they opened a workspace.
        expect(screen.getByRole('button', { name: 'Ada' })).toBeTruthy();
    });
});

/**
 * **The two mobile strings** — the half of `shell:I-29` that had no case.
 *
 * Under the breakpoint the sidebar *is* a Radix dialog, and its accessible name
 * and description come from `mobileTitle` / `mobileDescription`. Left unpassed
 * they fall back to the design system's own English literals ("Sidebar",
 * "Displays the mobile sidebar."), which is exactly what `ORT-159` was filed
 * for: the drawer announced English in every locale and no consumer could
 * translate it. `host.spec.ts` reads the desktop `label` and
 * `AppShell/index.spec.tsx` the `scrollLabel`; neither ever crosses the
 * breakpoint, because a Playwright project's viewport is fixed by the config.
 *
 * jsdom will, though — `useIsMobile` decides from `matchMedia` on the first
 * frame (`design-system:I-21`), so overriding it is the whole fixture.
 */
describe('AppSidebar on a narrow viewport', () => {
    let realMatchMedia: typeof window.matchMedia;

    /** Reports every media query as matching, i.e. under the breakpoint. */
    function setMobile() {
        window.matchMedia = ((query: string) => ({
            matches: true,
            media: query,
            onchange: null,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            addListener: () => undefined,
            removeListener: () => undefined,
            dispatchEvent: () => false
        })) as typeof window.matchMedia;
    }

    /** Opens the drawer, which is closed on arrival. */
    function OpenDrawer() {
        const { setOpenMobile } = useSidebar();
        return (
            <button type="button" onClick={() => setOpenMobile(true)}>
                Open the drawer
            </button>
        );
    }

    beforeEach(() => {
        realMatchMedia = window.matchMedia;
        setMobile();
    });

    afterEach(() => {
        window.matchMedia = realMatchMedia;
    });

    it('names and describes the drawer with translated strings [shell:I-29]', () => {
        wireSlotContributions([{ slot: SIDEBAR_NAV_SLOT, items: NAV }]);

        render(
            <IntlProvider
                locale="de"
                messages={{
                    'shell.sidebar.mobileTitle': 'Navigation (de)',
                    'shell.sidebar.mobileDescription':
                        'Die Hauptnavigation (de)'
                }}
                // Every other descriptor in the chrome is deliberately absent
                // from this catalogue; react-intl reports each fallback, and the
                // noise is not what is under test.
                onError={() => undefined}
            >
                <MemoryRouter initialEntries={['/']}>
                    <SidebarContentProvider>
                        <SidebarProvider>
                            <AppSidebar />
                            <OpenDrawer />
                        </SidebarProvider>
                    </SidebarContentProvider>
                </MemoryRouter>
            </IntlProvider>
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Open the drawer' })
        );

        // A German catalogue, so an unpassed prop is not merely untranslated —
        // it is visibly the design system's English default, which is the
        // failure `ORT-159` describes and the one a `locale="en"` fixture could
        // never tell apart.
        const drawer = screen.getByRole('dialog', { name: 'Navigation (de)' });
        expect(drawer.textContent).toContain('Die Hauptnavigation (de)');
        expect(drawer.textContent).not.toContain('Displays the mobile sidebar');
    });
});
