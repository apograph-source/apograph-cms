import { createJiti } from 'jiti';
import { transformSync } from '@swc/core';

/**
 * jiti transform hook delegating to swc. Loading the host's `ortha.config.ts`
 * or its `buildPlugins` pulls in the plugin graph (NestJS modules, their
 * DTOs), which uses **legacy** decorators (`experimentalDecorators`). jiti's
 * bundled babel ignores our tsconfig and defaults to the stage-3 decorator
 * semantics, which give a decorated definite-assignment field
 * (`email!: string`) an initializer and then crash in `transform-typescript`.
 * swc with `legacyDecorator` matches the repo's actual TS config, so the same
 * source the app compiles loads here too.
 */
function swcTransform(opts: { source: string; filename?: string }): {
    code: string;
    error?: unknown;
} {
    try {
        const { code } = transformSync(opts.source, {
            filename: opts.filename ?? 'module.ts',
            configFile: false,
            swcrc: false,
            jsc: {
                target: 'es2022',
                parser: { syntax: 'typescript', decorators: true },
                transform: {
                    legacyDecorator: true,
                    decoratorMetadata: true
                }
            },
            module: { type: 'commonjs' }
        });
        return { code };
    } catch (error) {
        return { error, code: opts.source };
    }
}

/**
 * Builds a jiti instance that transpiles TypeScript with swc in legacy-decorator
 * mode. Shared by the executors that load the host's TypeScript config/plugin
 * modules at runtime (`db:migrate`, `db:studio`), so both interpret decorators
 * the same way the app's compiler does.
 */
export function createTsJiti(
    referenceFile: string
): ReturnType<typeof createJiti> {
    return createJiti(referenceFile, { transform: swcTransform });
}
