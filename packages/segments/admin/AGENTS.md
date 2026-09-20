# `@orthacms/segments-admin`

The **segments UI** — two surfaces and no more.

```
src/lib/
  domain/types.ts               Segment, EntryAccess, and the three-state algebra
  infrastructure/               the gateway port + its HTTP impl + query keys
  application/hooks.ts          the TanStack hooks
  application/useEntryAccessPresave.ts   the save step + the tab's staging
  presentation/
    segmentsPlugin/             the factory
    pages/SegmentsPage/         the directory at /segments
    pages/SegmentEditorPage/    create / edit, at /segments/new and /segments/:id
    components/
      EntryAccessChip/          the entry header badge
      EntryAccessTab/           the Access tab — where every decision is made
      EntryAccessBulkActions/   set every matched audience at once
      SegmentStateControl/      one audience's three-state control
      SegmentWorkspacesField/   where an audience is offered
      SegmentsPagination/       the pager both lists share
```

## What it contributes

| Surface            | Where                   | What it is for                   |
| ------------------ | ----------------------- | -------------------------------- |
| Audience directory | `/segments`             | the vocabulary                   |
| Audience editor    | `/segments/new`, `/:id` | create / edit one                |
| Entry header chip  | `ENTRY_HEADER_SLOT`     | is this entry restricted         |
| **Access** tab     | `ENTRY_TAB_SLOT`        | every decision, one per audience |
| The save step      | `ENTRY_PRESAVE_SLOT`    | applying them, on Save / Publish |
| Revision row       | `REVISION_EXTRA_SLOT`   | who could read a past version    |

There is nothing between the directory and the entry — no rule library, no
assignment screen — because there is nothing in the model between them.

## Both lists are paginated, and they share one pager

The directory and the Access tab are two views of the same list — one manages
the vocabulary, the other decides against it — so they use one
`SegmentsPagination`. A reader moving between them should not meet two different
pagers.

Three consequences worth keeping:

**A page is not the whole list, so anything holding _ids_ reads by id.** The
entry header chip and a revision's captured access resolve their labels through
`useSegmentLookup` (`GET /segments/lookup?ids=`), never by searching a page. A
miss on page one would have rendered as "deleted audience" for an audience that
is merely on page three — a claim rather than a gap.

**The bulk control acts on every match, not on the rows on screen.** The ids
come from the list response's `ids`, which is every id the filter matched. A
control called "set every audience" that quietly set ten of forty would be worse
than no control: the mistake is invisible until a reader is turned away. Past
the server's cap the controls disable with the reason — that many could not be
stored on one entry anyway, so offering it would be offering a save that 400s.

**Decisions the list does not show are kept and counted.** A search hides rows,
and an audience can be narrowed away from this workspace after an entry named
it. The tab counts those below the list rather than dropping them, because
dropping them would rewrite who can read published content from a screen that
never mentioned them.

## The decisions that are easy to get wrong

**Three states, not a checkbox.** "Not set" is a real, distinct answer: an
audience nobody mentioned reads the entry when nothing else is allowed and does
not when something else is. A two-state control makes those outcomes look
identical and leaves "not mentioned" unreachable once a row has been touched.

**`withState` removes before it adds.** A segment in both lists is a state the
server accepts and the reader resolves as _denied_ — while the editor's screen
says allowed. The order of those two operations is what makes it unreachable,
and it is the one thing here with a unit test.

**There is no Save button on the Access tab — it rides the entry's own.** Who may
read a record is part of the record, so a change is staged and written when the
entry is written, marked with the same `ChangedBadge` a field carries. Two things
that ruled out the alternatives: writing on every toggle would publish three
intermediate answers to real readers on the way to the intended one, and a second
Save button on a tab of the editor asks the user to remember which of two buttons
their change belonged to.

**The staging is mounted above the tab; the write rides the save body.**
Editor tabs are **routes**, so the Access panel unmounts on every tab switch —
hence `ENTRY_PRESAVE_SLOT`, reached back down through `EntryTabContext.presave`,
exactly as the media plugin's staged uploads are. The step contributes
`extensions`, not a request of its own, and the reasons are all server-side:
content writes the bag inside the save's transaction, so the entry cannot land
with its restriction missing; the revision that save appends captures the access
it **applied** rather than the access it replaced; and restoring a version puts
that version's audiences back with its words.

**There is no write hook in `application/hooks.ts`, deliberately.** A mutation of
its own would be a second, later write — not atomic with the record, and
invisible to the version, which is the whole thing this design set out to fix.
The `PUT /segments/entries/:entryId` route still exists for an API client that is
not saving an entry; the admin is not that client.

**Access covers every language of a record, and the tab says so.** The server
writes an entry's audiences to its whole locale group, because who may read a
record is a fact about the record rather than about its German wording. On a
localized type the tab carries one extra line saying that — it is the only thing
on this screen that is not about the row in front of the editor, so leaving it to
be discovered would be leaving it to be discovered by a reader.

`settle` therefore **seeds the saved row and invalidates every other cached
entry** (`segmentsKeys.entries`). A sibling's `updatedAt` does not move when only
its access did, so its key is unchanged and its cached answer is now wrong —
switching locale would show the audiences that locale used to have. The seeded
row is excluded from the invalidation so the control the editor is still looking
at is not put back in flight.

**The entry cache key carries the row's `updatedAt`.** Access now moves on paths
this plugin has no hook into — a **restore** above all, which puts back a
version's audiences through content's own use-case. Keying on the row's version
means any of them produces a new key and a fresh read, instead of a chip quietly
reporting the access the entry used to have.

**Nothing staged is not the same as open access.** `EntryAccessStaging.draft` is
`null` until something is set, and a save with `null` writes nothing at all —
which is what keeps the feature inert for an editor who never opens the tab.
Toggling back to what is already stored clears the staging (`sameAccess`) rather
than staging a round trip.

**The header chip says what readers get _now_, the tab says what the next save
will make of it.** The chip renders from `EntrySlotContext`, which carries no
`presave` handle, so it cannot see the staging — and that is the honest reading
anyway: until Save, the restriction the chip reports is still the live one.

**`settle` seeds the cache rather than invalidating it.** The save carried these
lists and the server stored them in the same transaction — a failure would have
failed the save — so seeding is telling the cache what it already knows, not
guessing. A refetch would blank the control the editor is still looking at, and
on a create there is no query to refetch under the old (id-less) key at all.

**Two permission gates on the tab, and they are different.** `readOnly` says the
caller may not edit the entry's _values_; `segments:manage` says they may not
change who reads it. An editor with `content:update` and neither should be able
to rewrite the article and not to publish it to a new audience.

**The chip renders nothing when no audience exists.** With none the feature is
inert server-side, so a badge claiming anything about access would be a claim
about a system that is not running.

**The Access tab's search sits left and the Segments link right, on one row.**
The link is the way _out_ of this screen, so it belongs at the far edge rather
than beside the heading, where it competed with the restricted/open badge.

**Creating and editing are pages, not a dialog.** It was a dialog while an
audience was three short fields; it now also decides which workspaces may use
it, which is a list that grows with the installation. A modal that scrolls is a
modal that has outgrown being one — and a page gives each audience a URL, which
is what makes "look at this one" a link instead of a set of directions.

**Nothing ticked under "Offered in" means every workspace.** The same reading as
an entry's empty allow list, and the state every audience starts in. The control
says so on screen rather than leaving it to be inferred: the opposite reading —
an audience nobody has scoped being offered nowhere — is the one that would make
it look broken. A **failed** workspace read is not an empty one either; it
renders as a warning that leaves the current scope alone.

**The create form no longer pre-checks the key against a list.** The directory
is paginated, so a local "existing keys" list would be one page of them, and a
check that is right most of the time is worse than one that is honestly late.
The server's 409 lands on the key field, holding the refused **key** so the
message clears itself the moment a different one is typed.

**Field rules come from the kernel, not from a pattern spelled out here.**
`validateSegment` is the same function the server's DTO reads its constants
from, so the dialog cannot accept something the API then refuses. Errors appear
**on blur or on submit**, never from the first keystroke — a key is malformed
for the whole time somebody is typing it, and complaining from the second
character is noise about a state they are on their way out of.

**The Create button is never disabled on invalid input.** A dead button explains
nothing, and pressing it is how somebody with nothing focused finds out which
field is wrong: the submit handler refuses and marks every field due for its
message.

**The workspace is in the entry cache key.** It reaches the server only as
`apiClient`'s ambient `X-Workspace-Id` header, which is never sent on a cache
hit — so without it one workspace would read another's answer.

**The tab slug is content's, not ours.** `ENTRY_TAB_SLOT` drops an item naming a
slug outside `ENTRY_TAB_SLUGS`, because the route table would match the segment
while `entryTabFromPath` could not resolve it. `access` is declared in
`content/admin`'s `ENTRY_TAB` for that reason.

**The two audience filter fields open on `is one of`, not `is`.** A field's
declared `operators` list decides the picker's order and therefore its default
(`opsForField` narrows the declaration by the type rather than the other way
round). The question these fields answer is _which audiences_, and the
multi-select answers the one-audience case too — a single tick is the same `in`
the server reads as an overlap. Led by `is`, naming a second audience meant first
noticing there was a second operator.

**Both pages load into a skeleton, never a spinner.** A lazy route's fallback is
a whole page: a spinner in the middle of an empty one says only that something is
happening, then moves every control into place when the chunk lands. The
skeletons say what is coming and hold the layout. Four components, and the split
is by consumer — `SegmentsListSkeleton` and `SegmentFormSkeleton` are the bodies,
drawn **both** by the route fallback and by the page's own pending state (so
"loading the page" and "loading its data" are one shape); `SegmentsPageSkeleton`
and `SegmentEditorPageSkeleton` wrap them for `Suspense`.

Two rules the route-level ones follow, from `ContentLibraryPageSkeleton`:

- **The bar is real, not a skeleton.** It is the page's identity and its way back
  out, and both are known before a byte of the chunk arrives. The editor's second
  crumb _is_ a bar, because "New audience" vs "Edit audience" is in the chunk —
  dropping it instead would leave the trail a crumb short and shift it on resolve.
- **The `<h1>` is visually hidden and names the state.** A fallback is a page with
  no heading at all until the real one mounts, and it is the state a slow
  connection sits in longest. Naming the state keeps two identically-named
  level-one headings off the screen across the swap.

**Required fields carry `*` and the page says what it means.** The mark is the
shared `RequiredMark` from `@orthacms/content-admin` — one implementation, so the
audience form and the entry editor cannot drift — and it is `aria-hidden`, because
the control carries `aria-required` and announcing both would say "required"
twice. The legend above the fields is what a sighted reader who does not know the
convention needs; it is a line in the page rather than a tooltip, which is
unreachable by keyboard and touch alike. Name and Key are marked; reader tags are
not — an audience with none answers to its key.

## What is not here yet

- **A records column** showing which entries in a collection are restricted.
- **A bulk action** setting the same audiences on a selection.

## e2e

`apps/admin-e2e/src/segments/` holds three suites — the directory and its editor
pages, the entry editor's Access tab (staging, the tab-switch survival, and what
reaches the save **body**), and the records filter. Two harness notes:

- `SEGMENT_SEED` / `mockSegmentsApi` (`support/api/segments.ts`) **genuinely
  page** the list and carry every matched id in `ids`, because the pager and the
  "set every audience" control are the two things this feature got wrong most
  easily, and a mock that answered the whole seed to every request makes both
  look fine when broken.
- The Access-tab suite mocks **both** relation reads and the record itself. The
  per-field links read is what the editor's `RelationFieldLive` calls; unmocked
  it kills the editor inside the error boundary, and the schema-fabricated record
  fills a relation with a readable string the form refuses as "Must be a valid
  entry id" — either one turns "the save body carried the audiences" into "the
  save never happened".

## Commands

- `npx nx test @orthacms/segments-admin`
- `npx nx typecheck @orthacms/segments-admin` / `npx nx lint @orthacms/segments-admin`
