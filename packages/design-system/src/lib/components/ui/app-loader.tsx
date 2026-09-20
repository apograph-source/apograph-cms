import { Logo } from './logo';
import { Spinner } from './spinner';
import { cn } from '../../utils';

/**
 * Props for the {@link AppLoader} component.
 */
type AppLoaderProps = React.ComponentProps<'main'> & {
    /**
     * The announced loading text shown beside the spinner. Defaults to
     * `'Loading…'`; callers in a localized tree should pass a translated
     * string (the design system stays intl-agnostic).
     */
    label?: string;
    /**
     * The visually-hidden `<h1>` naming the page. Defaults to {@link label}.
     *
     * This screen *is* the whole document while it shows, so it owes the page a
     * heading — and a boot loader is the state a slow connection sits in
     * longest, which makes it the one most likely to be navigated by heading
     * (`ORT-167`). Callers with something better to say than "Loading…" should
     * say it.
     */
    heading?: string;
};

/**
 * Branded full-screen boot loader: the large Ortha CMS mark over a spinner and
 * a short status line, centered on the muted background. Used for the "root"
 * load — the initial app boot and the auth probe — where there is no page
 * chrome yet to drape a skeleton over. The busy state announces once through a
 * single `role="status"` region; the spinner is decorative (`aria-hidden`) and
 * the `label` carries the announcement.
 *
 * The root element is a **`<main>`**, and the status role sits on the inner
 * block rather than on it. While this screen is up it is the entire document —
 * there is no shell yet, so nothing else supplies the landmark a screen-reader
 * user jumps to, and every node on the page was being reported as outside one
 * (`ORT-166`, `ORT-170`). `role="status"` could not stay on the root: it would
 * override the `main` role and give the landmark back.
 */
export function AppLoader({
    label = 'Loading…',
    heading,
    className,
    ...props
}: AppLoaderProps) {
    return (
        <main
            className={cn(
                'flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10',
                className
            )}
            {...props}
        >
            <h1 className="sr-only">{heading ?? label}</h1>
            <Logo size="lg" showLabel={false} />
            <div
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
            >
                <Spinner aria-hidden />
                <span>{label}</span>
            </div>
        </main>
    );
}
