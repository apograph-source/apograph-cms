import { useEffect, useRef } from 'react';
import { setTitleDecorator } from '@orthacms/utils-admin';
import { badgedTitle } from './tabBadge';

/** The favicon link the admin ships, and the one we swap. */
const ICON_SELECTOR = 'link[rel~="icon"]';

/** Diameter of the dot, as a fraction of the icon. */
const DOT_SCALE = 0.42;

/**
 * Paints `count` onto the browser tab: a `(2)` on the title, and a dot on the
 * favicon.
 *
 * This is the whole of "notify me" for a chat running while you work — no
 * permission prompt, nothing to grant, nothing to deny. The trade is honest and
 * worth stating: it reaches you in **another tab**, not in another window or
 * another app. Reaching someone who has alt-tabbed away needs the Notification
 * API, which costs a prompt you get one chance at.
 *
 * The title decoration is removed on unmount, and the favicon is best-effort: if the icon
 * cannot be drawn (no `<link rel=icon>`, a format the canvas will not take, a
 * cross-origin icon that taints it) the dot is simply skipped. A badge that
 * silently degrades to the title alone is fine; one that blanks the favicon on
 * some browsers is not.
 */
export function useTabBadge(count: number): void {
    const baseIcon = useRef<string | null>(null);

    // Registered as a *decorator* over the shared document title rather than
    // written straight to `document.title`: routes set their own titles now
    // (`useDocumentTitle`), and a badge that captured the title once would pin
    // the tab to whichever page happened to be open when the first chat
    // started. Composing instead means either can change independently, and
    // `badgedTitle` still builds from a clean base, so counts can't stack.
    useEffect(() => {
        setTitleDecorator((title) => badgedTitle(title, count));
        return () => setTitleDecorator(null);
    }, [count]);

    useEffect(() => {
        const link = document.querySelector<HTMLLinkElement>(ICON_SELECTOR);
        if (!link) {
            return;
        }
        if (baseIcon.current === null) {
            baseIcon.current = link.href;
        }
        const original = baseIcon.current;

        if (count === 0) {
            link.href = original;
            return;
        }

        let cancelled = false;
        drawDot(original)
            .then((href) => {
                // The count can change — or the component unmount — while the
                // icon is decoding; a late resolve must not paint a stale badge.
                if (!cancelled && href) {
                    link.href = href;
                }
            })
            .catch(() => {
                // No dot, then. The title still carries the count.
            });

        return () => {
            cancelled = true;
        };
    }, [count]);

    // Put the favicon back the way it was found; the title restores itself when
    // the decorator is cleared above.
    useEffect(
        () => () => {
            const link = document.querySelector<HTMLLinkElement>(ICON_SELECTOR);
            if (link && baseIcon.current !== null) {
                link.href = baseIcon.current;
            }
        },
        []
    );
}

/** The favicon with a dot in its corner, as a data URI — or `null`. */
async function drawDot(source: string): Promise<string | null> {
    const image = await loadImage(source);
    const size = Math.max(image.width, 16);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
        return null;
    }
    context.drawImage(image, 0, 0, size, size);

    const radius = (size * DOT_SCALE) / 2;
    const centre = size - radius;
    // A ring of the page background first, so the dot reads as a badge sitting
    // *on* the icon rather than a smudge blending into whatever is under it.
    context.beginPath();
    context.arc(centre, centre, radius, 0, Math.PI * 2);
    context.fillStyle = '#ffffff';
    context.fill();
    context.beginPath();
    context.arc(centre, centre, radius * 0.78, 0, Math.PI * 2);
    // The admin's brand flame, stated literally: this is a canvas, so there are
    // no CSS custom properties to read.
    context.fillStyle = '#e8622a';
    context.fill();

    return canvas.toDataURL('image/png');
}

/** Loads an image, rejecting rather than hanging when it cannot be decoded. */
function loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('icon failed to load'));
        image.src = source;
    });
}
