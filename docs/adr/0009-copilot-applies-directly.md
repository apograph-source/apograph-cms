# 0009 — The copilot asks in the moment, then applies directly

- **Status:** Accepted
- **Date:** 2026-08-09
- **Deciders:** Engineering

> Amends [ADR-0005](0005-copilot-authority-model.md). §5 (writes produce
> proposals a human accepts) and §6 (direct apply is a per-workspace, per-tool
> opt-in) are **replaced** by this record. Everything else in ADR-0005 stands
> unchanged and is, if anything, load-bearing now: §1 (no copilot identity),
> §2–3 (the profile, recomputed per run and enforced at offer and execution),
> §7 (no publish tool), §8 (untrusted content), §9 (audit) and §10 (off by
> default, per-deployment).

## Context

ADR-0005 §5 made every copilot write a `copilot_proposals` row that a human
accepted through a card in the chat panel. §6 added an escape hatch: a
per-workspace, per-tool opt-in an admin could tick to skip the click.

Both shipped. What we learned from having them:

- **The opt-in screen is the feature nobody uses.** It defaults to every box
  unticked, it is behind an admin-only permission, and its own copy has to open
  by explaining that it is _not_ a permissions screen — because a page of empty
  checkboxes is read as a list of things you are forbidden to do. A
  configuration surface whose main job is apologising for the default is the
  wrong surface.
- **The review step is not review.** One request produces one card per change:
  "add alt text to every image in this article" is one sentence and twelve
  approvals. Nobody reads the twelfth. Clicking Apply twelve times is a queue
  being cleared, and a UI that rewards clearing it fast produces worse scrutiny
  than no ceremony at all — while still costing every user the ceremony.
- **It taught the wrong thing about authority.** Users reasonably read "Ortha AI
  needs your approval" as "Ortha AI could otherwise do more than you can". The
  opposite is true and always was: a run holds exactly the caller's permissions
  (§1–3), so a viewer's copilot is provably read-only whatever the policy says.
  The approval step obscured the guarantee it was supposed to express.
- **The pressure valve pushed the wrong way.** §6's opt-in is per tool, so a
  workspace tired of clicking turns on auto-apply for _every_ tool at once —
  arriving at this decision anyway, less deliberately, and with a screen and a
  table to maintain on the way.

What has not changed is the risk ADR-0005 was written about: entry bodies are
user-authored and attacker-influenceable, so a prompt injection can steer tool
selection. We accept that risk explicitly below rather than pretend it went
away.

## Decision

**A write asks once, in the moment, and then applies immediately.** The
caller's own permissions decide what is _possible_; an in-the-moment prompt
decides what actually happens.

1. **No review queue.** The run engine persists the `copilot_proposals` row and
   immediately applies it through the owning plugin's `ProposalApplier`. There
   is no `accept`, no `reject`, and no change sitting in a list waiting to be
   found.

1b. **Instead, the run parks _before_ the call runs.** A `propose` or `apply`
tool the thread has not already allowed makes the engine emit a
`tool-permission-request` frame and wait. The user answers **Allow once**,
**Allow for this chat**, or **Don't allow**; a refusal comes back as an
ordinary tool error the model reports. Reads never ask — a model runs three
or four before it answers anything, and a chat that opens with four prompts
teaches people to click through them without reading, which is worse than
not asking.

This is the difference between this record and the boundary it replaces, and
it is the whole of it: the old step asked about a change that had **already
been computed**, from a queue, later. This asks **before anything happens**,
inline, with the escape hatch in the prompt itself rather than on a settings
page. Twelve cards became twelve clicks; twelve calls become one click and
then silence, because the second button says "for this chat".

"Allow for this chat" is remembered on the **conversation row**
(`copilot_conversations.allowed_tools`) and dies with the thread. There is
deliberately no "always": a standing per-user allow-list is a policy
outliving the context it was granted in, which is the shape §4 below deletes.
The memory is a **usability** one and never an authority one — every call it
skips the prompt for is still authorized against live grants.

2. **The row stays, and is now the whole paper trail.** It is still written
   _before_ the apply, by the engine rather than the binder, so ADR-0005 §5's
   "undoable, never invisible" survives the loss of the human step — the change
   is recorded whether or not the write then succeeds. A binder that wrote
   directly instead of returning a draft would be a change with no receipt.

3. **`pending` now means the apply failed.** A failed apply reopens the row with
   its error, the run event carries the message, and the card says the change
   did not happen. Nothing retries it: the user asks again.

4. **The per-workspace policy is deleted** — `copilot_workspace_policies`, the
   `GET/PUT /api/copilot/policy` routes, the settings page and its nav entry.
   `copilot:configure` is removed from `PERMISSIONS` too; it gated nothing else.

5. **Offer-time filtering loses its second gate.** `resolveCapabilityProfile`
   decides on declared permissions alone; the `apply-not-enabled` withheld
   reason is gone. An `apply`-effect tool is offered exactly when a `read` one
   with the same `requires` would be.

6. **The kill switches stay, and are now the whole of the operator's control**:
   ADR-0005 §10's per-deployment `enabled` flag, `copilot:use` per role, and the
   workspace's content grants.

## Consequences

**Easier:**

- The product behaves the way its own copy already described: Ortha AI does what
  your role lets you do, and says what it did.
- One authority model to reason about instead of two. "What may this run do" has
  a single answer — the caller's grants — checked at offer and at execution.
- A whole surface deleted: a table, a migration, two routes, a permission key, a
  page, a nav entry, a query hook, two mutations and the accept boundary's
  concurrency handling.
- Bulk work stops being a clicking exercise, which removes the incentive that
  was pushing workspaces toward blanket auto-apply.

**Harder / the cost we accept, stated plainly:**

- **A prompt injection is stopped at the prompt, not by the audit log.** This is
  where an earlier draft of this record accepted that an injection would simply
  write, with the audit trail as the only detection. That was too much to give
  up, and §1b is what buys it back: the injected call parks and shows the user
  its arguments before anything happens. What remains is the honest residual —
  a user who has answered "allow for this chat" has, for that thread, accepted
  whatever that tool does next, including a call an injection talked the model
  into. Bounded by their own permissions, audited, revision-backed, and unable
  to publish (§7) or leave the workspace.
- **A parked run holds a connection and a model context open.** Five minutes,
  then it refuses and the answer lands anyway. The SSE heartbeat already keeps
  the socket alive, so the limit is about the user, not the transport.
- **The broker is in-memory, so a run and its decision must reach the same
  instance.** Fine for a single-node self-hosted deployment, which is what this
  is; a horizontally scaled one needs sticky routing by `runId` or a shared
  channel. Documented rather than discovered as an occasional hang.
- **Surfacing what the copilot changed is still worth building** — a workspace
  should see it without opening a thread — but it is no longer the only thing
  standing between an injection and a write.
- **Undo is per entry, through revisions.** There is no "undo everything that
  run did", and a run that touched a dozen entries needs a dozen restores.
- A deployment that wants _queued_ review — someone other than the asker
  approving later — has no setting for it. The prompt is synchronous and belongs
  to whoever is driving the run. Its levers are `copilot:use` per role and the
  global kill switch.

**What this rules out:** the proposal as a _decision_ — nothing may pause on a
human again without a new record. It does **not** rule out a future
deployment-level (not per-workspace, not per-tool) review mode; if one lands it
should be config next to the model providers, where operator decisions live.

## Alternatives considered

- **Keep the mechanism, flip the default to on.** The smallest change: every box
  ticked out of the box. Rejected because it keeps the screen, the table, the
  permission and the second authority model in exchange for a default — and the
  screen was the thing users pointed at.
- **Move the opt-in to host config** (`ortha.config.ts`, beside the model
  providers) and delete only the UI. Genuinely attractive: it keeps
  propose-then-apply available for a cautious deployment while removing the
  surface nobody used, and it makes the choice an operator's rather than an
  editor's. Rejected for now because it leaves two code paths and two sets of
  copy for a mode we expect nobody to enable — and because reintroducing it
  later is a config key plus the applier call that already exists. This is the
  option to revisit first if the injection cost above proves real.
- **Approve only high-blast-radius changes** (deletes, bulk edits over N
  entries). Keeps a step where it earns its place. Rejected for v1 as a rule
  nobody can predict: "why did this one ask me?" is a worse experience than
  either consistent behaviour, and the threshold would need tuning we have no
  data for.
- **Keep proposals and add "Apply all".** What we built immediately before this
  decision. It helps, and it is what showed that the step was ceremony: with one
  button clearing twelve cards, the cards were doing nothing the button could
  not.
- **Apply directly with no prompt at all**, leaning on the audit log. The first
  draft of this record. Rejected once written down: it traded a real defence for
  convenience and offered "you can read the log afterwards" as the mitigation,
  which is exactly the "recoverable ≠ noticed" argument ADR-0005 made and this
  record had just agreed with.
- **A persistent per-user "always allow".** The obvious third button, and what
  the tool it is modelled on offers. Rejected here because a standing allow-list
  is a policy that outlives its context — the thing §4 deletes — and because a
  thread is a scope a person can actually hold in their head. Revisit if
  re-approving once per thread proves to be the new ceremony.
