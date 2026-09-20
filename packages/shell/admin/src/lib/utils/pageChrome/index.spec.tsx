import { act, fireEvent, render, screen } from '@testing-library/react';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRightPanel } from '../../components/AppRightPanel';
import { PageActions } from '../../components/PageActions';
import {
    PageActionsPortal,
    PageChromeProvider,
    RightPanelPortal
} from './index';

/**
 * The two page-fillable chrome regions, and the three promises that make them
 * different from "the shell renders a node the page handed it".
 *
 * All three are structural, and `admin-e2e` can see none of them: a filler that
 * lost its page's context throws or renders a fallback rather than announcing
 * itself; a filler that was unmounted and remounted looks identical to one that
 * survived unless you were mid-edit; and a focus handoff nobody claimed only
 * misfires minutes later, on a page the browser test has already left.
 *
 * The chrome here is the real chrome — `PageActions` and `AppRightPanel` are the
 * two components that mount the hosts in the app — so the portal targets are the
 * production ones rather than a `div` this file made up.
 */

/** localStorage key the panel's open/collapsed preference is kept under. */
const STORAGE_KEY = 'ortha:right-panel';

/**
 * A context provided *by the page*, below the shell. Every real one behaves this
 * way (`useCurrentWorkspace`, a form's handlers, a plugin's slot context); this
 * is the smallest thing that can tell "rendered inside the page" from "rendered
 * inside the shell", which is the whole reason these regions are portals.
 */
const PageScope = createContext('the shell, above the page');

function ScopeReader({ testId }: { testId: string }) {
    return <span data-testid={testId}>{useContext(PageScope)}</span>;
}

/** The shell's side: the provider plus the two components that own the hosts. */
function Chrome({ children }: { children?: ReactNode }) {
    return (
        <IntlProvider locale="en">
            <PageChromeProvider>
                <PageActions />
                <AppRightPanel />
                {children}
            </PageChromeProvider>
        </IntlProvider>
    );
}

/** The page's side: everything it renders is under its own context. */
function Page({ children }: { children: ReactNode }) {
    return <PageScope value="the page that owns it">{children}</PageScope>;
}

const panelColumn = () =>
    document.getElementById('app-right-panel') as HTMLElement;
const actionsRegion = () =>
    document.querySelector('[data-slot="top-bar-actions"]') as HTMLElement;

/** Lets the provider's `setTimeout(…, 0)` expiry actually run. */
async function nextTick() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    window.localStorage.clear();
});

describe('the page-fillable chrome regions', () => {
    it('moves the filler’s DOM into the region and leaves it in the page’s tree [shell:I-15]', () => {
        render(
            <Chrome>
                <Page>
                    <PageActionsPortal>
                        <ScopeReader testId="actions-filler" />
                    </PageActionsPortal>
                    <RightPanelPortal title="Properties">
                        <ScopeReader testId="panel-filler" />
                    </RightPanelPortal>
                </Page>
            </Chrome>
        );

        const inActions = screen.getByTestId('actions-filler');
        const inPanel = screen.getByTestId('panel-filler');

        // The DOM moved…
        expect(actionsRegion().contains(inActions)).toBe(true);
        expect(panelColumn().contains(inPanel)).toBe(true);

        // …and the React tree did not. This is the assertion that tells a portal
        // apart from the alternative: handing the shell a node renders it where
        // the shell sits, above every provider the page mounts, and both readers
        // would answer with the default.
        expect(inActions.textContent).toBe('the page that owns it');
        expect(inPanel.textContent).toBe('the page that owns it');
    });

    it('keeps the panel host mounted while the panel is collapsed [shell:I-16]', () => {
        // Collapsed from the very first frame, which is the case a click-driven
        // test cannot reach: if the host were conditional on `shown`, there would
        // never have been a target for this portal at all.
        window.localStorage.setItem(STORAGE_KEY, 'collapsed');

        render(
            <Chrome>
                <Page>
                    <RightPanelPortal title="Properties">
                        <span data-testid="panel-filler">Fields</span>
                    </RightPanelPortal>
                </Page>
            </Chrome>
        );

        expect(panelColumn().hasAttribute('inert')).toBe(true);
        expect(panelColumn().contains(screen.getByTestId('panel-filler'))).toBe(
            true
        );
    });

    it('collapsing does not remount the filler or lose its state [shell:I-16]', () => {
        const mounted = vi.fn();

        function Filler() {
            // Stands in for the filler's data fetch. A filler that is unmounted
            // and remounted runs this again — which is the "re-fetch its data"
            // half of the invariant, and the reason this is not a `Sheet`.
            useEffect(() => mounted(), []);
            return <input aria-label="Draft note" defaultValue="" />;
        }

        render(
            <Chrome>
                <Page>
                    <RightPanelPortal title="Properties">
                        <Filler />
                    </RightPanelPortal>
                </Page>
            </Chrome>
        );

        expect(mounted).toHaveBeenCalledTimes(1);
        const note = screen.getByLabelText('Draft note') as HTMLInputElement;
        // Unsaved work, which is what "throws away the filler's state" costs.
        fireEvent.change(note, { target: { value: 'half a sentence' } });

        fireEvent.click(screen.getByLabelText('Hide Properties'));

        expect(panelColumn().hasAttribute('inert')).toBe(true);
        // The same DOM node, still in the document — not a fresh one that
        // happens to carry the same label.
        expect(note.isConnected).toBe(true);
        expect(note.value).toBe('half a sentence');
        expect(mounted).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByLabelText('Show Properties'));

        expect(panelColumn().hasAttribute('inert')).toBe(false);
        expect(note.value).toBe('half a sentence');
        expect(mounted).toHaveBeenCalledTimes(1);
    });
});

describe('the panel’s focus handoff', () => {
    /**
     * The control case, and it is load-bearing: "the late control does not steal
     * focus" would pass just as well against a handoff that never moved focus at
     * all. This is the same rule `admin-e2e` pins in a browser; here it is what
     * makes the expiry case mean something.
     */
    it('moves focus to the control the toggle just revealed [shell:I-18]', () => {
        render(
            <Chrome>
                <Page>
                    <RightPanelPortal title="Properties">
                        <span>Fields</span>
                    </RightPanelPortal>
                </Page>
            </Chrome>
        );

        fireEvent.click(screen.getByLabelText('Hide Properties'));

        expect(screen.getByLabelText('Show Properties')).toBe(
            document.activeElement
        );
    });

    it('expires an unclaimed handoff instead of arming it for the next control [shell:I-19]', async () => {
        // The bar is off screen when the toggle happens, so the handoff it names
        // has nobody to claim it — a page whose top bar has not mounted yet, or
        // one that renders no bar at all.
        function Fixture({ withBar }: { withBar: boolean }) {
            return (
                <IntlProvider locale="en">
                    <PageChromeProvider>
                        {withBar ? <PageActions /> : null}
                        <AppRightPanel />
                        <RightPanelPortal title="Properties">
                            <span>Fields</span>
                        </RightPanelPortal>
                    </PageChromeProvider>
                </IntlProvider>
            );
        }

        const { rerender } = render(<Fixture withBar={false} />);
        fireEvent.click(screen.getByLabelText('Hide Properties'));
        await nextTick();

        // Minutes later, in the invariant's terms: the next control to mount.
        rerender(<Fixture withBar={true} />);
        await nextTick();

        const reopen = screen.getByLabelText('Show Properties');
        expect(reopen).not.toBe(document.activeElement);
        expect(document.activeElement).toBe(document.body);
    });
});

describe('the panel’s persisted preference', () => {
    /**
     * Storage is the one thing in the chrome that can throw for reasons that have
     * nothing to do with this app: Safari's private mode, a quota, an iframe
     * without same-origin. The panel is a convenience, so it degrades to
     * in-memory rather than taking the page down with it.
     *
     * This is shell's whole share of the rule — the sidebar's `sidebar_state`
     * cookie is the design system's, guarded and pinned in its own suite, and
     * shell touches `sessionStorage` nowhere.
     */
    function withStorage(storage: Partial<Storage>) {
        const original = Object.getOwnPropertyDescriptor(
            window,
            'localStorage'
        );
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: () => null,
                setItem: () => undefined,
                removeItem: () => undefined,
                clear: () => undefined,
                key: () => null,
                length: 0,
                ...storage
            }
        });
        return () => {
            if (original) {
                Object.defineProperty(window, 'localStorage', original);
            }
        };
    }

    it('survives a read that throws, and opens the panel [shell:I-30]', () => {
        const restore = withStorage({
            getItem: () => {
                throw new DOMException('The operation is insecure.');
            }
        });
        try {
            expect(() =>
                render(
                    <Chrome>
                        <Page>
                            <RightPanelPortal title="Properties">
                                <span data-testid="panel-filler">Fields</span>
                            </RightPanelPortal>
                        </Page>
                    </Chrome>
                )
            ).not.toThrow();

            // Degraded to the in-memory default rather than to an error screen.
            expect(panelColumn().hasAttribute('inert')).toBe(false);
        } finally {
            restore();
        }
    });

    it('survives a write that throws, and still toggles [shell:I-30]', () => {
        const restore = withStorage({
            setItem: () => {
                throw new DOMException('QuotaExceededError');
            }
        });
        try {
            expect(() =>
                render(
                    <Chrome>
                        <Page>
                            <RightPanelPortal title="Properties">
                                <span data-testid="panel-filler">Fields</span>
                            </RightPanelPortal>
                        </Page>
                    </Chrome>
                )
            ).not.toThrow();

            // Losing the preference is survivable; losing the toggle is not.
            fireEvent.click(screen.getByLabelText('Hide Properties'));
            expect(panelColumn().hasAttribute('inert')).toBe(true);
        } finally {
            restore();
        }
    });
});
