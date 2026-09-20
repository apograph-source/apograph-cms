---
name: accessibility
description: Building accessible (WCAG 2.1 AA) admin UI in Ortha CMS — semantic HTML first, labels via the design-system Field/InputField, ARIA only as a last resort, focus management, keyboard support, accessible tables/pagination/dialogs/menus, landmarks + skip link, live-region announcements (toasts), color-contrast caveats, and intl. Use when authoring or reviewing admin components, forms, tables, dialogs, menus, or any interactive UI. Verify with the admin-e2e a11y/keyboard suites.
user-invocable: false
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(npx nx *), Bash(npm exec nx *)
---

# Ortha CMS accessibility (admin UI)

Target: **WCAG 2.1 Level AA**, as a best-practice goal (not a formal Section 508 /
VPAT obligation today). Build it accessible by default; **verify** with the
`admin-e2e` a11y (axe) + keyboard suites. Automated scans catch a fraction of
WCAG issues — they guard against regressions, they don't prove conformance.

> Companion skills: **`shadcn`** (component mechanics), **`admin-e2e`** (how to
> test the result). Design-system primitives live in
> [`packages/design-system`](../../../packages/design-system).

---

## The non-negotiables

1. **Semantic HTML first.** A real `<button>` for an action, `<a href>` for
   navigation, `<nav>/<main>/<header>`, `<h1…h6>` in order, `<ul>/<table>` for
   lists/tables. Reach for ARIA only when no native element fits — **a wrong/extra
   ARIA role is worse than none.**
2. **Every input has a programmatic label.** Build form fields from the
   design-system `InputField` (or `Field` + `FieldLabel`), which wires
   `htmlFor`/`id`, `aria-invalid`, and the error association for you. Never ship a
   bare `<input>` with only a placeholder.
3. **Keyboard-operable.** Every interaction works without a mouse: reachable by
   Tab in a logical order, activatable by Enter/Space, Escape closes overlays,
   and **focus is visible**. Don't remove focus outlines.
4. **Don't gate on a disabled submit.** Per the login pattern, the submit button
   stays enabled on an invalid form; pressing it **surfaces field errors** rather
   than silently doing nothing (a disabled control gives screen-reader users no
   feedback). See `packages/identity/admin/.../LoginForm`.
5. **Name every control.** Icon-only buttons need an accessible name
   (`sr-only` text or `aria-label`); decorative icons get `aria-hidden="true"`.
   Busy states announce (the submit `Spinner` is `aria-hidden` with an `sr-only`
   "Signing in…").
6. **Announce dynamic changes.** Content that appears without a navigation — a
   `toast()` confirmation, an async error banner, a "{n} results" count after a
   search — must reach screen readers through a live region. The design-system
   `Toaster` (sonner) and `Alert`/`FieldError` (`role="alert"`) already announce;
   never hand-roll a silent `<div>` for status. Don't stack two `role="alert"`s
   in one view (see the `admin-e2e` gotchas).

## Use the design system — it gives you a11y for free

- **`InputField`** — label + input + error, with `htmlFor`/`aria-invalid`/`FieldError`
  wired. Feed it `label`, `invalid`, `errors`. This is how `LoginField` binds a
  TanStack Form field.
- **`SkeletonRegion`** — the announced wrapper a block of `Skeleton`s belongs
  in: one named `role="status"`, `aria-busy`, placeholders hidden inside it.
  A bare `Skeleton` now reads as "I am handling the announcement myself". A
  **route-level** skeleton (a lazy page's `Suspense` fallback) also passes
  `heading`, because that state is a whole page with no `<h1>` until the real
  one mounts — and it is the state a slow connection sits in longest.
- **`FieldError`** renders `role="alert"` so new errors are announced — note this
  collides with the `Alert` banner's role (see the `admin-e2e` gotchas).
- **`Button`** — real `<button>`; pass `type="submit"|"button"`.
- **`Alert`** (`role="alert"`) for page-level messages; **`Logo`/icons** mark
  decorative glyphs `aria-hidden`. **`Spinner`** is decorative — pair it with an
  `sr-only` label for the busy state.
- **`Toaster`** (sonner) — mounted once in `createAdmin`; `toast()` posts to its
  live region, so success/error feedback is announced for free.
- **`Table`** family, **`Dialog`**, **`DropdownMenu`**, **`Pagination`**,
  **`Select`** — Radix-backed primitives that wire roles, labelling, and focus
  for you. Use them rather than hand-rolling; the per-element rules are below.
- Strings go through **`react-intl`** (`defineMessages` + `useIntl`), co-located
  per component — so labels/errors are real, translatable text, not hardcoded.

## Tables, pagination & overlays

- **Tables** (`Table`/`TableHeader`/`TableHead`/…): a real `<table>` with
  `<th scope="col">` column headers, and an accessible name — a `<caption>` or
  `aria-label` saying what the table lists (e.g. "Members"). A sortable column
  sets `aria-sort` on its header and puts the sort toggle in a real `<button>`
  inside the `<th>`. The members table uses the design-system `Table`, which
  renders the right elements — keep the header cells as `TableHead`.
- **Pagination & page size** (`Pagination`, `Select`): every control carries a
  name, not just a glyph or a bare number — "Go to next page", "Rows per page".
  Mark the active page `aria-current="page"`. A `Select` used as a control needs
  a label (a `FieldLabel`/`aria-label`), same as any input.
- **Row menus** (`DropdownMenu`): the kebab trigger needs an accessible name
  scoped to its row (`aria-label="Actions for {name}"`) — `MemberRowActions` is
  the reference. Radix handles roving focus and `Escape`.
- **Dialogs** (`Dialog`): always render a `DialogTitle` — Radix uses it as the
  dialog's accessible name and warns when it's missing; a visually-hidden title
  is fine. Add a `DialogDescription` for helper text; Radix wires
  `aria-labelledby`/`aria-describedby`. (Focus trap/restore is below.)

## Landmarks, headings & skip link

- **One `<h1>` per page**, via `ContainerHeader`'s `title` (it renders the
  `<h1>`). Don't hand-roll a page heading or skip levels — subsequent sections
  are `<h2>`+ in order.
- **Landmarks:** page content sits in the `<main>` the shell `layout` owns; the
  toolbar is a `<nav>`. Don't add a second `<main>`.
- **Skip link (WCAG 2.4.1):** with persistent chrome, the first focusable
  element should be a "Skip to main content" link targeting the `<main>`. The
  shell **already ships this**: `AppShell` renders the link as the first
  focusable element inside `SidebarProvider`, and `SidebarInset` is a real
  `<main id="main-content" tabIndex={-1}>`
  (`packages/shell/admin/src/lib/components/AppShell/index.tsx`). Don't re-add
  it — and note that `#main-content` being focusable is what lets a route move
  focus there after a gated redirect (see `useRedirectNotice` in
  `workspaces-admin`). It **is** pinned now:
  `apps/admin-e2e/src/host/host.spec.ts` ("bypass blocks") asserts the first
  `Tab` reaches it, that it becomes visible when focused, and that activating it
  lands focus on `<main>`; `src/host/reflow.spec.ts` re-checks it at 320 px,
  because a skip link the narrow layout pushes off screen is not one.

## Focus management

- **Visible focus** on every interactive element (don't `outline: none` without a
  replacement). The rule holds for anything you make focusable, not just
  controls: the app-wide scrollport (`sidebar-inset-scroll`) carries
  `tabIndex={0}` so a scrolling region is keyboard-reachable, and it shipped with
  `focus-visible:outline-none` and nothing put back — one press of `Tab` on every
  private route where nothing appeared to happen. Use the design system's
  convention, `focus-visible:ring-2 focus-visible:ring-ring`, adding
  `focus-visible:ring-inset` when an ancestor clips overflow (an outset ring is
  drawn outside its own box and never seen).
- **Logical order** follows DOM order — avoid positive `tabindex`. Remember a
  label-row action (e.g. "Forgot password?") sits **before** its input in the DOM,
  so it tabs first.
- On a route/dialog change, **move focus** to the new context (dialog, or the
  first error after a failed submit) so keyboard/SR users aren't stranded.
- Overlays (dialog/menu/popover) **trap focus** while open and **restore** it to
  the trigger on close — prefer the design-system/Radix primitives, which do this.

## Color & contrast

- Normal text needs **4.5:1**, large text **3:1**, UI/graphics **3:1**.
- Theme tokens live in `apps/admin/src/styles.css`. `muted-foreground` was
  darkened (from shadcn's `oklch(0.556…)` to `0.5`) to clear AA for small muted
  text — the admin-e2e axe scan enforces `color-contrast`, so a regression here
  fails CI. Keep any new token meeting the ratios above.
- Never use color **alone** to convey meaning (pair with text/icon).

## Other

- **`<html lang>` and `<html dir>` are the host's**, and `createAdmin` sets both
  from its `locale` (WCAG 3.1.1, 1.3.2) — don't set them from a component. A
  *content* locale that differs from the chrome's is marked per field instead
  (`EntryFieldSections` puts `lang`/`dir` on the translated run), because one
  page can legitimately hold two languages.
- **Respect `prefers-reduced-motion`** for non-essential animation.
- **Images/icons:** meaningful → `alt`/accessible name; decorative → empty
  `alt`/`aria-hidden`.
- **Don't trap or auto-steal focus** unexpectedly; don't auto-play motion/sound.

## Verify (don't trust by eye)

```bash
# axe scan of pages + dynamic states, and keyboard operability
npx nx e2e admin-e2e -- --project=chromium src/**/a11y.spec.ts src/**/keyboard.spec.ts
```

- Add/extend an `a11y.spec.ts` (axe) and `keyboard.spec.ts` for new UI — see the
  **`admin-e2e`** skill for the harness (`makeAxe`, `expectNoA11yViolations`).
- `eslint-plugin-jsx-a11y` is installed; if/when it's wired into the eslint
  config it catches missing labels/alt/bad ARIA at lint time — a cheap first net.
- Automated tools ≠ conformance. For higher-assurance work, add a manual
  keyboard + screen-reader pass (and a VPAT) — a human/process task, not a test.
