import type { ExecutorContext } from '@nx/devkit';

const applyPluginMigrations = jest.fn();
const jitiImport = jest.fn();

jest.mock('@orthacms/cli', () => ({
    applyPluginMigrations: (...args: unknown[]) =>
        applyPluginMigrations(...args)
}));
jest.mock('../../lib/jiti', () => ({
    createTsJiti: () => ({ import: (path: string) => jitiImport(path) })
}));

import dbMigrateExecutor from './executor';

const options = {
    config: 'apps/server/ortha.config.ts',
    plugins: 'apps/server/src/plugins.ts'
};
const context = { root: '/repo' } as ExecutorContext;
const buildPlugins = jest.fn(() => ['a-plugin']);

/** Wires jiti to answer with a host config carrying `url`. */
function hostConfig(url: string | undefined) {
    jitiImport.mockImplementation(async (path: string) =>
        path.endsWith('ortha.config.ts')
            ? { default: { database: url === undefined ? {} : { url } } }
            : { buildPlugins }
    );
}

beforeEach(() => jest.clearAllMocks());

describe('db-migrate executor', () => {
    it('loads the host config and its plugin factory from the workspace root [nx:I-33]', async () => {
        hostConfig('postgresql://localhost/ortha_cms');

        await dbMigrateExecutor(options, context);

        expect(jitiImport).toHaveBeenCalledWith(
            '/repo/apps/server/ortha.config.ts'
        );
        expect(jitiImport).toHaveBeenCalledWith(
            '/repo/apps/server/src/plugins.ts'
        );
    });

    it('applies the plugins the host built, against the configured URL [cli:I-01] [nx:I-32]', async () => {
        hostConfig('postgresql://localhost/ortha_cms');

        await expect(dbMigrateExecutor(options, context)).resolves.toEqual({
            success: true
        });
        expect(applyPluginMigrations).toHaveBeenCalledWith(
            ['a-plugin'],
            'postgresql://localhost/ortha_cms'
        );
    });

    /**
     * Regression: an unset `DATABASE_URL` resolves to `''` in `ortha.config.ts`,
     * and `new Pool({ connectionString: '' })` falls through to libpq's
     * environment defaults. Measured before this guard: with `DATABASE_URL`
     * unset and `PGDATABASE` pointing elsewhere, `db:migrate` reported
     * "Migrations complete." after creating every table in a database nobody
     * named. `db:studio` has always refused; this is the same refusal.
     */
    describe('when no database URL resolves', () => {
        it.each([
            ['empty', ''],
            ['absent', undefined]
        ])('refuses with an actionable message (%s)', async (_label, url) => {
            hostConfig(url);

            await expect(dbMigrateExecutor(options, context)).rejects.toThrow(
                /DATABASE_URL is not set/
            );
        });

        it('says it will not fall back to the local defaults [nx:I-06]', async () => {
            hostConfig('');

            await expect(dbMigrateExecutor(options, context)).rejects.toThrow(
                /will not fall back to the local defaults/
            );
        });

        it('opens nothing and applies nothing [nx:I-07]', async () => {
            hostConfig('');

            await dbMigrateExecutor(options, context).catch(() => undefined);

            expect(applyPluginMigrations).not.toHaveBeenCalled();
        });

        it('refuses before building the plugin list [nx:I-07]', async () => {
            hostConfig('');

            await dbMigrateExecutor(options, context).catch(() => undefined);

            expect(buildPlugins).not.toHaveBeenCalled();
        });
    });
});
