import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode
} from 'react';

/** Colour theme a user can pick. `system` tracks `prefers-color-scheme`. */
export type ThemePreference = 'light' | 'dark' | 'system';
/** The concrete theme in effect once `system` has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

/** The default theme before any preference is stored — mirrors the server. */
export const DEFAULT_THEME: ThemePreference = 'system';

/** `localStorage` key the chosen theme is persisted under. */
export const THEME_STORAGE_KEY = 'ortha.theme';

/** What {@link useAppearance} exposes: the current theme plus setters. */
export interface AppearanceContextValue {
    /** The user's chosen theme (`light` / `dark` / `system`). */
    theme: ThemePreference;
    /** The theme actually applied (`system` resolved against the OS). */
    resolvedTheme: ResolvedTheme;
    /** Set the colour theme. */
    setTheme: (theme: ThemePreference) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** True when the environment can touch the DOM / storage (i.e. the browser). */
const canUseDom = typeof window !== 'undefined' && !!window.document;

/** A valid theme value, or `null` if the input isn't one. */
function asTheme(value: string | null): ThemePreference | null {
    return value === 'light' || value === 'dark' || value === 'system'
        ? value
        : null;
}

/** Reads the persisted theme, tolerating absent/corrupt storage. */
function readStoredTheme(): ThemePreference {
    if (!canUseDom) {
        return DEFAULT_THEME;
    }
    try {
        return (
            asTheme(window.localStorage.getItem(THEME_STORAGE_KEY)) ??
            DEFAULT_THEME
        );
    } catch {
        return DEFAULT_THEME;
    }
}

/** Whether the OS currently prefers a dark colour scheme. */
function systemPrefersDark(): boolean {
    return canUseDom ? window.matchMedia(DARK_QUERY).matches : false;
}

/**
 * Reflects the resolved theme onto `<html>`: the `dark` class (which the
 * stylesheet's dark token block keys off) and the UA `color-scheme`. Idempotent
 * — safe to call on every change.
 */
function applyToDocument(resolved: ResolvedTheme): void {
    if (!canUseDom) {
        return;
    }
    const root = window.document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    // Lets the UA style form controls, scrollbars, etc. for the active scheme.
    root.style.colorScheme = resolved;
}

/**
 * Provides {@link useAppearance} and keeps the document in sync with the chosen
 * theme. Initial state hydrates synchronously from `localStorage` (so the first
 * paint already matches, avoiding a flash), then persists on every change and
 * re-resolves when the OS scheme flips while `theme` is `system`.
 *
 * Mounted once by the host in `createAdmin`, above the router — so every route
 * and toast reads the same theme. The durable, cross-device copy lives on the
 * server; a plugin hydrates it in via {@link AppearanceContextValue.setTheme}.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);
    const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

    const resolvedTheme: ResolvedTheme =
        theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

    // Track the OS scheme so a `system` preference flips live with no reload.
    useEffect(() => {
        if (!canUseDom) {
            return;
        }
        const media = window.matchMedia(DARK_QUERY);
        const onChange = (event: MediaQueryListEvent) =>
            setSystemDark(event.matches);
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, []);

    // Reflect onto the document whenever the resolved theme changes.
    useEffect(() => {
        applyToDocument(resolvedTheme);
    }, [resolvedTheme]);

    // Persist so the next load hydrates without waiting on the server.
    useEffect(() => {
        if (!canUseDom) {
            return;
        }
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch {
            // A private-mode / quota failure is non-fatal — the DOM is still
            // updated; only cross-reload persistence is lost.
        }
    }, [theme]);

    const setTheme = useCallback((next: ThemePreference) => {
        // Skip a state churn when nothing changed (the server hydrate often
        // echoes the value already in effect).
        setThemeState((current) => (current === next ? current : next));
    }, []);

    const value = useMemo<AppearanceContextValue>(
        () => ({ theme, resolvedTheme, setTheme }),
        [theme, resolvedTheme, setTheme]
    );

    return (
        <AppearanceContext.Provider value={value}>
            {children}
        </AppearanceContext.Provider>
    );
}

/**
 * Reads the current theme and its setter. Falls back to the default (with a
 * no-op setter) when no {@link AppearanceProvider} is mounted, so a component
 * using it in isolation (a test, Storybook) still renders.
 */
export function useAppearance(): AppearanceContextValue {
    const context = useContext(AppearanceContext);
    if (context) {
        return context;
    }
    return {
        theme: DEFAULT_THEME,
        resolvedTheme: 'light',
        setTheme: () => undefined
    };
}
