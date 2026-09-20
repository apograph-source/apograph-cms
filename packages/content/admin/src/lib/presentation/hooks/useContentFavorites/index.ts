import { useCallback, useEffect, useState } from 'react';

/** Pinned content-type names + the operations to mutate them. */
export type ContentFavorites = {
    /** Pinned content-type names, in the order they were pinned. */
    favorites: string[];
    /** Whether a content type is currently pinned. */
    isPinned: (name: string) => boolean;
    /** Pin an unpinned type, or unpin a pinned one. */
    toggle: (name: string) => void;
};

/** localStorage key for a workspace's pinned content types. */
function storageKey(workspaceId: string): string {
    return `ortha:content:favorites:${workspaceId}`;
}

/** Reads the persisted favorites, tolerating missing/blocked/corrupt storage. */
function readFavorites(workspaceId: string): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(storageKey(workspaceId));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (name): name is string => typeof name === 'string'
        );
    } catch {
        return [];
    }
}

/**
 * Per-workspace favorites for the Content Library sidebar, persisted in
 * `localStorage` (there is no favorites server yet — this is the planned
 * migration point). Pinned content-type names are keyed by workspace so they
 * don't leak across workspaces, and ordered by when they were pinned so the
 * Favorites group stays stable. Storage access is guarded, so a private-mode or
 * quota error degrades to an in-memory list rather than throwing.
 */
export function useContentFavorites(workspaceId: string): ContentFavorites {
    const [favorites, setFavorites] = useState<string[]>(() =>
        readFavorites(workspaceId)
    );

    // Re-sync when the open workspace changes (favorites are per-workspace).
    useEffect(() => {
        setFavorites(readFavorites(workspaceId));
    }, [workspaceId]);

    // Persist on change; swallow quota/security errors.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(
                storageKey(workspaceId),
                JSON.stringify(favorites)
            );
        } catch {
            // Storage unavailable (private mode, quota) — keep the in-memory list.
        }
    }, [workspaceId, favorites]);

    const isPinned = useCallback(
        (name: string) => favorites.includes(name),
        [favorites]
    );

    const toggle = useCallback((name: string) => {
        setFavorites((current) =>
            current.includes(name)
                ? current.filter((pinned) => pinned !== name)
                : [...current, name]
        );
    }, []);

    return { favorites, isPinned, toggle };
}
