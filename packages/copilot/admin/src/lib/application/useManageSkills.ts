import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@orthacms/utils-admin';
import { skillsKey, type CopilotSkill } from './useSkills';

/** One skill as the edit form reads it — the row, body included. */
export interface CopilotSkillDetail {
    id: string;
    name: string;
    title: string;
    description: string;
    instructions: string;
    mode: 'manual' | 'always';
    enabled: boolean;
    source: 'cms';
    createdAt: string;
    updatedAt: string;
}

/** What a create sends. */
export interface CreateSkillInput {
    name: string;
    title: string;
    description: string;
    instructions: string;
    mode: 'manual' | 'always';
    enabled: boolean;
}

/** What an edit sends — a patch, so every field is optional. */
export type UpdateSkillInput = Partial<CreateSkillInput>;

/**
 * Query key for the manage page's list.
 *
 * A **child** of `skillsKey`, deliberately: a write changes both lists — the
 * manage page's (every row) and the composer's (enabled ones only) — so
 * invalidating the parent refreshes them together. Two sibling keys would
 * refresh whichever one the caller remembered and leave the other showing a
 * skill that no longer exists.
 */
export const manageSkillsKey = (workspaceId: string) =>
    [...skillsKey(workspaceId), 'manage'] as const;

/** Query key for one skill's full record. */
export const skillKey = (workspaceId: string, id: string) =>
    [...skillsKey(workspaceId), 'detail', id] as const;

/**
 * Every skill in the workspace, disabled and code-defined ones included.
 *
 * A separate route from the picker's, not a flag: "what may I attach?" is
 * `copilot:use` and "what exists here?" is `copilot:skills:manage`, and one
 * endpoint answering both would have to pick the looser permission.
 */
export function useManageSkills(workspaceId: string | null) {
    return useQuery({
        queryKey: manageSkillsKey(workspaceId ?? ''),
        enabled: Boolean(workspaceId),
        queryFn: async (): Promise<CopilotSkill[]> => {
            const response = await apiClient.get<CopilotSkill[]>(
                '/copilot/skills/manage'
            );
            return response.data;
        }
    });
}

/**
 * One skill's full record, for the edit form.
 *
 * Fetched on demand rather than carried in the list, because the list is what
 * the page renders on mount and a body is the one field it never shows.
 */
export function useSkill(workspaceId: string | null, id: string | null) {
    return useQuery({
        queryKey: skillKey(workspaceId ?? '', id ?? ''),
        enabled: Boolean(workspaceId && id),
        queryFn: async (): Promise<CopilotSkillDetail> => {
            const response = await apiClient.get<CopilotSkillDetail>(
                `/copilot/skills/${id}`
            );
            return response.data;
        }
    });
}

/** Creates a skill in the open workspace. */
export function useCreateSkill(workspaceId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (
            input: CreateSkillInput
        ): Promise<CopilotSkillDetail> => {
            const response = await apiClient.post<CopilotSkillDetail>(
                '/copilot/skills',
                input
            );
            return response.data;
        },
        onSuccess: () => invalidate(queryClient, workspaceId)
    });
}

/** Edits a skill. */
export function useUpdateSkill(workspaceId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({
            id,
            patch
        }: {
            id: string;
            patch: UpdateSkillInput;
        }): Promise<CopilotSkillDetail> => {
            const response = await apiClient.patch<CopilotSkillDetail>(
                `/copilot/skills/${id}`,
                patch
            );
            return response.data;
        },
        onSuccess: () => invalidate(queryClient, workspaceId)
    });
}

/** Deletes a skill. */
export function useDeleteSkill(workspaceId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: string): Promise<void> => {
            await apiClient.delete(`/copilot/skills/${id}`);
        },
        onSuccess: () => invalidate(queryClient, workspaceId)
    });
}

/**
 * The server's reason for refusing a write, when it gave a readable one.
 *
 * Worth surfacing verbatim here rather than replacing with a generic line: the
 * two refusals a person actually hits are both name collisions, and each one
 * says which source already holds the name — which is the whole of what they
 * need to fix it.
 */
export function skillWriteMessage(error: unknown, fallback: string): string {
    const message = (error as { response?: { data?: { message?: unknown } } })
        .response?.data?.message;
    if (typeof message === 'string') {
        return message;
    }
    if (Array.isArray(message)) {
        return message.join('; ');
    }
    return fallback;
}

/** Refreshes both lists — the manage page's and the composer's picker. */
function invalidate(
    queryClient: ReturnType<typeof useQueryClient>,
    workspaceId: string
): void {
    void queryClient.invalidateQueries({ queryKey: skillsKey(workspaceId) });
}
