# @orthacms/wysiwyg-admin

The **rich-text editing plugin** for the Ortha CMS admin UI. It owns how a
`richtext` field looks and behaves in the entry form: the field shows the
content **as it reads**, and pressing it expands a [TipTap](https://tiptap.dev)
editor into the record's work area, with the formatting toolbar — text style and
size, colors and highlights, alignment, lists, links, callouts, tables, column
layouts, and **embedded images and video**.

It is **not a place in the app**. It contributes no route, no navigation entry,
and no page. Its entire surface is one contribution to content-admin's
`ENTRY_FIELD_CONTROL_SLOT`, which is why it appears everywhere an entry form
does — a collection's records editor and a single (page) alike, on the General
tab and inside a localized type's Translated/Shared groups — without knowing
about any of them.

There is **no server counterpart**. `richtext` is an existing content field type
(`@orthacms/content-server`); this plugin changes the _control_, not the
schema, the wire format, or the API.

What it stores is the **document** — `editor.getJSON()`, the ProseMirror node
tree — because a `richtext` value is a structured document rather than an
opaque HTML string (see
[`content-domain`](../../content/domain/AGENTS.md) and
[ORT-84](https://linear.app/ortha-source/issue/ORT-84)). A body written before
that change is still an HTML string in the column; opening it seeds TipTap,
which parses it through this editor's own schema, and the first save commits the
document — so content upgrades as it is edited rather than in one migration that
has to guess what an unknown tag meant.

## Which fields it claims

Every `richtext` field, **by default**. A rich-text field that renders as a raw
HTML textarea is exactly what this plugin exists to replace, and requiring an
opt-in would leave the old control on every schema written before it existed.

The opt-out is per field, in the content schema:

```ts
// packages/…/your-collection.ts
body: field.richtext({ admin: { label: 'Body' } }), // → the WYSIWYG
raw: field.richtext({ admin: { widget: 'textarea' } }) // → content-admin's textarea
```

`widget: 'textarea'` is for a body that isn't authored prose — a hand-maintained
snippet, an email template, anything the author edits _as markup_ on purpose,
which a WYSIWYG would reformat the moment it opened. `widget: 'wysiwyg'` is
accepted too, so a schema can state the intent rather than rely on the default.
Both live in `WYSIWYG_WIDGET` (the plugin's only other export).

## Layout — layered (ADR-0003)

Written layered from the start, like `content/admin`:

- **`domain/`** — pure TS, no React and no TipTap. `constants` (the widget
  values, callout tones, the color/size palettes, the prose class) and
  `richTextValue` (the editor-facing half of a stored value: what to seed TipTap
  with, and the storage normalization a closed editor's output goes through —
  emptiness itself is the kernel's, and re-exported from here).
- **`infrastructure/`** — the TipTap layer. `editorExtensions` (the one place
  that decides what an author can write), `extensions/callout`,
  `extensions/columns`, `extensions/language` (the BCP-47 marker on a run of
  text — language of parts), and `extensions/media` (nodes TipTap doesn't ship —
  the last one keeps its React node view beside it, since a node view is the
  extension's own plumbing and putting it under `presentation/` would have this
  layer importing upward), and `renderRichText` (the read-only renderer — see
  **Trust boundary** below).
- **`presentation/`** — React. `wysiwygPlugin` (the `AdminPlugin` factory),
  `components/WysiwygFieldControl` (the field as it sits in the form) and
  `components/WysiwygFieldFullView` (what it expands into) — the slot item's
  `Component` and `FullView` — plus `WysiwygPreview`, `WysiwygEditorPanel`,
  `WysiwygIssueList` (the structural findings under the document),
  `WysiwygToolbar` with a folder per menu, and `hooks/useLiveEditorState`.

## Six decisions worth knowing before you change anything

### 1. Trust boundary: the preview never renders the stored HTML as-is

A `richtext` value is whatever some other CMS user typed, pasted, or wrote
straight through the API, and a preview renders it as **markup**. Handing that
string to `dangerouslySetInnerHTML` unchecked would make every rich-text field a
stored-XSS vector against anyone who opens the record: `<script>` doesn't run
via `innerHTML`, but `<img src=x onerror=…>` does, and a contributor could aim
it at an admin.

So `renderRichText` round-trips the value through the **editor's own ProseMirror
schema** — a document rebuilt from its JSON, a legacy HTML string parsed out of
an inert `DOMParser` document — and re-serializes from the resulting nodes. (A
document carrying a node type this install has no extension for cannot be
rebuilt; it falls back to the kernel's `richTextToHtml` and takes the string
path, so the parts this editor _does_ understand still render instead of a blank
card.) Only what the schema declares survives; event handlers are
dropped, and the Link extension blanks any href outside its protocol allowlist
(`javascript:`). The allowlist is therefore the _same definition_ as "what this
editor can write", so the preview is exactly what the author sees once the
field is expanded. A hand-kept tag list would be a second definition, free to
drift.

**If you add a node or mark to `editorExtensions`, the preview supports it the
same day.** If you ever render rich text somewhere else, go through
`renderRichText` — never `innerHTML` on a raw value.

### 2. The control is a button _beside_ the preview, not around it

Wrapping formatted content in a `<button>` puts headings, lists, and tables
inside a control — invalid HTML, and it flattens the whole body into the
button's accessible name. Instead the preview renders as ordinary content and a
transparent button is laid over it (`absolute inset-0`): assistive tech reads
the content, then offers one clearly-named action, and a pointer anywhere on the
card still opens the editor.

That only holds because `renderRichText` **flattens links to spans**, leaving no
focusable elements in the preview. A live `<a>` under the button would be a tab
stop the reader falls into on their way to it — and pressing it would navigate
out of the record. Don't "fix" the flattening.

The button carries the field's `id` (content-admin's `<label for>` points at
it), so its name is set with `aria-label`: a native label outranks a button's
own contents, which left it announcing just "Body". It carries no
`aria-invalid`/`aria-required` — neither applies to a button — so the error
reaches AT through `aria-describedby`, pointing at the `<FieldError>`
content-admin renders below.

### 3. The editor is a **view**, not a dialog

Pressing the field expands it into the entry editor's work area — content-admin
renders the slot item's `FullView` in place of the tab strip. Everything around
it is untouched: the app sidebar, the record's title, the top bar's Save /
Publish, and the Properties rail, whose publish gate ticks over live as the body
is written. All of that keeps working because the expanded view is still inside
the record's own form — same tree, same values.

A modal could do none of that. It would cover the rail it should be updating,
hide the record it belongs to, and put Save behind an overlay.

The control owns none of the swap. It calls `setExpanded(true)`; `EntryEditor`
holds the state and decides what to render. The view mounts only while expanded,
so the editor is seeded from the value once at mount and owns its state from
then on — no controlled-content sync, and none of the caret-jumping that comes
with one.

Leaving is explicit — **Back to fields** at the top, **Done** in the footer.
There is deliberately **no Escape shortcut**: the toolbar's menus and popovers
each answer Escape themselves, and a second handler on the view would race them
into closing the whole editor out from under an open menu.

### 3b. Read-only keeps the expansion, and only the expansion

When the entry editor is read-only (`EntryFieldControlContext.readOnly` — the
reader has no `content:update`, or no `content:create` on a create form), every
other field on the record simply goes inert in place. A body can't: the collapsed
preview is height-clamped with a fade where it's cut, so a reader who is allowed
to read the record would be unable to read the part of it that matters most.

So the control is kept and renamed — **View {label}**, with an eye instead of a
pencil — and what it opens is the same view with `WysiwygEditorPanel`'s
`readOnly`: `editable: false`, **no toolbar** (it is nothing but commands that
write, so it is dropped whole rather than mounted with twenty inert controls), no
`autofocus` (dropping a reader at the end of a document is the opposite of
useful), and `role="region"` in place of `role="textbox"` + `aria-multiline` +
`aria-required` — a textbox that takes no text misdescribes the surface, and
`required` is meaningless on something the reader can't fill. The empty-state line
also swaps to a plain statement, since both the `admin.placeholder` and the
default ("press Edit to start") are written at an author.

### 4. Edits are written to the form as they're made

There is no Save/Cancel of its own. `onUpdate` writes straight back to the entry
form through the slot's `onChange`, exactly like typing in any other field, and
the record's own Save (plus the unsaved-changes guard) stays the only commit
boundary. So leaving the view — by either exit — can never lose work.

### 5. "Empty" is defined as what empty _is_

`isEmptyRichText` (the kernel's — `richTextValue` re-exports it, since the
server's `required` and the publish gate ask the same question) matches the
exact document an emptied editor leaves behind — a paragraph, a `hardBreak`,
whitespace — and calls **everything else** content. It is deliberately not the
inverse rule ("no text and no image/divider/table"), which has to name every
node that can carry meaning without carrying words, and will always be one
short: it was, and a column layout the author had just inserted but not yet
typed into read as empty and was thrown away on save.

The normalization matters beyond that bug — a `required` field whose editor was
cleared has to fail validation, and it only does if what we store is `null`
rather than a document holding an empty paragraph.

### 6. The editor names what is structurally wrong, while it can still be fixed

`WysiwygIssueList` sits under the document and reports `inspectRichText`'s
findings on it — a skipped heading level, a table with no header cells, a link
whose text says nothing, a `lang` no user agent can parse. The rules are the
**kernel's**, so this is never a second opinion: an error here is exactly what
will refuse the save, and a warning is exactly what will not.

Both are shown, and that is the point. Section 508's 504.2 asks whether an
authoring tool _enables_ the production of conformant content; a rule an author
only meets as a rejected save enables nothing.

**Language of parts** (WCAG 3.1.2) is the writing half of the same criterion:
the `Language` mark (`infrastructure/extensions/language`) carries a BCP-47
`lang` on a run of text, so a French quotation inside an English body is
announced with French phonemes. It is reached through **More formatting ▸
Language of this passage…**, whose dialog is mounted by the toolbar rather than
by the menu item — a `DropdownMenuContent` unmounts exactly when the dialog
needs to appear, the same reason the media sources are mounted there. The tag is
validated with the kernel's `isWellFormedLanguageTag`, so the editor can never
accept one the save then refuses.

## Bundle: keep TipTap out of the entry chunk

A plugin factory runs at boot — it has to, or its slot contribution isn't
registered before the first render — so anything it imports **statically** lands
in the app's entry chunk. TipTap and ProseMirror are ~460 kB of that, for a
control that only ever renders inside an entry editor (itself already behind a
lazy route).

So `wysiwygPlugin` reaches both the control and the full view through
`React.lazy`, and `src/index.ts` exports **nothing but** `WysiwygPlugin` and
`WYSIWYG_WIDGET`. Re-exporting the preview or the editor from the entry point
would pull TipTap straight back in.

The two split points share TipTap through a third chunk (the schema in
`editorExtensions`, which the preview's renderer and the editor both need), so
expanding a field downloads only the editor's own ~39 kB.

The guard is a number: the admin's entry chunk is **~255 kB** (it was ~254 kB
before this plugin existed), with TipTap out in `editorExtensions-*.js` at ~420
kB. If a change moves the first number, the lazy boundary has been broken.

## Styling: one scope, shared by the editor and the preview

`src/styles.css` hangs everything off `.ortha-wysiwyg`, which the editor surface
and every preview both carry. The host imports it once
(`apps/admin/src/styles.css`), after the design-system's.

It is a stylesheet rather than Tailwind classes on components for two reasons.
Most of these elements are produced by ProseMirror from stored HTML, so there is
no JSX to put a `className` on — the alternative is baking admin class names
into `renderHTML`, which writes this app's styling into content that gets
published elsewhere. And the editor and preview **must** render identically;
sharing one scope makes that structural instead of a thing to keep in sync.

Colors come from the app's `--color-*` theme tokens, so the editor follows
light/dark. Colors the _author_ picked (text color, highlight) are inline on the
content and stay put — those are content, not chrome. Same principle in the
custom nodes: a callout serializes to `<aside data-callout data-tone="warning">`
and a layout to `<div data-columns="3">`, so the consuming site styles the
structure however it likes.

## Media comes from a slot, not from a dependency

The editor knows how to **hold** an image or a video: `extensions/media` defines
a resizable `<img>` and a resizable `<video controls>`, and ships one way to
name one — paste a URL. It deliberately knows nothing about the Media Library.

Browsing folders, filtering by kind, and uploading are `@orthacms/media-admin`'s
whole job. Importing it here would make rich text unusable in an install without
a media plugin, and pin the editor to one library's shape forever. So the editor
declares `WYSIWYG_MEDIA_SLOT` and media-admin fills it — the same inversion
content-admin uses for its own slots, and the reason the dependency runs
media → wysiwyg rather than the other way.

A contribution is `{ id, label, icon?, order, Source }`. `Source` is handed
`{ open, onOpenChange, accept, onInsert }` and calls `onInsert` with
`WysiwygMediaEmbed[]` — a **URL plus display metadata**, not a library asset,
which is what lets one node type serve a pick, an upload, and a typed link
alike. media-admin registers two: **Media Library…** (its own picker, the same
one a media field opens) and **Upload files…** (files go into the library, then
into the text).

Two things to keep in mind if you add a source:

- **The toolbar mounts every `Source`, not the menu item that opens it.** A
  `DropdownMenuContent` unmounts the moment its menu closes — exactly when a
  picker is meant to appear — so a dialog rendered inside it opens into a tree
  being torn down. Same reason content-admin renders its ⋯-menu overlays outside
  the menu. Sources are mounted for the editor's whole life and told whether
  they are `open`.
- **`src` is vetted twice.** `domain/mediaSrc` allows `http(s)` and same-origin
  paths and refuses everything else — including protocol-relative `//host/…`,
  which inherits a scheme this editor can't vouch for. The dialogs check it to
  explain _why_ nothing happened; the node checks it on insert and on parse,
  which is the pass that protects stored content.

Sizing rides the **`width` attribute**, never an inline style or a stored
height: an attribute survives being pasted into an email or re-rendered by a
template, and a stored height is what goes wrong when someone swaps the asset.
The resize handle is a real `<button>` with arrow-key support — the width is
published content, so a pointer-only resize would put a content decision out of
reach of keyboard users.

### Media does not align with `text-align`

`@tiptap/extension-text-align` is configured for `heading` and `paragraph` only,
and adding the media nodes to that list would **not** work: `text-align`
positions a block's inline _children_, and an image **is** the block. The
property lands on the `<img>` and moves nothing — which is exactly what "align
centre does nothing to a selected image" looked like.

So media carries its own `align` attribute (`MEDIA_ALIGN`), stored as
`data-align` and applied by **margins** in `styles.css`. A `data-` attribute
rather than the long-deprecated `align="center"` or an inline `style`, for the
same reason `width` is an attribute: it survives a template's or an email
client's sanitizer. `left` is never written — it is where a block already sits.

`AlignMenu` stays **one** control, because it is one decision to the author: it
switches to `setMediaAlign` whenever the selection is on a media node, and drops
**Justify** from the list while it is (justify spreads the words of a line, and a
picture has none).

The figure the node view renders is `width: fit-content` unless the author has
chosen a width (`data-sized`). Otherwise an un-resized image fills the measure in
the editor while the preview shows it at its natural size — and centring has
nothing to move, because the block already spans the line.

### Alt text lives on the image, not only on the insert dialogs

Alt is published content and the difference between an image that works for a
screen-reader user and one that doesn't, so it can't only be a field on the way
in. An **upload** arrives with no alt at all; a **library pick** arrives with
whatever alt the library happened to hold. Either way, the moment an author
knows what a picture is _for_ is in the body, with the surrounding text on
screen — so every image carries its own alt control (`MediaNodeView`'s
`AltTextPopover`).

The trigger doubles as the prompt: an image with neither alt nor a decorative
mark shows a warning-tinted **"Add alt text"** chip, so the defect is visible
while writing rather than found in an audit.

**"Decorative" is a checkbox, not just an empty box.** `alt=""` is HTML's way of
saying an image carries no information, but on its own it can't be told apart
from "nobody has written this yet" — and those want opposite treatment, one
finished and one still a defect. So the answer is recorded as a `decorative`
attribute (`data-decorative` in the stored HTML, inert for any consumer that
ignores it) and the prompt keys off it. Ticking it also empties the alt, because
a screen reader would otherwise announce text sitting behind a ticked box.

One deliberate asymmetry: inside the editor an un-alt'd image still renders a
fallback accessible name, or it reads as an unlabelled graphic to the _author's_
own screen reader while they work. The stored HTML gets the real value — empty
if that is what it is. Inventing alt for published content would be worse than
none.

### Every overlay's `<form>` must stop its own submit

The alt popover, the link popover, and the "from a URL" dialog each render a
`<form>` so Enter works. All three are portalled — moved in the DOM, but **not**
in the React tree, and React bubbles synthetic events along that tree. So each
one's submit reached the entry editor's `<form>` and saved-and-**published** the
record.

All three now `stopPropagation()` on their own submit, and content-admin's form
ignores submits it didn't raise. Pinned by the _"never saves the record from an
overlay's own form"_ e2e case, which fired **three** saves before the fix — one
per overlay. Any new overlay in this package that wants a `<form>` needs the
same call.

## The toolbar fits on one row

That is a constraint, not an accident. Twenty flat controls wrapped onto a
second line at ordinary window widths — and the work area is narrower than the
window, because the app sidebar and the Properties rail are still there (about
**620px** at a 1280px viewport). A wrapped bar pushes the document down and
makes whatever landed on row two read as an afterthought.

So the bar keeps out front only what is reached mid-sentence — undo/redo, block
type, size, bold/italic, the two colors, the two lists, links — and folds the
rest into three menus grouped by _what the action is_:

- **More formatting** — underline, strikethrough, inline code, quote, clear
  formatting. Its toggles are checkbox items, so the menu still says what is
  active.
- **Alignment** — the four alignments, which were always mutually exclusive and
  so were four buttons doing a radio group's job. The trigger shows the current
  one's icon.
- **Insert** — tables, columns, callouts, dividers ("put a block here"), each
  with its own submenu for editing that block.

`flex-wrap` stays as the fallback for a genuinely narrow window: wrapping is
bad, clipping the last controls off the edge is worse.

**The budget is about 40px.** Adding a control to the bar means taking one off,
or it wraps again. `admin-e2e`'s _"keeps the toolbar on a single row"_ case
measures this — it groups children by vertical **centre**, not `top`, because
the bar is `items-center` and a 32px button beside a 20px separator otherwise
reads as two rows. Watch for the width that isn't in the obvious sum: the
separators' own margins were the last 20px that tipped it over, which is why
they now have none and lean on the bar's `gap`.

## Adding a control

1. Add the extension to `infrastructure/editorExtensions` (or a new node under
   `infrastructure/extensions/`, if TipTap doesn't ship one). Check StarterKit
   first — it already bundles Link, Underline, and TrailingNode, and a second
   copy makes TipTap warn about a duplicate name and resolve the extension set
   unpredictably.
2. Add a folder under `presentation/components/WysiwygToolbar/`, with its own
   co-located `defineMessages`. Reuse `ToolbarButton` (toggles/actions) or
   `ToolbarMenuTrigger` (dropdowns) so the bar stays one shape.
3. Prefer a menu to a new button — see the one-row budget above. Subscribe to
   only the state you need with **`useLiveEditorState`**, never
   `useEditorState` directly — each menu owns its own slice, so the bar's shared
   selector doesn't become the thing every menu re-renders through. The wrapper
   exists because the admin renders under `StrictMode`: every `useEditor` mounts,
   tears down, and remounts, and the dead instance's subscription fires one last
   selector run. `can().undo()` or `storage.characterCount.words()` on a
   destroyed editor throws _during render_, and React unwinds the whole editor
   subtree — the toolbar just vanishes. `useLiveEditorState` returns your
   `whenGone` value for that one frame instead.
4. Both must `preventDefault` on `mousedown`. Otherwise pressing the control
   moves focus out of the editor, collapsing the selection the command was about
   to act on — the classic "I selected a word, hit Bold, nothing happened".
5. If it introduces a new element in the stored HTML, style it in
   `src/styles.css` under `.ortha-wysiwyg`.

The bar is a `role="group"`, not `role="toolbar"`, on purpose: the ARIA toolbar
pattern promises arrow-key navigation with a single tab stop, and promising it
without implementing it strands screen-reader users. As a group, every control
is an ordinary tab stop.

## Commands

- `npx nx typecheck @orthacms/wysiwyg-admin`
- `npx nx lint @orthacms/wysiwyg-admin`
- `npx nx test @orthacms/wysiwyg-admin` — the unit suite (vitest + jsdom). It is
  deliberately **not** a second editor: what lives here is the pure rules
  (`domain/`), what the schema serializes into stored content, the document
  commands driven headlessly (clear-formatting, callout tones, column
  reshaping, media insertion — each a transform whose failure is invisible on
  screen and only shows in the stored document), and the structural claims a
  browser cannot see: the lazy boundary, the layering, and the single
  `.ortha-wysiwyg` style scope. Anything about **pointers** belongs in
  `admin-e2e`; so does anything about focus that a browser can actually be
  asked about. Where the caret *starts* is the exception, and it is here
  (`WysiwygEditorPanel/index.spec.tsx`): `autofocus` is resolved to a
  **selection** in the editor's state before it is a DOM focus, so a read-only
  surface — which takes no focus at all — still says whether the guard fired.
- `npx nx e2e admin-e2e -- --project=chromium wysiwyg-fields` — the suite that
  covers this plugin (`apps/admin-e2e/src/content/wysiwyg-fields.spec.ts`),
  including two axe scans and the saved-HTML assertions. The visible editor is
  only half the feature; what gets **stored** is the other half, and only the
  request body shows that — so a change here should be provable in that spec.
