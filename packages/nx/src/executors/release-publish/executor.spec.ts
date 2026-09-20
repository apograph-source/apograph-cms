import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutorContext } from '@nx/devkit';

const publishWithRetry = jest.fn();
const probeRegistry = jest.fn();

jest.mock('../../lib/release/publish', () => ({
    publishWithRetry: (...args: unknown[]) => publishWithRetry(...args),
    formatNpmError: (output: string) => output
}));
jest.mock('../../lib/release/registry', () => ({
    probeRegistry: (...args: unknown[]) => probeRegistry(...args),
    registryTokenFromEnv: () => 'token'
}));

import releasePublishExecutor from './executor';
import {
    creationLimitTrippedBy,
    throttleStateDir,
    tripCreationLimit
} from '../../lib/release/throttle';

let root: string;

/** Stages `dist/pack/<packageRoot>/package.json` under a throwaway root. */
function stage(manifest: Record<string, unknown>): string {
    const packageRoot = 'dist/pack/packages/media/server';
    mkdirSync(join(root, packageRoot), { recursive: true });
    writeFileSync(
        join(root, packageRoot, 'package.json'),
        JSON.stringify(manifest)
    );
    return packageRoot;
}

function context(): ExecutorContext {
    return {
        root,
        projectName: '@orthacms/media-server',
        isVerbose: false,
        projectsConfigurations: { projects: {} }
    } as unknown as ExecutorContext;
}

const manifest = { name: '@orthacms/media-server', version: '0.3.0' };

beforeEach(() => {
    jest.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), 'ortha-publish-'));
    delete process.env.ORTHA_PUBLISH_DELAY;
    delete process.env.ORTHA_PUBLISH_RETRIES;
    delete process.env.NX_DRY_RUN;
    probeRegistry.mockResolvedValue('name-exists');
    publishWithRetry.mockResolvedValue({ status: 'published', output: 'ok' });
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
});

describe('skipping without a write', () => {
    it('skips a private package', async () => {
        const packageRoot = stage({ ...manifest, private: true });

        await expect(
            releasePublishExecutor({ packageRoot }, context())
        ).resolves.toEqual({ success: true });
        expect(probeRegistry).not.toHaveBeenCalled();
        expect(publishWithRetry).not.toHaveBeenCalled();
    });

    it('skips a package Nx resolved no new version for', async () => {
        const packageRoot = stage(manifest);

        await releasePublishExecutor(
            {
                packageRoot,
                nxReleaseVersionData: {
                    '@orthacms/media-server': { newVersion: null }
                }
            },
            context()
        );

        expect(publishWithRetry).not.toHaveBeenCalled();
    });

    it('skips a version the probe says is already on the registry, sending nothing [nx:I-25]', async () => {
        probeRegistry.mockResolvedValue('version-published');
        const packageRoot = stage(manifest);

        await expect(
            releasePublishExecutor({ packageRoot }, context())
        ).resolves.toEqual({ success: true });
        expect(publishWithRetry).not.toHaveBeenCalled();
    });
});

describe('the probe’s answer reaches the retry policy', () => {
    it('marks a name-absent publish as a creation, which gets one attempt', async () => {
        probeRegistry.mockResolvedValue('name-absent');
        const packageRoot = stage(manifest);

        await releasePublishExecutor({ packageRoot }, context());

        expect(publishWithRetry.mock.calls[0][1]).toMatchObject({
            creatingName: true
        });
    });

    it('does not mark a version bump as a creation', async () => {
        const packageRoot = stage(manifest);

        await releasePublishExecutor({ packageRoot }, context());

        expect(publishWithRetry.mock.calls[0][1]).toMatchObject({
            creatingName: false
        });
    });

    it('publishes anyway when the probe could not answer [nx:I-24]', async () => {
        probeRegistry.mockResolvedValue('unknown');
        const packageRoot = stage(manifest);

        await releasePublishExecutor({ packageRoot }, context());

        expect(publishWithRetry).toHaveBeenCalled();
    });
});

describe('a dry run', () => {
    it('rehearses the publish without probing or waiting [nx:I-29]', async () => {
        const packageRoot = stage(manifest);

        await releasePublishExecutor({ packageRoot, dryRun: true }, context());

        expect(probeRegistry).not.toHaveBeenCalled();
        expect(publishWithRetry.mock.calls[0][0]).toMatchObject({
            dryRun: true
        });
    });

    it('is also enabled by NX_DRY_RUN', async () => {
        process.env.NX_DRY_RUN = 'true';
        const packageRoot = stage(manifest);

        await releasePublishExecutor({ packageRoot }, context());

        expect(publishWithRetry.mock.calls[0][0]).toMatchObject({
            dryRun: true
        });
    });
});

describe('the creation-limit breaker', () => {
    it('records the package that first hit the limit and fails [nx:I-27]', async () => {
        probeRegistry.mockResolvedValue('name-absent');
        publishWithRetry.mockResolvedValue({
            status: 'creation-blocked',
            output: ''
        });
        const packageRoot = stage(manifest);

        await expect(
            releasePublishExecutor({ packageRoot }, context())
        ).resolves.toEqual({ success: false });
        expect(creationLimitTrippedBy(throttleStateDir(root))).toBe(
            '@orthacms/media-server'
        );
    });

    it('makes a later new name bow out without spending a request [nx:I-27]', async () => {
        probeRegistry.mockResolvedValue('name-absent');
        tripCreationLimit(throttleStateDir(root), '@orthacms/other');
        const packageRoot = stage(manifest);

        await expect(
            releasePublishExecutor({ packageRoot }, context())
        ).resolves.toEqual({ success: false });
        expect(publishWithRetry).not.toHaveBeenCalled();
        expect((console.error as jest.Mock).mock.calls[0][0]).toContain(
            '@orthacms/other'
        );
    });

    it('leaves an existing name publishing normally while the breaker is open', async () => {
        tripCreationLimit(throttleStateDir(root), '@orthacms/other');
        const packageRoot = stage(manifest);

        await expect(
            releasePublishExecutor({ packageRoot }, context())
        ).resolves.toEqual({ success: true });
        expect(publishWithRetry).toHaveBeenCalled();
    });
});

describe('numeric precedence — env beats the target option beats the default', () => {
    async function retriesUsed(
        env: string | undefined,
        option: number | undefined
    ): Promise<number> {
        if (env === undefined) delete process.env.ORTHA_PUBLISH_RETRIES;
        else process.env.ORTHA_PUBLISH_RETRIES = env;

        const packageRoot = stage(manifest);
        await releasePublishExecutor(
            { packageRoot, retries: option },
            context()
        );

        return publishWithRetry.mock.calls[0][1].retries;
    }

    it('uses the built-in default when nothing is set', async () => {
        await expect(retriesUsed(undefined, undefined)).resolves.toBe(5);
    });

    it('uses the target option over the default', async () => {
        await expect(retriesUsed(undefined, 2)).resolves.toBe(2);
    });

    it('uses the environment over the target option [nx:I-30]', async () => {
        await expect(retriesUsed('8', 2)).resolves.toBe(8);
    });

    it('accepts 0 from the environment — it is finite and non-negative [nx:I-30]', async () => {
        await expect(retriesUsed('0', 2)).resolves.toBe(0);
    });

    it.each([
        ['a non-number', 'abc'],
        ['a negative', '-5']
    ])('ignores %s and falls back', async (_label, value) => {
        await expect(retriesUsed(value, 2)).resolves.toBe(2);
    });
});

describe('reporting', () => {
    it('reports an already-published race as success', async () => {
        publishWithRetry.mockResolvedValue({
            status: 'already-published',
            output: ''
        });
        const packageRoot = stage(manifest);

        await expect(
            releasePublishExecutor({ packageRoot }, context())
        ).resolves.toEqual({ success: true });
    });

    it('fails, naming the package and version, on anything else', async () => {
        publishWithRetry.mockResolvedValue({
            status: 'failed',
            output: 'npm error ENEEDAUTH'
        });
        const packageRoot = stage(manifest);

        await expect(
            releasePublishExecutor({ packageRoot }, context())
        ).resolves.toEqual({ success: false });
        expect((console.error as jest.Mock).mock.calls[0][0]).toContain(
            '@orthacms/media-server@0.3.0'
        );
    });
});
