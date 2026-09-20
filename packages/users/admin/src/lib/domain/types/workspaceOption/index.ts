import type { AvatarColor } from '@orthacms/design-system';

/** A workspace as the invite wizard's assignment step (and the add-to-workspaces dialog) render it. */
export type WorkspaceOption = {
    /** Stable workspace id. */
    id: string;
    /** Display name. */
    name: string;
    /** Short description, or `null` when none is set. */
    description: string | null;
    /** Two-letter initials shown in the avatar. */
    initials: string;
    /** Accent color tinting the workspace's avatar. */
    color: AvatarColor;
};
