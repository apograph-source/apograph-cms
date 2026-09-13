// The parameters are declared even though the body ignores them: without them
// the mock's call tuple is empty, so the spread below does not type and
// `mock.calls[0][0]` is an error rather than the path under test.
const createJiti = jest.fn((..._args: unknown[]) => ({ import: jest.fn() }));

jest.mock('jiti', () => ({
    createJiti: (...args: unknown[]) => createJiti(...args)
}));

import { createTsJiti } from './jiti';

/** The transform hook `createTsJiti` handed jiti, pulled back out of the mock. */
function capturedTransform(): (opts: { source: string; filename?: string }) => {
    code: string;
    error?: unknown;
} {
    createTsJiti('/repo/packages/nx/src/executors/db-migrate/executor.ts');

    const [, options] = createJiti.mock.calls[0] as unknown as [
        string,
        {
            transform: (opts: { source: string; filename?: string }) => {
                code: string;
                error?: unknown;
            };
        }
    ];
    return options.transform;
}

/**
 * A DTO the way the plugin graph actually writes them: a decorated field with
 * a definite-assignment assertion. This exact shape is what broke the host
 * config loader before the transform was swapped in — jiti's bundled babel
 * ignores our tsconfig, reads the decorator as stage-3, gives `email!: string`
 * an initializer on that reading, and then crashes in `transform-typescript`.
 */
const DECORATED_DTO = `
import { IsEmail } from 'class-validator';

export class CreateUserDto {
    @IsEmail()
    email!: string;
}
`;

beforeEach(() => jest.clearAllMocks());

describe('createTsJiti', () => {
    it('anchors jiti at the file that asked for it', () => {
        createTsJiti('/repo/packages/nx/src/executors/db-studio/executor.ts');

        expect(createJiti.mock.calls[0][0]).toBe(
            '/repo/packages/nx/src/executors/db-studio/executor.ts'
        );
    });

    it('compiles a decorated definite-assignment field instead of crashing [nx:I-33]', () => {
        // The regression itself. Nothing is mocked below this line — swc really
        // runs — so this fails if `legacyDecorator` stops matching the repo's
        // `experimentalDecorators`.
        const { code, error } = capturedTransform()({
            source: DECORATED_DTO,
            filename: 'create-user.dto.ts'
        });

        expect(error).toBeUndefined();
        expect(code).toContain('CreateUserDto');
    });

    it('emits the legacy decorator helper, not a stage-3 field initializer [nx:I-33]', () => {
        // The check above would also pass under stage-3 semantics on a source
        // swc happened to survive. This one reads which semantics were applied:
        // legacy decorators compile to a `_ts_decorate`/`__decorate` call, and
        // `decoratorMetadata` adds the `design:type` reflection Nest's DI and
        // class-validator both read. Turning either option off changes this.
        const { code } = capturedTransform()({
            source: DECORATED_DTO,
            filename: 'create-user.dto.ts'
        });

        expect(code).toMatch(/_?_ts_decorate|__decorate/);
        expect(code).toMatch(/design:type/);
    });

    it('emits CommonJS, because the executors that load it are CommonJS [nx:I-34]', () => {
        // `db:migrate` and `db:studio` are `require`d by Nx out of this
        // package's CJS build; a transform emitting ESM would hand them a
        // module they cannot interoperate with.
        const { code } = capturedTransform()({
            source: `export const answer = 42;`,
            filename: 'answer.ts'
        });

        expect(code).toContain('exports');
        expect(code).not.toMatch(/^export /m);
    });

    it('reports a transform failure as an error rather than throwing [nx:I-33]', () => {
        // jiti's hook contract: it wants `{ code, error }`, and a throw from
        // here escapes as an unhandled failure in whichever executor was
        // loading the host's config.
        const result = capturedTransform()({
            source: 'export class {{{ broken',
            filename: 'broken.ts'
        });

        expect(result.error).toBeDefined();
        expect(result.code).toContain('broken');
    });
});
