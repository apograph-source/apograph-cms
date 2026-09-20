import { act, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    EntryPublishOptions,
    EntryPublishVerdict,
    EntrySlotContext
} from '@orthacms/content-admin';
import type { EntryReview, NewEntryProtection } from '../../../domain/types';
import { usePublishProtectionVerdict } from './index';

/**
 * Which read the publish verdict answers from.
 *
 * Publish is up to two requests — a save, then the publish — and the verdict has
 * to be about what that pair will do (`protection:I-18`): the stored head for an
 * unchanged record, `afterSave` when there is anything to save, the new-entry
 * read on a create form. Get the choice wrong and the button offers an ordinary
 * publish the guard then refuses, which is the bug this arrangement replaced.
 */

const reads = vi.hoisted(() => ({
    review: undefined as EntryReview | undefined,
    /** Whether the review read failed — silence, never a refusal. */
    reviewFailed: false,
    /**
     * What an answer already cached for the entry said about the **type**, which
     * outlives the version it was about. `useEntryReview` reports it beside the
     * query so the verdict can tell "no rule" from "a rule being re-read".
     */
    typeKnownProtected: false,
    fresh: undefined as NewEntryProtection | undefined,
    reviewScope: vi.fn(),
    freshEnabled: vi.fn()
}));

vi.mock('../../../application/hooks', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../../../application/hooks')>();
    return {
        reviewScopeOf: actual.reviewScopeOf,
        useEntryReview: (scope: unknown) => {
            reads.reviewScope(scope);
            return {
                data: scope ? reads.review : undefined,
                isError: !!scope && reads.reviewFailed,
                typeKnownProtected: !!scope && reads.typeKnownProtected
            };
        },
        useNewEntryProtection: (
            _workspaceId: string,
            _typeName: string,
            enabled: boolean
        ) => {
            reads.freshEnabled(enabled);
            return { data: enabled ? reads.fresh : undefined };
        }
    };
});

// jsdom implements none of the browser APIs Radix's dialog reaches for.
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

const SAVED: EntrySlotContext = {
    schema: { name: 'article', label: 'Articles', publishable: true },
    entry: { id: 'e1', updatedAt: '2026-09-10T10:00:00.000Z' },
    isCreate: false,
    mode: 'edit',
    workspaceId: 'ws-1',
    typePath: '/workspaces/ws-1/content/article',
    params: {},
    tabSegment: ''
} as unknown as EntrySlotContext;

const CREATING = {
    ...SAVED,
    entry: undefined,
    isCreate: true,
    mode: 'create'
} as unknown as EntrySlotContext;

/** A protected entry whose stored head is approved, and a save would not be. */
function review(overrides: Partial<EntryReview> = {}): EntryReview {
    return {
        protected: true,
        required: 1,
        given: 1,
        stale: 0,
        blocked: false,
        bypassable: false,
        afterSave: { required: 1, given: 0, blocked: true, bypassable: false },
        headRevisionId: 'rev-2',
        headRevisionNumber: 2,
        callerWroteHead: false,
        callerApprovedHead: false,
        approvals: [],
        request: null,
        ...overrides
    };
}

/** The verdict as `EntryActions` would read it, plus its overlay mounted. */
let latest: EntryPublishVerdict | null = null;

function Harness({
    context,
    dirty
}: {
    context: EntrySlotContext;
    dirty: boolean;
}) {
    latest = usePublishProtectionVerdict(context, { dirty });
    return <>{latest?.overlay}</>;
}

function draw(context: EntrySlotContext, dirty = false) {
    return render(
        <IntlProvider locale="en">
            <Harness context={context} dirty={dirty} />
        </IntlProvider>
    );
}

beforeEach(() => {
    latest = null;
    reads.review = undefined;
    reads.reviewFailed = false;
    reads.typeKnownProtected = false;
    reads.fresh = undefined;
    reads.reviewScope.mockReset();
    reads.freshEnabled.mockReset();
});

describe('usePublishProtectionVerdict — which read answers [protection:I-18]', () => {
    it('answers from the stored head for an unchanged record', () => {
        reads.review = review();
        draw(SAVED, false);

        expect(latest).toEqual({ blocked: false });
    });

    it('answers from `afterSave` once there is anything to save', () => {
        reads.review = review();
        draw(SAVED, true);

        expect(latest).toMatchObject({
            blocked: true,
            reason: 'Saving your changes starts a new version: 1 approval required, 0 would count.'
        });
    });

    it('lets a dirty publish through when the save would keep the approvals', () => {
        reads.review = review({
            afterSave: {
                required: 1,
                given: 1,
                blocked: false,
                bypassable: false
            }
        });
        draw(SAVED, true);

        expect(latest).toEqual({ blocked: false });
    });

    it('answers a create form from the new-entry read, and asks no entry review', () => {
        reads.fresh = {
            protected: true,
            required: 2,
            given: 0,
            blocked: true,
            bypassable: false
        };
        draw(CREATING);

        expect(reads.reviewScope).toHaveBeenCalledWith(null);
        expect(reads.freshEnabled).toHaveBeenCalledWith(true);
        expect(latest).toMatchObject({
            blocked: true,
            reason: '2 approvals required before a new entry of this type can be published.'
        });
    });

    it('asks nothing about new entries on a saved record', () => {
        reads.review = review();
        draw(SAVED);

        expect(reads.freshEnabled).toHaveBeenCalledWith(false);
    });

    it('says nothing on a non-publishable type, even on a create form', () => {
        draw({
            ...CREATING,
            schema: { name: 'setting', label: 'Settings', publishable: false }
        } as unknown as EntrySlotContext);

        expect(reads.freshEnabled).toHaveBeenCalledWith(false);
        expect(latest).toBeNull();
    });

    it('says nothing on an unprotected type', () => {
        reads.review = review({ protected: false });
        draw(SAVED, true);

        expect(latest).toBeNull();
    });

    /** A read in flight or failed is silence, never a refusal. */
    it('says nothing while the read has no answer', () => {
        draw(SAVED, true);
        expect(latest).toBeNull();

        draw(CREATING);
        expect(latest).toBeNull();
    });
});

/**
 * The beat after a save, where the review key has moved and the answer for the
 * version Publish would ship has not landed yet.
 *
 * Answering `null` there let all three publish paths go live with no reason on
 * them — and took the bypass off `action`, so an administrator's click published
 * without `bypass: true` and met a 403 instead of the confirmation. The verdict
 * has to hold, without borrowing the previous version's numbers to do it
 * (`protection:I-18`, `protection:I-21`).
 */
describe('usePublishProtectionVerdict — the beat after a save [protection:I-18]', () => {
    const CHECKING =
        'Checking the review state of this version — Publish is held until it comes back.';

    it('holds Publish while it re-reads a type it knows is protected', () => {
        reads.typeKnownProtected = true;
        draw(SAVED, false);

        expect(latest).toEqual({ blocked: true, reason: CHECKING });
    });

    /**
     * No `action`, which is the point: with no numbers there is nothing for a
     * bypass dialog to state, and a way through that published without
     * `bypass: true` is worse than a held button. One verdict, so the primary
     * button, the ⋯ menu's Save & publish and the bypass are shut together
     * (`protection:I-21`).
     */
    it('offers no way through, and nothing to mount, while it is checking', () => {
        reads.typeKnownProtected = true;
        draw(SAVED, false);

        expect(latest?.action).toBeUndefined();
        expect(latest?.overlay).toBeUndefined();
    });

    it('holds it with unsaved edits on screen too', () => {
        // `afterSave`'s numbers are just as absent as the head's.
        reads.typeKnownProtected = true;
        draw(SAVED, true);

        expect(latest).toEqual({ blocked: true, reason: CHECKING });
    });

    it('says nothing when nothing is known about the type yet', () => {
        // Every first render of every editor: silence, as documented.
        draw(SAVED, false);

        expect(latest).toBeNull();
    });

    it('says nothing when the review read failed', () => {
        // An unreachable API must not read as a refused publish, even on a type
        // a previous answer said was protected. The server refuses regardless.
        reads.typeKnownProtected = true;
        reads.reviewFailed = true;
        draw(SAVED, false);

        expect(latest).toBeNull();
    });

    it('goes back to answering from the read the moment it lands', () => {
        // The hold never shadows the dirty branch: an answer in hand decides.
        reads.typeKnownProtected = true;
        reads.review = review();
        draw(SAVED, true);

        expect(latest).toMatchObject({
            blocked: true,
            reason: 'Saving your changes starts a new version: 1 approval required, 0 would count.'
        });
    });

    it('says nothing on a create form, which has no version to re-read', () => {
        reads.typeKnownProtected = true;
        draw(CREATING);

        expect(latest).toBeNull();
    });
});

describe('usePublishProtectionVerdict — the way through [protection:I-20]', () => {
    it('offers no way through to somebody who may not bypass', () => {
        reads.review = review({ blocked: true, given: 0 });
        draw(SAVED);

        expect(latest).toMatchObject({ blocked: true });
        expect(latest?.action).toBeUndefined();
    });

    it('publishes through the editor’s own publish, once confirmed', () => {
        reads.review = review({
            afterSave: {
                required: 1,
                given: 0,
                blocked: true,
                bypassable: true
            }
        });
        draw(SAVED, true);

        const action = latest?.action;
        if (!action) throw new Error('expected a way through to be offered');
        const publish = vi.fn<(options: EntryPublishOptions) => void>();

        // The click hands over the editor's publish; nothing is sent yet.
        act(() => action.onSelect(publish));
        const dialog = screen.getByRole('dialog');
        expect(publish).not.toHaveBeenCalled();

        fireEvent.click(
            screen.getByRole('button', { name: /publish anyway/i })
        );

        // Through the editor's publish — which saves the edits on screen first —
        // and never a publish of the stored record from here.
        expect(publish).toHaveBeenCalledWith({ bypass: true });
        expect(dialog.isConnected).toBe(false);
    });

    it('publishes nothing when the confirmation is cancelled', () => {
        reads.review = review({ blocked: true, given: 0, bypassable: true });
        draw(SAVED, false);

        const action = latest?.action;
        if (!action) throw new Error('expected a way through to be offered');
        const publish = vi.fn<(options: EntryPublishOptions) => void>();

        act(() => action.onSelect(publish));
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        expect(publish).not.toHaveBeenCalled();
    });
});
