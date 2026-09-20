import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, RequireAuth } from '@orthacms/identity-admin';
import { wireSlotContributions } from '@orthacms/utils-admin';
import { AppShell } from '../../components/AppShell';
import { SIDEBAR_NAV_SLOT } from '../../slots/sidebarSlots';
import { ShellPlugin } from './index';

/**
 * **Where `AppShell` sits in the layout** — the half of `shell:I-02` that the
 * browser suite cannot see.
 *
 * `apps/admin-e2e/src/auth/private-routes.spec.ts` pins the *outer* pair: put
 * `RequireAuth` outside `AuthProvider` and the gate reads a default context,
 * goes blind, and stops redirecting — which a signed-out visit to `/` shows
 * immediately. It says nothing about the third layer. A layout that rendered
 *
 * ```tsx
 * <AuthProvider>
 *     <RequireAuth />
 *     <AppShell />
 * </AuthProvider>
 * ```
 *
 * still redirects a signed-out visitor, so that suite stays green — and paints
 * the whole authenticated chrome (sidebar, nav rows, account menu) for the
 * frames before the redirect commits, to someone who is not signed in.
 *
 * So this asserts the composition twice over: the element tree the plugin
 * hands the host, and the rendered consequence of it with the gate closed.
 *
 * The gate is replaced by a stand-in whose *only* behaviour is "renders its
 * children, or does not". Identity's own specs pin what makes `RequireAuth`
 * decide; what is under test here is that the shell put its chrome **inside**
 * whatever that decision guards.
 */

const gate = vi.hoisted(() => ({ open: false }));

vi.mock('@orthacms/identity-admin', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@orthacms/identity-admin')>();
    return {
        ...actual,
        AuthProvider: ({ children }: { children: ReactNode }) => children,
        RequireAuth: ({ children }: { children: ReactNode }) =>
            gate.open ? children : <p>Sent to sign in</p>,
        useAuth: () => ({
            status: actual.AuthStatus.Authenticated,
            user: {
                id: 'usr_1',
                email: 'ada@example.com',
                name: 'Ada',
                permissions: [] as string[]
            }
        }),
        useHasPermission: () => false
    };
});

/** The layout the plugin contributes, rendered under the providers it needs. */
function renderLayout() {
    render(
        <IntlProvider locale="en">
            <MemoryRouter initialEntries={['/']}>
                {ShellPlugin().layout}
            </MemoryRouter>
        </IntlProvider>
    );
}

/**
 * The chrome, identified by the one landmark only `AppShell` mounts: the
 * sidebar's `complementary` region. Its name comes from `AppSidebar`'s `label`
 * prop, so this is the same node `shell:I-29` reads.
 */
const chrome = () => screen.queryByRole('complementary', { name: 'Sidebar' });

beforeEach(() => {
    gate.open = false;
    document.cookie = 'sidebar_state=; path=/; max-age=0';
    wireSlotContributions([{ slot: SIDEBAR_NAV_SLOT, items: [] }]);
});

afterEach(() => {
    document.cookie = 'sidebar_state=; path=/; max-age=0';
    wireSlotContributions([{ slot: SIDEBAR_NAV_SLOT, items: [] }]);
});

describe('the shell’s layout', () => {
    it('nests AuthProvider → RequireAuth → AppShell, each a single child [shell:I-02]', () => {
        const layout = ShellPlugin().layout as ReactElement<{
            children: ReactNode;
        }>;

        expect(layout.type).toBe(AuthProvider);

        // A single element at each level, not a fragment or an array: two
        // siblings under the provider is precisely the arrangement the e2e
        // suite cannot tell from this one.
        const guarded = layout.props.children;
        expect(isValidElement(guarded)).toBe(true);
        const gateElement = guarded as ReactElement<{ children: ReactNode }>;
        expect(gateElement.type).toBe(RequireAuth);

        const centre = gateElement.props.children;
        expect(isValidElement(centre)).toBe(true);
        expect((centre as ReactElement).type).toBe(AppShell);
    });

    it('draws no chrome at all while the gate is closed [shell:I-02]', () => {
        renderLayout();

        expect(screen.getByText('Sent to sign in')).toBeTruthy();
        // Nothing of the authenticated app: no sidebar landmark, and no skip
        // link, which is `AppShell`'s first focusable element.
        expect(chrome()).toBeNull();
        expect(screen.queryByText('Skip to main content')).toBeNull();
    });

    it('draws the chrome once the gate opens [shell:I-02]', () => {
        // The control. Without it the case above would pass against a layout
        // that never renders `AppShell` under any condition — the same shape as
        // a test that cannot fail.
        gate.open = true;
        renderLayout();

        expect(screen.queryByText('Sent to sign in')).toBeNull();
        expect(chrome()).not.toBeNull();
        expect(screen.getByText('Skip to main content')).toBeTruthy();
    });
});
