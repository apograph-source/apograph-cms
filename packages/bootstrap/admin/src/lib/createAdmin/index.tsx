import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import {
    BrowserRouter,
    Navigate,
    Outlet,
    Route,
    Routes
} from 'react-router-dom';
import { IntlProvider } from 'react-intl';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient, wireSlotContributions } from '@orthacms/utils-admin';
import {
    AppearanceProvider,
    TooltipProvider,
    Toaster
} from '@orthacms/design-system';
import { UnsavedChangesGuard } from '../UnsavedChangesGuard';
import { AppErrorBoundary } from '../AppErrorBoundary';
import { RouteAnnouncer } from '../RouteAnnouncer';
import { DesignSystemLabels } from '../DesignSystemLabels';
import type { AdminPlugin, CreateAdminOptions } from '../types/adminPlugin';

/**
 * Warns when more than one plugin contributes a `layout`.
 *
 * Only the first survives — `find(Boolean)` below — and the loser is whichever
 * plugin happens to be registered later, which is a decision nobody made. The
 * shell's layout is what composes identity's `RequireAuth`, so losing it does
 * not merely change the chrome: every private route renders **ungated**, with
 * the sidebar, the skip link and the `<main>` landmark gone with it. The host
 * cannot pick a winner for the app — it has no way to know which layout was
 * meant — but it can refuse to do it silently.
 */
/** The locale every descriptor's `defaultMessage` is authored in. */
const DEFAULT_LOCALE = 'en';

/**
 * Language subtags whose script is written right-to-left, used when the runtime
 * cannot say.
 *
 * A fallback for `Intl.Locale`'s text-info API, which is recent enough that a
 * browser in the support window may not have it. Deliberately a short list of
 * the languages an admin UI is plausibly translated into rather than every RTL
 * script in Unicode: a wrong `dir` is worse than a missing one, and anything not
 * listed simply gets the correct `ltr` it had before.
 */
const RTL_LANGUAGES = new Set([
    'ar',
    'arc',
    'ckb',
    'dv',
    'fa',
    'he',
    'ks',
    'ps',
    'sd',
    'ug',
    'ur',
    'yi'
]);

/**
 * The writing direction of `locale`, for `<html dir>`.
 *
 * Nothing was setting it, so every `ml-`/`mr-`/`pl-`/`pr-` in the admin was a
 * physical direction with no chance of mirroring, and a bidi run truncated the
 * wrong end of a string at 320px (WCAG 1.3.2, 1.4.10 — `ORT-86`). Setting the
 * attribute is the host's half and the prerequisite for the rest: a component
 * that wants to mirror has nothing to mirror *against* until the document
 * declares a direction.
 *
 * **This is the UI locale, not the content locale.** A content surface showing
 * an Arabic entry inside a German admin is two directions on one page, and the
 * per-field `dir` the entry editor already sets is what resolves that — the
 * document says which way the *chrome* runs.
 */
function directionOf(locale: string): 'ltr' | 'rtl' {
    try {
        const info = new Intl.Locale(locale) as Intl.Locale & {
            getTextInfo?: () => { direction?: string };
            textInfo?: { direction?: string };
        };
        const direction =
            info.getTextInfo?.().direction ?? info.textInfo?.direction;
        if (direction === 'rtl' || direction === 'ltr') return direction;
        const language = new Intl.Locale(locale).language;
        return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
    } catch {
        // An unparseable tag is the caller's bug, reported by the `IntlProvider`
        // rather than here. Left-to-right is what the document already said.
        return 'ltr';
    }
}

function warnOnLayoutCollision(plugins: AdminPlugin[]): void {
    const contributors = plugins
        .filter((plugin) => plugin.layout)
        .map((plugin) => plugin.name);
    if (contributors.length < 2) return;

    const [winner, ...ignored] = contributors;
    console.warn(
        `[bootstrap-admin] ${contributors.length} plugins contribute a layout; only the first is mounted. ` +
            `Using "${winner}", ignoring ${ignored.map((name) => `"${name}"`).join(', ')}. ` +
            'Every non-public route renders inside the winner, so if it is not the app shell they are no longer gated.'
    );
}

/**
 * Warns when two routes claim the same `path`.
 *
 * React Router matches by rank, not by declaration, so which element renders at
 * a duplicated path is unspecified; React additionally logs a bare
 * "two children with the same key" that names the path but not the plugins
 * behind it. Naming them here is the difference between a five-minute fix and
 * an afternoon.
 */
function warnOnRouteCollisions(plugins: AdminPlugin[]): void {
    const owners = new Map<string, string[]>();
    for (const plugin of plugins) {
        for (const route of plugin.routes ?? []) {
            owners.set(route.path, [
                ...(owners.get(route.path) ?? []),
                plugin.name
            ]);
        }
    }

    for (const [path, contributors] of owners) {
        if (contributors.length < 2) continue;
        console.warn(
            `[bootstrap-admin] route "${path}" is contributed by ${contributors
                .map((name) => `"${name}"`)
                .join(', ')}; only one of them will ever render.`
        );
    }
}

/**
 * Reports a missing translation once per message id, per locale.
 *
 * `IntlProvider` logs every `MISSING_TRANSLATION` at `error` level, once per
 * render of every descriptor — 460 of them on a single `/activity` load with
 * `locale: 'de'` — and gives the host no way to downgrade, sample or collect
 * them. The volume is not a style complaint: it buries anything real in the
 * console, which is the only place a developer looks (`ORT-141`).
 *
 * Two rules. A locale that *is* the default has nothing to be missing, so the
 * fallback is the expected path and says nothing at all. Otherwise each id is
 * reported once, at `warn` — a missing catalogue entry is a gap to fill, not a
 * failure of this render — and everything that is not a missing translation is
 * passed through untouched, because those are real formatting errors.
 */
function makeIntlErrorHandler(
    locale: string,
    defaultLocale: string
): (error: Error) => void {
    const reported = new Set<string>();

    return (error: Error) => {
        const code = (error as Error & { code?: string }).code;
        if (code !== 'MISSING_TRANSLATION') {
            console.error(error);
            return;
        }
        if (locale === defaultLocale) return;

        const id = (error as Error & { descriptor?: { id?: string } })
            .descriptor?.id;
        const key = id ?? error.message;
        if (reported.has(key)) return;
        reported.add(key);
        console.warn(
            `[bootstrap-admin] no "${locale}" translation for "${key}"; using the default message.`
        );
    };
}

/**
 * Bootstraps the Ortha CMS admin app: mounts the React root, wraps it in
 * the data, i18n, and router providers, and renders the routes contributed by
 * every plugin.
 *
 * Plugins author user-facing strings with `react-intl` (`defineMessages` +
 * `useIntl`), so the host provides a single `IntlProvider`. Messages are
 * resolved from each descriptor's `defaultMessage`; a translation catalogue
 * can be wired in here later without touching plugins.
 *
 * Server state is fetched with TanStack Query, so the host also provides one
 * `QueryClient`. Plugins call `useQuery`/`useMutation` (e.g. identity's
 * `useLoginMutation`) without owning a client of their own.
 *
 * Routes split by `public`: public routes mount as top-level siblings, while
 * every other route mounts under a single pathless parent that renders the
 * `layout` a plugin contributed (or a bare `<Outlet/>`). The host is
 * auth-agnostic — it does not know that `layout` may wrap its children in a
 * gate; the contributing plugin (the shell) owns that. A `public:false` route
 * with no gating `layout` therefore renders ungated.
 */
export function createAdmin(options: CreateAdminOptions): void {
    const { plugins, rootElement = 'root', locale = 'en' } = options;

    // The document's language, which nothing was setting: `apps/admin/index.html`
    // ships `lang="en"` and the host never touched it, so a `locale: 'de'` app
    // was German content announced with an English synthesizer — WCAG 3.1.1
    // Language of Page, and the one part of `ORT-141` that is unambiguously the
    // host's to fix. Set before render so assistive tech sees it with the first
    // paint rather than after a reconciliation.
    document.documentElement.lang = locale;
    document.documentElement.dir = directionOf(locale);

    warnOnLayoutCollision(plugins);
    warnOnRouteCollisions(plugins);

    const routes = plugins.flatMap((plugin) => plugin.routes ?? []);
    const publicRoutes = routes.filter((route) => route.public);
    const privateRoutes = routes.filter((route) => !route.public);

    // Wire every plugin's slot contributions into their target slots before
    // render, so consumers (e.g. the shell toolbar) see all contributed items.
    //
    // `wireSlotContributions` registers from empty rather than appending,
    // because a Vite hot update re-executes this module against the same
    // module-level slot closures instead of reloading the page — so a bare
    // `push` per contribution doubled every nav entry and every workspace, and
    // compounded with each save until a hard reload.
    wireSlotContributions(plugins.flatMap((plugin) => plugin.slots ?? []));

    // The single layout that wraps every private route; falls back to a bare
    // outlet before any layout plugin (the shell) is registered.
    const layout = plugins.map((plugin) => plugin.layout).find(Boolean) ?? (
        <Outlet />
    );

    // Checked rather than cast. `createRoot(null)` throws deep inside React with
    // a message about a "target container", which is true but says nothing about
    // *which* id the host was told to mount into — and the page the developer is
    // looking at is blank either way, so the console is all they have.
    const container = document.getElementById(rootElement);
    if (!container) {
        throw new Error(
            `[bootstrap-admin] no element with id "${rootElement}" to mount into. ` +
                'The host HTML must contain it (see `apps/admin/index.html`), or pass a different `rootElement` to createAdmin().'
        );
    }

    const root = ReactDOM.createRoot(container);

    root.render(
        <StrictMode>
            <AppearanceProvider>
                <QueryClientProvider client={queryClient}>
                    <IntlProvider
                        locale={locale}
                        defaultLocale={DEFAULT_LOCALE}
                        onError={makeIntlErrorHandler(locale, DEFAULT_LOCALE)}
                    >
                        <DesignSystemLabels>
                            <TooltipProvider delayDuration={200}>
                                <AppErrorBoundary>
                                    <BrowserRouter>
                                        <RouteAnnouncer />
                                        <UnsavedChangesGuard>
                                            <Routes>
                                                {publicRoutes.map((route) => (
                                                    <Route
                                                        key={route.path}
                                                        path={route.path}
                                                        element={route.element}
                                                    />
                                                ))}
                                                <Route element={layout}>
                                                    {privateRoutes.map(
                                                        (route) => (
                                                            <Route
                                                                key={route.path}
                                                                path={
                                                                    route.path
                                                                }
                                                                element={
                                                                    route.element
                                                                }
                                                            />
                                                        )
                                                    )}
                                                    <Route
                                                        path="*"
                                                        element={
                                                            <Navigate
                                                                to="/"
                                                                replace
                                                            />
                                                        }
                                                    />
                                                </Route>
                                            </Routes>
                                        </UnsavedChangesGuard>
                                    </BrowserRouter>
                                </AppErrorBoundary>
                                {/* Outside the boundary on purpose: a toast is how
                                the rest of the app reports trouble, so it has to
                                survive the failure that a boundary catches. */}
                                <Toaster />
                            </TooltipProvider>
                        </DesignSystemLabels>
                    </IntlProvider>
                </QueryClientProvider>
            </AppearanceProvider>
        </StrictMode>
    );
}
