import type { AvatarColor } from '@orthacms/design-system';

/** Lifecycle status of a workspace. */
export type WorkspaceStatus = 'Active' | 'Archived';

/** A person who belongs to a workspace. */
export type WorkspaceMember = {
    /** Stable member id. */
    id: string;
    /** Display name. */
    name: string;
    /** Two-letter initials shown in the avatar. */
    initials: string;
    /** Contact email. */
    email: string;
    /** Accent color tinting the member's avatar. */
    color: AvatarColor;
};

/**
 * A workspace: a self-contained grouping of content, members, and plugins.
 * The member count is never stored — read it from `members.length`.
 */
export type Workspace = {
    /** Stable workspace id. */
    id: string;
    /** URL-safe identifier, unique across the system. */
    slug: string;
    /** Display name. */
    name: string;
    /** Short summary of what the workspace holds. */
    description: string;
    /** Accent color tinting the workspace avatar. */
    color: AvatarColor;
    /** Lifecycle status. */
    status: WorkspaceStatus;
    /** Everyone who belongs to the workspace. */
    members: WorkspaceMember[];
    /**
     * Slugs of the content types granted to this workspace at creation. Feature
     * plugins (e.g. the Content Library) scope what they show to these.
     */
    content: string[];
};
