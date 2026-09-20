import { AVATAR_COLORS } from '@orthacms/design-system';
import { describe, expect, it } from 'vitest';
import { asAvatarColor, avatarColorForId } from '.';

describe('asAvatarColor', () => {
    it.each(AVATAR_COLORS)('passes the palette entry %s through', (color) => {
        expect(asAvatarColor(color)).toBe(color);
    });

    it.each(['#ff0000', 'blurple', '', 'SLATE', ' slate '])(
        'falls back to slate for the unknown value %j',
        (value) => {
            expect(asAvatarColor(value)).toBe('slate');
        }
    );

    // The narrowing is a membership test on the palette array, not a lookup in
    // an object literal — so an inherited `Object.prototype` name is not a
    // member and cannot pass the gate. (The sweep's recurring whitelist bug.)
    it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
        'does not treat the Object.prototype member %s as a palette entry',
        (value) => {
            expect(asAvatarColor(value)).toBe('slate');
        }
    );
});

describe('avatarColorForId', () => {
    it('is deterministic for the same id', () => {
        const id = '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';
        expect(avatarColorForId(id)).toBe(avatarColorForId(id));
    });

    it('always lands inside the palette', () => {
        for (let index = 0; index < 500; index++) {
            expect(AVATAR_COLORS).toContain(avatarColorForId(`id-${index}`));
        }
    });

    it('handles the empty id without producing undefined', () => {
        expect(AVATAR_COLORS).toContain(avatarColorForId(''));
    });

    // BUG-utils-admin-08 — the hash summed character codes, so any permutation
    // of an id hashed identically. Two accounts whose ids are anagrams got the
    // same accent even though colour is one of the roster's identity cues.
    it('separates ids that are permutations of each other', () => {
        expect(avatarColorForId('ab')).not.toBe(avatarColorForId('ba'));
        expect(avatarColorForId('abc-def')).not.toBe(
            avatarColorForId('fed-cba')
        );
    });

    it('spreads real (uuid-shaped) ids across the whole palette', () => {
        // A seeded PRNG, so the distribution claim is checked against realistic
        // ids without making the run flaky.
        let seed = 42;
        const random = () => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const hex = '0123456789abcdef';
        const total = 3500;
        const counts = new Map<string, number>();
        for (let index = 0; index < total; index++) {
            const chars = Array.from(
                { length: 32 },
                () => hex[Math.floor(random() * 16)]
            ).join('');
            const id = `${chars.slice(0, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}-${chars.slice(16, 20)}-${chars.slice(20)}`;
            const color = avatarColorForId(id);
            counts.set(color, (counts.get(color) ?? 0) + 1);
        }
        expect(counts.size).toBe(AVATAR_COLORS.length);
        for (const count of counts.values()) {
            // Uniform is ~14.3%; anything under a fifth of the roster still
            // reads as a varied palette.
            expect(count / total).toBeLessThan(0.2);
        }
    });
});
