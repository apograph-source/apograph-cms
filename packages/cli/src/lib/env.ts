import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Loads the app's `.env` into `process.env`.
 *
 * Nothing else does this. In the monorepo, Nx loads `.env` before a target
 * runs, so `ortha.config.ts` can simply read `process.env` — but a generated
 * app has no task runner, and without this every command that needs config
 * fails on a `DATABASE_URL` that is sitting right there in the file.
 *
 * `process.loadEnvFile` does **not** overwrite variables already exported in
 * the shell, which is the precedence a deployment needs: real environments set
 * their configuration in the environment, and a `.env` accidentally shipped in
 * an image must not win over it.
 *
 * Called once, at startup, so the values are inherited by the `node` and
 * `vite` processes the commands spawn.
 */
export function loadEnv(root: string): void {
    const envFile = join(root, '.env');

    // Absent is normal: a deployment sets real environment variables and never
    // writes this file, so it is not something to warn about.
    if (!existsSync(envFile)) return;

    if (typeof process.loadEnvFile !== 'function') {
        throw new Error(
            'Reading .env needs Node 20.12 or newer (process.loadEnvFile). ' +
                `You are on ${process.version}.`
        );
    }

    process.loadEnvFile(envFile);
}
