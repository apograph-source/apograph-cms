import type { ReactNode } from 'react';
import type { SlotContribution } from '@orthacms/utils-admin';

/** A route a plugin mounts into the app router. */
export type RouteItem = {
    /** Route path (e.g. "/users/*"). */
    path: string;
    /** Element rendered at that path. */
    element: ReactNode;
    /**
     * When `true`, the route mounts as a top-level sibling (e.g. the sign-in
     * page). Omitted/`false` means it mounts under the contributed `layout`.
     * The host attaches no auth meaning to this — whether "under the layout"
     * means "gated" is up to the layout (the shell wraps it in identity's
     * `RequireAuth`).
     */
    public?: boolean;
};

/**
 * Contract every admin-side plugin must implement: a name, the routes it
 * contributes, and optionally the layout its non-`public` siblings render
 * inside.
 */
export type AdminPlugin = {
    /** Unique identifier. */
    name: string;
    /** Routes this plugin contributes. */
    routes?: RouteItem[];
    /**
     * The app shell — chrome that renders an `<Outlet/>`. The host mounts the
     * first plugin-provided `layout` as the single parent of every non-`public`
     * route. The host treats it as opaque; the shell plugin composes its auth
     * provider + gate inside it. Omitted by most plugins.
     */
    layout?: ReactNode;
    /**
     * Slot contributions (e.g. toolbar nav items). The host wires these into
     * their target slots before render and attaches no meaning beyond wiring —
     * the consuming plugin (the shell) defines and reads the slot.
     */
    slots?: SlotContribution[];
};

/** Options for {@link createAdmin}. */
export type CreateAdminOptions = {
    /** Plugins to register. */
    plugins: AdminPlugin[];
    /** DOM element id to mount into. Defaults to "root". */
    rootElement?: string;
    /**
     * Active locale for `react-intl`, and the value written to `<html lang>`.
     * Defaults to `'en'`.
     *
     * **It does not translate anything yet.** The admin ships exactly one
     * catalogue — the `defaultMessage` on each descriptor — and no `messages`
     * are passed to `IntlProvider`, so every string resolves to its English
     * default whatever this is set to. What *does* follow it is `Intl`
     * formatting (dates, numbers, plurals) and the document language, which is
     * why setting it is still better than not.
     *
     * It is typed `string` rather than a union of shipped locales because there
     * is no set of shipped locales to name yet; when catalogues land, this
     * should narrow so the option cannot promise something it does not do
     * (`ORT-141`).
     */
    locale?: string;
};
