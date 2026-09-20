import { useEffect } from 'react';
import { useAppearance } from '@orthacms/design-system';
import { usePreferences } from '../../../application/usePreferences';

/**
 * Invisible bridge that pulls the signed-in user's stored theme from the server
 * into the app-wide {@link useAppearance} provider once, on load. It renders
 * nothing — it exists only for the effect — and is contributed into the shell's
 * **sidebar footer**, the one region the shell keeps mounted in both the global
 * and per-workspace sidebar contexts, so it stays mounted across every
 * authenticated route (a member never has to open their Preferences tab, or
 * even leave a workspace, for their saved theme to take effect).
 *
 * `localStorage` gives the instant, pre-paint theme (see the AppearanceProvider
 * + the index.html bootstrap); this reconciles that guess with the durable,
 * cross-device value the server holds, so signing in on a new device still
 * lands on the user's chosen theme. Setting the same value is a no-op in the
 * provider, so this never fights a change the user just made on the tab.
 *
 * A failed read is deliberately silent *here* — a background hydrate is not
 * worth a toast on every route — but it is not silent overall: the Preferences
 * tab reads the same query and surfaces the error where the user can act on it.
 */
export function ThemeSync() {
    const { setTheme } = useAppearance();
    const { data } = usePreferences();

    useEffect(() => {
        if (data) {
            setTheme(data.theme);
        }
    }, [data, setTheme]);

    return null;
}
