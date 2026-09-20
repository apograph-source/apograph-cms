import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { describe, expect, it, vi } from 'vitest';
import { HomePage } from './index';

/**
 * The tab title, from the shell's own route.
 *
 * `useDocumentTitle` is pinned as a mechanism in `utils-admin`, and the copilot's
 * unread badge is pinned as a decorator in `copilot-admin` — neither says that a
 * route in this package actually reaches for it. Every private route but
 * Workspaces was titled a bare "Admin" until `ORT-140`, which is a WCAG 2.4.2
 * failure that no rendering test can see and no screenshot shows: the page looks
 * finished, and only the tab strip, the window list, the history and the
 * bookmark are wrong.
 *
 * The app name comes from the host HTML's `<title>`, captured once at module
 * load; under jsdom that starts empty and falls back to "Admin".
 */

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
                permissions: []
            }
        }),
        useHasPermission: () => false
    };
});

describe('HomePage', () => {
    it('names the tab for the route, and gives the name back on unmount [shell:I-31]', () => {
        const { unmount } = render(
            <IntlProvider locale="en">
                <HomePage />
            </IntlProvider>
        );

        // Rendered, and titled — a page whose heading is right and whose tab is
        // not is exactly the state this rule exists to rule out.
        expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
        expect(document.title).toBe('Home · Admin');

        // Cleared on the way out, so the next route composes from the app name
        // rather than inheriting whatever the last page left behind.
        unmount();
        expect(document.title).toBe('Admin');
    });
});
