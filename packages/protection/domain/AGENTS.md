# `@orthacms/protection-domain`

The **publication-protection kernel** — may this person ship this entry now,
decided by one pure function over a rule, the head revision and the votes
recorded against it. No NestJS, no Drizzle, no React.

It is the **third** gate on publish, after the `content:publish` permission and
after the publish gate. It answers _who_, never _what_.

| File                     | What lives there                                                       |
| ------------------------ | ---------------------------------------------------------------------- |
| `protection-rule.ts`     | The rule's six fields, a vote, the actor, and the input.               |
| `evaluate-protection.ts` | `evaluateProtection` and `ProtectionDecision` — plus `countApprovals`. |

## Two entry points, one implementation of counting

`evaluateProtection` answers _may this ship_; `countApprovals` answers _where
does the count stand_. The second exists because `ProtectionDecision` carries
`given`/`stale` only on its refusal branch — a satisfied publish has nothing to
explain — while the entry editor has to draw "2 of 2" whether or not it is
enough.

The alternative is a surface that counts votes for itself, and it does not stay
wrong quietly: a panel and a gate that each implement the count agree until
somebody switches on `countStaleApprovals` or the four-eyes exclusion bites, and
then the button says one thing and the API refusing it says another. So
`evaluateProtection` calls `countApprovals`, and a caller that only wants the
numbers calls it directly rather than asking the gate a question it is rigged to
refuse.

With no rule, `countApprovals` uses the documented defaults — the head author
excluded, stale approvals not counted — which is what a type shows before
anybody protects it. Votes on an unprotected type are worth showing: asking for
a second pair of eyes is allowed there, it just does not block.

## Do not call it `canPublish`

`content/domain` already exports that name — the publish gate, which answers
whether the entry is _complete_. Two functions of one name deciding different
halves of the same button is exactly the two-authorities confusion
[ADR-0015](../../../docs/adr/0015-alarms-are-non-blocking.md) exists to prevent.
`kernel-boundary.spec.ts` fails if a `canPublish` ever appears in this package's
public API.

## The model, in full

An **approval belongs to a revision, not to an entry.** That single decision
carries the design: `content_entry_revisions` already snapshots every save,
numbered per entry and keyed per locale, so a vote recorded against the previous
revision stops counting toward the head **with no dismissal logic anywhere**.
Nothing is deleted; the row survives so the interface can strike it through
naming its version, because a counter that silently rolls back is unexplainable
to the person who just pressed Save.

`evaluateProtection` applies its rules in this order, and the order is load-bearing:

1. **No rule, or a rule switched off → `unprotected`.** The two states are
   identical, and this check sits _before_ the token gate: refusing a key on a
   type nobody chose to protect would break a deploy that never opted in.
2. **A bearer token is refused**, before the count and regardless of it, unless
   the rule sets `allowTokenPublish`. A token holds `content:publish` in the
   `full` scope and names nobody in the log, so a rule that let one through by
   default would be escaped by minting a key.
3. **Count the distinct people** who approved the head revision — or any
   revision when `countStaleApprovals` is on.
4. **Minus the head revision's author**, when `requireOtherPerson`. Whoever they
   are, administrators included.

There is one kind of vote. _Request changes_ was removed together with review
notes: without a sentence saying what to change it carried nothing, and a
reviewer who is not satisfied simply does not approve.

## Three things worth not re-deriving

**`allowTokenPublish` lets a token reach the count, it does not exempt it from
one.** The design doc is genuinely ambiguous here — its table says a token
"cannot publish this type at all" when off, and ADR-0017 calls allowing tokens
"escaping the rule", which reads the other way. Decided this way because the
flag is named _allow token publish_, not _exempt tokens from review_; because
guessing this way costs a confused CI run while guessing the other way silently
unprotects a type; and because it buys the flow people actually want — a human
writes, humans approve, a deploy key ships it. Revisit it here, in one line, not
by copying a second reading into the server.

**`stale` is people, not rows.** It is `|approvers across every revision| −
|approvers who count|`, which makes it exactly "how many names the interface
strikes through", and drops to zero on its own when `countStaleApprovals` is on,
because then they are not stale. The excluded head author never appears in it: a
vote that never counted is not a vote lost to a save.

**Distinctness is by user, in both sets.** `unique (revision_id, user_id)` stops
one person voting twice on one version, but nothing stops them approving five
versions in a row — and a naive sum would turn one reviewer into five the moment
stale approvals are counted.

## What is deliberately not here

No field values, so protection **cannot** validate content even by accident —
there is nowhere in the input to put one. No locale handling: revisions are
already per-locale, so `headRevisionId` carries it and the caller's query does
the scoping. No statuses, and no reviewer lists: a review request names the
people asked, but whom somebody asked never changes whose approval counts, so
the requested reviewers are not part of this input.

`bypassable` is **reported, never applied**. Taking a bypass is the caller's
explicit act, confirmed by a person, so a decision that returned
`allowed: true` here would publish past the rule without anybody having chosen
to — and without the log row that is the whole reason bypassing is permitted.

## Invariants covered here

The full list is in
[`docs/design/protection.md`](../../../docs/design/protection.md). This package's
tests carry the domain half of **I-04** through **I-08** and **I-11**, tagged in
the test names. The rest belong to the server, the admin and the host.
