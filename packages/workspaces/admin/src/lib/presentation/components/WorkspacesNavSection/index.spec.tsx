import { render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@orthacms/design-system';
import { useHasPermission } from '@orthacms/identity-admin';
import { useWorkspaces } from '../../../application/useWorkspaces';
import type { Workspace } from '../../../domain/types/workspace';
import { WorkspacesNavSection } from './index';

// The sidebar primitives measure the viewport on mount, and jsdom implements
// neither `matchMedia` nor `ResizeObserver`. This package registers no setup
// file, so the two shims the design-system's own suite installs globally are
// installed here instead — without them the provider throws before any
// assertion is reached.
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

// The list query and the permission probe are the two inputs this section
// branches on; both are collaborators with their own coverage, so they are
// stubbed and only the branch is under test.
vi.mock('../../../application/useWorkspaces', () => ({
    useWorkspaces: vi.fn()
}));

vi.mock('@orthacms/identity-admin', () => ({
    useHasPermission: vi.fn()
}));

const workspacesQuery = vi.mocked(useWorkspaces);
const hasPermission = vi.mocked(useHasPermission);

const HEADING = 'Workspaces';
const UNAVAILABLE = 'Couldn’t load your workspaces.';
const NEW_WORKSPACE = 'New workspace';

/** A member's-eye view of one workspace; only `status` and `name` matter here. */
function workspace(overrides: Partial<Workspace> = {}): Workspace {
    return {
        id: 'ws_1',
        name: 'Marketing site',
        slug: 'marketing-site',
        description: '',
        color: 'violet',
        status: 'Active',
        members: [],
        content: [],
        ...overrides
    };
}

/** Sets what the list query answers this render. */
function answerWith(state: { data?: Workspace[]; isError?: boolean }) {
    workspacesQuery.mockReturnValue({
        data: state.data,
        isError: state.isError ?? false
    } as unknown as ReturnType<typeof useWorkspaces>);
}

/**
 * Mounts the section in the context it really runs in — the app sidebar, inside
 * the router and the host's single `IntlProvider`. The extra host element is
 * what makes "renders nothing" assertable: the providers put markup in the
 * container regardless, so the question is what *this* component contributed.
 */
function renderSection() {
    render(
        <IntlProvider locale="en">
            <MemoryRouter initialEntries={['/workspaces']}>
                <SidebarProvider>
                    <div data-testid="section">
                        <WorkspacesNavSection />
                    </div>
                </SidebarProvider>
            </MemoryRouter>
        </IntlProvider>
    );

    return screen.getByTestId('section');
}

/**
 * The sidebar quick-list, and the one thing it must never do: render a failed
 * load as an empty membership.
 *
 * On error `data` is `undefined`, so a version of this component that reads only
 * `data` produces byte-for-byte what someone who genuinely belongs to nothing
 * sees — the section gone, or a bare heading with a "+". The person is then told
 * they have no workspaces when the truth is that we could not find out, and the
 * only visible remedy ("create one") is the wrong move. Every other surface
 * reading this query says so; this one is a nav aid, so it says it quietly — but
 * it has to say it.
 *
 * The three no-rows outcomes are therefore asserted as three *distinguishable*
 * renders, not merely as "something sensible happened".
 */
describe('WorkspacesNavSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hasPermission.mockReturnValue(false);
    });

    it('says the list could not be loaded rather than showing nothing [workspaces:I-31]', () => {
        answerWith({ isError: true });

        const section = renderSection();

        expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
        expect(section.textContent).toContain(HEADING);
        // The remedy on offer must not be "create your first workspace" when
        // the user may well already have several.
        expect(screen.queryByRole('link', { name: NEW_WORKSPACE })).toBeNull();
    });

    // Even with create permission, an error is an error: the "+" is not a
    // substitute for saying the list is missing.
    it('still says so when the user could have created one', () => {
        answerWith({ isError: true });
        hasPermission.mockReturnValue(true);

        renderSection();

        expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
    });

    it('offers the create action beside a bare heading on an empty list', () => {
        answerWith({ data: [] });
        hasPermission.mockReturnValue(true);

        const section = renderSection();

        expect(section.textContent).toContain(HEADING);
        expect(screen.getByRole('link', { name: NEW_WORKSPACE })).toBeTruthy();
        expect(screen.queryByText(UNAVAILABLE)).toBeNull();
        // No rows to reveal, so no disclosure — a trigger with nothing behind
        // it is not a control, and its `aria-controls` would dangle.
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders no section at all when there is nothing to show or do', () => {
        answerWith({ data: [] });

        const section = renderSection();

        expect(section.innerHTML).toBe('');
    });

    // The baseline the three empty renders are distinguishable *from*: an
    // archived workspace is not a destination, so only the active ones list.
    it('lists the active workspaces as links', () => {
        answerWith({
            data: [
                workspace(),
                workspace({
                    id: 'ws_2',
                    name: 'Old campaign',
                    status: 'Archived'
                })
            ]
        });

        renderSection();

        expect(
            screen
                .getByRole('link', { name: /Marketing site/ })
                .getAttribute('href')
        ).toBe('/workspaces/ws_1');
        expect(screen.queryByText('Old campaign')).toBeNull();
        expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    });
});
