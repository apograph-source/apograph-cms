import { EntryReviewService, type ReviewActor } from './entry-review.service';
import {
    ReviewableEntryNotFoundError,
    ReviewerNotEligibleError,
    SelfApprovalRefusedError
} from '../domain/errors';

const WORKSPACE = '44444444-4444-4444-8444-444444444444';
const ANNA = 'anna';
const BORIS = 'boris';
const ENTRY = 'entry-1';

/** The caller, as the routes resolve one. */
const caller = (id: string, managesProtection = false): ReviewActor => ({
    id,
    email: `${id}@example.com`,
    managesProtection
});

/** A `UnitOfWork` that just runs the callback — there is no transaction to fake. */
const uow = { run: <T>(fn: () => Promise<T> | T) => Promise.resolve(fn()) };

/** An outbox that records nothing anybody here asserts on. */
const outbox = { append: async () => undefined };

/** One collection, named the way the registry hands it over. */
const registry = {
    get: (slug: string) =>
        slug === 'article' ? { name: 'article', kind: 'collection' } : undefined
};

const grants = (...slugs: string[]) => ({
    grantedSlugs: async () => new Set(slugs)
});

type Vote = { userId: string; revisionId: string; createdAt?: Date };

/**
 * The whole service under one roof: every collaborator is a fake with the
 * narrowest behaviour the method under test reads.
 */
function makeService(
    options: {
        rule?: Record<string, unknown> | null;
        head?: { id: string; number: number; authorId: string | null } | null;
        votes?: Vote[];
        timeline?: { id: string; number: number }[];
        candidates?: { userId: string; email: string }[];
        openRequest?: {
            id: string;
            requestedBy: string;
            reviewerIds: string[];
            revisionId: string;
            createdAt: Date;
        } | null;
        granted?: string[];
    } = {}
) {
    const opened: unknown[] = [];
    const cast: unknown[] = [];
    const head =
        options.head === undefined
            ? { id: 'rev-7', number: 7, authorId: ANNA }
            : options.head;

    const instance = new EntryReviewService(
        uow as never,
        outbox as never,
        { find: async () => options.rule ?? null } as never,
        {
            open: async (input: unknown) => {
                opened.push(input);
                return { id: 'request-1' };
            },
            findOpen: async () => options.openRequest ?? null,
            resolve: async () => true
        } as never,
        {
            listForEntry: async () =>
                (options.votes ?? []).map((vote) => ({
                    ...vote,
                    createdAt:
                        vote.createdAt ?? new Date('2026-09-09T09:00:00Z')
                })),
            cast: async (input: unknown) => {
                cast.push(input);
            },
            withdraw: async () => undefined
        } as never,
        {
            find: async () => head,
            timeline: async () => options.timeline ?? []
        } as never,
        { list: async () => options.candidates ?? [] } as never,
        grants(...(options.granted ?? ['article'])) as never,
        { forRole: async () => [] } as never,
        { can: () => false } as never,
        registry as never
    );

    return { service: instance, opened, cast };
}

describe('EntryReviewService.state', () => {
    const rule = {
        enabled: true,
        requiredApprovals: 1,
        requireOtherPerson: true,
        countStaleApprovals: false,
        adminBypass: true,
        allowTokenPublish: false
    };

    /**
     * The server half of `protection:I-18`, and the half nothing pinned: the
     * admin's own spec proves the editor *reads* `afterSave` when the form is
     * dirty, and this proves the number it reads is the right one.
     *
     * A save writes a version **no vote is bound to**, so the outlook hands the
     * kernel a head id no stored vote can match. Every approval on the entry is
     * therefore stale against it, whoever is about to save — which is the whole
     * of what "an approval belongs to a revision" means, stated one step before
     * the save rather than after it. Satisfied as it stands, held the moment
     * anything is written.
     */
    it('predicts the version a save by this caller would write', async () => {
        const { service } = makeService({
            rule,
            head: { id: 'rev-7', number: 7, authorId: ANNA },
            votes: [{ userId: BORIS, revisionId: 'rev-7' }]
        });

        const view = await service.state(
            WORKSPACE,
            'article',
            ENTRY,
            caller(BORIS)
        );

        expect(view).toMatchObject({
            protected: true,
            required: 1,
            given: 1,
            blocked: false,
            afterSave: { required: 1, given: 0, blocked: true }
        });
    });

    /**
     * With `count_stale_approvals` on, the votes survive a save — and *then* who
     * is about to write the next version starts to matter, because the four-eyes
     * rule excludes the author of the head from the count. So the same entry,
     * the same votes, read by two people, gives two different outlooks: Cyril's
     * save leaves Boris's approval standing, Boris's own save does not.
     *
     * This is the pair that pins whose id the outlook carries. Handing the
     * kernel the *stored* head's author instead of the caller passes every
     * other test in this file and fails these two.
     */
    it('excludes the caller’s own approval from the outlook, but not a third party’s', async () => {
        const staleCounting = { ...rule, countStaleApprovals: true };
        const votes = [{ userId: BORIS, revisionId: 'rev-7' }];

        const forCyril = await makeService({
            rule: staleCounting,
            head: { id: 'rev-7', number: 7, authorId: ANNA },
            votes
        }).service.state(WORKSPACE, 'article', ENTRY, caller('cyril'));
        const forBoris = await makeService({
            rule: staleCounting,
            head: { id: 'rev-7', number: 7, authorId: ANNA },
            votes
        }).service.state(WORKSPACE, 'article', ENTRY, caller(BORIS));

        expect(forCyril.afterSave).toMatchObject({ given: 1, blocked: false });
        expect(forBoris.afterSave).toMatchObject({ given: 0, blocked: true });
    });

    it('says whether the caller wrote the head and whether they approved it', async () => {
        const { service } = makeService({
            rule,
            head: { id: 'rev-7', number: 7, authorId: ANNA },
            votes: [{ userId: BORIS, revisionId: 'rev-7' }]
        });

        expect(
            await service.state(WORKSPACE, 'article', ENTRY, caller(ANNA))
        ).toMatchObject({ callerWroteHead: true, callerApprovedHead: false });
        expect(
            await service.state(WORKSPACE, 'article', ENTRY, caller(BORIS))
        ).toMatchObject({ callerWroteHead: false, callerApprovedHead: true });
    });

    /**
     * A vote on an earlier version is reported **stale, with the version it was
     * given on** — that line is the only explanation the editor has for a count
     * that moved after a save, and the number comes from the revision timeline
     * rather than from the vote.
     */
    it('names the version a stale approval was given on', async () => {
        const { service } = makeService({
            rule,
            head: { id: 'rev-7', number: 7, authorId: ANNA },
            votes: [
                { userId: BORIS, revisionId: 'rev-4' },
                { userId: 'cyril', revisionId: 'rev-7' }
            ],
            timeline: [
                { id: 'rev-7', number: 7 },
                { id: 'rev-4', number: 4 }
            ]
        });

        const view = await service.state(
            WORKSPACE,
            'article',
            ENTRY,
            caller(ANNA)
        );

        expect(view.approvals).toEqual([
            expect.objectContaining({
                userId: BORIS,
                isStale: true,
                revisionNumber: 4
            }),
            expect.objectContaining({
                userId: 'cyril',
                isStale: false,
                revisionNumber: 7
            })
        ]);
        expect(view).toMatchObject({ given: 1, stale: 1 });
    });

    /** A revision the timeline no longer holds reports no number rather than failing the read. */
    it('reports an unknown version as null instead of failing', async () => {
        const { service } = makeService({
            rule,
            votes: [{ userId: BORIS, revisionId: 'rev-purged' }],
            timeline: [{ id: 'rev-7', number: 7 }]
        });

        const view = await service.state(
            WORKSPACE,
            'article',
            ENTRY,
            caller(ANNA)
        );

        expect(view.approvals[0]).toMatchObject({
            isStale: true,
            revisionNumber: null
        });
    });

    it('reports an unprotected type as unprotected, with no requirement', async () => {
        const { service } = makeService({ rule: null });

        expect(
            await service.state(WORKSPACE, 'article', ENTRY, caller(ANNA))
        ).toMatchObject({ protected: false, required: 0, blocked: false });
    });

    /**
     * Ungranted and unknown answer with the **same** error, which is content's
     * own `resolveGrantedType` rule one level down: telling them apart lets a
     * member of one workspace enumerate the deployment's content model.
     */
    it('refuses an ungranted type exactly as it refuses an unknown one', async () => {
        const ungranted = makeService({ granted: [] });
        const unknown = makeService();

        await expect(
            ungranted.service.state(WORKSPACE, 'article', ENTRY, caller(ANNA))
        ).rejects.toBeInstanceOf(ReviewableEntryNotFoundError);
        await expect(
            unknown.service.state(WORKSPACE, 'ghost', ENTRY, caller(ANNA))
        ).rejects.toBeInstanceOf(ReviewableEntryNotFoundError);
    });

    it('refuses an entry with no revision under this type', async () => {
        const { service } = makeService({ head: null });

        await expect(
            service.state(WORKSPACE, 'article', ENTRY, caller(ANNA))
        ).rejects.toBeInstanceOf(ReviewableEntryNotFoundError);
    });
});

describe('EntryReviewService.approve', () => {
    const rule = {
        enabled: true,
        requiredApprovals: 1,
        requireOtherPerson: true,
        countStaleApprovals: false,
        adminBypass: true,
        allowTokenPublish: false
    };

    /**
     * The four-eyes rule refuses the **write**, not just the count. The kernel
     * excludes the head author from the tally, so a stored self-approval would
     * be a row that silently never counts: the name appears in the list, the
     * number does not move, and nothing says why.
     */
    it('refuses the head author’s own approval, storing nothing', async () => {
        const { service, cast } = makeService({
            rule,
            head: { id: 'rev-7', number: 7, authorId: ANNA }
        });

        await expect(
            service.approve(WORKSPACE, 'article', ENTRY, caller(ANNA))
        ).rejects.toBeInstanceOf(SelfApprovalRefusedError);
        expect(cast).toEqual([]);
    });

    it('allows it when the rule does not ask for a second person', async () => {
        const { service, cast } = makeService({
            rule: { ...rule, requireOtherPerson: false },
            head: { id: 'rev-7', number: 7, authorId: ANNA }
        });

        await service.approve(WORKSPACE, 'article', ENTRY, caller(ANNA));

        expect(cast).toEqual([
            expect.objectContaining({ userId: ANNA, revisionId: 'rev-7' })
        ]);
    });

    /**
     * A head nobody can be named for — a token's write, an import, a
     * migration — excludes nobody, so there is no self-approval to refuse.
     */
    it('refuses nobody when the head has no author', async () => {
        const { service, cast } = makeService({
            rule,
            head: { id: 'rev-7', number: 7, authorId: null }
        });

        await service.approve(WORKSPACE, 'article', ENTRY, caller(ANNA));

        expect(cast).toHaveLength(1);
    });

    /** The vote lands on the **current** head, whatever version the request named. */
    it('records the vote against the head, not the requested revision', async () => {
        const { service, cast } = makeService({
            rule,
            head: { id: 'rev-9', number: 9, authorId: ANNA },
            openRequest: {
                id: 'request-1',
                requestedBy: ANNA,
                reviewerIds: [BORIS],
                revisionId: 'rev-4',
                createdAt: new Date('2026-09-01T00:00:00Z')
            }
        });

        await service.approve(WORKSPACE, 'article', ENTRY, caller(BORIS));

        expect(cast[0]).toMatchObject({ revisionId: 'rev-9' });
    });
});

describe('EntryReviewService.requestReview', () => {
    /**
     * One definition of who may be asked, for the picker and for the route —
     * so nobody can be left in a request as a pending reviewer with no way to
     * approve (`protection:I-22`).
     */
    it('refuses a reviewer the candidate list does not offer', async () => {
        const { service, opened } = makeService({
            candidates: [{ userId: BORIS, email: 'boris@example.com' }]
        });

        await expect(
            service.requestReview(
                WORKSPACE,
                'article',
                ENTRY,
                ['cyril'],
                caller(ANNA)
            )
        ).rejects.toBeInstanceOf(ReviewerNotEligibleError);
        expect(opened).toEqual([]);
    });

    it('refuses a request naming nobody', async () => {
        const { service, opened } = makeService({
            candidates: [{ userId: BORIS, email: 'boris@example.com' }]
        });

        await expect(
            service.requestReview(WORKSPACE, 'article', ENTRY, [], caller(ANNA))
        ).rejects.toBeInstanceOf(ReviewerNotEligibleError);
        expect(opened).toEqual([]);
    });

    /**
     * Allowed on an unprotected type: wanting a second pair of eyes does not
     * require a rule, and refusing it would make the queue a function of the
     * settings tab rather than of what people actually asked for.
     */
    it('opens a request on an unprotected type, naming the head at the time', async () => {
        const { service, opened } = makeService({
            rule: null,
            candidates: [{ userId: BORIS, email: 'boris@example.com' }]
        });

        await service.requestReview(
            WORKSPACE,
            'article',
            ENTRY,
            [BORIS, BORIS],
            caller(ANNA)
        );

        expect(opened).toEqual([
            expect.objectContaining({
                entryId: ENTRY,
                revisionId: 'rev-7',
                requestedBy: ANNA,
                // Deduplicated: asking for the same person twice is one ask.
                reviewerIds: [BORIS]
            })
        ]);
    });
});
