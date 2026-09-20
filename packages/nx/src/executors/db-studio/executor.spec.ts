import type { ExecutorContext } from '@nx/devkit';

const runDrizzleKitStudio = jest.fn();
const jitiImport = jest.fn();

jest.mock('@orthacms/cli', () => ({
    runDrizzleKitStudio: (...args: unknown[]) => runDrizzleKitStudio(...args)
}));
jest.mock('../../lib/jiti', () => ({
    createTsJiti: () => ({ import: (path: string) => jitiImport(path) })
}));

import dbStudioExecutor from './executor';

const options = { config: 'apps/server/ortha.config.ts' };
const context = { root: '/repo' } as ExecutorContext;
const URL = 'postgresql://ortha:secret@localhost:5432/ortha_cms';

function hostConfig(url: string | undefined) {
    jitiImport.mockResolvedValue({
        default: { database: url === undefined ? {} : { url } }
    });
}

beforeEach(() => jest.clearAllMocks());

describe('db-studio executor', () => {
    it('resolves the URL from the host config — the one place that reads DATABASE_URL [nx:I-32] [nx:I-33]', async () => {
        hostConfig(URL);

        await expect(dbStudioExecutor(options, context)).resolves.toEqual({
            success: true
        });
        expect(jitiImport).toHaveBeenCalledWith(
            '/repo/apps/server/ortha.config.ts'
        );
        expect(runDrizzleKitStudio).toHaveBeenCalledWith(URL, {
            host: undefined,
            port: undefined
        });
    });

    it('forwards host and port', async () => {
        hostConfig(URL);

        await dbStudioExecutor(
            { ...options, host: '0.0.0.0', port: 4990 },
            context
        );

        expect(runDrizzleKitStudio).toHaveBeenCalledWith(URL, {
            host: '0.0.0.0',
            port: 4990
        });
    });

    it.each([
        ['empty', ''],
        ['absent', undefined]
    ])(
        // covers: nx:I-06
        'refuses with one actionable sentence when the URL is %s',
        async (_l, url) => {
            hostConfig(url);

            await expect(dbStudioExecutor(options, context)).rejects.toThrow(
                /DATABASE_URL is not set — Drizzle Studio needs a live database/
            );
            expect(runDrizzleKitStudio).not.toHaveBeenCalled();
        }
    );

    /**
     * drizzle-kit does bind an ephemeral port for `--port=0`, but it prints the
     * port it was asked for, so Studio ends up somewhere nothing reports.
     * Refusing beats the silent drop this used to do (`if (options.port)`) and
     * beats the unusable success drizzle-kit would give.
     */
    it('refuses port 0 rather than silently ignoring it [nx:I-12]', async () => {
        hostConfig(URL);

        await expect(
            dbStudioExecutor({ ...options, port: 0 }, context)
        ).rejects.toThrow(/port 0 is not supported/);
        expect(runDrizzleKitStudio).not.toHaveBeenCalled();
    });
});
