import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, SidebarProvider } from '@orthacms/design-system';
import { wireSlotContributions } from '@orthacms/utils-admin';
import {
    SIDEBAR_NAV_SLOT,
    type SidebarItem
} from '../../../slots/sidebarSlots';
import { GlobalSidebar } from './index';

/**
 * The global sidebar's two rules about *rows the signed-in user cannot have*.
 *
 * Neither is reachable from `admin-e2e`, and the reason is the shipped nav
 * itself: `workspaces-admin` contributes a Directory row with no `permission` at
 * all, so no account the browser suite can sign in as ever empties that group.
 * The heading-over-emptiness case only exists against a nav this file supplies —
 * which is precisely the fixture problem to look for, not to work around: a
 * browser test written for this rule would have passed for the wrong reason.
 *
 * Auth is the one collaborator stubbed. `useAuth` is a data source (the shell
 * has no other way to know who is signed in), and `useHasPermission` is restated
 * over the same fixture because the row-level check runs inside the identity
 * package, whose own spec pins the rule. Everything branching on those answers —
 * the group filter, the empty-group guard, the row's own gate — is the real
 * component.
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

/** A nav icon that contributes no accessible text, so row names stay readable. */
function StubIcon({ className }: { className?: string }) {
    return <svg aria-hidden className={className} />;
}

/**
 * A nav shaped like the shipped one, except that **every** Directory row is
 * permission-gated. Without that, "a heading never hangs over emptiness" has no
 * fixture that can distinguish the guard from its absence.
 */
const NAV: SidebarItem[] = [
    {
        labelId: 'shell.nav.home',
        defaultLabel: 'Home',
        to: '/',
        end: true,
        group: 'overview',
        order: 10,
        icon: StubIcon
    },
    {
        labelId: 'test.nav.activity',
        defaultLabel: 'Activity',
        to: '/activity',
        group: 'overview',
        order: 20,
        icon: StubIcon,
        permission: 'activity:read'
    },
    {
        labelId: 'test.nav.members',
        defaultLabel: 'Members',
        to: '/users',
        group: 'directory',
        order: 10,
        icon: StubIcon,
        permission: 'users:read'
    },
    {
        labelId: 'test.nav.tokens',
        defaultLabel: 'API tokens',
        to: '/api-tokens',
        group: 'directory',
        order: 20,
        icon: StubIcon,
        permission: 'tokens:read'
    }
];

function renderSidebar({
    permissions = [] as string[],
    path = '/',
    nav = NAV
} = {}) {
    auth.permissions = permissions;
    // The host's own wiring, not a hand-rolled `_register`: it resets first, so
    // one test's nav cannot leak into the next.
    wireSlotContributions([{ slot: SIDEBAR_NAV_SLOT, items: nav }]);

    render(
        <IntlProvider locale="en">
            <MemoryRouter initialEntries={[path]}>
                <SidebarProvider>
                    <Sidebar collapsible="offcanvas">
                        <GlobalSidebar />
                    </Sidebar>
                </SidebarProvider>
            </MemoryRouter>
        </IntlProvider>
    );
}

beforeEach(() => {
    document.cookie = 'sidebar_state=; path=/; max-age=0';
});

afterEach(() => {
    auth.permissions = [];
    wireSlotContributions([{ slot: SIDEBAR_NAV_SLOT, items: [] }]);
});

describe('the global sidebar’s primary nav', () => {
    it('renders the groups in their fixed order and the rows by order [shell:I-07]', () => {
        // Registered scrambled *within each group*, so a component that read the
        // slot straight through instead of via `byOrder` would put Activity
        // above Home and API tokens above Members — the plugin registration
        // order deciding the nav, which is the thing `order` exists to stop.
        renderSidebar({
            permissions: ['activity:read', 'users:read', 'tokens:read'],
            nav: [NAV[1], NAV[3], NAV[0], NAV[2]]
        });

        expect(
            screen.getAllByRole('link').map((link) => link.textContent)
        ).toEqual(['Home', 'Activity', 'Members', 'API tokens']);
    });

    it('drops a group whose every row was filtered out [shell:I-10]', () => {
        renderSidebar({ permissions: [] });

        // Overview survives on its ungated Home row, which is what makes this a
        // test of the *group* guard rather than of "nothing rendered at all".
        expect(screen.getByText('Overview')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy();

        // Directory has two rows, both gated, and the user holds neither.
        expect(screen.queryByText('Directory')).toBeNull();
        expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
        expect(screen.queryByRole('link', { name: 'API tokens' })).toBeNull();
    });

    it('keeps the group as soon as one row survives [shell:I-10]', () => {
        // The control: a guard that dropped every group would pass the case
        // above and take the whole nav with it.
        renderSidebar({ permissions: ['users:read'] });

        expect(screen.getByText('Directory')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Members' })).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'API tokens' })).toBeNull();
    });

    it('marks the open row current, visually and to a screen reader [shell:I-28]', () => {
        renderSidebar({ permissions: ['users:read'], path: '/users' });

        const members = screen.getByRole('link', { name: 'Members' });
        expect(members.getAttribute('aria-current')).toBe('page');
        expect(members.getAttribute('data-active')).toBe('true');
    });

    it('leaves Home uncurrent on a sub-route, because only it is exact [shell:I-28]', () => {
        // `end: true` is the whole difference. Without it Home matches `/*` and
        // every page in the product announces two current rows.
        renderSidebar({ permissions: ['users:read'], path: '/users' });

        const home = screen.getByRole('link', { name: 'Home' });
        expect(home.getAttribute('aria-current')).toBeNull();
        expect(home.getAttribute('data-active')).toBe('false');
    });

    it('marks Home current on the root route [shell:I-28]', () => {
        renderSidebar({ permissions: [], path: '/' });

        const home = screen.getByRole('link', { name: 'Home' });
        expect(home.getAttribute('aria-current')).toBe('page');
        expect(home.getAttribute('data-active')).toBe('true');
    });
});
