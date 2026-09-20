import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CreateNodesV2, TargetConfiguration } from '@nx/devkit';

/**
 * Infers database and release targets onto projects, the same way `@nx/js`
 * infers `typecheck` from a tsconfig:
 *
 * - a project with a `drizzle.config.ts` gets `db:generate`
 * - a project with an `ortha.config.ts` (the host) gets `db:migrate` and
 *   `db:studio`
 * - a package under `packages/` gets `build`, and a publishable one also
 *   gets `pack` plus an `nx-release-publish` pointed at what `pack` staged
 *
 * No per-project wiring — drop a config file and the target appears.
 *
 * ## Why `db:generate` is not cached
 *
 * It used to be, with `inputs: ['{projectRoot}/src/lib/schema/**\/*']` and
 * `outputs: ['{projectRoot}/migrations']`. Both halves were wrong, and the
 * combination lost work:
 *
 * 1. **The inputs could not be right.** Each project's schema location comes
 *    from *its own* `drizzle.config.ts` — `./src/content/index.ts` for the
 *    host, `./src/lib/infrastructure/schema/index.ts` for media,
 *    `./src/lib/*\/infrastructure/schema/index.ts` for copilot. Five of the
 *    eight configs in this workspace point outside `src/lib/schema/`, so the
 *    declared input matched **nothing** for them: editing the schema did not
 *    change the hash, and re-running `db:generate` with the same `--name`
 *    replayed a cached "No schema changes, nothing to migrate" — a green tick
 *    and no migration, which is precisely the schema/migration drift
 *    `.cursor/BUGBOT.md` warns about.
 * 2. **The output is also an input.** drizzle-kit diffs the schema against
 *    `migrations/meta/*_snapshot.json`, which lives inside the declared
 *    output directory. So the result is not a function of the declared inputs
 *    no matter how those inputs are written, and a cache *restore* replaces
 *    the whole `migrations/` directory — deleting migrations generated since
 *    the entry was written, journal and snapshot included.
 *
 * Deriving the inputs from each config would fix (1) but not (2), and would
 * mean importing eight TypeScript configs on every graph computation.
 * Generation takes about a second, is run by hand a few times a week, and is
 * run by nothing in CI, so the cache was buying nothing and risking the
 * working tree. `db:migrate` and `db:studio` are uncached for the ordinary
 * reason: they are side-effecting.
 */
export const createNodesV2: CreateNodesV2 = [
    '**/{drizzle.config.ts,ortha.config.ts,package.json}',
    async (configFiles, _, context) => {
        return configFiles.map((file) => {
            const projectRoot = dirname(file);

            if (file.endsWith('package.json')) {
                const targets = packageTargets(
                    projectRoot,
                    file,
                    context.workspaceRoot
                );
                return [
                    file,
                    targets ? { projects: { [projectRoot]: { targets } } } : {}
                ];
            }

            const isDrizzleConfig = file.endsWith('drizzle.config.ts');

            const targets: Record<string, TargetConfiguration> = isDrizzleConfig
                ? {
                      'db:generate': {
                          executor: '@orthacms/nx:db-generate',
                          options: {
                              cwd: projectRoot,
                              config: 'drizzle.config.ts'
                          },
                          // Deliberately uncached — see the note below.
                          cache: false
                      }
                  }
                : {
                      'db:migrate': {
                          executor: '@orthacms/nx:db-migrate',
                          options: {
                              config: file,
                              plugins: `${projectRoot}/src/plugins.ts`
                          },
                          cache: false
                      },
                      'db:studio': {
                          executor: '@orthacms/nx:db-studio',
                          options: {
                              config: file
                          },
                          cache: false
                      }
                  };

            return [file, { projects: { [projectRoot]: { targets } } }];
        });
    }
];

/**
 * Compile and release targets for one package under `packages/`.
 *
 * `@nx/js/typescript` infers `build` only for a project whose manifest
 * points at its **output**; ours point at `./src/index.ts`, because
 * workspace packages are consumed from source (AGENTS.md, "How packages
 * resolve"). That is the right trade for development and the wrong one for
 * npm, so the compile step is inferred here instead: `tsc --build` against
 * the package's `tsconfig.lib.json`, which emits JS and declarations into
 * `dist/` and builds its project references on the way.
 *
 * A publishable package gets two more targets. `pack` stages a publishable
 * package root under `dist/pack/` (see `tools/release/pack.mjs`), and
 * `nx-release-publish` is redirected at that directory rather than the
 * project root — the checked-in manifest is never what ships.
 *
 * Returns `undefined` for anything outside `packages/`; the apps build
 * through their own bundlers.
 */
function packageTargets(
    projectRoot: string,
    file: string,
    workspaceRoot: string
): Record<string, TargetConfiguration> | undefined {
    if (!projectRoot.startsWith('packages/')) return undefined;

    let manifest: { name?: string; private?: boolean };

    try {
        manifest = JSON.parse(readFileSync(join(workspaceRoot, file), 'utf8'));
    } catch {
        return undefined;
    }

    if (!manifest.name) return undefined;
    if (!existsSync(join(workspaceRoot, projectRoot, 'tsconfig.lib.json'))) {
        return undefined;
    }

    const targets: Record<string, TargetConfiguration> = {
        build: {
            executor: 'nx:run-commands',
            options: {
                command: 'tsc --build tsconfig.lib.json --pretty',
                cwd: projectRoot
            },
            dependsOn: ['^build'],
            cache: true,
            inputs: ['production', '^production'],
            outputs: ['{projectRoot}/dist']
        }
    };

    // This plugin is workspace tooling, not a distributable.
    if (manifest.private) return targets;

    return {
        ...targets,
        pack: {
            executor: 'nx:run-commands',
            options: {
                command: `node tools/release/pack.mjs ${projectRoot}`
            },
            dependsOn: ['build'],
            // Cheap, and it reads `dist` — which is not one of its declared
            // inputs — so a cache hit would happily restore a stale tarball.
            cache: false,
            outputs: [`{workspaceRoot}/dist/pack/${projectRoot}`]
        },
        // Ours rather than `@nx/js:release-publish`, because npm rate-limits
        // an account's writes and this workspace publishes ~37 packages in one
        // release — see the executor.
        //
        // The executor is named **twice**: here, and in `nx.json`'s
        // `targetDefaults`. Nx adds an implicit `nx-release-publish` of its own
        // to every non-private package and applies it after inference, so the
        // two definitions have to agree on the executor — when they disagree,
        // Nx's wins outright and takes `packageRoot` with it, and the release
        // silently publishes the source-pointing project root instead of what
        // `pack` staged. `dependsOn` is absent for the same reason: Nx would
        // overwrite it, so it lives in `targetDefaults` alone.
        'nx-release-publish': {
            executor: '@orthacms/nx:release-publish',
            options: { packageRoot: `dist/pack/${projectRoot}` }
        }
    };
}
