import { initialsOf } from '@orthacms/utils-admin';
import { AVATAR_COLORS, type AvatarColor } from '@orthacms/design-system';
import type {
    Workspace,
    WorkspaceMember,
    WorkspaceStatus
} from '../../domain/types/workspace';

/** A member as `GET /api/workspaces` returns it (presentation fields derived). */
export interface WorkspaceMemberView {
    id: string;
    name: string | null;
    email: string;
}

/** A workspace as `GET /api/workspaces` returns it. */
export interface WorkspaceView {
    id: string;
    name: string;
    slug: string;
    description: string;
    color: string;
    status: 'active' | 'archived';
    members: WorkspaceMemberView[];
    /** Granted content-type slugs; absent on older responses. */
    content?: string[];
}

const STATUS: Record<WorkspaceView['status'], WorkspaceStatus> = {
    active: 'Active',
    archived: 'Archived'
};

/** Derives an admin member (initials + a stable avatar color) from a server row. */
function toMember(view: WorkspaceMemberView, index: number): WorkspaceMember {
    const name = view.name ?? view.email;
    return {
        id: view.id,
        name,
        email: view.email,
        initials: initialsOf(name),
        color: AVATAR_COLORS[index % AVATAR_COLORS.length]
    };
}

/**
 * Anti-corruption layer for the workspaces API: maps a server workspace view to
 * the admin's `Workspace`, deriving the presentation-only member initials/colors
 * the server doesn't store. The single wire→model translation the gateway routes
 * every workspace response through, so no hook or component ever touches the wire
 * shape.
 */
export function toWorkspace(view: WorkspaceView): Workspace {
    return {
        id: view.id,
        slug: view.slug,
        name: view.name,
        description: view.description,
        color: view.color as AvatarColor,
        status: STATUS[view.status],
        members: view.members.map(toMember),
        content: view.content ?? []
    };
}
