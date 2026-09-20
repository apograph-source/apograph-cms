import { fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { TooltipProvider } from '@orthacms/design-system';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentTypeDetail } from '../../../../../domain/types/contentType';
import { ENTRY_MODE } from '../../../../../domain/constants';
import { EntrySlotContextProvider } from '../../../../hooks/useEntrySlotContext';
import {
    ENTRY_PUBLISH_GUARD_SLOT,
    type EntryPublishGuardItem,
    type EntrySlotContext
} from '../../../../slots/contentSlots';
import { EntryActions } from './index';

// jsdom implements none of the browser APIs Radix's dropdown reaches for, and
// this package registers no vitest setup file — the same shims `api-tokens`'
// dialog suite installs.
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

if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
}

// The editor's permission gate. Every case here is a writer who may publish —
// what is under test is the guard slot, not the RBAC that runs before it.
vi.mock('@orthacms/identity-admin', () => ({
    useHasPermission: () => true
}));

const SCHEMA = {
    name: 'article',
    label: 'Articles',
    kind: 'collection',
    publishable: true,
    fields: []
} as unknown as ContentTypeDetail;

const SLOT_CONTEXT: EntrySlotContext = {
    schema: SCHEMA,
    entry: undefined,
    isCreate: true,
    mode: ENTRY_MODE.Create,
    workspaceId: 'ws-1',
    typePath: '/workspaces/ws-1/content/article',
    params: {},
    tabSegment: ''
};

/** Registers guard items for one test and clears them afterwards. */
function useGuards(...items: EntryPublishGuardItem[]) {
    ENTRY_PUBLISH_GUARD_SLOT._register(items);
}

afterEach(() => {
    ENTRY_PUBLISH_GUARD_SLOT._reset();
    vi.restoreAllMocks();
});

function renderActions(onPublish = vi.fn()) {
    render(
        <IntlProvider locale="en">
            <TooltipProvider>
                <EntrySlotContextProvider value={SLOT_CONTEXT}>
                    <EntryActions
                        publishable
                        paranoid={false}
                        isCreate
                        saving={false}
                        onSaveDraft={vi.fn()}
                        onPublish={onPublish}
                    />
                </EntrySlotContextProvider>
            </TooltipProvider>
        </IntlProvider>
    );
    return { onPublish };
}

/**
 * Invariant **protection:I-03**, and the reason this file exists.
 *
 * The slot was added for one plugin, and the state it will spend almost all of
 * its life in is the one nobody will think to check again: empty. After this PR
 * nothing else records that "an empty slot changes nothing" was a decision
 * rather than an accident — so it is pinned here, in the package that owns the
 * slot, not in the plugin that fills it.
 */
describe('with no contribution in the publish-guard slot [protection:I-03]', () => {
    it('leaves the publish button exactly as the publish gate alone had it', () => {
        const { onPublish } = renderActions();

        const button = screen.getByRole('button', { name: 'Publish' });
        expect(button.hasAttribute('aria-disabled')).toBe(false);
        expect(button.hasAttribute('aria-describedby')).toBe(false);
        expect((button as HTMLButtonElement).disabled).toBe(false);

        fireEvent.click(button);
        expect(onPublish).toHaveBeenCalledTimes(1);
    });

    it('asks no guard, so nothing can make the button pay for the seam', () => {
        const useVerdict = vi.fn(() => null);
        // Registered and then cleared: proves the assertion above is about an
        // empty registry rather than about a slot that is never consulted.
        useGuards({ id: 'probe', useVerdict });
        ENTRY_PUBLISH_GUARD_SLOT._reset();

        renderActions();

        expect(useVerdict).not.toHaveBeenCalled();
    });
});

/**
 * The control case. Every assertion above is about something being *absent*,
 * and a change that dropped the guard handling wholesale would pass them all.
 */
describe('with a contribution that blocks', () => {
    it('keeps the button focusable and says why, rather than disabling it', () => {
        useGuards({
            id: 'protection',
            useVerdict: () => ({
                blocked: true,
                reason: '2 approvals required, 0 given'
            })
        });

        const { onPublish } = renderActions();
        // The reason is a description, not part of the name — a reader must not
        // hear the whole refusal read out as the thing they are about to press.
        const button = screen.getByRole('button', { name: 'Publish' });

        // `disabled` would drop it out of the tab order, so the person most
        // likely to need the reason is the one who cannot reach it.
        expect((button as HTMLButtonElement).disabled).toBe(false);
        expect(button.getAttribute('aria-disabled')).toBe('true');

        const describedBy = button.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(
            document.getElementById(describedBy as string)?.textContent
        ).toBe('2 approvals required, 0 given');

        fireEvent.click(button);
        expect(onPublish).not.toHaveBeenCalled();
    });

    it('keeps an ordinary Publish and hands the click over when an action is offered [protection:I-20]', () => {
        const publishes: ((options: { bypass?: boolean }) => void)[] = [];
        const onSelect = vi.fn((publish) => {
            publishes.push(publish);
        });
        useGuards({
            id: 'protection',
            useVerdict: () => ({
                blocked: true,
                reason: '2 approvals required, 0 given',
                action: { onSelect }
            })
        });

        const { onPublish } = renderActions();
        // Not relabelled and not restyled: the way through is explained by the
        // ceremony the click opens, not by a second kind of Publish button.
        const button = screen.getByRole('button', { name: 'Publish' });

        // An override is operable — it is the way through, not a refusal.
        expect(button.hasAttribute('aria-disabled')).toBe(false);

        fireEvent.click(button);
        expect(onSelect).toHaveBeenCalledTimes(1);
        // Content never publishes behind the contribution's back: the action
        // owns whatever ceremony comes first…
        expect(onPublish).not.toHaveBeenCalled();

        // …and then publishes through the editor's own publish, options intact.
        expect(publishes).toHaveLength(1);
        publishes[0]({ bypass: true });
        expect(onPublish).toHaveBeenCalledWith({ bypass: true });
    });

    it('hands the unsaved state to every guard [protection:I-18]', () => {
        const useVerdict = vi.fn(() => null);
        useGuards({ id: 'probe', useVerdict });

        render(
            <IntlProvider locale="en">
                <TooltipProvider>
                    <EntrySlotContextProvider value={SLOT_CONTEXT}>
                        <EntryActions
                            publishable
                            paranoid={false}
                            isCreate
                            saving={false}
                            dirty
                            onSaveDraft={vi.fn()}
                            onPublish={vi.fn()}
                        />
                    </EntrySlotContextProvider>
                </TooltipProvider>
            </IntlProvider>
        );

        expect(useVerdict).toHaveBeenCalledWith(SLOT_CONTEXT, { dirty: true });
    });

    it('renders a contributed overlay outside the button', () => {
        useGuards({
            id: 'protection',
            useVerdict: () => ({
                blocked: true,
                reason: 'blocked',
                overlay: <div data-testid="bypass-dialog" />
            })
        });

        renderActions();

        expect(screen.getByTestId('bypass-dialog')).toBeTruthy();
    });

    it('takes the first refusal and asks no later guard', () => {
        const second = vi.fn(() => ({ blocked: true, reason: 'second' }));
        useGuards(
            {
                id: 'first',
                useVerdict: () => ({ blocked: true, reason: 'first' })
            },
            { id: 'second', useVerdict: second }
        );

        renderActions();

        const button = screen.getByRole('button', { name: 'Publish' });
        const describedBy = button.getAttribute('aria-describedby');
        expect(
            document.getElementById(describedBy as string)?.textContent
        ).toBe('first');
        // Every hook still runs — they are hooks, and skipping one would change
        // the call order between renders.
        expect(second).toHaveBeenCalled();
    });
});

/** Open the ⋯ menu the way a keyboard does — Radix opens on Enter. */
function openMenu() {
    const trigger = screen.getByRole('button', { name: 'More actions' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    return screen.getByRole('menuitem', { name: 'Save & publish' });
}

/**
 * The menu is a second way to publish, and the easy one to forget: it was, until
 * `Save & publish` published straight past a refusal the primary button was
 * holding.
 */
describe('the ⋯ menu’s Save & publish [protection:I-21]', () => {
    it('is held along with the button when a guard refuses with no way through', () => {
        useGuards({
            id: 'protection',
            useVerdict: () => ({ blocked: true, reason: '1 approval required' })
        });

        const { onPublish } = renderActions();
        const item = openMenu();

        expect(item.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(item);
        expect(onPublish).not.toHaveBeenCalled();
    });

    it('opens the same ceremony as the button when a way through is offered', () => {
        const onSelect = vi.fn();
        useGuards({
            id: 'protection',
            useVerdict: () => ({
                blocked: true,
                reason: '1 approval required',
                action: { onSelect }
            })
        });

        const { onPublish } = renderActions();
        fireEvent.click(openMenu());

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onPublish).not.toHaveBeenCalled();
    });

    it('publishes plainly when nothing objects', () => {
        const { onPublish } = renderActions();
        fireEvent.click(openMenu());

        // Called with no options — a menu event must never leak in as one.
        expect(onPublish.mock.calls).toEqual([[]]);
    });
});

describe('with a contribution that does not object', () => {
    it('leaves the button ordinary', () => {
        useGuards({ id: 'quiet', useVerdict: () => ({ blocked: false }) });

        const { onPublish } = renderActions();
        const button = screen.getByRole('button', { name: 'Publish' });

        expect(button.hasAttribute('aria-disabled')).toBe(false);
        fireEvent.click(button);
        expect(onPublish).toHaveBeenCalledTimes(1);
    });
});
