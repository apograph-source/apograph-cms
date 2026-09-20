import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AvatarColor } from '@orthacms/design-system';
import { useContentTypes } from '../../../application/useContentTypes';
import type {
    ContentMode,
    MemberDraft,
    ResourceSelection,
    WizardData,
    WizardSnapshot
} from '../../../domain/types/wizard';
import { count, EMPTY_SELECTION } from '../../../domain/resourceSelection';
import { useBasicsSchema } from '../useBasicsSchema';

const STEP_PARAM = 'step';
const MIN_STEP = 1;
const MAX_STEP = 3;

/** Default accent color for a new workspace. */
const DEFAULT_COLOR: AvatarColor = 'slate';

const INITIAL_DATA: WizardData = {
    name: '',
    slug: '',
    slugEdited: false,
    description: '',
    color: DEFAULT_COLOR
};

const clampStep = (n: number) =>
    Math.min(MAX_STEP, Math.max(MIN_STEP, Number.isFinite(n) ? n : MIN_STEP));

/** The full controller returned by {@link useWizard}. */
export type WizardController = {
    /** Active step (1–3), mirrored to `?step=` and clamped. */
    step: number;
    /** Highest step the user has reached (gates rail navigation). */
    maxReached: number;
    /** Step 1 basics. */
    data: WizardData;
    /** Added members (excludes the implied owner). */
    members: MemberDraft[];
    /** Page-level content decision. */
    contentMode: ContentMode;
    /** Collection selection. */
    collections: ResourceSelection;
    /** Page selection. */
    pages: ResourceSelection;
    /** Whether the content-types list is still loading. */
    ctLoading: boolean;
    /** Whether the content-types list failed to load. */
    ctError: boolean;
    /** Navigate to a step (clamped); bumps {@link maxReached}. */
    goStep: (next: number) => void;
    /** Merge a partial patch into the basics data. */
    update: (patch: Partial<WizardData>) => void;
    /** Add a member if not already present. */
    addMember: (member: MemberDraft) => void;
    /** Remove a member by id. */
    removeMember: (id: string) => void;
    /** Set the page-level content mode. */
    setContentMode: (mode: ContentMode) => void;
    /** Replace the collection selection. */
    setCollections: (selection: ResourceSelection) => void;
    /** Replace the page selection. */
    setPages: (selection: ResourceSelection) => void;
    /** Whether the basics step passes shape validation (not availability). */
    basicsValid: boolean;
    /** Total members including the owner. */
    memberCount: number;
    /** Number of selected collections. */
    collectionCount: number;
    /** Number of selected pages. */
    pageCount: number;
    /**
     * The full current wizard state as a submittable snapshot. The page hands
     * this (optionally spread with an override, e.g. empty content for "Skip &
     * create") to the create use-case hook without mutating wizard state.
     */
    snapshot: WizardSnapshot;
};

/**
 * Single source of truth for the create-workspace wizard: step (mirrored to the
 * `?step=` query param and clamped), the per-step form state, and derived
 * validity and counts. Step bodies are presentational and read everything from
 * here, so state survives navigating between steps. Submission itself lives in
 * the `useCreateWorkspaceFlow` use-case hook — this only exposes the
 * {@link WizardController.snapshot} it consumes.
 */
export function useWizard(): WizardController {
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedStep = clampStep(
        Number(searchParams.get(STEP_PARAM) ?? MIN_STEP)
    );

    const [data, setData] = useState<WizardData>(INITIAL_DATA);
    const [members, setMembers] = useState<MemberDraft[]>([]);
    const [contentMode, setContentMode] = useState<ContentMode>('all');
    const [collections, setCollections] =
        useState<ResourceSelection>(EMPTY_SELECTION);
    const [pages, setPages] = useState<ResourceSelection>(EMPTY_SELECTION);

    const basicsSchema = useBasicsSchema();
    const contentTypes = useContentTypes();

    const basicsValid = basicsSchema.safeParse({
        name: data.name,
        slug: data.slug,
        description: data.description
    }).success;

    // The basics gate is enforced on the *state*, not just on the transition.
    // All wizard state is in-memory, so a deep link or a reload lands on a later
    // step with an empty step 1 — previously rendering a live "Create workspace"
    // button whose only possible outcome was a generic failure toast. Falling
    // back to step 1 makes the wizard self-healing: the user sees exactly what
    // is missing instead of a dead end. Steps 2 and 3 hold no basics fields, so
    // this can never yank a user backwards mid-flow.
    const step = basicsValid ? requestedStep : MIN_STEP;

    const [maxReached, setMaxReached] = useState(step);

    // Keep maxReached monotonic across deep-links and browser back/forward.
    useEffect(() => {
        setMaxReached((m) => Math.max(m, step));
    }, [step]);

    const allTypes = contentTypes.data ?? [];
    const collectionsTotal = allTypes.filter(
        (ct) => ct.kind === 'collection'
    ).length;
    const pagesTotal = allTypes.filter((ct) => ct.kind === 'single').length;

    const goStep = useCallback(
        (next: number) => {
            const clamped = clampStep(next);
            setMaxReached((m) => Math.max(m, clamped));
            setSearchParams({ [STEP_PARAM]: String(clamped) });
        },
        [setSearchParams]
    );

    const update = useCallback(
        (patch: Partial<WizardData>) =>
            setData((prev) => ({ ...prev, ...patch })),
        []
    );

    const addMember = useCallback((member: MemberDraft) => {
        setMembers((prev) =>
            prev.some((m) => m.id === member.id) ? prev : [...prev, member]
        );
    }, []);

    const removeMember = useCallback((id: string) => {
        setMembers((prev) => prev.filter((m) => m.id !== id));
    }, []);

    return {
        step,
        maxReached,
        data,
        members,
        contentMode,
        collections,
        pages,
        ctLoading: contentTypes.isPending,
        ctError: contentTypes.isError,
        goStep,
        update,
        addMember,
        removeMember,
        setContentMode,
        setCollections,
        setPages,
        basicsValid,
        memberCount: members.length + 1,
        collectionCount: count(collections, collectionsTotal),
        pageCount: count(pages, pagesTotal),
        snapshot: { data, members, contentMode, collections, pages }
    };
}
