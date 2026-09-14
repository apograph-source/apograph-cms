# Definition of Ready

What a ticket must contain before the [agent pipeline](agent-pipeline.md) will
act on it. The lead checks this at step 0 and, when it fails, labels the ticket
`agent:needs-spec`, says what is missing, and stops.

This gate exists because of one failure mode that dominates all others: three
agents fanned out across an under-specified ticket do not stall, they
**invent**. Each one fills the gap differently, the plan reads as confident, and
the divergence surfaces days later as rework. A ticket that is two sentences
short of ready is cheaper to fix than an afternoon of code built on a guess.

## Required

**1. The behaviour change, stated as behaviour.** Not the implementation. "An
editor with `content:approve` can approve from the records list without opening
the entry" is behaviour. "Add an approve button" is a guess at a solution and
tells the analysis nothing about what it is for.

**2. Who it is for.** A role or permission, if the change is gated at all. Most
of this codebase is permission-gated, so a change whose audience is unstated is a
change whose guard is unstated.

**3. Acceptance criteria, as a list.** Each one checkable by clicking or by
calling an endpoint. These are not decoration — at step 8 they are the script QA
drives through `agent-browser`, and at step 2 they are what the plan's "what QA
will verify" section is built from. A ticket with no acceptance criteria cannot
reach t2.

**4. Out of scope.** One line. The most expensive thing an agent does is widen
the work because nothing said where it stopped.

## Recommended

**Where you think it lives** — a package or a group (`packages/protection`,
`content/admin`). The analysis will confirm or correct it, but a starting point
saves a fan-out pass. Being wrong here costs nothing.

**A reproduction**, for a bug: steps, what you expected, what happened. Without
it the analysis has to guess the defect before it can plan the fix, and it will
sometimes guess a different bug than the one you saw.

**Prior art** — a similar flow already in the product, an ADR, a dossier
invariant the change has to respect.

## Not required

Effort estimates, and a tier label. The lead proposes the tier at triage, and on
anything it reads as t0 or t1 it simply proceeds. Label it yourself when you
disagree with the routing — that override is why the label exists.

## The shape of a ready ticket

```
Publishing an entry from the records list

Behaviour
  A user holding content:approve can approve a pending review from the
  records list, without opening the entry.

For
  Holders of content:approve. Users without it see the review state but
  no control.

Acceptance criteria
  - The records list shows a review chip on every entry with an open
    review request.
  - Clicking approve on a chip records a vote against the head revision
    and updates the chip without a page reload.
  - A user without content:approve sees the chip as read-only.
  - Saving the entry afterwards stops the approval counting (the vote
    belongs to a revision).
  - The list's own filters and pagination survive the mutation.

Out of scope
  Bulk approval. Notifying the requester.

Probably lives in
  packages/protection/{admin,server}, plus a records column in
  content/admin.
```

The last criterion in that example is the kind of line that is worth writing even
when it feels obvious: "clamp the page to `pageCount` after a mutation" is a
review-critical rule in the `admin-plugin` skill precisely because it is the
thing everyone forgets.
