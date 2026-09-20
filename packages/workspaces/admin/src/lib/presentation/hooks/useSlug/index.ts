import { slugify } from '@orthacms/utils-admin';
import { useSlugAvailability } from '../../../application/useSlugAvailability';
import type { SlugStatus, WizardData } from '../../../domain/types/wizard';

/** Arguments for {@link useSlug}. */
export type UseSlugArgs = {
    /** Current basics data (reads `name`, `slug`, `slugEdited`). */
    data: WizardData;
    /** Merge a partial patch into the basics data. */
    update: (patch: Partial<WizardData>) => void;
};

/** What {@link useSlug} returns. */
export type UseSlugResult = {
    /** Live availability status of the current slug. */
    status: SlugStatus;
    /** Name change handler: also auto-fills the slug until it's been edited. */
    onNameChange: (name: string) => void;
    /** Direct slug edit — marks the slug as user-owned. */
    onSlugChange: (slug: string) => void;
    /** Re-derive the slug from the name and resume auto-fill. */
    regenerate: () => void;
};

/**
 * Wires the name → slug relationship for the basics step. The slug auto-fills
 * from the name (via {@link slugify}) until the user edits it; from then on it
 * is left alone and a regenerate action restores auto-fill. Availability is
 * tracked by {@link useSlugAvailability}. State lives in the wizard — this only
 * supplies handlers and the live status.
 */
export function useSlug({ data, update }: UseSlugArgs): UseSlugResult {
    const status = useSlugAvailability(data.slug);

    return {
        status,
        onNameChange: (name) =>
            update(data.slugEdited ? { name } : { name, slug: slugify(name) }),
        onSlugChange: (slug) => update({ slug, slugEdited: true }),
        regenerate: () =>
            update({ slug: slugify(data.name), slugEdited: false })
    };
}
