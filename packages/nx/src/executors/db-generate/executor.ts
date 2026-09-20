import { join } from 'node:path';
import type { ExecutorContext } from '@nx/devkit';
import { runDrizzleKitGenerate } from '@orthacms/cli';

/** Options for the `db-generate` executor. */
export interface DbGenerateExecutorOptions {
    /** Plugin project root (the drizzle-kit working directory). */
    cwd: string;
    /** Path to the drizzle config, relative to `cwd`. */
    config: string;
    /** Optional name for the generated migration. */
    name?: string;
}

/**
 * Generates Drizzle migrations for a single plugin by invoking drizzle-kit
 * against the plugin's static config. Cacheable — inputs are the schema
 * files, output is the plugin's migrations directory.
 */
export default async function dbGenerateExecutor(
    options: DbGenerateExecutorOptions,
    context: ExecutorContext
): Promise<{ success: boolean }> {
    const cwd = join(context.root, options.cwd);
    runDrizzleKitGenerate(cwd, options.config, options.name);
    return { success: true };
}
