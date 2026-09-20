import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    Command,
    CommandList,
    Sidebar,
    SidebarMenu,
    SidebarProvider
} from '@orthacms/design-system';
import type { SidebarItem } from '../../slots/sidebarSlots';
import { SidebarNavButton } from './SidebarNavButton';
import { SidebarCommandItem } from './SidebarSearch/SidebarCommandItem';

/**
 * The permission hook is called on **every** render of a nav destination, with
 * `''` standing in for "this row is ungated".
 *
 * The rule reads like an implementation detail and is not one. Both controls
 * below decide visibility from `useHasPermission`, and the obvious way to write
 * that is `item.permission ? useHasPermission(item.permission) : true` — which
 * calls a hook conditionally and makes the hook order a function of slot data.
 * A plugin that later contributes a gated row where an ungated one used to sit
 * would then remount the row into a different hook sequence.
 *
 * ## What makes this observable
 *
 * The judgment this file retires said the rule was implementation shape only,
 * on the grounds that `item.permission` is fixed for an instance's lifetime so
 * the hook order never actually shifts within one component. That is true of
 * the *consequence* and false of the *statement*: whether the hook ran at all
 * is visible the moment `useHasPermission` is a spy rather than a stub. A
 * conditional call skips it for an ungated row; the unconditional one records
 * `''`.
 *
 * The stub returns `true` throughout, so nothing here turns on the answer —
 * only on the call. `GlobalSidebar/index.spec.tsx` owns what the answer does.
 */

const identity = vi.hoisted(() => ({
    useHasPermission: vi.fn((_permission: string) => true)
}));

vi.mock('@orthacms/identity-admin', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@orthacms/identity-admin')>();
    return { ...actual, useHasPermission: identity.useHasPermission };
});

/** A nav icon that contributes no accessible text. */
function StubIcon({ className }: { className?: string }) {
    return <svg aria-hidden className={className} />;
}

const item = (permission?: string): SidebarItem => ({
    labelId: 'shell.nav.home',
    defaultLabel: 'Home',
    to: '/',
    end: true,
    group: 'overview',
    order: 10,
    icon: StubIcon,
    ...(permission ? { permission } : {})
});

/** The row as the sidebar mounts it — inside a menu, inside a router. */
function renderNavButton(entry: SidebarItem) {
    render(
        <IntlProvider locale="en">
            <MemoryRouter initialEntries={['/']}>
                <SidebarProvider>
                    <Sidebar>
                        <SidebarMenu>
                            <SidebarNavButton item={entry} />
                        </SidebarMenu>
                    </Sidebar>
                </SidebarProvider>
            </MemoryRouter>
        </IntlProvider>
    );
}

/** The palette result as `SidebarSearch` mounts it — inside a cmdk list. */
function renderCommandItem(entry: SidebarItem) {
    render(
        <IntlProvider locale="en">
            <Command>
                <CommandList>
                    <SidebarCommandItem
                        item={entry}
                        onNavigate={() => undefined}
                    />
                </CommandList>
            </Command>
        </IntlProvider>
    );
}

describe('the nav permission gate calls its hook unconditionally', () => {
    beforeEach(() => {
        identity.useHasPermission.mockClear();
    });

    it('asks about the empty key for an ungated sidebar row [shell:I-09]', () => {
        renderNavButton(item());

        // The assertion that fails on the conditional shape: it never asks.
        expect(identity.useHasPermission).toHaveBeenCalledWith('');
    });

    it('asks about the declared key for a gated sidebar row [shell:I-09]', () => {
        renderNavButton(item('users:read'));

        expect(identity.useHasPermission).toHaveBeenCalledWith('users:read');
        // No second call with a different key: one row, one question, so the
        // two cases above are the same call site and not two branches.
        expect(identity.useHasPermission).not.toHaveBeenCalledWith('');
    });

    it('asks about the empty key for an ungated palette result [shell:I-09]', () => {
        // The second call site of the same rule. `SidebarNavButton` alone would
        // leave a conditional call in the palette unseen, and the palette is
        // where a row's gate is easiest to forget — it renders a cmdk item, not
        // a sidebar menu button.
        renderCommandItem(item());

        expect(identity.useHasPermission).toHaveBeenCalledWith('');
    });

    it('asks about the declared key for a gated palette result [shell:I-09]', () => {
        renderCommandItem(item('users:read'));

        expect(identity.useHasPermission).toHaveBeenCalledWith('users:read');
        expect(identity.useHasPermission).not.toHaveBeenCalledWith('');
    });
});
