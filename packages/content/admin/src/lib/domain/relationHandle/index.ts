/**
 * Handle helpers for the Relations editor. A linked record shows a muted
 * `/handle` beside its title: the target's **slug** when it has one, else a
 * slugified title so a handle always renders (matching the mockup).
 */

import { slugify } from '@orthacms/utils-admin';
import type { ContentField } from '../types/contentType';

/**
 * The slug value for a candidate's `values` bag — the field flagged
 * `admin.widget === 'slug'`, else a field literally named `slug`, when it
 * carries a non-empty string. Mirrors the server's `entrySlug` (`entry-row.ts`)
 * so a freshly-picked candidate handles the same as a server-loaded ref.
 */
export function slugFromValues(
    values: Record<string, unknown>,
    fields: readonly ContentField[]
): string | undefined {
    let named: string | undefined;
    for (const field of fields) {
        const value = values[field.name];
        if (typeof value !== 'string' || !value.trim()) continue;
        if ((field.admin as { widget?: string }).widget === 'slug')
            return value.trim();
        if (field.name === 'slug') named = value.trim();
    }
    return named;
}

/**
 * The `/handle` to display for a linked record: its real `slug` when present,
 * else a slugified `title`. Always returns a non-empty handle.
 */
export function handleFor(title: string, slug?: string): string {
    const trimmed = slug?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : slugify(title);
}
