import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutorContext } from '@nx/devkit';
import type { PublishOutcome } from '../../lib/release/publish';
import { formatNpmError, publishWithRetry } from '../../lib/release/publish';
import {
    probeRegistry,
    registryTokenFromEnv
} from '../../lib/release/registry';
import {
    creationLimitTrippedBy,
    throttleStateDir,
    tripCreationLimit,
    withPublishSlot
} from '../../lib/release/throttle';

/** Options for the `release-publish` executor. */
export interface ReleasePublishExecutorOptions {
    /** Staged package root, relative to the workspace root. */
    packageRoot?: string;
    /** Milliseconds to leave between two publishes across the whole release. */
    delay?: number;
    /** Extra attempts a rate-limited or transient failure gets. */
    retries?: number;
    /** Backoff before the first retry, in milliseconds; doubles after that. */
    retryBackoff?: number;
    /** Ceiling for the doubling, in milliseconds. */
    maxRetryBackoff?: number;
    /* ---- passed through by `nx release publish` ---- */
    registry?: string;
    tag?: string;
    otp?: string | number;
    access?: string;
    dryRun?: boolean;
    firstRelease?: boolean;
    nxReleaseVersionData?: Record<string, { newVersion: string | null }>;
}

/**
 * This package never asked the registry anything, because a peer had already
 * been told no. Distinct from `creation-blocked` so only the package that
 * actually earned the 429 reports it as its own.
 */
interface BlockedByPeer {
    status: 'blocked-by-peer';
    blockedBy: string;
}

const DEFAULTS = {
    delay: 5_000,
    retries: 5,
    retryBackoff: 30_000,
    maxRetryBackoff: 300_000
};

/**
 * Publishes one package to npm, in place of `@nx/js:release-publish`.
 *
 * The lockstep release publishes ~37 packages in one go, and npm rate-limits
 * an account's writes: run them as fast as Nx can schedule them and the
 * registry starts answering 429 partway through, leaving a tagged commit and
 * half a release. So every publish takes a turn through a workspace-wide slot
 * (`withPublishSlot`) that serialises them and leaves a gap in between, and a
 * publish the registry refuses for its own reasons is retried with backoff.
 *
 * Tuning without touching code, for a CI run that hits a stricter limit:
 *
 *     ORTHA_PUBLISH_DELAY=10000 ORTHA_PUBLISH_RETRIES=8 npm run release
 *
 * Every publish is preceded by a registry probe, which costs a `GET` — not a
 * metered write — and answers the two questions worth knowing first: whether
 * this version is already out (skip it, send nothing) and whether this would
 * *create* the package name. Creation is metered on its own, far tighter
 * schedule that no backoff outlasts, so it gets one attempt rather than a
 * twelve-minute retry ladder per package. See `docs/releasing.md`.
 *
 * Together those are what make `npm run release:publish` a cheap and safe way
 * to finish a release that died halfway.
 */
export default async function releasePublishExecutor(
    options: ReleasePublishExecutorOptions,
    context: ExecutorContext
): Promise<{ success: boolean }> {
    const projectName = context.projectName ?? '';
    const packageRoot = join(
        context.root,
        options.packageRoot ??
            context.projectsConfigurations.projects[projectName].root
    );

    const manifest = JSON.parse(
        readFileSync(join(packageRoot, 'package.json'), 'utf8')
    ) as { name: string; version: string; private?: boolean };

    const label = `${manifest.name}@${manifest.version}`;

    if (manifest.private) {
        console.warn(`Skipped ${label}, because it is marked private`);
        return { success: true };
    }

    // Nx tells us when a project was left at its current version; nothing to
    // publish for it, and asking npm would only earn another 403.
    if (options.nxReleaseVersionData?.[projectName]?.newVersion === null) {
        console.warn(`Skipped ${label}, because no new version was resolved`);
        return { success: true };
    }

    const dryRun = process.env.NX_DRY_RUN === 'true' || options.dryRun === true;
    const log = (message: string) =>
        console.log(`${manifest.name}: ${message}`);

    const stateDir = throttleStateDir(context.root);

    // Ask before telling. The probe is a `GET`, which npm does not meter the
    // way it meters writes, and its answer decides whether this publish is
    // needed at all and whether it is the kind npm rations.
    const state = dryRun
        ? 'unknown'
        : await probeRegistry({
              name: manifest.name,
              version: manifest.version,
              registry: options.registry,
              token: registryTokenFromEnv(process.env, options.registry)
          });

    if (state === 'version-published') {
        console.warn(
            `Skipped ${label}, because that version is already on the registry`
        );
        return { success: true };
    }

    const creatingName = state === 'name-absent';

    /**
     * Whether a peer has already proved npm is not creating names for this
     * account. Asked again from inside the slot rather than only up front:
     * every task reaches this point before the first publish has even been
     * attempted, so up front the answer is always "no".
     */
    const blockedByPeer = (): string | null => {
        if (!creatingName || dryRun) return null;

        const first = creationLimitTrippedBy(stateDir);

        return first && first !== manifest.name ? first : null;
    };

    const outcome = await withPublishSlot(
        {
            dir: stateDir,
            // A dry run writes nothing, so there is no limit to stay under —
            // rehearsing a release should not also rehearse the waiting. Nor
            // should a package that is about to bow out without a request.
            spacing: () =>
                dryRun || blockedByPeer()
                    ? 0
                    : numeric(
                          process.env.ORTHA_PUBLISH_DELAY,
                          options.delay,
                          DEFAULTS.delay
                      ),
            onWait: log
        },
        async (): Promise<PublishOutcome | BlockedByPeer> => {
            const blockedBy = blockedByPeer();

            if (blockedBy) return { status: 'blocked-by-peer', blockedBy };

            return publishWithRetry(
                {
                    cwd: context.root,
                    packageRoot,
                    registry: options.registry,
                    tag: options.tag,
                    otp: options.otp,
                    access: options.access,
                    dryRun
                },
                {
                    retries: numeric(
                        process.env.ORTHA_PUBLISH_RETRIES,
                        options.retries,
                        DEFAULTS.retries
                    ),
                    backoff: numeric(
                        process.env.ORTHA_PUBLISH_RETRY_BACKOFF,
                        options.retryBackoff,
                        DEFAULTS.retryBackoff
                    ),
                    maxBackoff: numeric(
                        undefined,
                        options.maxRetryBackoff,
                        DEFAULTS.maxRetryBackoff
                    ),
                    creatingName,
                    log
                }
            );
        }
    );

    switch (outcome.status) {
        case 'published':
            console.log(
                dryRun
                    ? `Would publish ${label} — [dry-run] was set`
                    : `Published ${label}`
            );
            if (context.isVerbose) console.log(outcome.output);
            return { success: true };

        case 'already-published':
            console.warn(
                `Skipped ${label}, because that version is already on the registry`
            );
            return { success: true };

        case 'creation-blocked':
            tripCreationLimit(stateDir, manifest.name);
            console.error(
                `Failed to publish ${label}:\n${creationLimitAdvice(manifest.name)}`
            );
            return { success: false };

        case 'blocked-by-peer':
            console.error(
                `Failed to publish ${label}:\n${creationLimitAdvice(manifest.name, outcome.blockedBy)}`
            );
            return { success: false };

        default:
            console.error(`Failed to publish ${label}:`);
            console.error(formatNpmError(outcome.output));
            return { success: false };
    }
}

/**
 * What the operator actually needs to know, because no amount of waiting or
 * re-running fixes this one.
 */
function creationLimitAdvice(packageName: string, blockedBy?: string): string {
    const preamble = blockedBy
        ? `  npm is not creating new package names for this account right now\n` +
          `  (${blockedBy} already hit the limit in this run).`
        : `  npm refused to create this package name (429), and that limit does\n` +
          `  not clear on a timescale a release can wait out.`;

    return (
        `${preamble}\n\n` +
        `  ${packageName} has never been published, so this publish would create\n` +
        `  the name — which npm rations per account, separately from version\n` +
        `  bumps on names that already exist. Those keep working; this does not.\n\n` +
        `  Nothing in the release can fix it. Either ask npm support to raise the\n` +
        `  new-package limit for this account, or create the remaining names by\n` +
        `  hand as the limit lets you, then finish the release with:\n\n` +
        `      npm run release:publish\n\n` +
        `  which now skips everything already on the registry without a write.`
    );
}

/** Env wins over the target's options, which win over the built-in default. */
function numeric(
    fromEnv: string | undefined,
    fromOptions: number | undefined,
    fallback: number
): number {
    const parsed = Number.parseInt(fromEnv ?? '', 10);

    if (Number.isFinite(parsed) && parsed >= 0) return parsed;

    return typeof fromOptions === 'number' ? fromOptions : fallback;
}
