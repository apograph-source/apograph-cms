import { AVATAR_COLORS, type AvatarColor } from '@orthacms/design-system';

/**
 * Narrows an arbitrary color string — e.g. a persisted `color` returned by an
 * API — to a known {@link AvatarColor}, falling back to `slate` (the palette's
 * neutral default) when the value isn't part of the palette.
 */
export function asAvatarColor(value: string): AvatarColor {
    return (AVATAR_COLORS as readonly string[]).includes(value)
        ? (value as AvatarColor)
        : 'slate';
}

/**
 * Derives a stable {@link AvatarColor} from an id by hashing it into the
 * palette. Used where avatar colors aren't persisted and so are derived
 * client-side: deterministic (a given id always gets the same accent) and
 * spread across the palette so a roster reads as distinct.
 *
 * FNV-1a over code points rather than a sum of character codes: a sum is
 * order-insensitive, so any two ids that are permutations of each other hash to
 * the same accent. Colour is one of the cues a roster uses to tell two people
 * apart (WCAG 1.4.1 says it must never be the *only* one), so the hash should
 * not throw away the ordering it was given.
 */
export function avatarColorForId(id: string): AvatarColor {
    let hash = 0x811c9dc5;
    for (const character of id) {
        hash ^= character.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 0x01000193);
    }
    return AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length];
}
