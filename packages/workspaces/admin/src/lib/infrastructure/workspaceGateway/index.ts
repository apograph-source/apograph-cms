import type { AvatarColor } from '@orthacms/design-system';
import type { Workspace, WorkspaceStatus } from '../../domain/types/workspace';
import type {
    ContentType,
    CreateWorkspaceBody,
    DirectoryUser
} from '../../domain/types/wizard';

/**
 * A partial profile edit: the target workspace id plus any of the editable
 * fields. Only the fields present are sent; the server writes just those.
 */
export type UpdateWorkspaceInput = {
    /** The workspace to edit. */
    id: string;
    /** New display name. */
    name?: string;
    /** New description (an empty string clears it). */
    description?: string;
    /** New accent color. */
    color?: AvatarColor;
};

/** The target lifecycle status for a workspace. */
export type SetWorkspaceStatusInput = {
    /** The workspace to archive/unarchive. */
    id: string;
    /** The desired status. */
    status: WorkspaceStatus;
};

/** Links an existing directory user to a workspace. */
export type AddWorkspaceMemberInput = {
    /** The workspace to add the member to. */
    workspaceId: string;
    /** The directory user id to link. */
    userId: string;
};

/** Removes a member's link to a workspace. */
export type RemoveWorkspaceMemberInput = {
    /** The workspace to remove the member from. */
    workspaceId: string;
    /** The member's user id. */
    userId: string;
};

/** Grants a workspace access to one content type. */
export type AddWorkspaceContentInput = {
    /** The workspace to grant. */
    workspaceId: string;
    /** The content-type slug to grant. */
    slug: string;
};

/** Revokes a workspace's access to one content type. */
export type RemoveWorkspaceContentInput = {
    /** The workspace to revoke from. */
    workspaceId: string;
    /** The content-type slug to revoke. */
    slug: string;
};

/**
 * The port over the remote workspaces API — the single seam the admin plugin
 * talks to instead of `apiClient` directly. Every method returns the admin's
 * mapped models (via the `workspaceMapper` anti-corruption layer), never the
 * wire shape, so the application hooks and presentation stay off the transport.
 * {@link httpWorkspaceGateway} is the HTTP implementation.
 */
export type WorkspaceGateway = {
    /** Lists every workspace the signed-in user can see. */
    list(): Promise<Workspace[]>;
    /** Creates a workspace via `POST /api/workspaces`. */
    create(body: CreateWorkspaceBody): Promise<Workspace>;
    /** Edits a workspace's profile via `PATCH /api/workspaces/:id`. */
    update(input: UpdateWorkspaceInput): Promise<Workspace>;
    /** Archives or unarchives a workspace. */
    setStatus(input: SetWorkspaceStatusInput): Promise<Workspace>;
    /** Permanently deletes a workspace via `DELETE /api/workspaces/:id`. */
    remove(id: string): Promise<void>;
    /** Adds an existing user to a workspace. */
    addMember(input: AddWorkspaceMemberInput): Promise<Workspace>;
    /** Removes a member from a workspace. */
    removeMember(input: RemoveWorkspaceMemberInput): Promise<void>;
    /** Grants a workspace access to a content type. */
    addContent(input: AddWorkspaceContentInput): Promise<Workspace>;
    /** Revokes a workspace's access to a content type (`409` if non-empty). */
    removeContent(input: RemoveWorkspaceContentInput): Promise<Workspace>;
    /** Whether `slug` is free, via `GET /api/workspaces/slug-available`. */
    checkSlugAvailable(slug: string): Promise<boolean>;
    /** Entries of content type `slug` a workspace holds. */
    contentEntryCount(workspaceId: string, slug: string): Promise<number>;
    /** Total content entries a workspace holds across all its types. */
    entryCount(workspaceId: string): Promise<number>;
    /** Searches the user directory for the member typeahead. */
    searchUsers(query: string): Promise<DirectoryUser[]>;
    /** Loads the content-type catalogue. */
    listContentTypes(): Promise<ContentType[]>;
};
