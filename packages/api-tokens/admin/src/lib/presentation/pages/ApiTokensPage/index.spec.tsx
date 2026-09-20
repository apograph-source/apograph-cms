import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHasPermission } from '@orthacms/identity-admin';
import type { ApiToken } from '../../../domain/types/apiToken';
import { httpApiTokenGateway } from '../../../infrastructure/httpApiTokenGateway';
import { ApiTokensPage } from './index';

// jsdom implements none of the browser APIs the Radix primitives reach for, and
// this package registers no vitest setup file, so the shims the design-system's
// own suite installs globally are installed here instead.
if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false
    })) as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
        observe() {
            return undefined;
        }
        unobserve() {
            return undefined;
        }
        disconnect() {
            return undefined;
        }
    } as unknown as typeof ResizeObserver;
}

/**
 * The gateway is mocked rather than the query hooks, because the sharpest
 * assertion this page needs is about a request that must **not** happen — and
 * only the gateway can tell a suppressed read apart from an empty answer.
 */
vi.mock('../../../infrastructure/httpApiTokenGateway', () => ({
    httpApiTokenGateway: {
        list: vi.fn(),
        create: vi.fn(),
        revoke: vi.fn(),
        listWorkspaceOptions: vi.fn()
    }
}));

vi.mock('@orthacms/identity-admin', () => ({
    useHasPermission: vi.fn()
}));

// The top bar drags in the shell's page-chrome context, which this page neither
// owns nor is under test here.
vi.mock('@orthacms/shell-admin', () => ({
    PageTopBar: () => null
}));

const list = vi.mocked(httpApiTokenGateway.list);
const listWorkspaceOptions = vi.mocked(
    httpApiTokenGateway.listWorkspaceOptions
);
const hasPermission = vi.mocked(useHasPermission);

const READ = 'tokens:read';
const CREATE = 'tokens:create';
const DELETE = 'tokens:delete';

const NEW_TOKEN = 'New token';
const NO_ACCESS = 'You don’t have access to API tokens';

/** One live token, enough to draw a row with a kebab in it. */
const token: ApiToken = {
    id: 'tok_1',
    name: 'Production website',
    workspaceIds: ['ws_1'],
    scope: 'read',
    lookupPrefix: 'ort_a1b2c3',
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    status: 'active'
};

/**
 * Renders the page at `path`, granting exactly `permissions`.
 * `total` drives the page-count maths, so a control test can ask for a page
 * that genuinely exists instead of being clamped back to the first.
 */
function renderPage({
    permissions,
    path = '/api-tokens',
    total = 1
}: {
    permissions: string[];
    path?: string;
    total?: number;
}) {
    hasPermission.mockImplementation((permission: string) =>
        permissions.includes(permission)
    );
    list.mockResolvedValue({ items: [token], total, page: 1, pageSize: 25 });
    listWorkspaceOptions.mockResolvedValue([]);

    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });

    return render(
        <IntlProvider locale="en" onError={() => undefined}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={[path]}>
                    <ApiTokensPage />
                </MemoryRouter>
            </QueryClientProvider>
        </IntlProvider>
    );
}

/** Waits for the one row to land, so a later "absent" assertion means something. */
const waitForTable = () =>
    waitFor(() => expect(screen.getByText(token.name)).toBeTruthy());

/**
 * The API-tokens management page.
 *
 * Two things are pinned here. The first is `readPage`, the `?page=` parser: it
 * is module-private, so it is exercised through the request the page actually
 * issues — the page number reaches the gateway, which is the only place it
 * matters. (Testing it directly would mean exporting it from production code,
 * which these tests are not allowed to change, and the round trip through the
 * gateway is the more faithful assertion anyway.)
 *
 * The second is that the page fails **closed**. Every control is gated on its
 * own permission, and `tokens:read` gates the request itself rather than only
 * the rows: the server would refuse the call, so issuing it would be a
 * guaranteed `403` in the console on every visit by a viewer.
 */
describe('ApiTokensPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('the ?page= parser', () => {
        // Everything a hand-typed or stale URL can carry. Each one has to land
        // on the first page rather than on `NaN`, page zero or a fraction — the
        // server would answer a `page=0` with a `400`, and `page=1.5` is not a
        // page at all.
        it.each([
            ['a word', '/api-tokens?page=abc'],
            ['zero', '/api-tokens?page=0'],
            ['a negative', '/api-tokens?page=-3'],
            ['a fraction', '/api-tokens?page=1.5'],
            ['nothing at all', '/api-tokens']
        ])('falls back to page 1 on %s', async (_case, path) => {
            renderPage({ permissions: [READ], path });

            await waitFor(() => expect(list).toHaveBeenCalled());
            expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
        });

        // The control: without this the four tests above would pass on a parser
        // that ignored the URL entirely and always answered 1.
        it('honours a page that is a whole number above zero', async () => {
            renderPage({
                permissions: [READ],
                path: '/api-tokens?page=3',
                total: 100
            });

            await waitFor(() =>
                expect(list).toHaveBeenCalledWith({ page: 3, pageSize: 25 })
            );
        });
    });

    describe('failing closed', () => {
        /**
         * The load-bearing one. "No rows on screen" cannot tell a suppressed
         * read from an empty answer, so the assertion is on the gateway: without
         * `tokens:read` the page must issue **no** request at all — the reason
         * `useApiTokens` takes an `enabled` flag rather than being called
         * unconditionally and filtered afterwards.
         */
        it('issues no request at all without tokens:read', async () => {
            renderPage({ permissions: [] });

            await waitFor(() =>
                expect(screen.getByText(NO_ACCESS)).toBeTruthy()
            );

            expect(list).not.toHaveBeenCalled();
            // The workspace names are only ever shown beside tokens, so that
            // read is gated on the same permission.
            expect(listWorkspaceOptions).not.toHaveBeenCalled();
        });

        it('offers no way to mint a token without tokens:create', async () => {
            renderPage({ permissions: [READ] });
            await waitForTable();

            expect(
                screen.queryByRole('button', { name: NEW_TOKEN })
            ).toBeNull();
        });

        // The control for the test above, so an absent button proves a gate and
        // not a mislaid label.
        it('offers the create button with tokens:create', async () => {
            renderPage({ permissions: [READ, CREATE] });
            await waitForTable();

            expect(
                screen.getByRole('button', { name: NEW_TOKEN })
            ).toBeTruthy();
        });

        /**
         * Without `tokens:delete` the whole actions column goes, **header cell
         * included**. Dropping only the row kebab would leave a header standing
         * over nothing: the table's column count would no longer match its
         * header row, which a screen reader reads out as a real (empty) column
         * on every row.
         */
        it('drops the actions column, header and all, without tokens:delete', async () => {
            renderPage({ permissions: [READ] });
            await waitForTable();

            expect(screen.getAllByRole('columnheader')).toHaveLength(7);
            expect(screen.queryByText('Actions')).toBeNull();
            expect(
                screen.queryByRole('button', {
                    name: `Actions for ${token.name}`
                })
            ).toBeNull();
        });

        it('keeps the actions column with tokens:delete', async () => {
            renderPage({ permissions: [READ, DELETE] });
            await waitForTable();

            expect(screen.getAllByRole('columnheader')).toHaveLength(8);
            expect(
                screen.getByRole('button', {
                    name: `Actions for ${token.name}`
                })
            ).toBeTruthy();
        });
    });
});
