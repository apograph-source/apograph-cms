import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@orthacms/utils-admin';
import { InsightsPage } from './index';
import {
    INSIGHTS_SECTION_SLOT,
    INSIGHTS_WIDGET_SLOT,
    type InsightsWidget
} from '../../slots/insightsSlots';

/**
 * **`insights:I-15` — "every widget opens its own request; the page itself makes
 * not a single network request."**
 *
 * The positive half is pinned in `apps/admin-e2e`, where every widget's own
 * route is seen in a request spy. The negative half was pinned by nothing, and
 * the reason is worth stating: a DOM assertion cannot see it. No arrangement of
 * "the cards rendered" tells a reader whether the frame around them also went to
 * the server, so a `useQuery` added to `InsightsPage`, `InsightsSectionBand` or
 * the range picker would pass every suite in the repo. That exact shape — an
 * observable that cannot distinguish the two implementations — is what once left an
 * equivalent test in `activity` unable to fail.
 *
 * So the observable here is the request itself. Every channel the admin can
 * reach the network through is intercepted — the shared `apiClient`'s axios
 * adapter, `fetch`, and `XMLHttpRequest` — and the assertion is over the list of
 * URLs, not over the DOM.
 *
 * It matters because the page is a **frame with no data of its own**: it
 * contributes no widgets and imports no feature package, and the moment it
 * fetches anything it has become the module that knows about every other one.
 * A page-level request also fails page-level — the whole premise of the design
 * is that one card degrades alone.
 *
 * The two things mocked are the shell's, not the page's: the signed-in user and
 * the open workspace are both resolved by the shell before this route mounts.
 * They are also the only dependencies here that would open requests of their
 * own, which would make the spy's list say nothing about the page.
 */

vi.mock('@orthacms/identity-admin', () => ({
    AuthStatus: { Authenticated: 'authenticated' },
    useAuth: () => ({
        status: 'authenticated',
        user: { id: 'u1', email: 'ada@example.com', permissions: ['x:read'] }
    })
}));

const WORKSPACE = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Docs',
    slug: 'docs'
};

vi.mock('@orthacms/workspaces-admin', () => ({
    useCurrentWorkspace: () => WORKSPACE
}));

/** Every URL requested during a render, whichever channel it went out on. */
let requested: string[];

beforeEach(() => {
    requested = [];
    INSIGHTS_WIDGET_SLOT._reset();
    INSIGHTS_SECTION_SLOT._reset();

    // The shared axios instance every admin data hook uses. Replacing the
    // adapter is what makes this a *request* spy rather than a mock of one
    // gateway: anything reaching for the API through `apiClient`, from anywhere
    // in the tree, is recorded here by URL.
    apiClient.defaults.adapter = async (config) => {
        requested.push(config.url ?? '');
        return {
            data: {},
            status: 200,
            statusText: 'OK',
            headers: {},
            config
        };
    };

    // The two channels a hand-rolled call would take instead.
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            requested.push(String(input));
            return new Response('{}', {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        })
    );
    vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(function (
        this: XMLHttpRequest,
        _method: string,
        url: string | URL
    ) {
        requested.push(String(url));
    });
});

afterEach(() => {
    INSIGHTS_WIDGET_SLOT._reset();
    INSIGHTS_SECTION_SLOT._reset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** A widget that reads exactly one path through the shared client. */
function fetchingWidget(id: string, path: string): InsightsWidget {
    function Widget() {
        useEffect(() => {
            void apiClient.get(path);
        }, []);
        return <span>{id} body</span>;
    }

    return {
        id,
        section: 'content',
        titleId: `insights.test.${id}`,
        defaultTitle: id,
        Component: Widget
    };
}

function renderPage() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });

    return render(
        <IntlProvider locale="en">
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={['/workspaces/w/insights']}>
                    <InsightsPage />
                </MemoryRouter>
            </QueryClientProvider>
        </IntlProvider>
    );
}

describe('the Insights page frame', () => {
    it('opens no request of its own when no widget is contributed [insights:I-15]', async () => {
        INSIGHTS_SECTION_SLOT._register([
            {
                id: 'content',
                titleId: 'insights.section.content',
                defaultTitle: 'Content'
            }
        ]);

        renderPage();

        // The whole frame is up — top bar, heading, range picker, empty note —
        // so this is the page having rendered and asked for nothing, not the
        // page having failed to mount.
        expect(
            await screen.findByRole('heading', { name: 'Insights' })
        ).toBeTruthy();
        expect(screen.getByText(/No insights are available yet/)).toBeTruthy();

        // A settling window a real request would not survive.
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(requested).toEqual([]);
    });

    it('requests exactly what its widgets asked for, and nothing more [insights:I-15]', async () => {
        // The control the case above depends on. Without it, a spy that had
        // stopped seeing requests at all — an adapter no longer reached, a
        // stubbed global replaced later in the tree — would report an
        // impeccably quiet page forever.
        INSIGHTS_SECTION_SLOT._register([
            {
                id: 'content',
                titleId: 'insights.section.content',
                defaultTitle: 'Content'
            }
        ]);
        INSIGHTS_WIDGET_SLOT._register([
            fetchingWidget('one', '/insights/one'),
            fetchingWidget('two', '/insights/two')
        ]);

        renderPage();

        await waitFor(() => expect(requested).toHaveLength(2));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Sorted: the two widgets mount in slot order but their effects are
        // not ordered by contract, and the claim is about the *set* of URLs.
        expect([...requested].sort()).toEqual([
            '/insights/one',
            '/insights/two'
        ]);
    });
});
