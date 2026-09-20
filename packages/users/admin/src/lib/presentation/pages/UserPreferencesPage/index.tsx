import { useRef } from 'react';
import { defineMessages, useIntl, type MessageDescriptor } from 'react-intl';
import { AlertTriangle, Check, Monitor, Moon, Sun } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    RadioGroup,
    RadioGroupItem,
    cn,
    toast,
    useAppearance,
    type ThemePreference
} from '@orthacms/design-system';
import { usePreferences } from '../../../application/usePreferences';
import { useUpdateTheme } from '../../../application/useUpdateTheme';
import { ThemePreview } from './ThemePreview';

/** Intl descriptors for {@link UserPreferencesPage}, co-located here. */
const messages = defineMessages({
    themeTitle: {
        id: 'users.preferences.themeTitle',
        defaultMessage: 'Theme'
    },
    themeDescription: {
        id: 'users.preferences.themeDescription',
        defaultMessage:
            'Choose how Ortha looks. This is personal to your account and applies immediately on every device you sign in on. “System” follows your device’s appearance setting.'
    },
    lightLabel: { id: 'users.preferences.lightLabel', defaultMessage: 'Light' },
    lightHint: {
        id: 'users.preferences.lightHint',
        defaultMessage: 'The bright, default canvas.'
    },
    darkLabel: { id: 'users.preferences.darkLabel', defaultMessage: 'Dark' },
    darkHint: {
        id: 'users.preferences.darkHint',
        defaultMessage: 'Dimmed surfaces, easier at night.'
    },
    systemLabel: {
        id: 'users.preferences.systemLabel',
        defaultMessage: 'System'
    },
    systemHint: {
        id: 'users.preferences.systemHint',
        defaultMessage: 'Match my device automatically.'
    },
    systemResolved: {
        id: 'users.preferences.systemResolved',
        defaultMessage: 'Your device is currently set to {mode}.'
    },
    modeLight: { id: 'users.preferences.modeLight', defaultMessage: 'light' },
    modeDark: { id: 'users.preferences.modeDark', defaultMessage: 'dark' },
    groupLabel: {
        id: 'users.preferences.groupLabel',
        defaultMessage: 'Colour theme'
    },
    saved: { id: 'users.preferences.saved', defaultMessage: 'Theme saved.' },
    failed: {
        id: 'users.preferences.failed',
        defaultMessage: 'Couldn’t save your theme. Please try again.'
    },
    loadFailed: {
        id: 'users.preferences.loadFailed',
        defaultMessage:
            'Couldn’t load your saved theme, so this may not be the one stored on your account. Reload to try again — picking a theme below still saves normally.'
    }
});

/** One selectable theme, its icon, and its co-located label/hint descriptors. */
type ThemeOption = {
    value: ThemePreference;
    icon: typeof Sun;
    label: MessageDescriptor;
    hint: MessageDescriptor;
    preview: 'light' | 'dark' | 'system';
};

const OPTIONS: ThemeOption[] = [
    {
        value: 'light',
        icon: Sun,
        label: messages.lightLabel,
        hint: messages.lightHint,
        preview: 'light'
    },
    {
        value: 'dark',
        icon: Moon,
        label: messages.darkLabel,
        hint: messages.darkHint,
        preview: 'dark'
    },
    {
        value: 'system',
        icon: Monitor,
        label: messages.systemLabel,
        hint: messages.systemHint,
        preview: 'system'
    }
];

/**
 * Stable toast id, so rapid selections (a keyboard user arrowing across the
 * group selects each option in turn) replace one another in place instead of
 * stacking a column of "Theme saved."
 */
const THEME_TOAST_ID = 'users.preferences.theme';

/**
 * The Preferences tab (shown only on your **own** profile): pick the colour
 * theme (Light / Dark / System). Selection is optimistic — the app re-themes
 * the instant you choose, via the shared {@link useAppearance} provider — then
 * persisted to the server; a failed save rolls the choice back and surfaces a
 * toast. The radio group is the accessible backbone; each option is a full card
 * with a live preview.
 */
export function UserPreferencesPage() {
    const intl = useIntl();
    const { theme, resolvedTheme, setTheme } = useAppearance();
    const preferences = usePreferences();
    const update = useUpdateTheme();

    // The user's most recent choice. Selections can overlap (arrow keys fire one
    // per keypress) and the responses can land out of order, so a save only owns
    // the rollback if nothing has superseded it — otherwise a slow failure for
    // an abandoned choice would yank the UI off the choice the user *did* make,
    // and onto a `previous` that is by then two selections stale.
    const latest = useRef<ThemePreference | null>(null);

    const select = (next: ThemePreference) => {
        if (next === theme) {
            return;
        }
        const previous = theme;
        latest.current = next;
        // Apply immediately so the whole UI re-themes as the user chooses…
        setTheme(next);
        // …then persist. On failure, roll the visible choice back.
        update.mutate(next, {
            onSuccess: () => {
                if (latest.current !== next) {
                    return;
                }
                toast.success(intl.formatMessage(messages.saved), {
                    id: THEME_TOAST_ID
                });
            },
            onError: () => {
                if (latest.current !== next) {
                    return;
                }
                setTheme(previous);
                toast.error(intl.formatMessage(messages.failed), {
                    id: THEME_TOAST_ID
                });
            }
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>{intl.formatMessage(messages.themeTitle)}</CardTitle>
                <CardDescription>
                    {intl.formatMessage(messages.themeDescription)}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {/* A failed read gets its own state rather than being folded
                    into "no preference saved": without it the picker would
                    confidently present the local fallback as the stored choice.
                    The group stays usable — saving is a separate request. */}
                {preferences.isError ? (
                    <Alert variant="warning" className="mb-3">
                        <AlertTriangle className="size-4" aria-hidden />
                        <AlertDescription>
                            {intl.formatMessage(messages.loadFailed)}
                        </AlertDescription>
                    </Alert>
                ) : null}
                <RadioGroup
                    value={theme}
                    onValueChange={(value) => select(value as ThemePreference)}
                    aria-label={intl.formatMessage(messages.groupLabel)}
                    className="grid gap-3 sm:grid-cols-3"
                >
                    {OPTIONS.map((option) => {
                        const selected = option.value === theme;
                        const Icon = option.icon;
                        const inputId = `theme-${option.value}`;
                        return (
                            <label
                                key={option.value}
                                htmlFor={inputId}
                                className={cn(
                                    'group relative flex cursor-pointer flex-col gap-3 rounded-lg border bg-card p-3 text-left transition-colors',
                                    'hover:border-input focus-within:ring-2 focus-within:ring-ring',
                                    selected
                                        ? 'border-primary ring-1 ring-primary'
                                        : 'border-border'
                                )}
                            >
                                <ThemePreview variant={option.preview} />
                                <div className="flex items-start gap-2">
                                    <Icon
                                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                                        aria-hidden
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium">
                                            {intl.formatMessage(option.label)}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {intl.formatMessage(option.hint)}
                                        </p>
                                    </div>
                                    <RadioGroupItem
                                        id={inputId}
                                        value={option.value}
                                        className="sr-only"
                                    />
                                    <span
                                        aria-hidden
                                        className={cn(
                                            'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                                            selected
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'border-input'
                                        )}
                                    >
                                        {selected ? (
                                            <Check className="size-3" />
                                        ) : null}
                                    </span>
                                </div>
                            </label>
                        );
                    })}
                </RadioGroup>
                {theme === 'system' ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                        {intl.formatMessage(messages.systemResolved, {
                            mode: intl.formatMessage(
                                resolvedTheme === 'dark'
                                    ? messages.modeDark
                                    : messages.modeLight
                            )
                        })}
                    </p>
                ) : null}
            </CardContent>
        </Card>
    );
}
