import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDatabase, type Database } from '@orthacms/database';
import { userPreferences } from '../../schema';
import type { UpdatePreferencesDto } from '../dto/update-preferences.dto';

/** A user's appearance preferences as exposed over the wire (no `userId`). */
export type UserPreferences = Pick<
    typeof userPreferences.$inferSelect,
    'theme'
>;

/**
 * The defaults a brand-new user renders with before they have ever saved a
 * preference (no row exists yet). Kept in sync with the schema column default
 * so `get` can synthesise a response without writing a row on read.
 *
 * Frozen, and always returned via {@link defaultPreferences} rather than by
 * reference: it is process-wide shared state, so handing the same object to
 * every user would let one mutation downstream redefine the default for all of
 * them.
 */
export const DEFAULT_PREFERENCES: Readonly<UserPreferences> = Object.freeze({
    theme: 'system'
});

/** A fresh copy of {@link DEFAULT_PREFERENCES}, safe to hand to one caller. */
function defaultPreferences(): UserPreferences {
    return { ...DEFAULT_PREFERENCES };
}

/** The columns projected into a {@link UserPreferences} response. */
const PREFERENCE_COLUMNS = {
    theme: userPreferences.theme
} as const;

/**
 * Reads and writes the current user's appearance preferences. A thin service
 * over the single `user_preferences` row a user owns: `get` returns the stored
 * row or a copy of {@link DEFAULT_PREFERENCES} when none exists yet, and
 * `save` upserts the choice, creating the row on first write.
 */
@Injectable()
export class PreferencesService {
    constructor(@InjectDatabase() private readonly db: Database) {}

    /** The user's stored preferences, or the defaults if they have none yet. */
    async get(userId: string): Promise<UserPreferences> {
        const [row] = await this.db
            .select(PREFERENCE_COLUMNS)
            .from(userPreferences)
            .where(eq(userPreferences.userId, userId));
        return row ?? defaultPreferences();
    }

    /**
     * Upserts the user's theme choice and returns the stored preferences. One
     * statement — the insert seeds the row on first save, and on conflict it
     * updates the existing row. No check-then-write race.
     */
    async save(
        userId: string,
        patch: UpdatePreferencesDto
    ): Promise<UserPreferences> {
        const [row] = await this.db
            .insert(userPreferences)
            .values({ userId, theme: patch.theme })
            .onConflictDoUpdate({
                target: userPreferences.userId,
                set: { theme: patch.theme, updatedAt: new Date() }
            })
            .returning(PREFERENCE_COLUMNS);

        // `row` is always defined — an upsert with `returning` yields the row.
        return row ?? defaultPreferences();
    }
}
