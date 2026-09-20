import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '@orthacms/design-system';
import { wireSlotContributions } from '@orthacms/utils-admin';
import {
    SIDEBAR_NAV_SLOT,
    type SidebarItem
} from '../../../slots/sidebarSlots';
import { SidebarSearch } from './index';

/**
 * **The palette's copy of the two sidebar rules** — the permission gate and the
 * chord guard.
 *
 * `shell:I-08` says the permission rule is "the same in the sidebar and in the
 * palette". Only the sidebar half had a test: `unconditional-permission.spec.tsx`
 * covers `SidebarNavButton`, and `apps/admin-e2e/src/users/members.spec.ts`
 * reads the *nav*, never the ⌘K results. `SidebarCommandItem` re-implements the
 * gate — a second `useHasPermission` call in a second file — so a row that
 * stopped being gated there would offer a member with no `users:read` a result
 * that lands them on the page's no-access state, and nothing in the repo would
 * say so.
 *
 * The reason it went unwritten in the unit pass was a guess about the harness,
 * not about the code: the control renders a cmdk `CommandItem`, which needs a
 * `Command` context, and the note assumed no spec in the repo drove cmdk under
 * jsdom. `packages/design-system/src/lib/components/ui/multi-select.spec.tsx`
 * already does, and `src/test-setup.ts` shims the four browser APIs the dialog
 * reaches for — naming `CommandDialog` in its own comment.
 *
 * The chord half (`shell:I-26`) is here for the same reason: the ⌘K listener
 * lives on `window`, so pressing it while a page's own search field has the
 * caret is what the guard exists for, and the e2e case that covers it can only
 * observe the caret, not whether the dialog was suppressed.
 */

const auth = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('@orthacms/identity-admin', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@orthacms/identity-admin')>();
    return {
        ...actual,
        useHasPermission: (permission: string) =>
            auth.permissions.includes(permission)
    };
});

function StubIcon({ className }: { className?: string }) {
    return <svg aria-hidden className={className} />;
}

/**
 * Two destinations that differ in exactly one field. Anyone signed in may see
 * Home; Members is gated on `users:read`, which is the row the real sidebar
 * gates the same way.
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
        labelId: 'users.nav.members',
        defaultLabel: 'Members',
        to: '/users',
        group: 'directory',
        order: 20,
        permission: 'users:read',
        icon: StubIcon
    }
];

function renderSearch({ withField = false } = {}) {
    wireSlotContributions([{ slot: SIDEBAR_NAV_SLOT, items: NAV }]);

    return render(
        <IntlProvider locale="en">
            <MemoryRouter initialEntries={['/']}>
                <SidebarSearch />
                {withField ? <Input aria-label="Filter entries" /> : null}
            </MemoryRouter>
        </IntlProvider>
    );
}

/** Opens the palette the way a pointer user does, and waits for the results. */
async function openPalette() {
    renderSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
}

/** The labels cmdk is currently offering. */
const results = () =>
    screen.queryAllByRole('option').map((option) => option.textContent);

beforeEach(() => {
    auth.permissions = [];
});

afterEach(() => {
    wireSlotContributions([{ slot: SIDEBAR_NAV_SLOT, items: [] }]);
});

describe('the ⌘K palette', () => {
    it('offers a gated destination only to a holder of its permission [shell:I-08]', async () => {
        auth.permissions = ['users:read'];
        await openPalette();

        // Both, so the case below is a difference and not an empty palette.
        await waitFor(() => expect(results()).toContain('Members'));
        expect(results()).toContain('Home');
    });

    it('hides a gated destination from someone without it [shell:I-08]', async () => {
        await openPalette();

        await waitFor(() => expect(results()).toContain('Home'));
        // The ungated row is still there: the gate is per row, not "the palette
        // is empty for anyone without permissions".
        expect(results()).not.toContain('Members');
    });

    it('leaves ⌘K alone while a page’s own field has the caret [shell:I-26]', () => {
        renderSearch({ withField: true });
        const field = screen.getByRole('textbox', { name: 'Filter entries' });
        field.focus();

        // Dispatched on the field, not on `window`: the listener is a window
        // one, so the press has to arrive there by bubbling for `event.target`
        // to be the field — which is the only thing the guard reads.
        fireEvent.keyDown(field, { key: 'k', metaKey: true });

        // `isComposingText` — shared with the copilot dock's ⌘J and the content
        // nav's own palette — is what keeps the chord out of a text field. The
        // dialog is what proves it: the caret staying put (which `admin-e2e`
        // asserts) is also what a browser does when nothing is bound at all.
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('opens on ⌘K when nothing is being typed into [shell:I-26]', async () => {
        renderSearch();

        fireEvent.keyDown(window, { key: 'k', metaKey: true });

        // The control for the case above.
        await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    });
});
