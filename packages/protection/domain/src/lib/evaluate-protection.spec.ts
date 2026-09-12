import { countApprovals, evaluateProtection } from './evaluate-protection';
import type {
    Approval,
    ProtectionInput,
    ProtectionRule
} from './protection-rule';

/** The entry's current version, and one the reviewer looked at before it. */
const HEAD = 'rev-7';
const OLDER = 'rev-4';

/** A rule with every field at its documented default, overridable per test. */
const ruleWith = (overrides: Partial<ProtectionRule> = {}): ProtectionRule => ({
    enabled: true,
    requiredApprovals: 1,
    requireOtherPerson: true,
    countStaleApprovals: false,
    adminBypass: true,
    allowTokenPublish: false,
    ...overrides
});

const approved = (userId: string, revisionId = HEAD): Approval => ({
    revisionId,
    userId
});

const person = (userId = 'publisher') => ({
    userId,
    isAdmin: false,
    isToken: false
});
const administrator = (userId = 'root') => ({
    userId,
    isAdmin: true,
    isToken: false
});
const token = () => ({ userId: null, isAdmin: false, isToken: true });

/**
 * The unstated half of the input, so each test says only what it is about.
 * `anna` wrote the head revision throughout.
 */
const evaluate = (input: Partial<ProtectionInput>) =>
    evaluateProtection({
        headRevisionId: HEAD,
        headAuthorId: 'anna',
        approvals: [],
        actor: person(),
        ...input
    });

describe('an unprotected type', () => {
    // covers: protection:I-04
    it('is allowed when there is no rule at all', () => {
        expect(evaluate({ rule: undefined })).toEqual({
            allowed: true,
            reason: 'unprotected'
        });
    });

    // covers: protection:I-04
    it('is allowed when the rule exists but is switched off', () => {
        expect(evaluate({ rule: ruleWith({ enabled: false }) })).toEqual({
            allowed: true,
            reason: 'unprotected'
        });
    });

    /**
     * The ordering trap. The counting rules list the token gate first, which
     * reads as "check the token before anything else" — but a switched-off rule
     * is not a protected type, and refusing a token there would break a CI
     * publish on a type nobody chose to protect.
     */
    it('does not refuse a token — a disabled rule protects nothing', () => {
        expect(
            evaluate({
                rule: ruleWith({ enabled: false, allowTokenPublish: false }),
                actor: token()
            })
        ).toEqual({ allowed: true, reason: 'unprotected' });
    });
});

describe('the token gate', () => {
    // covers: protection:I-11
    it('refuses a bearer token on a protected type', () => {
        expect(evaluate({ rule: ruleWith(), actor: token() })).toEqual({
            allowed: false,
            reason: 'token-refused'
        });
    });

    /**
     * "Regardless of approvals" is the part that matters: a token that finds a
     * fully approved entry still cannot be the one to ship it, because the log
     * row would name a key rather than a person.
     */
    // covers: protection:I-11
    it('refuses it even when the entry is fully approved', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 1 }),
                approvals: [approved('boris')],
                actor: token()
            })
        ).toEqual({ allowed: false, reason: 'token-refused' });
    });

    /**
     * A token is never an administrator in practice — `isAdmin` is read off a
     * session — but the gate must not depend on that staying true, because the
     * failure mode is a key that bypasses the rule and names nobody.
     */
    it('wins over the bypass, whatever the actor claims', () => {
        expect(
            evaluate({
                rule: ruleWith({ adminBypass: true }),
                actor: { userId: null, isAdmin: true, isToken: true }
            })
        ).toEqual({ allowed: false, reason: 'token-refused' });
    });

    it('lets a token through to the count once the rule opts in', () => {
        expect(
            evaluate({
                rule: ruleWith({ allowTokenPublish: true }),
                approvals: [approved('boris')],
                actor: token()
            })
        ).toEqual({ allowed: true, reason: 'satisfied' });
    });

    /**
     * The one reading of the spec that is genuinely ambiguous, decided here and
     * flagged in `AGENTS.md`: `allow_token_publish` lets the token *reach* the
     * count, it does not exempt it from one. The flag is named "allow token
     * publish", not "exempt tokens from review", and guessing this way costs a
     * confused CI run while guessing the other way silently unprotects a type.
     *
     * It also buys the flow people actually want: a human writes, humans
     * approve, and a deploy key ships it.
     */
    /**
     * The third term of `bypassable`, and the only one no other test reaches.
     *
     * Every other token case short-circuits at `token-refused` before the
     * bypass is computed, and every other bypass case uses a non-token actor —
     * so `adminBypass && isAdmin` already decides them and `&& !actor.isToken`
     * could be deleted with the whole suite staying green. It is here on
     * purpose: `isAdmin` is read off a session today, but the gate must not
     * depend on that staying true, because the failure it guards against is a
     * key publishing past a rule with no name to write into the log row.
     */
    it('offers no bypass to an opted-in token that claims to be an administrator', () => {
        expect(
            evaluate({
                rule: ruleWith({
                    allowTokenPublish: true,
                    adminBypass: true,
                    requiredApprovals: 2
                }),
                approvals: [approved('boris')],
                actor: { userId: null, isAdmin: true, isToken: true }
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 2,
            given: 1,
            stale: 0,
            bypassable: false
        });
    });

    it('still holds an opted-in token to the approval count', () => {
        expect(
            evaluate({
                rule: ruleWith({
                    allowTokenPublish: true,
                    requiredApprovals: 2
                }),
                approvals: [approved('boris')],
                actor: token()
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 2,
            given: 1,
            stale: 0,
            // A token has no bypass, ever: there is no human to demand a reason
            // from and no name to write into the log row.
            bypassable: false
        });
    });
});

describe('counting approvals on the head revision', () => {
    // covers: protection:I-05
    it('counts an approval given on the head', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 1 }),
                approvals: [approved('boris', HEAD)]
            })
        ).toEqual({ allowed: true, reason: 'satisfied' });
    });

    // covers: protection:I-05
    it('does not count one given on an earlier revision', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 1 }),
                approvals: [approved('boris', OLDER)]
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 1,
            given: 0,
            stale: 1,
            bypassable: false
        });
    });

    /**
     * The whole feature in one assertion. Nothing about the approvals changed —
     * the same rows, the same people — and the answer flipped because a save
     * moved the head. No dismissal logic exists to get this wrong.
     */
    // covers: protection:I-06
    it('changes its answer when the head moves, with the approvals untouched', () => {
        const approvals = [approved('boris', OLDER)];
        const rule = ruleWith({ requiredApprovals: 1 });

        expect(evaluate({ rule, approvals, headRevisionId: OLDER })).toEqual({
            allowed: true,
            reason: 'satisfied'
        });
        expect(evaluate({ rule, approvals, headRevisionId: HEAD })).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 1,
            given: 0,
            stale: 1,
            bypassable: false
        });
    });

    // covers: protection:I-05
    it('counts earlier revisions once count_stale_approvals is on', () => {
        expect(
            evaluate({
                rule: ruleWith({
                    requiredApprovals: 1,
                    countStaleApprovals: true
                }),
                approvals: [approved('boris', OLDER)]
            })
        ).toEqual({ allowed: true, reason: 'satisfied' });
    });

    /**
     * `unique (revision_id, user_id)` stops one person voting twice on one
     * version, but nothing stops them voting on five versions in a row — and
     * with stale approvals counted, a naive sum turns one reviewer into five.
     */
    // covers: protection:I-08
    it('counts one person once, however many versions they approved', () => {
        expect(
            evaluate({
                rule: ruleWith({
                    requiredApprovals: 2,
                    countStaleApprovals: true
                }),
                approvals: [
                    approved('boris', OLDER),
                    approved('boris', 'rev-5'),
                    approved('boris', HEAD)
                ]
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 2,
            given: 1,
            stale: 0,
            bypassable: false
        });
    });

    // covers: protection:I-08
    it('counts one person once even if the same row arrives twice', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 2 }),
                approvals: [approved('boris'), approved('boris')]
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 2,
            given: 1,
            stale: 0,
            bypassable: false
        });
    });

    it('counts several people separately', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 2 }),
                approvals: [approved('boris'), approved('igor')]
            })
        ).toEqual({ allowed: true, reason: 'satisfied' });
    });

    it('is satisfied by more approvals than the rule asks for', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 2 }),
                approvals: [
                    approved('boris'),
                    approved('igor'),
                    approved('dmitry')
                ]
            })
        ).toEqual({ allowed: true, reason: 'satisfied' });
    });
});

describe('the four-eyes switch', () => {
    // covers: protection:I-07
    it('excludes the author of the head revision', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 1 }),
                headAuthorId: 'anna',
                approvals: [approved('anna')]
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 1,
            given: 0,
            // Their own vote is not a vote lost to a save — it never counted.
            stale: 0,
            bypassable: false
        });
    });

    /**
     * "Whoever they are — administrators included". An administrator writing
     * and approving their own entry is exactly the review this rule is bought
     * to prevent, and the bypass is the sanctioned way past it: loud, reasoned
     * and in the log.
     */
    // covers: protection:I-07
    it('excludes the head author when the head author is an administrator', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 1 }),
                headAuthorId: 'root',
                approvals: [approved('root')],
                actor: administrator('root')
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 1,
            given: 0,
            stale: 0,
            bypassable: true
        });
    });

    it('lets the head author approve once the switch is off', () => {
        expect(
            evaluate({
                rule: ruleWith({
                    requiredApprovals: 1,
                    requireOtherPerson: false
                }),
                headAuthorId: 'anna',
                approvals: [approved('anna')]
            })
        ).toEqual({ allowed: true, reason: 'satisfied' });
    });

    /**
     * A revision whose author we cannot name — a deleted user, an import, a
     * migration. Excluding nobody is the only honest reading: the alternative
     * is refusing every approval on the entry with nothing to point at.
     */
    it('excludes nobody when the head author is unknown', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 1 }),
                headAuthorId: null,
                approvals: [approved('anna')]
            })
        ).toEqual({ allowed: true, reason: 'satisfied' });
    });

    it('leaves everyone else counting', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 1 }),
                headAuthorId: 'anna',
                approvals: [approved('anna'), approved('boris')]
            })
        ).toEqual({ allowed: true, reason: 'satisfied' });
    });
});

describe('the stale count', () => {
    /**
     * `stale` exists for one sentence in the interface: "the count moved
     * because you saved". It is people, not rows — the panel strikes a name
     * through, not a database id.
     */
    it('counts the people whose only approval is off the head', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 3 }),
                approvals: [
                    approved('boris', HEAD),
                    approved('dmitry', OLDER),
                    approved('igor', 'rev-5')
                ]
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 3,
            given: 1,
            stale: 2,
            bypassable: false
        });
    });

    it('does not call someone stale who also approved the head', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 2 }),
                approvals: [approved('boris', OLDER), approved('boris', HEAD)]
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 2,
            given: 1,
            stale: 0,
            bypassable: false
        });
    });

    /**
     * An excluded author is not a lost vote, so striking their name through
     * would explain a movement that never happened.
     */
    it('never counts the excluded head author as stale', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 1 }),
                headAuthorId: 'anna',
                approvals: [approved('anna', OLDER)]
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 1,
            given: 0,
            stale: 0,
            bypassable: false
        });
    });

    it('is zero when stale approvals are being counted anyway', () => {
        expect(
            evaluate({
                rule: ruleWith({
                    requiredApprovals: 3,
                    countStaleApprovals: true
                }),
                approvals: [approved('boris', HEAD), approved('dmitry', OLDER)]
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 3,
            given: 2,
            stale: 0,
            bypassable: false
        });
    });
});

describe('the bypass', () => {
    it('is offered to an administrator when the rule allows it', () => {
        expect(
            evaluate({
                rule: ruleWith({ adminBypass: true }),
                actor: administrator()
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 1,
            given: 0,
            stale: 0,
            bypassable: true
        });
    });

    it('is not offered when the rule turns it off — the rule is absolute', () => {
        expect(
            evaluate({
                rule: ruleWith({ adminBypass: false }),
                actor: administrator()
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 1,
            given: 0,
            stale: 0,
            bypassable: false
        });
    });

    it('is not offered to an ordinary member', () => {
        expect(
            evaluate({
                rule: ruleWith({ adminBypass: true }),
                actor: person()
            })
        ).toEqual({
            allowed: false,
            reason: 'insufficient-approvals',
            required: 1,
            given: 0,
            stale: 0,
            bypassable: false
        });
    });

    /**
     * Reported, never applied. The decision stays a refusal: taking the bypass
     * costs a reason, and only the caller can supply one, so a domain that
     * returned `allowed: true` here would publish without the log row that is
     * the entire point of allowing it.
     */
    it('leaves the decision a refusal', () => {
        const decision = evaluate({
            rule: ruleWith({ adminBypass: true }),
            actor: administrator()
        });

        expect(decision.allowed).toBe(false);
    });

    it('does not colour a satisfied decision', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 1, adminBypass: true }),
                approvals: [approved('boris')],
                actor: administrator()
            })
        ).toEqual({ allowed: true, reason: 'satisfied' });
    });
});

describe('degenerate rules', () => {
    /**
     * Not reachable through the editor, whose stepper starts at one — but it is
     * a coherent configuration rather than nonsense: "anyone may publish this,
     * a key may not". The function is total, so it answers rather than throws.
     */
    it('is satisfied by nothing when the rule asks for no approvals', () => {
        expect(evaluate({ rule: ruleWith({ requiredApprovals: 0 }) })).toEqual({
            allowed: true,
            reason: 'satisfied'
        });
    });

    it('still refuses a token when the rule asks for no approvals', () => {
        expect(
            evaluate({
                rule: ruleWith({ requiredApprovals: 0 }),
                actor: token()
            })
        ).toEqual({ allowed: false, reason: 'token-refused' });
    });

    it('treats a negative requirement as no requirement rather than throwing', () => {
        expect(evaluate({ rule: ruleWith({ requiredApprovals: -1 }) })).toEqual(
            { allowed: true, reason: 'satisfied' }
        );
    });
});

describe('countApprovals', () => {
    /** The counts alone, for a surface that has to render "2 of 2". */
    const count = (input: Partial<ProtectionInput>) =>
        countApprovals({
            headRevisionId: HEAD,
            headAuthorId: 'anna',
            approvals: [],
            actor: person(),
            ...input
        });

    it('counts the head revision and reports what a save left behind', () => {
        expect(
            count({
                rule: ruleWith(),
                approvals: [approved('boris', HEAD), approved('dmitry', OLDER)]
            })
        ).toEqual({ given: 1, stale: 1 });
    });

    it('follows count_stale_approvals', () => {
        expect(
            count({
                rule: ruleWith({ countStaleApprovals: true }),
                approvals: [approved('boris', HEAD), approved('dmitry', OLDER)]
            })
        ).toEqual({ given: 2, stale: 0 });
    });

    it('follows require_other_person', () => {
        const approvals = [approved('anna'), approved('boris')];

        expect(count({ rule: ruleWith(), approvals })).toEqual({
            given: 1,
            stale: 0
        });
        expect(
            count({ rule: ruleWith({ requireOtherPerson: false }), approvals })
        ).toEqual({ given: 2, stale: 0 });
    });

    /**
     * An unprotected type still has votes worth showing: a request for review
     * is allowed on one, so the panel has something to draw. The defaults are
     * what the type would count by if a rule were switched on as it stands.
     */
    it('counts by the documented defaults when there is no rule', () => {
        expect(
            count({
                rule: undefined,
                approvals: [
                    approved('anna'),
                    approved('boris'),
                    approved('dmitry', OLDER)
                ]
            })
        ).toEqual({ given: 1, stale: 1 });
    });

    /**
     * The property this function exists for. The editor's "1 of 2" and the API's
     * refusal must be one implementation, or they agree until somebody switches
     * on `countStaleApprovals` and then quietly do not.
     */
    it.each([
        ['plain', ruleWith({ requiredApprovals: 3 })],
        [
            'stale counted',
            ruleWith({ requiredApprovals: 3, countStaleApprovals: true })
        ],
        [
            'author allowed',
            ruleWith({ requiredApprovals: 3, requireOtherPerson: false })
        ]
    ])(
        'agrees with the refusal evaluateProtection reports (%s)',
        (_label, rule) => {
            const input = {
                rule,
                approvals: [
                    approved('anna'),
                    approved('boris', HEAD),
                    approved('dmitry', OLDER)
                ]
            };
            const decision = evaluate(input);

            expect(decision).toMatchObject({
                reason: 'insufficient-approvals'
            });
            expect(count(input)).toEqual({
                given: (decision as { given: number }).given,
                stale: (decision as { stale: number }).stale
            });
        }
    );
});

describe('the function itself', () => {
    it('does not mutate the approvals it is handed', () => {
        const approvals = [approved('boris', OLDER), approved('igor', HEAD)];
        const snapshot = JSON.parse(JSON.stringify(approvals));

        evaluate({ rule: ruleWith({ requiredApprovals: 3 }), approvals });

        expect(approvals).toEqual(snapshot);
    });

    it('gives the same answer twice for the same input', () => {
        const input = {
            rule: ruleWith({ requiredApprovals: 2 }),
            approvals: [approved('boris'), approved('dmitry', OLDER)]
        };

        expect(evaluate(input)).toEqual(evaluate(input));
    });
});
