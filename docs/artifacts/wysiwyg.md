# WYSIWYG

_Package · packages/wysiwyg/admin_

**Not a place in the application, but the behaviour of one field type**

WYSIWYG is the **rich-text editor** for the Ortha CMS admin UI. It has no route, no navigation item and no screen of its own: its entire external outline is one contribution into `content-admin`'s `ENTRY_FIELD_CONTROL_SLOT`. In an entry's form a `richtext` field displays its content **as it reads**, and pressing it unfolds the TipTap editor into the entry's working area — not as a dialog over the form but by replacing the tab content, so that the entry header, the Save/Publish buttons and the right-hand properties panel all stay alive.

- **0** routes and menu items
- **1** slot filled, **1** declared
- **16** TipTap extensions
- **20** document node types
- **9** mark types
- **14** toolbar controls
- **7** structural check rules
- **0** database tables and server packages

## Contents

- [01. Business description](#01-business-description)
- [02. Composition and place in the system](#02-composition-and-place-in-the-system)
- [03. The document format: why a tree and not HTML](#03-the-document-format-why-a-tree-and-not-html)
- [04. An inventory of the editor's capabilities](#04-an-inventory-of-the-editors-capabilities)
- [05. Step-by-step flows](#05-step-by-step-flows)
- [06. The seam with media and with content](#06-the-seam-with-media-and-with-content)
- [07. States](#07-states)
- [08. Accessibility and the keyboard](#08-accessibility-and-the-keyboard)
- [09. Invariants](#09-invariants)
- [10. Testing checklist](#10-testing-checklist)
- [11. Boundaries of responsibility](#11-boundaries-of-responsibility)
- [12. Discrepancies between code and documentation](#12-discrepancies-between-code-and-documentation)

## 01. Business description

The `@orthacms/wysiwyg-admin` package answers one question: **how an editor writes the body of an entry**. Everything else in the CMS — content types, permissions, publishing, the public API — exists without it; without it a `richtext` field simply renders as an ordinary text area with HTML markup inside. That is exactly the variant this plugin replaces.

### The problem it solves

- **Text instead of tags.** An article's body in a `<textarea>` is a wall of markup that cannot be proofread. The collapsed field shows the _content_: headings as headings, lists as lists, images as images — while the writing surface itself is hidden behind a deliberate press.
- **Editing does not throw the author out of the entry.** The unfolded editor is a **view**, not a modal. It takes over the working area instead of the tab strip, and everything around it stays where it was: the application's sidebar, the entry's heading, the save and publish buttons, and the properties panel on the right, whose publish-readiness indicator recomputes as you type.
- **Accessibility as part of the authoring tool, not as an audit afterwards.** Beneath the document lives a list of structural remarks (a skipped heading level, a table with no header, a "read more" link, an unparseable language tag). The rules come from the shared core — the very same ones that will refuse the save on the server — so the list is not a "second opinion" but exactly what will happen on Save.
- **The content stays portable.** Custom nodes serialise into semantic HTML with `data-` attributes (`<aside data-callout data-tone="warning">`, `<div data-columns="3">`), with not one class name from the admin UI. Styling on the public site is the site's business.
- **Zero coupling to the media library.** The editor can _hold_ an image and a video, but knows nothing about the file library. Whoever does know fills the slot it declares.

### Who sees it

#### Author / editor

Sees a field with the finished text and an "Edit" chip. Presses it and lands in the editor with the caret at the end of the document. Writes, formats, inserts an image from the media library, and returns with "Back to fields" or "Done". The editor has no save of its own — the entry has one Save.

#### A reader with no edit permission

Sees the same chip, but reading "View" and with an eye icon. Unfolding is kept — this is the one field a collapsed form row physically cannot show in full — but it opens with no toolbar, no caret and no autofocus.

#### A content-schema author

Does nothing: the editor takes every `richtext` field by default. Opting out is per-field — `admin: { widget: 'textarea' }` for a body that is edited _as markup_ on purpose (an email template, a hand-maintained fragment).

### What the plugin is not

- **It is not a page.** The `WysiwygPlugin()` factory has no `routes`, no `nav` and no `layout` — only `slots`. It cannot be "opened" and cannot be linked to.
- **It is not a server plugin.** The `packages/wysiwyg` group holds exactly one package — `admin`. No tables, no migrations, no API routes, no changes to the wire format.
- **It is not a field type.** `richtext` exists in `@orthacms/content-domain` and `@orthacms/content-server` independently; the plugin changes the _control_, not the schema, not the validation and not the column.
- **It is not the media library.** Browsing folders, filtering by type and uploading are entirely the work of `@orthacms/media-admin`, which arrives into the declared slot from outside.
- **It is not the accessibility rules.** The rules (`inspectRichText`, `isWellFormedLanguageTag`, `isEmptyRichText`) live in the `content-domain` core; the plugin only displays them and obeys them.

> **The key architectural idea**
>
> The field's value is a **document** (a ProseMirror/TipTap node tree), not an HTML string (ADR-0011). Everything else follows: `maxLength` counts words rather than tags; heading order and table headers become checkable facts; and the preview in the admin UI is safe, because it is assembled _afresh from the editor's schema_ rather than by injecting foreign markup into the DOM.

## 02. Composition and place in the system

One package, layered from the start (ADR-0003 — tactical DDD inside a plugin): `domain/` knows neither React nor TipTap; `infrastructure/` is the TipTap layer; `presentation/` is React.

| Module                                       | Layer        | What is there                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain/constants                             | domain       | A pure dictionary: `WYSIWYG_WIDGET`, `WYSIWYG_MEDIA_KIND`, `MEDIA_ALIGN`, `CALLOUT_TONE`, `COLUMN_COUNTS`, the `TEXT_COLORS`/`HIGHLIGHT_COLORS`/`FONT_SIZES` palettes, the `orthacms-wysiwyg` class, and the `MEDIA_MIN_WIDTH = 64` and `MEDIA_RESIZE_STEP = 16` thresholds |
| domain/mediaSrc                              | domain       | `isSafeMediaSrc` / `safeMediaSrc` — what may become an image's or a video's `src` at all                                                                                                                                                                                 |
| domain/richTextValue                         | domain       | `asEditorContent` (what to seed TipTap with), `normalizeRichText` (what to hand back to the form), and a re-export of the core's `isEmptyRichText`                                                                                                                       |
| infrastructure/editorExtensions              | infra        | The single place that decides **what an author can write at all** — 16 extensions                                                                                                                                                                                        |
| infrastructure/extensions/callout            | infra        | The `callout` node → `<aside data-callout data-tone>`, with the `setCallout`/`unsetCallout` commands                                                                                                                                                                     |
| infrastructure/extensions/columns            | infra        | The `columnBlock`/`column` nodes, with the `setColumns`/`unsetColumns` commands                                                                                                                                                                                          |
| infrastructure/extensions/language           | infra        | The `language` mark — BCP-47 on a fragment of text (WCAG 3.1.2)                                                                                                                                                                                                          |
| infrastructure/extensions/media              | infra        | The `image` and `video` nodes plus their React node views (`MediaNodeView`, `AltTextPopover`) — next to the node rather than in `presentation/`, or the layer would import upwards                                                                                       |
| infrastructure/extensions/tableTab           | infra        | The `orthacmsTableTab` extension (`priority: 200`) — constrains Tab at the end of a table                                                                                                                                                                                   |
| infrastructure/renderRichText                | infra        | The trust boundary: a value → safe preview HTML                                                                                                                                                                                                                          |
| infrastructure/transformPastedHTML           | infra        | Strips `color`, `font-size` and `background-color` out of pasted HTML                                                                                                                                                                                                    |
| presentation/wysiwygPlugin                   | presentation | The `AdminPlugin` factory: one contribution, both halves through `React.lazy`                                                                                                                                                                                            |
| presentation/slots/wysiwygSlots              | presentation | The declaration of `WYSIWYG_MEDIA_SLOT` and the `WysiwygMediaEmbed` / `…SourceContext` / `…SourceItem` types                                                                                                                                                             |
| presentation/components/WysiwygFieldControl  | presentation | The collapsed field: the preview plus a transparent button over it plus the Edit/View chip                                                                                                                                                                               |
| presentation/components/WysiwygFieldFullView | presentation | The unfolded view: "Back to fields", the field's heading, the error, the editor panel                                                                                                                                                                                    |
| presentation/components/WysiwygEditorPanel   | presentation | `useEditor` itself: the toolbar, the document, the remarks list, and a footer with the counter and the exit button                                                                                                                                                       |
| presentation/components/WysiwygPreview       | presentation | `dangerouslySetInnerHTML` over the result of `renderRichText`, memoised on the raw value                                                                                                                                                                                 |
| presentation/components/WysiwygIssueList     | presentation | The structural remarks beneath the document, `aria-live="polite"`                                                                                                                                                                                                        |
| presentation/components/WysiwygToolbar       | presentation | The panel plus 11 subfolders (`InsertMenu` has four more nested): menus, popovers, dialogs, and two shared button shapes                                                                                                                                                 |
| presentation/hooks/useLiveEditorState        | presentation | A wrapper over `useEditorState` that is safe against a destroyed editor                                                                                                                                                                                                  |
| src/styles.css                               | —            | 429 lines, all hanging off `.orthacms-wysiwyg`; the host imports it once after the design system                                                                                                                                                                            |

### 2.1 Where it plugs in

In `apps/admin/src/plugins.ts`, `WysiwygPlugin()` stands **after** `ContentPlugin()`, whose slot it fills. The order here expresses intent rather than a requirement: slots are module singletons, and `createAdmin` registers every plugin's contributions before the first render. What does depend on position is the order of items _inside_ a slot: `ENTRY_FIELD_CONTROL_SLOT` resolves through `find`, so **the first matching item wins** in registration order.

| Slot                                                   | Direction  | What is in it                                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| content.entry.fieldControl<br>ENTRY_FIELD_CONTROL_SLOT | `fills`    | One `wysiwyg.entry.richtext` item: `appliesTo` = `isWysiwygField`, `Component` = the collapsed field, `FullView` = the unfolded editor. Both halves are lazy, each under its own `Suspense` with a skeleton                                                               |
| wysiwyg.media.sources<br>WYSIWYG_MEDIA_SLOT            | `declares` | Media sources. `@orthacms/media-admin` puts two in: `media.wysiwyg.library` ("Media Library…", `order: 10`) and `media.wysiwyg.upload` ("Upload files…", `order: 20`). With not one contribution the editor still inserts media — only the built-in "by URL" items remain |

### 2.2 Which fields it takes

The `isWysiwygField` predicate is literally two lines:

```
function isWysiwygField(field: ContentField): boolean {
    if (field.type !== CONTENT_FIELD_TYPE.RichText) return false;
    return field.admin['widget'] !== WYSIWYG_WIDGET.Textarea;
}
```

That is, **every** `richtext` field — by default, with no opt-in. The reasoning is direct: opt-in would leave a raw textarea on every schema written before the plugin existed. Opting out is per field, in the content schema: `field.richtext({ admin: { widget: 'textarea' } })`. The value `'wysiwyg'` is accepted too — so that a schema can state its intent rather than rely on the default. `widget` in `AdminProps` is typed as a free string, so both values are this plugin's convention rather than an enum on the server.

> **The bundle: TipTap must not land in the entry chunk**
>
> The plugin factory runs **at startup** — otherwise its contribution would not be registered before the first render — so everything it imports _statically_ ends up in the application's startup chunk. TipTap and ProseMirror are ~460 kB for a control that lives only inside the entry editor. Hence two rules: both halves are taken through `React.lazy`, and `src/index.ts` re-exports neither the preview nor the editor. The documentation names the control figure: the admin UI's entry chunk is ~255 kB (it was ~254 kB before the plugin), TipTap sits separately in `editorExtensions-*.js` at ~420 kB, and unfolding a field pulls in ~39 kB more. If that first number moves, the laziness boundary is broken.

## 03. The document format: why a tree and not HTML

ADR-0011 ("Rich text is a structured document, not an opaque string", status **Proposed**, 19 Aug 2026) describes a decision that is already fully implemented in the code. Before it, a `richtext` value was an HTML string in a `text` column, and the core validated it as `typeof === 'string'` plus a length and a `pattern`. That made the body's semantics **unmodellable and therefore uncheckable**: this passed validation clean —

```
validateFieldValue('body', { type: 'richtext', required: true },
  '<h4>Intro</h4><h1>Title</h1><table><tr><td>a</td></tr></table>')
// → []
```

A skipped heading level, an inverted structure and a table with no header — three things a screen-reader user meets as a broken document, and the platform could call none of them an error (WCAG 1.3.1, 2.4.6, Section 508 504.2). Plus two consequences of the same category error: `maxLength` counted markup (bolding a word spent `<strong></strong>` from the author's budget), and there was nowhere to express a **fragment's language** (3.1.2).

### 3.1 What now counts as the value

- **A document** — a `{ type: 'doc', content: [...] }` tree, exactly what `editor.getJSON()` returns. Stored in a `jsonb` column (`table-builder.ts`: `case CONTENT_FIELD_TYPE.RichText: builder = jsonb(col)`).
- **An HTML string** — also a valid value. The migration was `USING to_jsonb(col)`, so an old body became a JSON _string_ in the same column. Nothing was parsed — so nothing could be lost.
- **`null`** — no body. That is exactly what an empty document collapses into on the way out of the editor (`normalizeRichText`).

> **Upgrade as you edit, not as a batch migration**
>
> An old HTML body becomes a document precisely when the entry is next saved from the editor: `asEditorContent` hands the string to TipTap, which parses it with **its own schema**, and the very first `onUpdate` puts a tree into the form. A batch migration was rejected deliberately: converting HTML requires deciding what every unknown tag meant, and the only parser that knows what this installation can represent is the editor's own schema.

### 3.2 The vocabulary: what the editor can write down

The core's vocabulary (`RICH_TEXT_NODE`, `RICH_TEXT_MARK`) is **open**: it names what the core _reasons about_, not what a document is allowed to contain. An editor extension (a callout, columns, an embed) passes through it untouched — a closed vocabulary would make the core the gatekeeper of every plugin's extension set. The set this particular editor produces is composed of StarterKit, TableKit and four extensions of its own:

| Node                                       | From                            | Serialises to                                                               |
| ------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------- |
| doc                                        | StarterKit                      | the root, no tag                                                            |
| text                                       | StarterKit                      | characters (plus marks)                                                     |
| paragraph                                  | StarterKit                      | `<p>`                                                                       |
| heading                                    | StarterKit, `levels: [1,2,3,4]` | `<h1>…<h4>`; deeper than h4 makes no sense in a CMS body                    |
| bulletList / orderedList / listItem        | StarterKit                      | `<ul>` / `<ol>` / `<li>`                                                    |
| blockquote                                 | StarterKit                      | `<blockquote>`                                                              |
| codeBlock                                  | StarterKit                      | `<pre><code>`                                                               |
| horizontalRule                             | StarterKit                      | `<hr>`                                                                      |
| hardBreak                                  | StarterKit                      | `<br>`                                                                      |
| table / tableRow / tableHeader / tableCell | TableKit                        | `<table>`, `<tr>`, `<th scope="col">`, `<td>`                               |
| callout                                    | custom                          | `<aside data-callout data-tone="warning">`, content `block+`                |
| columnBlock / column                       | custom                          | `<div data-columns="3">` / `<div data-column>`, content `column{2,4}`       |
| image                                      | custom                          | `<img src alt [width] [data-align] [data-decorative]>`, `atom`, `draggable` |
| video                                      | custom                          | `<video src controls [width] [data-align]>`, `atom`, `draggable`            |

| Mark                          | From                                | Serialises to                                                                         |
| ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| bold / italic / strike / code | StarterKit                          | `<strong>`, `<em>`, `<s>`, `<code>`                                                   |
| underline                     | StarterKit                          | `<u>`                                                                                 |
| link                          | StarterKit, configured              | `<a href rel="noopener noreferrer nofollow">`; `openOnClick: false`, `autolink: true` |
| textStyle (+ color, fontSize) | `@tiptap/extension-text-style`      | `<span style="color:…;font-size:…">`                                                  |
| highlight                     | `extension-highlight`, `multicolor` | `<mark style="background-color:…">`                                                   |
| language                      | custom                              | `<span lang="fr">`; the mark's name comes from the core — `RICH_TEXT_MARK.Language`   |

Plus two extensions with no nodes and no marks: `TextAlign` (writes `text-align` into the attributes of `heading` and `paragraph` — and only those), `Placeholder`, and `CharacterCount` (the footer counter, which is also now the unit a field's `maxLength` is measured in).

### 3.3 What is valid, and who decides

The core's validator (`validate-entry-values.ts`) does exactly four things for `richtext`:

1. **Emptiness is judged by the document, not by the JSON.** `isEmptyRichText` rather than the generic `isEmpty`: `{ doc: [paragraph] }` is what an emptied editor leaves behind, and `required` must fail on it.
   _empty means: doc, paragraph, hardBreak, text (whitespace only), container. Everything else is content_
2. **The value's shape.** Neither a string nor a document → `must be a rich-text document`.
3. **Length and `pattern` are judged on the text.** `richTextPlainText(value)`: block boundaries give a newline, markup gives nothing. The length is counted in _human-perceived characters_ rather than UTF-16 code units.
4. **The structural check** — `inspectRichText`, unless the field switched it off with `validation: { structure: 'off' }`. **Only severity `error`** fails validation.

| Rule                   | Severity  | WCAG  | What exactly                                                                     |
| ---------------------- | --------- | ----- | -------------------------------------------------------------------------------- |
| headingEmpty           | **error** | 2.4.6 | A heading with no text — a landmark that names nothing                           |
| headingLevelSkipped    | **error** | 1.3.1 | A level more than 1 above the previous — an invented section                     |
| headingLevelInverted   | warning   | 1.3.1 | A heading above the level the body starts at                                     |
| tableMissingHeader     | **error** | 1.3.1 | A table with neither `tableHeader` cells nor a `tableCaption`                    |
| linkTextEmpty          | **error** | 2.4.4 | A link with nothing to announce                                                  |
| linkTextNotDescriptive | warning   | 2.4.4 | Text from a list (14 phrases such as "click here" and "read more") or a bare URL |
| invalidLanguageTag     | **error** | 3.1.2 | Any `lang` (on a node or on a mark) that does not parse as BCP-47                |

### 3.4 What follows from this on the outside

#### The public API and GraphQL

REST returns the tree as is; in OpenAPI the field is described as a `oneOf` of `RichTextDocument` and a string. In GraphQL the field's type is `JSON` rather than `String`: a **breaking change** for a consumer that expected a string. In exchange the consumer gets a tree it renders however it likes, instead of markup it is obliged to sanitise.

#### Filtering, sorting, search

`richtext` **cannot be filtered or sorted** (`scalarTypeFor` returns `null`): an `equals` over a document would compare tree serialisations rather than prose. Free-text `?search=` does reach the body — the column is cast `::text` and searched over the serialised tree; the price is that a query for the word `paragraph` may hit a body that never says it. In the entry list the richtext column is off by default (`HEAVY_TYPES`).

#### Transfer (export / import)

In JSON/NDJSON the tree travels as is. In **CSV** the cell is `richTextPlainText`, that is, text without markup: what a translator works with. Coming back, each line of the cell becomes a paragraph (`htmlToRichTextDocument` over `<p>…</p>`) — so the CSV round trip is **lossy for formatting**, deliberately.

#### The fallback control

A field with `widget: 'textarea'` renders as an ordinary area, and `content-admin` serialises the document to HTML on the way in (`asRichTextSource` → `richTextToHtml`), handing back a string — which remains a valid value. So switching the widget does not break the data, but the **return path is lossy**: saving from a textarea turns the document into a string.

## 04. An inventory of the editor's capabilities

The panel is a `role="group"` named "Formatting", **not** a `role="toolbar"`. The ARIA toolbar pattern promises arrow-key navigation with a single tab stop; promising that and not implementing it leads a screen-reader user into a void. As a group, every control is an ordinary tab stop.

The panel has to fit **on one line**. This is a constraint rather than an accident: the working area is narrower than the window (about **620px** at a 1280px viewport — the application menu on the left, the properties panel on the right), and wrapping to a second line pushes the document down and turns everything that moved into a postscript. Hence the composition: what people reach for mid-sentence stays at the front, and the rest is folded into menus grouped by _kind of action_. The budget is **about 40px**: adding a control to the panel means removing another. `flex-wrap` is left as a fallback for a genuinely narrow window — wrapping is bad, clipping is worse.

### 4.1 The panel in order

14 controls and 5 separators. The separators have no horizontal margins: five pairs of them were the last ~20px that dropped the panel onto a second line; they now rely on the panel's shared `gap`.

**Undo** **Redo** │ **Text style ▾** **Text size ▾** │ **Bold** **Italic** **More formatting ▾** │ **Text color ▾** **Highlight ▾** │ **Bulleted list** **Numbered list** **Alignment ▾** │ **Link ▾** **Insert ▾**

### 4.2 The full inventory

The package declares exactly **one** keybinding of its own — `Ctrl+M` — and overrides **one**: `Tab` inside a table. Everything else in the "Keys" column comes from the stock bindings of the TipTap extensions in use (StarterKit, TableKit, TextAlign) and is declared nowhere in this package's source — at acceptance that is checked on a running stack rather than in the code. "What it puts in the document" is what will end up in the saved value and travel outward.

| Capability                                                         | How it is invoked                                                                                                                                                                    | What it puts in the document                                                                                                                                                                                                                                                    | Keys                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Undo / redo**                                                    | The Undo / Redo buttons; disabled when the history is empty (`can().undo()`)                                                                                                         | Nothing — the ProseMirror history                                                                                                                                                                                                                                               | Ctrl/⌘+Z, Ctrl/⌘+Shift+Z                                                              |
| **Text style** (paragraph, H1–H4, code block)                      | The "Text style" menu, a radio group; the trigger shows a short form ("Text", "H2", "Code")                                                                                          | `paragraph`, `heading level=1..4`, `codeBlock`                                                                                                                                                                                                                                  | Ctrl/⌘+Alt+1..4                                                                       |
| **Text size** (Default, Small, Normal, Medium, Large, Extra large) | The "Text size" menu, a radio group; the items are shown at their own size                                                                                                           | `fontSize` on the `textStyle` mark: `0.875rem` / `1rem` / `1.25rem` / `1.5rem` / `2rem`. "Default" **removes** the mark rather than setting `1rem`                                                                                                                              | —                                                                                     |
| **Bold**                                                           | The Bold button                                                                                                                                                                      | The `bold` mark → `<strong>`                                                                                                                                                                                                                                                    | Ctrl/⌘+B                                                                              |
| **Italic**                                                         | The Italic button                                                                                                                                                                    | The `italic` mark → `<em>`                                                                                                                                                                                                                                                      | Ctrl/⌘+I                                                                              |
| **Underline**                                                      | More formatting ▸ Underline (a checkbox item)                                                                                                                                        | The `underline` mark → `<u>`                                                                                                                                                                                                                                                    | Ctrl/⌘+U                                                                              |
| **Strikethrough**                                                  | More formatting ▸ Strikethrough                                                                                                                                                      | The `strike` mark → `<s>`                                                                                                                                                                                                                                                       | Ctrl/⌘+Shift+S                                                                        |
| **Inline code**                                                    | More formatting ▸ Inline code                                                                                                                                                        | The `code` mark → `<code>`                                                                                                                                                                                                                                                      | Ctrl/⌘+E                                                                              |
| **Quote**                                                          | More formatting ▸ Quote                                                                                                                                                              | The `blockquote` node                                                                                                                                                                                                                                                           | Ctrl/⌘+Shift+B                                                                        |
| **Clear formatting**                                               | More formatting ▸ Clear formatting                                                                                                                                                   | `unsetAllMarks()` + `clearNodes()`. It **does not touch** the `language` mark — because that mark declares `clearable: false`; being a separate mark from `textStyle` is not on its own enough, since `unsetAllMarks()` strips every mark that has not opted out                | —                                                                                     |
| **The language of a passage**                                      | More formatting ▸ "Language of this passage…" → a dialog mounted by the toolbar. The active tag is shown right in the menu item                                                      | The `language` mark with `attrs.lang` → `<span lang="fr">`. The tag is checked by the core's `isWellFormedLanguageTag`                                                                                                                                                          | —                                                                                     |
| **Text colour**                                                    | The "Text color" menu: a 5×2 grid of 10 swatches plus "Default color"                                                                                                                | `color` on `textStyle`, as a hex value (`#334155`, `#dc2626`, … — colours of the _content_, not of the admin theme)                                                                                                                                                             | —                                                                                     |
| **Highlight**                                                      | The "Highlight" menu: 8 pale swatches plus "No highlight"                                                                                                                            | The `highlight` mark with a `color` → `<mark style="background-color:#fef08a">`                                                                                                                                                                                                 | —                                                                                     |
| **Bulleted list**                                                  | The Bulleted list button                                                                                                                                                             | `bulletList` + `listItem`                                                                                                                                                                                                                                                       | Ctrl/⌘+Shift+8                                                                        |
| **Numbered list**                                                  | The Numbered list button                                                                                                                                                             | `orderedList` + `listItem`                                                                                                                                                                                                                                                      | Ctrl/⌘+Shift+7                                                                        |
| **Alignment** (left / center / right / justify)                    | The "Alignment" menu, a radio group; the trigger's icon shows the current one                                                                                                        | For text — `textAlign` in the attributes of `heading`/`paragraph`. For selected media it is a **different command**: `setMediaAlign` → `data-align`, and the "Justify" item disappears from the list                                                                            | Ctrl/⌘+Shift+L/E/R/J                                                                  |
| **Link**                                                           | The "Link" popover with a URL field; it opens pre-filled with the href under the caret. A "Remove link" button appears only when there is a link                                     | The `link` mark, with `rel="noopener noreferrer nofollow"` baked in. Three cases: there is a selection — it is marked up; the caret is inside a link — `extendMarkRange` and the whole thing is edited; nothing is selected — the URL is inserted **as text linking to itself** | — (⌘K is deliberately left to the command palette and suppressed in the body, see §8) |
| **Divider**                                                        | Insert ▸ Divider                                                                                                                                                                     | `horizontalRule` → `<hr>`                                                                                                                                                                                                                                                       | —                                                                                     |
| **Callout** (Note / Success / Warning / Danger)                    | Insert ▸ Callout ▸ a tone. "Remove callout" is shown only when the caret is inside one                                                                                               | `callout` with a `tone` → `<aside data-callout data-tone="warning">`. Choosing a second tone **recolours** rather than nesting a callout inside a callout                                                                                                                       | —                                                                                     |
| **Table**                                                          | Insert ▸ Table ▸ "Insert table"                                                                                                                                                      | 3×3 **with a header row**; every `<th>` carries `scope="col"` — set through `HTMLAttributes`, so the attribute travels into the preview and into the published body alike                                                                                                       | —                                                                                     |
| **Editing a table**                                                | The same submenus, but the items are **hidden** while the caret is outside a table: row above/below/delete, column left/right/delete, toggle header, merge/split cells, delete table | Changes to `tableRow`/`tableHeader`/`tableCell`. Column widths are `resizable: true`                                                                                                                                                                                            | Tab / Shift+Tab — between cells                                                       |
| **Column layout** (2, 3, 4)                                        | Insert ▸ Columns ▸ a number; and "Merge back to one column" there too, when the caret is inside                                                                                      | `columnBlock count=N` + N `column` nodes, each seeded with an empty paragraph → `<div data-columns="3"><div data-column>`. Reducing the column count **does not delete** what was written: the blocks of the discarded columns fold into the last remaining one                 | —                                                                                     |
| **Image**                                                          | Insert ▸ Media ▸ (the media library's contributions) or "Image from a URL…"                                                                                                          | An `image` node: `src`, `alt`, optional `width`, `align`, `decorative`                                                                                                                                                                                                          | —                                                                                     |
| **Video**                                                          | Insert ▸ Media ▸ … or "Video from a URL…"                                                                                                                                            | A `video` node: `src`, optional `width`, `align`; `controls` is baked into the serialisation — a video with no controls cannot be played wherever the body ends up                                                                                                              | —                                                                                     |
| **Media size**                                                     | A handle in the block's bottom-right corner — a real `<button>`: drag it with the mouse or use the arrows                                                                            | The `width` attribute (not an inline style and **never** a height). Minimum 64px                                                                                                                                                                                                | ← / → in 16px steps, Shift ×4, Backspace/Delete restores the natural width            |
| **An image's alt text**                                            | A chip on the picture itself in the editor: "Alt text", or a warning "Add alt text" when there is neither an alt nor a "decorative" mark                                             | `alt`, plus `decorative` → `data-decorative`. Ticking "decorative" **clears** the alt: otherwise a screen reader would announce text sitting behind a ticked box                                                                                                                | —                                                                                     |
| **Leaving the document with focus**                                | The plugin's only keybinding of its own                                                                                                                                              | Nothing — it moves focus to the exit button in the footer                                                                                                                                                                                                                       | Ctrl+M                                                                                |
| **Tab at the end of a table**                                      | An override of TableKit's behaviour (`orthacmsTableTab`, `priority: 200`)                                                                                                               | One new row — **once**. A second Tab falls through the just-created empty row and focus leaves the document                                                                                                                                                                     | Tab                                                                                   |

> **Why Tab in a table had to be constrained**
>
> The stock `@tiptap/extension-table` binding **never returns `false`** in an editable table: in the last cell it adds a row and moves into it. That is Word and Google Docs behaviour, and an author building a table needs it. But an author simply trying to **leave** grows the table by a row per press — measured: 3 rows became 9 over 27 presses, and focus never got out (ORT-165). The convention is kept and the runaway removed: one press adds a row, the next leaves, because the empty last row is the one just created. An author who wanted the row types in it — the row stops being empty, and adding is armed again.

### 4.3 The two shared control shapes

#### `ToolbarButton`

The icon is decorative, the name is carried by `aria-label`, which is also the tooltip text — so a button cannot read as one thing and be announced as another. A toggle passes `active`, which gives **both** `aria-pressed` **and** a fill: state must not be conveyed by colour alone. A plain action (undo, insert table) passes no `active` at all — "pressed" would be a lie.

#### `ToolbarMenuTrigger`

An icon, an optional current value, a chevron. Rendered through `asChild` from `DropdownMenuTrigger`/`PopoverTrigger`, so it forwards the ref and all of Radix's props.

> **The rule that breaks most quietly**
>
> Both button shapes must `preventDefault` on `mousedown`. Otherwise pressing a control takes focus out of the editor and collapses the selection the command was about to work on — the classic "selected a word, pressed Bold, nothing happened". The click still happens; only the focus move is suppressed. The alt-text chip on an image does the same — without it, `mousedown` deselects the node and takes the chip away before the click arrives.

### 4.4 How they subscribe to editor state

Each menu reads **its own** slice through `useLiveEditorState` rather than a shared panel selector — otherwise the panel would become the single place through which everything re-renders. The wrapper exists because of `StrictMode`: every `useEditor` mounts, is destroyed and mounts again, and a dead instance's subscription still runs the selector one last time. `can().undo()` or `storage.characterCount.words()` on a destroyed editor throws _during render_, React unwinds the whole subtree — and the toolbar the author was reaching for simply disappears. The wrapper returns the supplied `whenGone` value for exactly that frame ("nothing is active, nothing is possible" is the truth about a non-existent editor).

### 4.5 Pasting from the clipboard

`transformPastedHTML` strips three properties out of pasted HTML — `color`, `font-size`, `background-color`. The reasoning is in the file itself: an inline colour chosen _from the toolbar palette_ is content and stays. **A paste is not a choice**: nobody opened the colour menu, and usually nobody even noticed. Measured on a live stack (ORT-164): Word emits `<span style="color: rgb(192,0,0); font-size: 14pt;">`, and Google Docs stamps `color: rgb(0,0,0); font-size: 11pt` onto practically every text run — so a body pasted from Docs lost the site's own typography for the whole entry. Only the clipboard path is processed; toolbar commands go around it. Parsing is through `DOMParser` rather than a regex over `style="…"`: there are quotes, commas inside `url()` and escaping in there, and a mistake here damages an author's text rather than merely missing. An element whose `style` becomes empty loses the attribute entirely.

## 05. Step-by-step flows

### 5.1 How the editor opens

The plugin's key transition: from a form row into a view occupying the working area. There is not one network request on this path.

1. **The form renders the field's row.** _Before_ its switch on field type, `EntryFieldInput` asks `ENTRY_FIELD_CONTROL_SLOT` whether an item's `appliesTo` takes this field. The label, the required marker, the "Changed" badge, the description and the error message stay with `content-admin` — the contributor renders only the input surface itself.
   _the first matching item wins, in registration order_
2. **The control's chunk loads.** `LazyWysiwygFieldControl` under a `Suspense`; the fallback is a `Skeleton` of height `h-24`, deliberately sized to the collapsed preview so the form does not jump up and back.
3. **The value becomes preview HTML.** `WysiwygPreview` → `renderRichText(value)`, memoised on the **raw value**: a form re-render on every keystroke in any other field must not re-parse an unchanged document.
4. **The card is assembled from three layers.** The content (`min-h-40`, and for a non-empty body `max-h-72` with a gradient fade at the bottom, so the cut reads as a continuation rather than a severed sentence); a transparent `absolute inset-0` button; and the "Edit" chip with a pencil in the top-right corner (`aria-hidden`, purely visual).
   _the focus ring is drawn by the card rather than the button — has-[button:focus-visible]:ring-2_
5. **The author presses — anywhere on the card.** The only thing the control does is `setExpanded(true)`. It has no state of its own.
6. **`EntryEditor` replaces the working area's content.** It holds `expandedFieldName`, finds the field among `generalFields`, finds the slot item with a `FullView` — and renders it **instead of the tab strip**. The entry's heading stays above, and the sidebar, the Save/Publish buttons in the top bar and the properties panel on the right are not touched at all: the unfolded view sits inside the same entry form. **One** field can be unfolded at a time; unfolding a second collapses the first.
   _if the field disappeared from the schema after a locale change, the name is cleared and the tabs come back by themselves_
7. **The unfolded view's context is assembled.** The same `EntryFieldControlContext`, but **without** `describedBy`: the `<FieldError>` it would point at belongs to the form row, and that is not on screen. In exchange `contentLocale` is passed — the form row inherited `lang` from the Translated group's wrapper, while the unfolded view renders _outside_ it.
8. **The editor panel mounts.** `useEditor` with the extensions, seeded with `asEditorContent(value)` **once**: the view is mounted only while the field is unfolded, so the editor owns its own state and there is no controlled-content synchronisation — and therefore none of the caret jumps that come with it.
9. **Focus is placed at the end of the document** (`autofocus: 'end'`). The author pressed the field in order to keep writing; leaving focus on a button that has just disappeared would lose it.

### 5.2 How edits reach the entry

1. **Every transaction calls `onUpdate`.** First of all: `if (readOnly) return`: `editable: false` rejects transactions anyway, but this is the one line that writes into the entry.
2. **`getJSON()` is taken, not `getHTML()`.** The stored value is a document; that is what makes heading order, table headers and language markers checkable rather than characters in an opaque string.
3. **Normalisation.** `normalizeRichText`: an empty document collapses to `null`, a meaningful one is handed over **verbatim** — this function never rewrites a real document.
4. **The write into the form goes through the slot's `onChange`** — exactly as typing in any other field does. The field is marked "changed", and the publish indicator in the properties panel recomputes on the fly.
   _onChange is held in a ref: the form hands over a new callback on every render, while TipTap captures the options when the editor is created_
5. **The editor has no Save of its own.** The only commit boundary is the entry's own Save, along with its unsaved-changes guard. So leaving the view **by any means** cannot lose work.

### 5.3 How the editor closes

1. **Two explicit exits:** "Back to fields" at the top of the view and "Done" in the panel's footer. Both call the same `collapse`.
2. **Escape is deliberately unbound.** The toolbar's menus and popovers answer Escape themselves; a second handler on the view would race them and close the whole editor from under an open menu.
3. **`setExpanded(false)`** — `EntryEditor` brings the tab strip back.
4. **`onBlur?.()`** — to the form this means "the field was touched", so from now on a required field is entitled to complain.
5. **Focus returns to the field's button.** Focus does not follow a removed element — the browser drops it onto `<body>`, and an author who pressed "Done" from the keyboard ends up nowhere. Hence a `requestAnimationFrame` and `getElementById(id)?.focus()`: the button carries the field's `id`, and the form row only appears a frame later (WCAG 2.4.3).

### 5.4 How an image or video is inserted

1. **Insert ▸ Media.** The submenu lists the slot's contributions first (by `order`), then a separator, then the two built-in items — "Image from a URL…" and "Video from a URL…". The menu items only _open_ things; they render nothing.
2. **A source opens where it is mounted.** Every `Source` and both dialogs are mounted by the **toolbar** rather than by the menu item: `DropdownMenuContent` unmounts at exactly the moment the picker should appear, and the dialog would open into a tree being torn down. The source lives for the editor's whole lifetime and receives `open`.
3. **A source returns `WysiwygMediaEmbed[]`** — _a URL plus display metadata_ (`kind`, `src`, optional `alt` and `width`), not a library asset. That is exactly what lets one node type serve a library pick, an upload and a hand-typed link alike. Calling `onInsert` **does not close** the source — the "inserted one and kept browsing" flow stays possible.
4. **The `insertMedia` command filters.** Anything whose `src` fails `isSafeMediaSrc` is **skipped** rather than saved as a broken node. Then a kind absent from this editor's schema is cut (otherwise the insert would fail on an unknown node name). If nothing is left, the command returns `false`.
5. **The node appears at the caret** with a `width` if the source knew the natural width and it is at least 64px, and `width: null` otherwise.
6. **From then on it is edited in place:** the resize handle, the alt-text chip, the Alignment menu (which switched itself to `setMediaAlign`, because a media node is selected).

> **Why "by URL" is built in and the library is not**
>
> The "from a URL" dialog needs nothing: no library, no upload endpoint, no plugin. It is what lets an installation **with no media plugin** put a picture in a body at all, and the honest answer for an asset that really does live elsewhere (a CDN, a partner's site). Its text says exactly that: "The file stays where it is — nothing is copied into the Media Library". The URL is checked **twice**: by the dialog, to explain _why_ nothing happened, and by the node on insert and on parse — and that second one protects the stored content.

### 5.5 How a table and columns are inserted

1. **Insert ▸ Table ▸ Insert table** — a 3×3 with a header row, immediately. This is the only way to create a table in this editor, and it always builds a header row — which is why `scope="col"` is correct for every `<th>` the editor can produce (a _row_ header would need a toggle that does not exist, and `scope="row"` along with it).
2. **While the caret is outside a table**, the submenu shows **one** live item. Ten greyed lines are harder to read than one live one, so the editing items are hidden rather than disabled.
3. **Insert ▸ Columns ▸ 2/3/4.** Outside a layout a new `columnBlock` is inserted, each column seeded with an empty paragraph (the `column{2,4}` schema rejects an empty block).
4. **Inside a layout the same menu rebuilds it.** Growing adds empty columns; shrinking **moves** the discarded columns' blocks into the last remaining one. A `data-columns` read from foreign markup is clamped to the 2..4 range: a hand-written `data-columns="wide"` would otherwise become `NaN` and take `grid-template-columns` down with it.
5. **"Merge back to one column"** unfolds the layout, laying every column's blocks out in reading order. This is not a `lift`: that would remove one level, and here there are two.
6. **Inside a column, Backspace does not merge neighbours** — the `column` node is declared `isolating`. Without that, Backspace at the start of a column would pull it into the previous column's last paragraph, and the layout would quietly fall apart.

### 5.6 How a body written before the move to documents opens

1. **The column holds a JSON string** — the old HTML body the migration carried over as is.
2. **The collapsed field already displays it:** for a string, `renderRichText` takes the "string path" — a `DOMParser` into an **inert** document, a parse by the ProseMirror schema, and re-serialisation.
3. **On unfolding, `asEditorContent` hands the string to TipTap**, which parses it with its own schema — preserving everything this editor can represent and nothing it cannot.
4. **The very first `onUpdate` puts a tree into the form.** The conversion is committed on the entry's next save: content upgrades as it is edited.
5. **The `language` mark survives the round trip:** its `parseHTML` declares `span[lang]` — but only a span that _really_ names a language, or an unconditional rule would swallow every `textStyle` span and turn colours into empty language marks.

## 06. The seam with media and with content

### 6.1 Dependency inversion: media → wysiwyg

The editor can **hold** an image and a video, and knows **one** way of naming them — pasting a URL. It knows nothing about the media library, and that is a decision: importing `media-admin` would make rich text unusable in an installation with no media plugin and would nail the editor forever to one particular library's shape. So the editor _declares_ `WYSIWYG_MEDIA_SLOT` and `@orthacms/media-admin` fills it — the same inversion `content-admin` uses for its own slots, and the reason the dependency runs media → wysiwyg rather than the other way.

| Contract                  | Field                                                                                                                      | Meaning                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| WysiwygMediaEmbed         | kind                                                                                                                       | `'image'` or `'video'` — which node this will become              |
| src                       | Where the bytes are. Must be `http(s)` or a same-origin path                                                               |                                                                   |
| alt?                      | The alternative text. Images only — and the reason a picker has to pass it                                                 |                                                                   |
| width?                    | The natural width, if the source knows it. Seeds the node and gives the resize handle a sensible starting point            |                                                                   |
| WysiwygMediaSourceContext | open                                                                                                                       | Whether the source's UI is open (the editor decides which one is) |
| onOpenChange              | Close it or open it again                                                                                                  |                                                                   |
| accept                    | The kinds this editor will take. A source must return nothing else — there is no node for it, and it would silently vanish |                                                                   |
| onInsert                  | Put the selection at the caret, in one call, in the right order. It does not close the source                              |                                                                   |
| WysiwygMediaSourceItem    | id                                                                                                                         | The React key and what the Insert menu uses to open the source    |
| label                     | A `MessageDescriptor` — the Insert ▸ Media submenu item                                                                    |                                                                   |
| icon?                     | The item's leading icon                                                                                                    |                                                                   |
| order                     | Sorting among the sources. The built-in "by URL" item sits at 100                                                          |                                                                   |
| Source                    | The UI itself. Mounted by the **toolbar** for the editor's whole lifetime                                                  |                                                                   |

### 6.2 What media-admin puts in

#### Media Library… `order 10`

The same `MediaPickerDialog` that a media _field_ opens — and that is the point: browsing, search and folder navigation are implemented once, and an author moving between a media field and the body meets the same picker. `multiple` is on: putting three pictures in a row is a normal thing to do. The editor's `accept` is passed to the picker as its own constraint, so an audio file or a PDF is filtered out of the grid rather than being selectable and then silently discarded.

#### Upload files… `order 20`

The files go **into the media library** and are then placed in the text — not as data URIs and not as an "entry attachment". It uploads **immediately**, unlike a media field, which defers the upload until the entry is saved: a field holds an id, while a body holds a **URL**, and a URL does not exist until the bytes do. The trade is one-sided and deliberate — an abandoned edit leaves an asset in the library, where it is visible and deletable, rather than a body pointing nowhere. Each file gets its own request: one failure costs one file, and the toast names that file.

`toWysiwygEmbed` is the only place where media-admin translates its model into the editor's. For an image it takes the `previewUrl` (a ~1280px derivative) rather than the original: a body on a page does not need a 12-megapixel JPEG, and the derivative exists for exactly this; the fallback is `url`, which covers SVGs and small images with no derivatives. Video always goes by `url` — there are no video derivatives. The asset's own `alt` travels with it, so that an author who wrote it once in the library does not write it again in every body. For anything the editor has no node for (audio, a PDF, an archive) it returns `null`: the picker filtered those out already, but this is the second gate.

### 6.3 The `src` check: what can reach a body at all

```
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function isSafeMediaSrc(src: unknown): src is string {
    if (typeof src !== 'string') return false;
    const value = src.trim();
    if (value === '' || value.startsWith('//')) return false;
    // A root-relative or relative path — no scheme, nothing to check.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return true;
    try {
        return ALLOWED_PROTOCOLS.has(new URL(value).protocol);
    } catch {
        return false;
    }
}
```

- **A same-origin path is allowed, and that is not a courtesy but the main case:** the media library serves assets from `/api/media/assets/…`, and a stored absolute URL would nail the content to whichever host the author happened to be on.
- **A protocol-relative `//host/…` is rejected:** it inherits the _consumer's_ scheme, and this editor cannot vouch for that.
- **Parsing into a node is stricter than typing:** `parseHTML` on `image` and `video` refuses the whole node rather than importing it with a nulled `src` — a picture with no source in a body looks like data loss.

### 6.4 The preview's trust boundary

A `richtext` value is what _some other_ user of the CMS typed, pasted or wrote straight through the API, and the preview renders it as **markup**. Handing such a string to `dangerouslySetInnerHTML` unchecked makes every rich-text field a vector for stored XSS against anyone who opens the entry: a `<script>` does not execute through `innerHTML`, but `<img src=x onerror=…>` does, and a contributor could aim it at an administrator.

1. **The document is rebuilt from JSON** by the editor's own schema (`ProseMirrorNode.fromJSON`). The schema is built once and cached — it depends only on the node and mark set, not on the field's placeholder.
2. **A legacy string is parsed from an inert document** with `DOMParser`: it loads no resources and executes no scripts — which is what makes touching the input safe in the first place.
3. **The result is serialised afresh from the resulting nodes.** Only what the schema declares survives: event handlers are discarded, and the Link extension nulls any href outside its protocol list (`javascript:`). The allow-list is **the very same definition** as "what this editor can write", so the preview is exactly what the author will see on unfolding the field. A hand-written tag list would be a second definition, free to drift.
4. **A document with a node this installation does not have** (written through the API, or by another deployment with an extra extension) cannot be rebuilt. Then it falls back to the core's `richTextToHtml` and the string path: what the editor _does_ understand still renders, instead of an empty card.
5. **Links are flattened into `<span data-link>`.** The one deliberate difference from the editor — and the condition under which a button may be laid over it at all: the preview is left with **not one focusable element**.

> **The rule for any new place**
>
> Add a node or a mark to `editorExtensions` and the preview supports it the same day. If rich text needs rendering somewhere else, it goes through `renderRichText` and **never** through `innerHTML` on a raw value. And do not "fix" the link flattening: a live `<a>` under the button is a tab stop the reader falls into on the way to it, and pressing it takes them out of the entry.

### 6.5 Styling: one scope for the editor and the preview

`src/styles.css` (429 lines) hangs entirely off `.orthacms-wysiwyg`, which is carried by both the editor surface and every preview. The host imports it once, after the design system. Why a stylesheet rather than Tailwind classes on components — two reasons. Most of these elements are produced by ProseMirror from stored content, and there is simply **no JSX to hang a `className` on**; the alternative is to bake admin class names into `renderHTML`, that is, to write this application's styling into content published elsewhere. And the editor and the preview **must** render identically — a shared scope makes that a structural property rather than something to keep in agreement.

The colours come from the application theme's `--color-*`, so the editor follows light and dark. Colours chosen by the _author_ (text colour, highlight) sit inline on the content and stay as they are — that is content, not styling. The same principle governs the custom nodes: a callout serialises to `<aside data-callout data-tone>` and a layout to `<div data-columns>`, and the consuming site styles the structure as it likes. Two things in the styles belong only to the editable surface (both through a `[contenteditable]` selector): an empty column's minimum height, and the dashed outline around a layout — the preview must show the layout, not the scaffolding around it.

### 6.6 Why media is not aligned with `text-align`

`@tiptap/extension-text-align` is configured for `heading` and `paragraph` — and adding the media nodes to that list **would not work**: `text-align` positions a block's _inline children_, and an image **is** a block. The property lands on the `<img>` and moves nothing — which is exactly what "centre alignment does nothing to the selected picture" looked like. So media carries an `align` attribute of its own, is stored as `data-align` and is moved by **margins** in the stylesheet. `data-` specifically, rather than the long-obsolete `align="center"` or an inline `style`, for the same reason as `width`: the attribute survives a template's or an email client's sanitiser. `left` is never written — that is where a block sits anyway.

`AlignMenu` nonetheless stays **one** control, because to an author it is one decision: it switches to `setMediaAlign` as soon as the selection sits on a media node, and for that time removes "Justify" from the list (justification stretches a line's words, and a picture has none). The figure the node view renders has `width: fit-content` until the author has chosen a width (`data-sized`): otherwise an unsized picture would stretch to the full measure in the editor while the preview showed its natural size — and there would be nothing to centre, since the block already fills the line.

## 07. States

The plugin has **no network requests of its own** — no data hook, no cache key, no API client. So "loading" here means only loading code, and "error" means form validation rather than a server failure. The only network operations on its territory belong to the media plugin's contributions.

**collapsed, empty** → **collapsed, preview** → **chunk loading** → **unfolded, being edited** → **collapsed, changed**

| State                                             | What is visible                                                                                                                                                                                                                                             | What determines it                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Loading code**                                  | A skeleton: `h-24 w-full rounded-lg` for the collapsed field, `min-h-0 w-full flex-1` for the unfolded view                                                                                                                                                 | The `Suspense` around `React.lazy`. The collapsed skeleton's height is matched to the preview so the form does not jump                                                                                                                             |
| **Empty**                                         | One line of muted text. Priority: the field's `admin.placeholder` → the default "Nothing written yet — press Edit to start."                                                                                                                                | `isEmptyRichText(value)` — the core's definition of emptiness, the same one `required` and the publish gate use                                                                                                                                     |
| **Empty, read-only**                              | "Nothing written yet." — **not** the placeholder and **not** the default                                                                                                                                                                                    | A placeholder is written _at the author_ ("Tell the story…"), and the default names an action the reader does not have                                                                                                                              |
| **There is content**                              | The preview clamped to `max-h-72` with a gradient band at the bottom                                                                                                                                                                                        | `renderRichText`, memoised on the raw value                                                                                                                                                                                                         |
| **A validation error**                            | Collapsed: a red border on the card plus a `<FieldError>` message below, which the button points at through `aria-describedby`. Unfolded: a `<p role="alert">` above the editor panel                                                                       | The button carries **neither** `aria-invalid` **nor** `aria-required` — they do not apply to a button, and ARIA has no "invalid" state for one. In the unfolded view the `<FieldError>` is not on screen at all, so the view shows the error itself |
| **Read-only**                                     | A "View" chip with an eye, and the button's label reads "View {label}". Unfolding is kept                                                                                                                                                                   | `EntryFieldControlContext.readOnly`: the reader lacks `content:update` — or lacks `content:create` on the create form                                                                                                                               |
| **Read-only, unfolded**                           | The toolbar is **absent entirely**; the document is inert; focus is not set; instead of `role="textbox"` + `aria-multiline` + `aria-required` there is `role="region"`; the footer button reads "Back to fields" rather than "Done"; the remarks list stays | `WysiwygEditorPanel readOnly` → `editable: false`, `autofocus: false`. The toolbar is not mounted at all — it consists entirely of commands that write, so removing it wholesale is cheaper than laying out twenty dead controls                    |
| **The editor was destroyed (a StrictMode frame)** | Every toggle is off, undo/redo are unavailable, the counter reads 0/0, and the remarks list is empty                                                                                                                                                        | `useLiveEditorState` returns `whenGone` instead of throwing during render and taking the subtree down                                                                                                                                               |
| **No media sources**                              | Only the two built-in "by URL" items remain in the Insert ▸ Media submenu, and the separator is not drawn                                                                                                                                                   | The slot is empty — the media plugin is not registered. The editor still inserts media                                                                                                                                                              |
| **No edit permission**                            | See "read-only". The plugin has no separate "no permission" state                                                                                                                                                                                           | The decision is made by `content-admin` (`useEntryReadOnly`), and the control must honour it; the server would refuse the write anyway, but a control that kept accepting typing would let somebody do work that Save throws away                   |

> **Why read-only is not "just disable the field"**
>
> Every other field of an entry simply goes inert in place in read mode. The body cannot: the collapsed preview is clipped by height, with a fade at the cut — and a reader who _is allowed_ to read the entry would be unable to read its most important part. So the control is kept and merely renamed.

> **The word counter is computed differently in read mode**
>
> `useEditorState` refreshes its snapshot only on `transaction`/`update` events, and the **first** snapshot is taken before the initial content has settled. While editing this is invisible: `autofocus: 'end'` produces a transaction on mount, and every keystroke produces more. A read-only editor has neither — `editable: false` rejects every transaction — so the subscription would stay on the first empty snapshot forever, and the footer would show "0 words · 0 characters" above a full document. So in that mode the counters are read straight off the editor rather than waiting for an event that will not come.

## 08. Accessibility and the keyboard

Section 508's criterion 504.2 asks not whether the tool itself is accessible but whether **the authoring tool lets you produce conforming content**. That explains half the decisions in this package: the structural remarks list under the document, the "Add alt text" chip on a picture, the passage-language dialog, and `scope="col"` on every `<th>`.

### 8.1 The collapsed field

- **The button sits _beside_ the preview rather than wrapping it.** Wrapping rich content in a `<button>` means putting headings, lists and tables inside a control (invalid) and flattening the whole body into the button's accessible name. Instead the preview renders as ordinary content and a transparent button is laid over it: assistive technology reads the content and then gets one clearly named action, while the pointer can still press anywhere on the card.
- **The name is set with `aria-label` rather than hidden text.** The button carries the field's `id` — `content-admin`'s `<label for>` points at it — and a native label overrides the button's own content, which made it announce as simply "Body", with no hint that pressing it opens anything. `aria-label` overrides the label in turn and **contains the label's visible text**, so the name matches what a voice-input user will say (2.5.3).
- **No `aria-haspopup`:** pressing it turns the working area over to the editor rather than opening a popup on top of it.
- **There are no focusable elements in the preview** — they would be tab stops hidden under the button.

### 8.2 The unfolded editor

- **The section is named by the field's heading** (`<section aria-labelledby>` plus an `<h2>` with the label and the word "Required" when the field is required).
- **The string's language, if the field is localised:** `lang={field.localized ? contentLocale : undefined}`. The collapsed preview inherited `lang` from the Translated group's wrapper; the unfolded view renders outside it, and the chain would break here — a German or Arabic body would be announced by English rules under a hardcoded `<html lang="en">` (3.1.2). For a **shared** (non-localised) field no language is declared at all: one value across every locale, and declaring the string's locale would be a worse claim than declaring nothing.
- **`dir="auto"`, not the locale's direction** — as in the form: the order is taken from the body's first strong character, which is right for an RTL locale and stays right for an RTL quotation inside LTR text.
- **The document surface is** `role="textbox"`, `aria-multiline="true"`, `aria-required`, with an `aria-label` of the form "{field} content". A bare `contenteditable` div has no role at all, leaving assistive technology to guess that it is editable.
- **The remarks are announced politely.** `aria-live="polite"`, `aria-atomic="false"` — and this is not a log: the findings change on almost every keystroke while a heading is being retyped, and reading every intermediate state aloud would mean talking over the author continuously. The block's heading carries the **count**, so the change that really matters ("there are two problems now, there was one") is announced first.
- **The word counter is not announced:** `aria-live="off"`.
- **The remarks list is visible in read mode too.** A body the reader cannot fix is still a body whose problems are worth knowing about, and this is the only surface that mentions them.

### 8.3 The keyboard

| Key                | Where                    | What it does and why that way                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab                | The toolbar              | Every control is an ordinary tab stop (the panel is declared `role="group"`, not `toolbar`)                                                                                                                                                                                                                                                                                                 |
| Ctrl+M             | The document             | The only binding of its own: moves focus to the exit button in the footer. `Ctrl` rather than `Mod`: on macOS `Mod` is ⌘, and ⌘M is "minimise window", which must not be taken from the OS. Ctrl+M is free everywhere and is exactly what the ARIA practices name for this editor pattern                                                                                                   |
| Tab                | The document             | From an ordinary paragraph it moves out; inside a nested list it is intercepted (`sinkListItem`); inside a table it moves between cells, adds one new row in the last cell, and the next press leaves                                                                                                                                                                                       |
| Shift+Tab          | The document             | Moves back out                                                                                                                                                                                                                                                                                                                                                                              |
| Escape             | Menus, popovers, dialogs | Closes **only its own** popup. On the editor view Escape is deliberately unbound                                                                                                                                                                                                                                                                                                            |
| ← / →              | The media resize handle  | 16px steps; ×4 with Shift. The handle is a real `<button>` with a name, because the width is **published**: a decision about content must not be unavailable to somebody who does not use a mouse                                                                                                                                                                                           |
| Backspace / Delete | The media resize handle  | Resets to the natural width — the way out of a botched resize                                                                                                                                                                                                                                                                                                                               |
| Enter              | Popup forms              | Works thanks to a real `<form>` in the alt popover, the link popover and the dialogs                                                                                                                                                                                                                                                                                                        |
| ⌘K / Ctrl+K        | The document             | **Suppressed** while the caret is in the body — but not by this package: the shared `isComposingText` helper from `@orthacms/utils-admin` closes global chords over `input`, `textarea`, `select` and any `contenteditable`. Opening the palette from under the caret is a change of context in response to typing in _another_ control (3.2.2), and ⌘K in any editor means "insert a link" |

> **Every <form> in a popup must stop its own submit**
>
> The alt popover, the link popover, the "from a URL" dialog and the language dialog all render a `<form>` so that Enter works. All of them are **portalled** — moved in the DOM but **not** in the React tree, and React bubbles synthetic events along the tree. So each of their submits reached the entry editor's `<form>` and **saved and published** the entry. Now each calls `stopPropagation()`, and `content-admin`'s form additionally ignores a submit it did not raise (`if (event.target !== event.currentTarget) return`). Pinned down by the e2e case "never saves the record from an overlay's own form", which before the fix produced **three** saves — one per popup. Any new popup with a form in this package must make the same call.

### 8.4 Alt text: why "decorative" is a checkbox

`alt=""` is how HTML says "this image carries no information", but on its own it is indistinguishable from "nobody has written one yet", and those two need opposite treatment: one is finished, the other is a defect the editor should keep pointing at. So the answer is recorded in a `decorative` attribute (`data-decorative` in the saved HTML — inert for any consumer that ignores it), and the prompt keys off it. Ticking the box also **clears** the alt: otherwise a screen reader would announce text left behind a ticked box. The input is _disabled_ rather than hidden, so that the two choices stay visible as one decision.

One deliberate asymmetry: **inside the editor** an image with no alt still gets a fallback accessible name ("Embedded image"), or it would read as unnamed graphics to the _author's_ own screen reader while they work. What goes into the saved HTML is the real value — empty if it is empty: inventing an alt for published content is worse than having none.

## 09. Invariants

Statements that must always hold. Both a review list and a starting set of test assertions.

- **I-01** — The plugin contributes no route, no navigation item and no `layout`: the object `WysiwygPlugin()` returns holds only `name` and `slots`.
- **I-02** — The editor claims **every** `richtext` field except those with `admin.widget === 'textarea'`. There is no other condition in `isWysiwygField`.
- **I-03** — `src/index.ts` exports neither the preview, nor the editor, nor anything that statically pulls in TipTap; both halves of the contribution are taken through `React.lazy`.
- **I-04** — The preview **never** renders stored markup as is: the value always goes through the editor's own ProseMirror schema (`renderRichText`), and a legacy string through an inert `DOMParser`.
- **I-05** — The preview is left with **not one** focusable element: links are flattened into `<span data-link>`. That is the correctness condition for the button lying over it.
- **I-06** — The collapsed field's button carries the field's `id` and an `aria-describedby`, but **neither** `aria-invalid` **nor** `aria-required`.
- **I-07** — Unfolding replaces the working area's content rather than opening a dialog: the sidebar, the entry heading, the Save/Publish buttons and the properties panel stay mounted and operable.
- **I-08** — At most **one** field is unfolded at a time; the state is held by `EntryEditor`, and the control only asks.
- **I-09** — The editor panel is mounted **only** while the field is unfolded, and is seeded from the value **once**, at mount; there is no controlled content synchronisation.
- **I-10** — The editor has no Save and no Cancel of its own: every edit is written into the entry's form through `onChange`, and the only commit boundary is the entry's Save.
- **I-11** — An empty document is stored as `null` rather than as a document with an empty paragraph; a meaningful document is handed to the form **verbatim**.
- **I-12** — Emptiness is defined by the **core** (`isEmptyRichText`) as a list of what emptiness _is_ (doc, paragraph, hardBreak, whitespace text, container) rather than as the negation of a list of "meaningful" nodes.
- **I-13** — The remarks list under the document is built by the **core's** `inspectRichText`: an `error` here is exactly what will refuse the save, and a `warning` exactly what will not.
- **I-14** — A language tag is checked by the **core's** `isWellFormedLanguageTag`, so the editor cannot accept a tag the save will later reject.
- **I-15** — The `language` mark declares `clearable: false`, so "Clear formatting" leaves it alone. Being its own mark rather than a `textStyle` attribute is necessary for that and _not_ sufficient: "Clear formatting" runs `unsetAllMarks()`, which strips every mark in the schema that has not opted out — which is how a WCAG 3.1.2 language marker was once cleared along with a bold.
- **I-16** — Every `<th>` this editor can produce carries `scope="col"`, and the attribute travels into the preview and the published body alike (set through `HTMLAttributes`, not by overriding `renderHTML`).
- **I-17** — Tab in a table's last cell adds a row **once**; pressing it again in the remaining empty row falls through and releases focus.
- **I-18** — Reducing the column count never deletes content: the discarded columns' blocks move into the last remaining one.
- **I-19** — The column count is always within 2..4 — on insert and when parsing foreign markup alike (`clampCount` handles `NaN`).
- **I-20** — Choosing a second callout tone **recolours** the current one rather than nesting a callout inside a callout.
- **I-21** — A media node's `src` is checked **twice** — in the dialog (to explain it to the author) and in the node, on insert and on parse (to protect the stored content). Only `http(s)` and same-origin paths are allowed; a protocol-relative `//host/…` is rejected.
- **I-22** — An unsafe embed is **skipped** rather than saved as a broken node; an `<img>` with an inadmissible `src` is not imported at all rather than imported with an empty `src`.
- **I-23** — Media size is stored in the `width` attribute; a height is **never** stored; a width below 64px reads as "no width chosen" rather than being clamped upward.
- **I-24** — Media alignment is stored in `data-align` and applied with margins; the value `left` is not written; the alignment menu for media has no "Justify" item.
- **I-25** — Ticking "decorative" clears the `alt`: a non-empty alt together with `data-decorative` is impossible in the saved HTML.
- **I-26** — Inside the editor an image with no alt gets a fallback accessible name; the saved HTML carries the real value, empty included.
- **I-27** — Every `<form>` in a popup in this package calls `stopPropagation()` on its submit; the entry is never saved from a popup under any circumstances.
- **I-28** — Every popup opened from a dropdown menu (media sources, the language dialog, the "by URL" dialogs) is mounted by the **toolbar**, not by the menu item.
- **I-29** — Every toolbar control does `preventDefault` on `mousedown`, so a press never collapses the selection the command works on.
- **I-30** — No editor-state selector is called through `useEditorState` directly: they all go through `useLiveEditorState`, which returns `whenGone` on a destroyed editor.
- **I-31** — In `readOnly` mode the toolbar is not mounted at all, `onUpdate` does not write into the form, focus is not set, and the surface's role is `region`.
- **I-32** — A paste loses `color`, `font-size` and `background-color`; a colour applied by a toolbar command does not.
- **I-33** — The `domain/` layer imports neither React nor TipTap; the media node view sits next to its extension so that `infrastructure/` does not import upwards into `presentation/`.
- **I-34** — Every style rule in the package hangs off `.orthacms-wysiwyg`: none can reach the rest of the admin UI, and the editor surface and the preview render the same markup identically.
- **I-35** — Not one admin class name reaches the stored content: the custom nodes serialise into `data-` attributes.
- **I-36** — The unfolded view declares a `lang` only for a field marked `localized`, and never for a shared one.
- **I-37** — Leaving the unfolded view returns focus to the field's button (through a `requestAnimationFrame`) rather than dropping it onto `<body>`.
- **I-38** — `editorExtensions` holds no second copy of an extension StarterKit already brings (Link, Underline, TrailingNode): a duplicate name makes TipTap warn and resolve the extension set unpredictably.

## 10. Testing checklist

Phrased as "action → expected result". The package has no server side, so the checking is entirely browser-based; the existing suite is `apps/admin-e2e/src/content/wysiwyg-fields.spec.ts` (987 lines, 38 cases in five groups, including two axe scans). One thing matters separately: **the visible editor is only half the feature**, and the other half is what exactly goes into the save request's body, which is visible only in the request. To run: `npx nx e2e admin-e2e -- --project=chromium wysiwyg-fields`.

### The collapsed field

- **Open an entry with a non-empty body** → formatted content is visible (headings as headings, lists as lists) rather than text with tags in it.
- **The body contains a link** → the preview holds not one element you can tab onto; Tab from the previous field lands straight on the field's button.
- **The body is empty and the field has an `admin.placeholder`** → the placeholder is shown, not the default.
- **The body is empty with no placeholder** → "Nothing written yet — press Edit to start."
- **The field is declared with `widget: 'textarea'`** → `content-admin`'s ordinary textarea renders, with no Edit chip.
- **The body is longer than the clamp** → the card is clipped at `max-h-72` with a gradient below; the form page does not grow.
- **The body contains `<img src=x onerror=alert(1)>` written through the API** → nothing executes; the preview's DOM holds no `onerror` and no other handler.
- **The body is a document with a node of an unknown type** → the card is not empty: the parts the editor understands are rendered.
- **Press anywhere on the card** → the unfolded editor opens.

### Unfolding and returning

- **Unfold the field** → the editor takes the working area, there is no tab strip, and the caret is already at the end of the text.
- **Inspect the unfolded editor's surroundings** → the sidebar, the entry heading, the Save/Publish buttons and the properties panel are present and live.
- **Measure the toolbar children's positions at a 1280px viewport** → every control is on one line; grouping is by vertical **centre** rather than by `top` (the panel is `items-center`, and a 32px button beside a 20px separator otherwise reads as two lines).
- **Leave with "Back to fields", then repeat and leave with "Done"** → both return the form; the edits are there in both cases.
- **Press "Done" from the keyboard** → focus is on the field's button, not on `<body>`.
- **Press Escape with a toolbar menu open** → the menu closes; the editor stays unfolded.
- **Unfold a second richtext field on the same entry** → the first collapses.

### What goes into the save

- **Type text, apply bold/italic/colour/size, save** → the request body holds a document (`{ type: 'doc', … }`) with the marks carrying the expected attributes.
- **Insert a Warning-toned callout, save** → a `callout` node with `attrs.tone === 'warning'`.
- **Insert a table, save** → the document holds a row of `tableHeader` cells.
- **Centre a paragraph, save** → `textAlign` on the block itself, not on its children.
- **Insert a three-column layout, save** → `columnBlock count=3` with three nested `column`s.
- **Insert a layout and type nothing into it, save** → the layout is saved rather than discarded as "empty".
- **Delete all the content, save** → the request holds `null`, not a document with an empty paragraph.
- **The same on a `required` field** → validation fails.
- **Open an entry with a legacy HTML body, touch it, save** → the request body holds a document; reopening shows the same content.
- **Shrink a layout from 4 columns to 2, save** → nothing written is lost, and the former 3rd and 4th columns' blocks are in the last column.

### Structure and language

- **Make an H2, then an H4 straight after** → a "level skipped" remark appears under the document, marked "Blocks saving", citing WCAG 1.3.1.
- **Try to save such an entry** → the save is rejected; the server's error text says the same thing.
- **Make a link with the text "click here"** → a **warning**, "Worth fixing", appears; the save goes through.
- **Switch a table's header row off** → a blocking remark about a table with no header appears. (The editor offers no "add a caption" alternative — there is no `tableCaption` node in the extension set.)
- **Select a passage, More formatting ▸ Language of this passage…, enter `fr`, save** → the document holds a `language` mark with `lang: 'fr'` on that text run.
- **Enter `fr_FR` or `French`** → the dialog answers with an error and will not apply it; the save never meets that tag.
- **Open the language dialog with no selection** → an explanation, "select a passage", and a disabled Apply button.
- **Open the language dialog on an already marked passage** → the field is pre-filled with the current tag and a "Remove" button has appeared.
- **Apply "Clear formatting" to a passage with a language mark** → the `language` mark survives.
- **Open a localised entry in the German locale and unfold the body** → the section carries `lang="de"`; a shared field does not.

### Media

- **Open Insert ▸ Media** → "Media Library…" and "Upload files…" first, then a separator, then the two "by URL" items.
- **Remove the media plugin from the plugin list** → only the "by URL" items remain, and the editor still inserts media.
- **Insert a picture by URL, save** → an `<img>` node with that `src`; the alt from the dialog if one was entered.
- **Enter `javascript:alert(1)` or `//evil.host/x.png`** → the dialog shows the error "Enter an http(s) address or a path beginning with “/”", and nothing is inserted.
- **Pick an asset from the media library** → the `previewUrl` is inserted rather than the original; the asset's alt travelled into the node; the width is seeded from the asset's dimensions.
- **Upload a file through Upload files…** → the file appears in the media library **and** in the body; the library's cache is invalidated.
- **Upload a PDF through Upload files…** → an "isn’t an image or a video" toast, with no request sent.
- **Tab onto the resize handle and press →×5, save** → the width grew by 80px and is written into the `width` attribute; there is no `height` in the body.
- **Press Backspace on the handle** → the width is reset and `width` disappears from the node.
- **Select a picture, Alignment ▸ Center, save** → `data-align="center"`; there was no "Justify" item in the menu.
- **Choose Alignment ▸ Left on an aligned picture** → the `data-align` attribute disappears from the saved body entirely.
- **Insert a picture with no alt** → it carries the warning chip "Add alt text".
- **Write an alt and save** → the chip becomes the neutral "Alt text"; the `alt` is in the body.
- **Tick "Decorative"** → the alt field is disabled; the body holds `alt=""` and `data-decorative`; the chip no longer warns.
- **Press Save/Enter inside the alt popover, the link popover, the URL dialog and the language dialog** → the entry is **not** saved and **not** published in any of the four cases.

### Pasting

- **Paste a paragraph copied from Google Docs** → the text and the structure are there; `color` and `font-size` are gone; no empty `style=""` is left behind.
- **Paste a fragment from Word with red 14pt text** → the same.
- **Apply a colour from the toolbar palette** → the colour is kept — that is a choice, not a paste.
- **Paste a fragment containing `<span lang="fr">`** → the language mark survives.

### Permissions, states, accessibility

- **Open an entry as a user without `content:update`** → a "View" chip with an eye; the button reads "View {label}".
- **Unfold in that mode** → there is no toolbar at all; no caret appears; the footer says "Back to fields"; the word counter shows real numbers rather than 0/0.
- **An empty body in that mode** → "Nothing written yet." — with no mention of the Edit button.
- **An axe scan of the collapsed field and of the unfolded editor** → no violations.
- **Tab to the field and open it with Enter/Space** → the editor opens; the button's name contains the field's visible label.
- **Press Ctrl+M in the document** → focus lands on the exit button in the footer.
- **Press ⌘K with the caret in the body** → the content palette does **not** open and focus stays in the document; ⌘K outside the body does open it.
- **Press Tab twice in a table's last cell** → the first press added one row and the second moved focus out of the document; there is one more row, not two.
- **Select a word with the mouse and press Bold with the mouse** → the selection did not collapse and the word became bold.
- **Open the field, close it and open it again (StrictMode in a dev build)** → the toolbar is there, and the console holds no "Cannot read properties of null".

## 11. Boundaries of responsibility

The package is small but densely surrounded. Below is who answers for what at its edges; it doubles as the list of where to go when "the editor is broken" and it is not the editor's fault.

| Question                                                                                                 | Answered by                                             | wysiwyg's role                                                                             |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| What a `richtext` field is, what column it has, how it is validated                                      | content-domain, content-server                          | None — the plugin changes the control, not the schema, not the wire format and not the API |
| The structural rules (heading order, table headers, link text, BCP-47)                                   | content-domain inspectRichText, isWellFormedLanguageTag | Shows them live and obeys them; holds no opinion of its own                                |
| What counts as an empty body                                                                             | content-domain isEmptyRichText                          | Re-exports and applies it — to the field's empty state and to normalisation on the way out |
| The field's label, required marker, "Changed" badge, description and `<FieldError>`                      | content-admin EntryFieldInput                           | Renders **only** the input surface                                                         |
| Replacing the working area, the "which field is unfolded" state, Save/Publish, the unsaved-changes guard | content-admin EntryEditor                               | Asks through `setExpanded`; holds no unfolding state of its own                            |
| Permissions: may this user change the entry                                                              | content-admin + identity                                | Receives a ready `readOnly` and must honour it                                             |
| Folder browsing, search, file upload, invalidating the library's cache                                   | media-admin                                             | Declares the slot and inserts what it is handed; knows nothing about the library           |
| Global chords (⌘K the palette, ⌘B the menu, ⌘J the copilot) and their suppression in text                | utils-admin isComposingText plus the chords' own owners | Does nothing; benefits from the surface being `contenteditable`                            |
| Entry locales, the Translated/Shared groups                                                              | i18n-admin, content-admin                               | Receives `contentLocale` and sets `lang` on a localised field's unfolded view              |
| The `--color-*` theme tokens, the menu, dialog, popover and checkbox components                          | design-system                                           | Consumes them; introduces no primitives of its own                                         |
| Plugin registration order, the uniqueness of `layout`                                                    | apps/admin/src/plugins.ts, bootstrap-admin              | Registers after `ContentPlugin()`; contributes no `layout`                                 |

### 11.1 What the package does not have — deliberately

- **Not one HTTP request of its own and not one TanStack Query key.** Everything it does is synchronous operations on a document in the form's memory.
- **No configuration.** `WysiwygPlugin()` takes no arguments; the `WysiwygAdminPlugin` type is a thin alias of `AdminPlugin`, named separately to give future configuration (a trimmed toolbar, a custom palette) somewhere to live.
- **No user settings.** The palettes, the size steps, the callout tones and the column counts are baked into `domain/constants`.
- **No autosave, drafts or collaborative editing.** The only commit boundary is the entry's Save.
- **No drag-and-drop image upload into the document and no pasting a picture from the clipboard.** Media reaches a body only through Insert ▸ Media.
- **No table caption (`tableCaption`) and no row header.** The core knows about a caption and accepts it as an alternative to a header, but the editor does not produce one.
- **No footnotes, no table of contents, no anchors and no embedding of CMS entries.**

## 12. Discrepancies between code and documentation

The package's `AGENTS.md` was read as a skeleton, but every claim was checked against the implementation. What follows is not a set of behavioural bugs but the places where a document (or a comment) has fallen behind the code and can mislead whoever comes here next.

| Where                                             | What it says                                                                                                                                            | What is in the code                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| admin/AGENTS.md,<br>"Which fields it claims"      | "Both live in `WYSIWYG_WIDGET` (the plugin's **only other export**)"                                                                                    | `src/index.ts` exports four more runtime values and three types: `WYSIWYG_MEDIA_KIND`, `WYSIWYG_MEDIA_KINDS`, `WysiwygMediaKind`, `WYSIWYG_MEDIA_SLOT`, `WysiwygMediaEmbed`, `WysiwygMediaSourceContext`, `WysiwygMediaSourceItem`. Without them `media-admin` could not fill the slot                                                                       |
| admin/AGENTS.md,<br>"Bundle"                      | "`src/index.ts` exports **nothing but** `WysiwygPlugin` and `WYSIWYG_WIDGET`"                                                                           | The same discrepancy, repeated a second time. The claim's intent (re-export nothing that pulls in TipTap) is right and is honoured — the media-seam exports are almost entirely types — but the letter of it is wrong                                                                                                                                        |
| admin/AGENTS.md,<br>"Layout — layered"            | The `infrastructure/` list: `editorExtensions`, `extensions/callout`, `extensions/columns`, `extensions/language`, `extensions/media`, `renderRichText` | The layer holds two more modules, each with its own role: `extensions/tableTab` (the Tab constraint, ORT-165) and `transformPastedHTML` (paste cleaning, ORT-164). The first is also mentioned in the accessibility section, but not in the layout                                                                                                           |
| extensions/media/index.ts,<br>the file header     | "What they _do_ share is the attribute set and the node view (see `presentation/components/MediaNodeView`)"                                             | The node view sits at `infrastructure/extensions/media/MediaNodeView`. The node view's own documentation and `AGENTS.md` explain **why** it is there (otherwise `infrastructure/` would import upwards) — so the error is in this reference specifically                                                                                                     |
| admin/AGENTS.md,<br>"The toolbar fits on one row" | "Twenty flat controls wrapped onto a second line", "we folded the rest into **three** menus"                                                            | A historical phrasing. The panel now holds **14** controls, **8** of them drop-downs (Text style, Text size, More formatting, the two colours, Alignment, Link, Insert) — so "three menus" describes only the last folding step rather than the final composition                                                                                            |
| docs/adr/0011-…md                                 | Status **Proposed**, dated 19 Aug 2026                                                                                                                  | The decision is implemented in full and across several packages: the `jsonb` column in `table-builder`, the `richtext/` module in the core, the `RichText` branch in the validator, `GraphQLJSON` in the GraphQL schema, the `::text` cast in search, `scalarTypeFor → null` for filters, and this whole editor. The ADR's status has fallen behind the code |
| admin/AGENTS.md,<br>"Bundle"                      | The reference numbers: an entry chunk of ~255 kB, `editorExtensions-*.js` at ~420 kB, unfolding at ~39 kB                                               | Not checkable from the source — these are build outputs. Not a discrepancy but an **obligation**: the numbers must be re-measured before acceptance, or "the laziness boundary is broken" stays a claim with no measurement behind it                                                                                                                        |
| admin/AGENTS.md,<br>the header                    | "Its entire surface is **one** contribution to content-admin's `ENTRY_FIELD_CONTROL_SLOT`"                                                              | As a contributor, true — exactly one item. But the package **declares** a slot of its own, `WYSIWYG_MEDIA_SLOT`, so its outward outline is wider than one contribution: it is also an extension point for other plugins. The same document's "Media comes from a slot" section describes it — a contradiction inside one file                                |

### 12.1 Observations that are not discrepancies

- **A table with no header is a blocking error, and the only way around it is a header.** The core accepts a `tableCaption` as an alternative, but the editor produces no caption node; so the only way out available to an author is "Toggle header row". That works, but it merges two different decisions into one.
- **`widget` is a free string.** In `AdminProps` it is `widget?: string` with the comment "render hint, e.g. 'textarea', 'slug', 'color'". Neither the server nor the core knows about the values `'wysiwyg'`/`'textarea'` — it is the plugin's convention, and a typo in a schema silently returns the field to WYSIWYG (because it is "not equal to `'textarea'`").
- **The return path through a textarea is lossy.** Switching a field to `widget: 'textarea'` does not break the data (the document is serialised to HTML for display), but the very first save from the textarea writes a string into the column instead of a tree — so the body is "un-upgraded" again.
- **The remarks list uses the index as its key.** Deliberately, and explained in the code: two identical remarks are distinguished only by position, and the list is derived from the document afresh each time and holds no state of its own.

---

**An artifact about a UI plugin.** The series' frame is adapted for a package with no routes, no API and no tables: business description → composition and place → the document format → the capability inventory → flows → the seams → states → accessibility → invariants → checklist → boundaries → discrepancies. The "HTTP API", "Data model" and "Configuration" sections dropped out for want of a subject; their place is taken by what matters most here — a full inventory of what an author can write, and of what will end up in the saved document as a result.

The source is all of `packages/wysiwyg/admin/**`, plus `docs/adr/0011-richtext-as-a-structured-document.md`, the `richtext/` module and the validator from `packages/content/domain`, the slot contract from `packages/content/admin`, the contributions from `packages/media/admin` and the `apps/admin-e2e/src/content/wysiwyg-fields.spec.ts` suite. `AGENTS.md` was used as a skeleton, but every claim was checked against the implementation — discrepancies went into section 12.
