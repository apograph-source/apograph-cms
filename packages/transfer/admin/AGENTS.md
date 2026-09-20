# `@orthacms/transfer-admin`

Export and import in the Content Library. Governed by the `admin-plugin`,
`accessibility` and `admin-e2e` skills; what follows is specific to this one.

Contributes **no routes**. Everything it does is an action on content someone is
already looking at, so it lives in the content library's seams:

| Slot                       | Contribution                                  |
| -------------------------- | --------------------------------------------- |
| `ENTRY_MENU_SLOT`          | **Export…** in the editor's ⋯ menu (Extras).  |
| `RECORDS_BULK_ACTION_SLOT` | **Export** in the selection bar's ⋯ menu.     |
| `RECORDS_MENU_SLOT`        | **Import…** in the collection's ⋯ menu.       |

Register it **after** `contentAdminPlugin()`, which declares all three.

## The rules that matter here

**Import belongs to the collection, not the selection.** There is nothing
selected when you import — what arrives is whatever the file holds — so the
selection bar would be a category error. It sits in the collection's ⋯ menu
rather than as a toolbar button of its own because importing is occasional, and
search, columns and filters are used on every visit; they should not give up
width to it. Hidden in the trash view, where the rows are on their way out.

**The export dialog's counts must stay honest.** They come from
`/export/preview`, which runs the *same* graph walk the export runs. If that
ever becomes a cheaper estimate, the toggles stop meaning anything — "include
related records" is the difference between 40 records and 4,000, and the count
is the only warning.

**A format that cannot carry bytes disables the files toggle** rather than
accepting it and ignoring it. `TRANSFER_FORMAT_CAPABILITIES` decides, so the UI
cannot offer a promise the server will not keep.

**The import dialog asks two questions, not one.** "If a record is already here"
governs the records in the file; "Records this file links to" governs the ones
they point at. A single answer cannot serve both — an export carries an
article's author so the link can be made again, and "add a second copy of this
article" must not quietly mean "and a second author". The relation choice
defaults to **Link**, which writes nothing to a related record that already
exists.

**Import verdicts go stale.** Changing the file *or* **either** policy retires
the table — showing one file's verdicts above another file's Import button is
the worst bug this dialog can have.

**An import refreshes every type it touched, through content's own pass.** The
verdicts name each one, so the set is exact: a run that creates an article *and*
the author it points at must refresh both lists, or the authors list shows
pre-import data with nothing to say it is stale. Use
`refreshEntryCaches` from `@orthacms/content-admin`, never a key spelled here —
the library's roots are `content-entries` / `content-entry` / …, so the obvious
`['content']` matches nothing and the import silently leaves the table alone.

**The import dialog caps its own height.** `DialogContent` sets none, and this
one is long enough — two explained questions, then a verdict table — to run off
both ends of a laptop viewport with the Import button unreachable. Three grid
rows, and only the body scrolls.

**A bulk-action overlay dies with the selection.** The selection bar unmounts as
soon as the selection is empty, so `onDone` is called on success, never on open.
The overlay is rendered outside the ⋯ menu for the same reason the entry menu's
is — the menu content unmounts the instant the menu closes, which is exactly
when the export dialog is meant to appear.

## Unit cover — vitest + jsdom

The package gained a **vitest target** (`vite.config.mts`, jsdom) during the
invariant sweep. Dialog behaviour stays in `apps/admin-e2e`; what lives here is
the one claim a browser cannot make. `invalidateQueries` refetches only
*mounted* queries, the import dialog is reachable only from the collection you
are already looking at, and the entry list's `staleTime` is 0 — so the second
type's list and the media library are always unmounted, and navigating to either
afterwards refetches whether or not it was invalidated. A browser test therefore
passes with `useImportApply`'s whole `touched` set deleted; `index.spec.tsx`
does not.
