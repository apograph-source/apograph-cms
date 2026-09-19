# `@apograph/protection-admin`

Publication protection as the people who use it meet it: three contributions
into the Content Library's slots, where a requirement is met or missed, one into
workspace settings, where a rule is made, and **one page of its own** — the
reviewer's queue, which is where somebody finds out an approval is wanted.

```
src/lib/
  domain/types.ts              the wire shapes, restated, plus `toneOf`
  infrastructure/
    protectionGateway.ts       the port over /api/protection + its HTTP impl
    protectionKeys.ts          query keys — every one carries the workspace id
  application/hooks.ts         the reads, the request and the approval
  presentation/
    protectionPlugin/          the factory
    components/
      ReviewChip/              the header chip  (ENTRY_HEADER_SLOT)
      ReviewerLabel/           an id → a person, from the open workspace
      ReviewSection/           the rail block   (ENTRY_SIDEBAR_WIDGET_SLOT)
        ReviewerRow/             one person: green check or yellow dot, in words too
        RequestReviewDialog/     the people picker behind Request review
        ReviewActions/           request review / approve
      BypassDialog/            the way past a rule — a confirmation
      ProtectionSettings/      the settings tab (WORKSPACE_SETTINGS_TAB_SLOT)
        RuleEditorDialog/        the six fields, submitted whole
      ReviewQueueTable/        one tab's rows, as a real table
      RequestAge/              how long an ask has waited, in words
      ReviewsSkeleton/         the lazy route's fallback
    pages/ReviewsPage/         the queue      (WORKSPACE_ROUTE_SLOT + NAV)
    slots/publishGuard/        the verdict     (ENTRY_PUBLISH_GUARD_SLOT)
```

Layered per [ADR-0003](../../../docs/adr/0003-tactical-ddd-inside-plugins.md).

## What it contributes

| Surface         | Where                         | What it says                                 |
| --------------- | ----------------------------- | -------------------------------------------- |
| Review chip     | `ENTRY_HEADER_SLOT`           | "Needs review · 0 of 2"                      |
| Review block    | `ENTRY_SIDEBAR_WIDGET_SLOT`   | who was asked, who approved, and the actions |
| Publish verdict | `ENTRY_PUBLISH_GUARD_SLOT`    | whether Publish is held, and why             |
| Protection tab  | `WORKSPACE_SETTINGS_TAB_SLOT` | which types are protected, and how           |
| Review column   | `RECORDS_COLUMN_SLOT`         | where each row stands, one request per page  |
| `reviewState`   | `RECORDS_FILTER_FIELDS_SLOT`  | waiting on review / not requested            |
| Insights card   | `INSIGHTS_WIDGET_SLOT`        | how much review is outstanding               |
| Reviews page    | `WORKSPACE_ROUTE_SLOT` + nav  | what is waiting, and on whom                 |

**The three entry contributions render nothing on an unprotected type** and on a
non-publishable one. `reviewScopeOf` is the single place that decides, so the
three cannot disagree about when the feature applies at all. An installation
with no rule is the entry editor it was before this package existed.

**A create form is the one place the verdict speaks and the chip and rail do
not.** There is no entry to review, but its Publish creates one and publishes it
in the same press, so the verdict reads `GET /protection/types/:type` — what a
new entry of the type would meet — instead of the entry review. The chip and the
rail stay silent: "0 of 2" about a record that does not exist is noise.

**The verdict answers for the version Publish will ship, not the stored one.**
Publish saves anything unsaved first, and that save is a new version with none
of the head's approvals and the caller as its author. So a dirty editor reads
the review's `afterSave` projection, a clean one the review itself, a create
form the new-entry read — all three computed by the server's kernel.

**The settings tab is the deliberate exception.** It is where a workspace with
no rule goes to get one, so it has to be visible before there is anything to
see. It is hidden from anybody without `protection:manage` instead — the list
route is administrator-only too, so a visible tab would be a link to a 403.

## The rules worth not re-deriving

**Nothing here counts anything.** The requirement, the tally and the staleness
all arrive computed from `GET /api/protection/entries/:type/:id`, which reads
them from `evaluateProtection` in the kernel. A second count in the client is a
panel that agrees with the API until somebody switches on `countStaleApprovals`
or the four-eyes exclusion bites, and then quietly does not — which is the
failure #257 was amended to prevent, on the server side of the same seam.

**The Review block lists people, and colour is never the only signal.**
`reviewerRows` puts everybody the request names first, in the order they were
picked, then anybody else who approved — who was asked never changes whose
approval counts, so leaving an unasked approver out would make the count disagree
with the names. Each row is a green check with "Approved" once they approved the
current version, or a yellow dot with "Pending"; the marks are `aria-hidden` and
the words carry the state.

**An approval a save left behind says so in words.** That person is pending
again, and the sentence under their name ("approved version 4 — the entry has
changed since, so this no longer counts") is the explanation for why the count
moved. `ReviewerRow`'s spec pins it.

**No notes, no _request changes_, and Approve goes away once used.** Review
messages were removed: _Request review_ opens `RequestReviewDialog`, a picker of
exactly the people the server accepts (`GET …/reviewers`), and on an entry that
already has a request the button reads _Change reviewers_ and starts from who is
already asked. _Approve_ is hidden once `callerApprovedHead` — the green check on
your row already says it — and comes back after a save.

**The save is not invalidated — it is keyed.** `EntryReviewScope` carries the
entry's `updatedAt` and `entryReviewKey` carries it **last**, so a save produces
a new query key and the panel reads afresh. Protection never reaches into
content's save path, and content never learns protection exists. An approval or a
request, by contrast, invalidates **only** this entry's review — by the key's
**prefix**, because a vote moves no `updatedAt` and so cannot know which version
the panel is holding; it moves no value, no relation and no revision either, so
refreshing the editor would refetch a record and a whole timeline to learn one
number. That is why the version sits at the end of the key rather than anywhere
else: the prefix has to stay a prefix, or all four review actions refresh
nothing.

**An unprotected type mints no new key.** `reviewScopeOf` answers for any saved
publishable entry and cannot know whether a rule exists — only the first response
says `protected: false`. So `entryReviewVersion` reuses the token of a cached
unprotected answer instead of the new `updatedAt`: with no rule, saving costs no
request, which is the inertness I-03/I-04 promise, and it is safe because every
reader bails on that flag before it looks at another field. The cost is that a
rule written while such an editor is open is not noticed until it is reopened —
the same trade the rule write already makes by not invalidating open panels.
`entryReviewVersion` is pure and unit-tested, and `protection-refresh.spec.ts`
pins both halves of the key in a browser: the chip rolling back from
`Reviewed · N of N` to `Needs review · 0 of N` after a Save draft without a
reload, and a save on an unprotected type issuing no second read at all. Neither
passes without the version in the key and the gate on it respectively.

**Publish is held for the beat the new key is in flight.** The save mints a key
with no answer yet, so for that beat the verdict has no numbers for the version
Publish would ship — and answering `null` there let the primary button, the ⋯
menu's _Save & publish_ and an offered bypass all go live with no reason on them.
The bypass was the serious one: it was gone from `action.onSelect` too, so the
click published **without** `bypass: true` and met a 403 instead of the
confirmation. So `useEntryReview` reports `typeKnownProtected` beside the query —
whether an answer already cached for this entry said a rule is in force, which is
knowledge about the _type_ and so outlives the version it came with — and the
verdict returns a **hold with no way through** while that is true and no answer
is in hand. It carries no numbers forward, deliberately: `keepPreviousData` would
re-show `Reviewed · N of N` about a version that no longer exists and open a
bypass dialog stating a count the save had already invalidated.

**The bypass does not publish anything itself.** An administrator who may pass
a rule sees an ordinary **Publish** — same label, same style — and the click
opens a confirmation. Confirming goes back through the `publish` callback
`ENTRY_PUBLISH_GUARD_SLOT` hands the action, which runs the editor's own publish
with `bypass: true`: client validation, saving the edits on screen (or
creating the record), the busy cover and the toasts. The dialog used to post to
content's publish route directly, which shipped the stored record and silently
dropped whatever was being edited — and on a create form had no record to
publish at all.

**The bypass asks for no reason.** Reasons were removed with review notes; the
dialog names the rule, how far short the count is, and that an
`entry.publish_bypassed` row will be written with your name — before the click.
The pause stays: publishing past a rule is still something a person confirms.

**The request dialog's submit is not disabled with nobody picked.** Pressing it
says why, through a `FieldError` that announces — a disabled control explains
nothing to a screen reader.

**The dialog returns focus itself, in `onCloseAutoFocus`.** Radix restores focus
to whatever it captured when the content mounted, and that reference is not
reliable here: the trigger belongs to `content-admin` and is re-rendered as the
verdict changes, so the node Radix holds can be one React has already replaced —
and closing with Escape left focus on `<body>`, putting a keyboard user back at
the top of the page. The trigger is captured in `onSelect` instead, at the
moment of the click, and restored inside Radix's own hook so nothing overwrites
it afterwards. The e2e pins it; it failed before this and passes after.

**A failed read is not an empty one.** "Nobody has reviewed this" is a claim
about the entry; saying it when the truth is "we could not ask" tells somebody
their draft is unreviewed when it may be approved.

**The guard says nothing while the read has failed, or while nothing is known
about the type.** Blocking the button on an unreachable API would make a network
fault look like a refused publish, and the person could not tell them apart. The
server refuses regardless, with the reason — so silence is the honest client-side
default. The one in-flight read it does **not** stay silent about is the re-read
after a save on a type it already knows is protected: see the hold above. "We
could not ask" and "we are asking again about a rule we know exists" are
different facts, and only the first one is silence.

## Names come from the workspace, not from a request

The API stays id-only. `ReviewerLabel` resolves a reviewer through
`useCurrentWorkspace`, whose members the shell has already loaded — so putting a
name beside a vote costs no request. Somebody who has left is named as such
rather than given a fabricated label: a vote records who looked, and inventing a
name over a gap in the roster misreports the one fact the row carries.

## The settings tab

**The list is the workspace's content grants, not its rules.** A rule is
addressed by `(workspace, kind, slug)` — the same pair `workspace_content`
grants — so no type picker is invented and there is nothing to keep in step: a
type is listed because the workspace may work with it, and its rule is a
property of the row rather than the reason for it. `protectedTypeRows` is the
whole selector, pure and unit-tested.

**A non-publishable type is left out**, because protection guards
`draft → published` and a type that is always live has no transition to hold.
**A rule whose type is no longer granted is kept**, listed separately and
removable — the API returns those on purpose, and dropping them here would
leave a rule nobody can see and nobody can delete.

**The editor submits all six fields, always.** `PUT` replaces rather than
patches, so a form that sent only what it showed would reset the rest to their
defaults and "what does this rule do" would become a question about the order
somebody edited it in.

**The one-member warning is announced, not merely rendered.** ADR-0017 accepts
that a workspace of one person with four eyes required blocks itself, and
requires the interface to say so _when the rule is switched on_ rather than a
week later on the first failed publish. Somebody who has just flipped a toggle
is looking at the toggle, so the warning lives in a `role="status"` live region.
`blocksEveryone` is the predicate; both halves are pinned by tests, and both
mutations fail them.

**The count is a number input, not a stepper.** The mockup draws −/+ around a
value; a pair of buttons around a `<span>` has no value a screen reader can read
back and no keyboard behaviour of its own. A real `type="number"` with a label
gets both for free, and the clamp still runs on what is typed.

**`allow_token_publish`'s helper text says what it actually does.** A token that
is let through still meets the approval count — the flag stops it being refused
outright, it does not exempt it from review (#258). The mockup's caption
predates that decision and is wrong; the interface says the true thing.

## The Reviews page

**It is the only way a reviewer learns there is work.** Approvals can be
recorded the moment a rule exists, but nothing announces one until the mail port
lands (ORT-207), so this page carries the whole feature's discoverability. It is
a page rather than a saved view of a records list because an ask arrives against
whichever type somebody happened to be editing, and a saved view can only ever
ask about the collection it belongs to.

**One request feeds both tabs.** `splitQueue` splits one fetched window, so
the two counts cannot disagree with each other, switching tabs costs nothing,
and no ask can appear in both for the render where a second request had not yet
landed.

**"Waiting on me" is every ask that names me.** A request says who was asked, so
that is the true answer; an ask naming somebody else is in neither tab, even
though anyone with `content:approve` may still approve it. The narrower reading
— _minus what I have already approved_ — is deliberately **not approximated**:
the queue line carries the tally but not who approved. The table has a
_Reviewers_ column naming who each ask is waiting on.

**The age says "overdue" in words, not only in colour.** A greyscale screen, a
colour-blind reader and a screen reader all have to get the same fact — the rule
a queue breaks most easily, because "this one is old" feels like something red
says by itself. The exact moment rides `<time datetime>` so nothing is lost to
the rounding.

**A failed read is not an empty queue.** "Nothing is waiting on you" is a claim
about the workspace; saying it when the truth is "we could not ask" tells a
reviewer they are free when they are not, which is the one thing this page must
never do.

## The records column and its filter

**The column counts nothing.** The numbers arrive from
`GET /protection/entries/:type/status`, which reads them through the same kernel
call the publish gate obeys — so a row saying "2 of 2" beside a Publish button
that then refuses cannot happen. It is one request for the **page**, never one
per row, and only when the column is switched on: extension columns are hidden
by default and `useRowsData` runs on every render regardless, so ignoring
`isVisible` fetches on every page of every list for numbers nobody is looking
at. The entry ids are part of the query key, because paging changes which rows
are on screen and a key that ignored them would serve the previous page's
numbers against the new page's rows — wrong in a way that looks plausible.

Every state carries its meaning in **text** and its own `aria-label`: a bare
"1 of 2" in a row of numbers says nothing about what was counted, and a reader
arrives at the cell with only a column header for context. An **absent** status
renders nothing rather than a placeholder — "we have not asked" and "this type is
unprotected" are different facts.

**The filter's operator set is the subquery's, not a column's.** The server
answers `eq` and `in` and refuses the rest, and an operator the resolver refuses
reaches the user as "couldn't load this collection" over a rule the drawer itself
proposed — so the two lists are narrowed together or not at all. Negation is
absent for the reason it is absent from i18n's fields: `ne` would negate _inside_
the EXISTS. "Not waiting" is its own value in the enum, which is the honest
spelling.

## The Insights card

**The four-branch state ladder is `WidgetCard`'s, not the card's.** That is why
the shell owns it: "nothing is waiting on a review" and "we could not ask" look
identical and mean opposite things, and the second one tells a reviewer they are
free when they are not. The overdue threshold arrives **with** the figure rather
than being restated here, so the caption cannot come to say "3 days" over a
number counted against something else.
