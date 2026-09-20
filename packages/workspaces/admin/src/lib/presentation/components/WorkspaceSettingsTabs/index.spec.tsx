import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Shield } from 'lucide-react';
import { WORKSPACE_SETTINGS_TAB_SLOT } from '../../slots/workspaceSlots';
import { WorkspaceSettingsTabs } from './index';

const hasPermission = vi.fn((_permission: string) => true);

vi.mock('@orthacms/identity-admin', () => ({
    useHasPermission: (permission: string) => hasPermission(permission)
}));

/** The three built-ins every workspace has, in the order they are declared. */
const BUILT_IN = ['General', 'Members', 'Content'];

function renderTabs(showDanger = false) {
    render(
        <IntlProvider locale="en">
            <MemoryRouter initialEntries={['/workspaces/w1/settings/general']}>
                <WorkspaceSettingsTabs
                    workspaceId="w1"
                    showDanger={showDanger}
                />
            </MemoryRouter>
        </IntlProvider>
    );
}

/** Every tab label currently rendered, in DOM order. */
const labels = () =>
    screen.getAllByRole('link').map((link) => link.textContent?.trim());

afterEach(() => {
    WORKSPACE_SETTINGS_TAB_SLOT._reset();
    hasPermission.mockReset();
    hasPermission.mockReturnValue(true);
});

/**
 * The slot was added for one plugin, and the state it will spend almost all of
 * its life in is the one nobody will think to check again: empty. It is pinned
 * here, in the package that owns the tab bar, rather than in the plugin that
 * fills it — after this commit nothing else records that "an empty slot changes
 * nothing" was a decision rather than an accident.
 */
describe('with no contribution in the settings-tab slot', () => {
    it('renders exactly the built-in tabs, in their original order', () => {
        renderTabs();
        expect(labels()).toEqual(BUILT_IN);
    });

    it('keeps Danger zone last when it is shown', () => {
        renderTabs(true);
        expect(labels()).toEqual([...BUILT_IN, 'Danger zone']);
    });

    it('asks about no permission, so an empty slot costs nothing', () => {
        renderTabs(true);
        expect(hasPermission).not.toHaveBeenCalled();
    });
});

/**
 * The control case. Every assertion above is about something being *absent*,
 * and a change that dropped the slot handling wholesale would pass them all.
 */
describe('with a contributed tab', () => {
    const tab = {
        id: 'protection',
        path: 'protection',
        labelId: 'protection.settings.tab',
        defaultLabel: 'Protection',
        icon: Shield,
        order: 10,
        permission: 'protection:manage',
        element: <div />
    };

    it('renders it between Content and Danger zone', () => {
        WORKSPACE_SETTINGS_TAB_SLOT._register([tab]);
        renderTabs(true);
        expect(labels()).toEqual([...BUILT_IN, 'Protection', 'Danger zone']);
    });

    it('links to the section under the workspace settings base', () => {
        WORKSPACE_SETTINGS_TAB_SLOT._register([tab]);
        renderTabs();
        expect(
            screen
                .getByRole('link', { name: 'Protection' })
                .getAttribute('href')
        ).toBe('/workspaces/w1/settings/protection');
    });

    /**
     * A link to a page that will refuse you is worse than no link — the same
     * treatment the Danger zone gets, and the reason the entry carries a
     * permission at all.
     */
    it('hides it from somebody who lacks the permission it named', () => {
        hasPermission.mockReturnValue(false);
        WORKSPACE_SETTINGS_TAB_SLOT._register([tab]);
        renderTabs(true);
        expect(labels()).toEqual([...BUILT_IN, 'Danger zone']);
    });

    it('shows a tab that names no permission to everybody', () => {
        hasPermission.mockReturnValue(false);
        WORKSPACE_SETTINGS_TAB_SLOT._register([
            { ...tab, permission: undefined }
        ]);
        renderTabs();
        expect(labels()).toEqual([...BUILT_IN, 'Protection']);
    });

    it('orders contributions among themselves by `order`', () => {
        WORKSPACE_SETTINGS_TAB_SLOT._register([
            {
                ...tab,
                id: 'b',
                labelId: 'x.b',
                defaultLabel: 'Beta',
                order: 20
            },
            { ...tab, id: 'a', labelId: 'x.a', defaultLabel: 'Alpha', order: 5 }
        ]);
        renderTabs();
        expect(labels()).toEqual([...BUILT_IN, 'Alpha', 'Beta']);
    });
});
