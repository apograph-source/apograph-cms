import { useQuery } from '@tanstack/react-query';
import { apiClient, STALE_TIME } from '@orthacms/utils-admin';

/**
 * One skill as the picker renders it.
 *
 * No `instructions` — the catalogue route deliberately withholds bodies, so a
 * composer that mounts on every page does not pull an 8 000-character body per
 * skill down with it. The manage page reads them one at a time.
 */
export interface CopilotSkill {
    /** Row id for a workspace skill; `null` for a code-defined one. */
    id: string | null;
    /** Machine name — what a run refers to. */
    name: string;
    /** What a person reads. */
    title: string;
    /** When to use it. */
    description: string;
    /** `always` is in force on every run; `manual` waits to be attached. */
    mode: 'manual' | 'always';
    /** Where it was defined. */
    source: 'code' | 'cms';
    /** Whether it is on offer. */
    enabled: boolean;
    /** Whether it can be edited here — false for code-defined skills. */
    editable: boolean;
}

/** Query key for one workspace's skill catalogue. */
export const skillsKey = (workspaceId: string) =>
    ['copilot', 'skills', workspaceId] as const;

/**
 * The skills a run in this workspace can use.
 *
 * Workspace-scoped rather than global: code skills are the same everywhere but
 * the workspace's own are not, so the key carries the id and switching
 * workspace refetches rather than showing the previous one's list.
 */
export function useSkills(workspaceId: string | null) {
    return useQuery({
        queryKey: skillsKey(workspaceId ?? ''),
        // The launcher renders outside a workspace, where there is nothing to
        // ask for. Disabled rather than defaulted to a blank id, which would be
        // a request the guard rejects.
        enabled: Boolean(workspaceId),
        staleTime: STALE_TIME.Short,
        queryFn: async (): Promise<CopilotSkill[]> => {
            // `X-Workspace-Id` rides the shared client's interceptor, as every
            // other workspace-scoped read here does. Setting it by hand would
            // be a second source of truth for the open workspace, and the two
            // would disagree exactly when it changed.
            const response =
                await apiClient.get<CopilotSkill[]>('/copilot/skills');
            return response.data;
        }
    });
}

/** The always-on ones, which are in force whether or not anybody picks them. */
export function alwaysOnSkills(skills: readonly CopilotSkill[]) {
    return skills.filter((skill) => skill.mode === 'always');
}

/** The ones a person can attach — everything the workspace does not force on. */
export function attachableSkills(skills: readonly CopilotSkill[]) {
    return skills.filter((skill) => skill.mode === 'manual');
}
