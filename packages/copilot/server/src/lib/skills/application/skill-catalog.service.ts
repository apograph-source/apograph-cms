import { Inject, Injectable } from '@nestjs/common';
import {
    mergeSkills,
    type Skill,
    type SkillRegistry
} from '@orthacms/copilot-domain';
import { COPILOT_SKILL_REGISTRY } from '../../copilot.tokens';
import {
    SkillRepository,
    type SkillRecord
} from '../infrastructure/persistence/skill.repository';

/**
 * A skill as the picker and the manage page render it — **never** carrying
 * `instructions`.
 *
 * The body is withheld from the list on purpose. Everyone with `copilot:use`
 * can read this route, and while a skill's text is not a secret, it is also not
 * something a picker needs: shipping it would put an 8 000-character body per
 * skill into a request the composer makes on every mount. The manage page,
 * which does need it, reads one skill at a time behind
 * `copilot:skills:manage`.
 */
export interface SkillSummary {
    /** Row id for a CMS skill; `null` for a code-defined one, which has none. */
    id: string | null;
    name: string;
    title: string;
    description: string;
    mode: Skill['mode'];
    source: Skill['source'];
    /** Always true in the run catalogue; the manage list shows both. */
    enabled: boolean;
    /**
     * Whether this deployment lets the skill be edited here. False for code
     * skills, so the manage page can render them read-only rather than
     * offering a form whose save is refused.
     */
    editable: boolean;
}

/** Thrown when a run names skills that do not resolve in its workspace. */
export class SkillResolutionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SkillResolutionError';
    }
}

/**
 * The one place the two sources of skills become one catalogue.
 *
 * Code skills come from the registry the host built at boot; CMS skills come
 * from this workspace's rows. `mergeSkills` decides collisions (code wins), and
 * everything downstream — the picker, the prompt, the run resolver — reads the
 * merged view rather than either source.
 */
@Injectable()
export class SkillCatalogService {
    constructor(
        @Inject(COPILOT_SKILL_REGISTRY)
        private readonly registry: SkillRegistry,
        private readonly repository: SkillRepository
    ) {}

    /**
     * Every skill a run in this workspace could use: the deployment's code
     * skills plus the workspace's **enabled** rows.
     */
    async available(workspaceId: string): Promise<Skill[]> {
        const rows = await this.repository.list(workspaceId, true);
        return mergeSkills(this.registry.all(), rows);
    }

    /** The picker's view — the available catalogue, without the bodies. */
    async catalogue(workspaceId: string): Promise<SkillSummary[]> {
        const rows = await this.repository.list(workspaceId, true);
        const byName = new Map(rows.map((row) => [row.name, row]));
        return mergeSkills(this.registry.all(), rows).map((skill) =>
            toSummary(skill, byName.get(skill.name) ?? null, true)
        );
    }

    /**
     * The manage page's view — code skills (read-only) and **every** CMS row,
     * disabled ones included.
     *
     * A shadowed row is still listed, because the manage page is the only place
     * anyone could discover that a deploy has taken its name over; hiding it
     * would leave an admin editing a skill that silently never runs.
     */
    async manageList(workspaceId: string): Promise<SkillSummary[]> {
        const rows = await this.repository.list(workspaceId);
        const shadowed = new Set(
            rows
                .filter((row) => this.registry.has(row.name))
                .map((row) => row.name)
        );
        return [
            ...this.registry.all().map((skill) => toSummary(skill, null, true)),
            ...rows.map((row) => ({
                ...toSummary(row, row, row.enabled),
                // A shadowed row can be edited (renaming it is the fix) but is
                // reported as not enabled, because it is not: the code skill
                // holds the name and this row never reaches a run.
                enabled: row.enabled && !shadowed.has(row.name)
            }))
        ];
    }

    /** Whether a name is already taken in this workspace, by either source. */
    async nameTaken(
        name: string,
        workspaceId: string,
        exceptId?: string
    ): Promise<'code' | 'cms' | null> {
        if (this.registry.has(name)) {
            return 'code';
        }
        const existing = await this.repository.findByName(name, workspaceId);
        if (existing && existing.id !== exceptId) {
            return 'cms';
        }
        return null;
    }

    /**
     * What one run needs to know about skills: everything the workspace offers,
     * and the subset in force.
     *
     * Both together in one call because the prompt needs both and they come
     * from the same query — the bodies of the active ones, and one line each
     * for the rest so the model can recommend one it was not given.
     */
    async resolveRunSkills(
        workspaceId: string,
        requested: readonly string[]
    ): Promise<{ available: Skill[]; inForce: Skill[] }> {
        const available = await this.available(workspaceId);
        return {
            available,
            inForce: this.selectInForce(available, requested)
        };
    }

    /**
     * The skills one run actually runs with: the workspace's always-on skills,
     * then the ones the person attached, de-duplicated.
     *
     * **Always-on first.** They are the workspace's standing instructions and
     * an attached skill is the specific request on top of them, so the specific
     * one reads last — closest to the message, which is where a model resolves
     * a conflict in its favour.
     *
     * @throws {SkillResolutionError} When a requested name does not resolve.
     *   The message names a **count**, never which name: this resolver is
     *   workspace-scoped, so "belongs to another workspace" and "was just
     *   deleted" are indistinguishable here, and saying which would turn the one
     *   place a caller picks names into an oracle for other workspaces' skills.
     *   Same rule the attachment resolver follows.
     */
    async resolveForRun(
        workspaceId: string,
        requested: readonly string[]
    ): Promise<Skill[]> {
        return this.selectInForce(await this.available(workspaceId), requested);
    }

    /** The pure half of {@link resolveForRun}, over an already-loaded catalogue. */
    private selectInForce(
        available: readonly Skill[],
        requested: readonly string[]
    ): Skill[] {
        const always = available.filter((skill) => skill.mode === 'always');

        if (requested.length === 0) {
            return always;
        }

        const byName = new Map(available.map((skill) => [skill.name, skill]));
        const unique = [...new Set(requested)];
        const attached = unique
            .map((name) => byName.get(name))
            .filter((skill): skill is Skill => skill !== undefined);

        if (attached.length !== unique.length) {
            const missing = unique.length - attached.length;
            throw new SkillResolutionError(
                missing === 1
                    ? 'One of the selected skills is no longer available.'
                    : `${missing} of the selected skills are no longer available.`
            );
        }

        const seen = new Set(always.map((skill) => skill.name));
        return [
            ...always,
            ...attached.filter((skill) => !seen.has(skill.name))
        ];
    }
}

/** The list view of a skill, with its row id when it has one. */
function toSummary(
    skill: Skill,
    row: SkillRecord | null,
    enabled: boolean
): SkillSummary {
    return {
        id: row?.id ?? null,
        name: skill.name,
        title: skill.title,
        description: skill.description,
        mode: skill.mode,
        source: skill.source,
        enabled,
        editable: skill.source === 'cms'
    };
}
