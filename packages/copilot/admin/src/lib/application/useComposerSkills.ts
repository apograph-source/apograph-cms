import { useMemo } from 'react';
import { MAX_RUN_SKILLS } from '@orthacms/copilot-domain';
import type { ChatSkill } from '../domain/types/chat';
import { useSkills, type CopilotSkill } from './useSkills';

/** What the composer needs to show, stage and clear skills. */
export interface ComposerSkills {
    /** Everything the workspace offers, always-on ones included. */
    all: CopilotSkill[];
    /** The names staged for the next turn. */
    selected: readonly string[];
    /** Those names resolved to skills — what the chips render. */
    staged: CopilotSkill[];
    /** The workspace's always-on skills, in force whatever is staged. */
    always: CopilotSkill[];
    /**
     * What the turn will actually run under, as transcript refs — the always-on
     * ones plus the staged ones. Matches what the server records, so the
     * optimistic turn's chips and the reopened thread's agree.
     *
     * **For display only.** What goes on the wire is {@link chosen}.
     */
    inForce: ChatSkill[];
    /**
     * The names the person picked — and the only thing the request carries.
     *
     * Separate from {@link inForce} because an always-on skill is *workspace
     * configuration*: the server puts it in force whatever the client sends, so
     * naming it in the request would be the client asserting something it does
     * not decide. Harmless today (the resolver de-duplicates), and wrong the
     * moment an admin switches that skill to `manual` — the client would go on
     * forcing a skill nobody chose.
     */
    chosen: readonly string[];
    /** Replaces the staged set. */
    setSelected(names: readonly string[]): void;
    /** Drops one staged skill. */
    remove(name: string): void;
    /** True while the catalogue is loading. */
    loading: boolean;
    /** How many may be staged at once. */
    max: number;
}

/**
 * Joins the workspace's skill catalogue to the chat's staged selection.
 *
 * The selection itself lives on the session (`copilotStore`), not here: a
 * picker's `useState` is lost by collapsing a window or leaving the Agents
 * view, and the next turn would then quietly run without the instructions the
 * person set up. This hook only derives.
 *
 * **A staged name that is no longer in the catalogue is dropped**, rather than
 * carried into the request. A skill deleted or disabled while it sat in someone
 * else's composer would otherwise fail their next turn with "one of the
 * selected skills is no longer available", which is a true sentence and a
 * useless one — the chip vanishing when the catalogue refreshes says the same
 * thing before they press send.
 */
export function useComposerSkills(
    workspaceId: string | null,
    selected: readonly string[],
    setSelected: (names: readonly string[]) => void
): ComposerSkills {
    const { data, isLoading } = useSkills(workspaceId);
    const all = useMemo(() => data ?? [], [data]);

    return useMemo(() => {
        const byName = new Map(all.map((skill) => [skill.name, skill]));
        const always = all.filter((skill) => skill.mode === 'always');
        const staged = selected
            .map((name) => byName.get(name))
            .filter(
                (skill): skill is CopilotSkill =>
                    skill !== undefined && skill.mode === 'manual'
            );

        return {
            all,
            selected,
            staged,
            always,
            // Always-on first, matching the order the server puts them in — the
            // chips on a sent turn should read in the same order as the ones on
            // the turn it is reopened as.
            inForce: [...always, ...staged].map(toChatSkill),
            chosen: staged.map((skill) => skill.name),
            setSelected,
            remove: (name: string) =>
                setSelected(selected.filter((entry) => entry !== name)),
            loading: isLoading,
            max: MAX_RUN_SKILLS
        };
    }, [all, isLoading, selected, setSelected]);
}

/** The transcript's view of a skill. */
function toChatSkill(skill: CopilotSkill): ChatSkill {
    return { name: skill.name, title: skill.title, source: skill.source };
}
