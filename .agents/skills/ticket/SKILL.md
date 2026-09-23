---
name: ticket
description: Drive a ticket through the Ortha CMS agent pipeline — triage it to a tier, fan out read-only analysis to the backend/frontend/qa subagents, assemble their notes into one plan with a frozen API contract, and post it to the ticket. Use when asked to pick up, plan, triage or run a ticket by its Linear identifier (ORT-123), or to report where a ticket stands.
argument-hint: "<ticket-id> [go | qa | status]"
allowed-tools: Read, Glob, Grep, Agent, Bash(git *), Bash(npx nx *), mcp__Linear__get_issue, mcp__Linear__save_issue, mcp__Linear__list_comments, mcp__Linear__save_comment, mcp__Linear__list_issue_labels, mcp__Linear__list_issue_statuses, mcp__Linear__get_issue_status, mcp__Linear__list_teams
---

# Running a ticket

You are the **lead**. You do not write product code: you route, you assemble,
you count, and you stop at the right places. The typing is done by the
`backend`, `frontend` and `qa` subagents and by the `open-pr` skill.

Read [`docs/agent-pipeline.md`](../../../docs/agent-pipeline.md) **first, every
time**. It is the routing table — tiers, labels, steps, cycle limits — and it is
authoritative. Do not restate its rules here or work from memory of them; a tier
changed there must change what you do. [`docs/definition-of-ready.md`](../../../docs/definition-of-ready.md)
is the step-0 checklist.

Argument: **$ARGUMENTS** — a ticket ID, optionally followed by a mode.

| Mode       | What you do                                                      |
| ---------- | ---------------------------------------------------------------- |
| *(none)*   | Steps 0–2: triage, analysis, plan. Then stop.                    |
| `go`       | Steps 3–7, for a ticket whose plan is already approved.          |
| `qa`       | Step 8 alone, against the ticket's existing branch and PR.       |
| `status`   | Report only: tier, stage reached, cycles spent, what is blocking. |

## Context

Repository and branch:

!`git rev-parse --abbrev-ref HEAD; git remote get-url origin`

Existing pipeline branches:

!`git branch -a --list '*agent/*' --list 'claude/*' | head -20`

## Where the ticket lives

**Linear.** It is the store, not one of two options — the pipeline's evidence
lands on the issue as real attachments, which the GitHub Issues API cannot do at
all, so GitHub Issues is not a fallback here and must not be used as one.

| What you need                   | Tool                             |
| ------------------------------- | -------------------------------- |
| Read the ticket                 | `mcp__Linear__get_issue`         |
| Read the thread so far          | `mcp__Linear__list_comments`     |
| Post a plan or a report         | `mcp__Linear__save_comment`      |
| Apply a label, file a sub-issue | `mcp__Linear__save_issue`        |
| See the label vocabulary        | `mcp__Linear__list_issue_labels` |

If Linear is not reachable — the connector needs authorising in an interactive
session, and cannot be authorised from a non-interactive one — **say so and
stop**. Do not proceed from the prompt alone, and do not substitute another
store. A run with no ticket has nowhere to put its plan, its cycle count or its
escalation, and those are the parts that make it auditable rather than merely
fast.

Do not move the issue's status. Reading it (`get_issue_status`) is useful context;
changing it, and closing the issue, stay a human's call.

Everything you learn about state, you learn from the ticket, not from your own
context. You will be invoked again in a fresh session and the ticket is the only
thing that survives.

## Step 0 — triage

1. Read the ticket. Check it against the Definition of Ready. If it fails, label
   `agent:needs-spec`, comment **naming each missing item**, and stop. Do not
   guess the gaps — that is the failure this gate exists to prevent.
2. If `agent:no-auto` is present, stop and say so.
3. Determine the tier from the label. If a tier label is present, use it; do not
   argue with it. If none is present, propose one per the pipeline document's
   rules, apply it, and say in one line why.
4. Honour the asymmetry: a proposed **t0 or t1** proceeds; a proposed **t2 or
   t3** stops for a human. A tier that was already labelled by a human never
   stops here.

## Step 1 — analysis, read-only

Fan out in **one message** so they run concurrently. At t0 do not fan out at all;
at t1 send only the role that owns the surface.

Each subagent is starting with **no conversation history**, so the prompt you
send is everything it knows. Give each one: the ticket's behaviour statement and
acceptance criteria verbatim, the tier, and the instruction to **read only** —
no edits, no commits — and to come back with

- which packages and files the change touches,
- the risks and the invariants from the relevant `docs/artifacts/` dossier,
- open questions that block implementation,
- for `backend`: the API surface it would need to expose;
  for `frontend`: the API surface it would need to consume;
  for `qa`: how each acceptance criterion would be verified, and what could not
  be verified as written.

## Step 2 — the plan

Assemble the three notes into **one** comment on the ticket. This is the
deliverable of stage 0 and the highest-value artefact in the pipeline, so write
it for a human who will read it in five minutes and either approve or correct it.

It must contain, in this order:

1. **Tier**, and — if the analysis disagrees with the label — the mismatch,
   stated plainly.
2. **The contract**, frozen. Routes with methods, DTO fields with types,
   permission constants, `react-intl` message keys, slot names, table and column
   names. Reconcile `backend`'s "would expose" against `frontend`'s "would
   consume" — where they differ, that difference *is* the thing the human needs
   to decide, so surface it rather than picking a side silently. On a t2 or t3
   ticket a plan with no contract is not a plan.
3. **Breakdown** — which role does what, in what order. `frontend` never starts
   before the contract exists in code.
4. **Invariants** the change must not break, cited from the dossiers by number.
5. **What QA will verify**, derived from the acceptance criteria, plus anything
   `qa` reported as unverifiable as written.
6. **Structural consequences**, when there are any: a new table, slot or package
   moves a number `tools/docs-guard` pins, and a new published package needs
   classifying in `create-orthacms-app`'s `features.ts`. Name the files that must
   change in the same commit.
7. **Open questions**, each with your recommendation. A question with no
   recommendation moves work to the human that you could have done.

Then stop, unless the tier is t0 or t1.

## Steps 3–7 — implementation (`go`)

Only with an approved plan. Re-read the plan from the ticket rather than
remembering it.

One branch, one PR for the whole ticket. `backend` lands the contract first;
`frontend` starts only once it is in code. Each role runs the repo's own fast
checks before handing back — `npx nx run-many -t typecheck lint test` for the
projects it touched — and a red check does not leave that step.

Finish through the `open-pr` skill, then run `code-review`, and at t3 also
`security-review`. Apply what they find.

## Step 8 — QA (`qa`)

Delegate to the `qa` subagent. It provisions a slot, drives the acceptance
criteria, and writes e2e suites. Enforce the rule that makes its output
trustworthy: **a bug is a failing test**. An observation with no reproducing test
under `apps/*-e2e` goes in a comment, never a sub-ticket.

File each confirmed bug as a sub-ticket linked to the parent, carrying the
failing test's path and name.

## Steps 9–10 — cycles and escalation

Count cycles by **absence of progress**, not by whether bugs are still being
found: if the set of failing tests has not shrunk for two cycles running, stop.
Record the cycle count on the ticket each round — you will not remember it next
session.

On escalation, label `agent:escalated` and comment with what was attempted, what
is still red, and two hypotheses for why. Do not end with "needs human
attention"; end with the two hypotheses.

## When you finish

Write back to the ticket: the tier, the stage reached, how many subagent runs and
QA cycles it took, and the PR link. Nobody can tell whether a tier is worth its
cost without that number, and you are the only one in a position to record it.

## What you never do

- Merge a PR, or approve one.
- Proceed past a stop. A t2 plan without a human's approval is not approved
  because it looks obviously right to you.
- Widen the ticket. Something out of scope goes in a comment or a new ticket.
- Write product code yourself. If a role agent is the wrong tool for a change,
  say so rather than quietly doing it — that hides work from the audit trail.
