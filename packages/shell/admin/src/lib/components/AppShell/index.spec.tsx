import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wireSlotContributions } from '@orthacms/utils-admin';
import { SIDEBAR_NAV_SLOT, type SidebarItem } from '../../slots/sidebarSlots';
import { AppShell } from './index';

/**
 * The floating sidebar toggle's position in the tree — a rule that exists
 * entirely because of a CSS selector, and is therefore invisible to every test
 * that looks at rendered pixels.
 *
 * `SidebarToggle` hides itself on any page that draws a top bar (which carries
 * its own inline reveal trigger) with
 * `[main:has([data-slot=top-bar])~&]:hidden` — a *sibling* combinator rooted at
 * `<main>`. Put a wrapper `<div>` between the shell and the button and the
 * selector stops matching: the rule silently does nothing, and a floating button
 * reappears on top of the bar on every page in the product. Nothing throws, and
 * a screenshot of the Home page — the one page where the button is supposed to
 * show — looks exactly right.
 *
 * jsdom applies no Tailwind, so what is asserted is the DOM relationship the
 * selector needs, which is the thing a refactor breaks.
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

beforeEach(() => {
    // Collapsed, because the floating toggle is the collapsed sidebar's reveal
    // control and does not render while the panel is open.
    document.cookie = 'sidebar_state=false; path=/';
    window.localStorage.clear();
    wireSlotContributions([{ slot: SIDEBAR_NAV_SLOT, items: NAV }]);
});

afterEach(() => {
    document.cookie = 'sidebar_state=; path=/; max-age=0';
    window.localStorage.clear();
    wireSlotContributions([{ slot: SIDEBAR_NAV_SLOT, items: [] }]);
});

describe('AppShell', () => {
    it('keeps the floating toggle a sibling of main, after it [shell:I-24]', () => {
        render(
            <IntlProvider locale="en">
                <MemoryRouter initialEntries={['/']}>
                    <Routes>
                        <Route element={<AppShell />}>
                            <Route path="/" element={<div>A page</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </IntlProvider>
        );

        const main = screen.getByRole('main');
        // By role + name, not by label text: `SidebarTrigger` names itself with
        // an `sr-only` span rather than an `aria-label`.
        const toggle = screen.getByRole('button', { name: 'Show navigation' });

        // `~` needs a shared parent and `main` first; a wrapper around the
        // button breaks the first, reordering breaks the second.
        expect(toggle.parentElement).toBe(main.parentElement);
        expect(
            main.compareDocumentPosition(toggle) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it('names the scrollport tab stop, in the app’s locale [shell:I-29]', () => {
        // The design system exposes the name as a prop precisely because it
        // carries no `react-intl`; the shell is the only place that can pass a
        // translated one, and until `ORT-150` the stop had neither name nor role.
        // The scrollport is a `group`, not a `region`, so naming it does not add
        // a second landmark beside `<main>`.
        render(
            <IntlProvider locale="en">
                <MemoryRouter initialEntries={['/']}>
                    <Routes>
                        <Route element={<AppShell />}>
                            <Route path="/" element={<div>A page</div>} />
                        </Route>
                    </Routes>
                </MemoryRouter>
            </IntlProvider>
        );

        const scrollport = screen.getByRole('group', { name: 'Page content' });
        expect(screen.getByRole('main').contains(scrollport)).toBe(true);
        expect(scrollport.getAttribute('tabindex')).toBe('0');
    });
});
