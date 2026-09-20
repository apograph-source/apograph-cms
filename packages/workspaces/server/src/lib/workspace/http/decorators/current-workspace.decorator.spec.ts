import 'reflect-metadata';
import {
    InternalServerErrorException,
    type ExecutionContext
} from '@nestjs/common';
import type { AuthenticatedRequest } from '@orthacms/identity-server';
import { CurrentWorkspace } from './current-workspace.decorator';

/** Nest's own metadata key for a handler's param decorators. */
const ROUTE_ARGS_METADATA = '__routeArguments__';

/**
 * The factory `createParamDecorator` hid behind the decorator. Applying the
 * decorator to a throwaway handler and reading it back out of Nest's own
 * metadata is the only way to reach it — and it means this test exercises the
 * exact function the request pipeline calls.
 */
function factoryOf(
    decorator: () => ParameterDecorator
): (data: unknown, context: ExecutionContext) => string {
    class Probe {
        handle(@decorator() workspaceId: string): void {
            // Never called — only the metadata the decorator wrote is read.
            void workspaceId;
        }
    }
    const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        Probe,
        'handle'
    ) as Record<
        string,
        { factory: (data: unknown, ctx: ExecutionContext) => string }
    >;
    return args[Object.keys(args)[0]].factory;
}

/** A context over a request carrying (or not carrying) a resolved workspace. */
function contextFor(workspaceId?: string): ExecutionContext {
    const request = { workspaceId } as unknown as AuthenticatedRequest;
    return {
        switchToHttp: () => ({ getRequest: () => request })
    } as ExecutionContext;
}

/**
 * `@CurrentWorkspace()` is only ever correct downstream of `WorkspaceGuard`,
 * which is what validated the id and checked the caller's membership against
 * it. The failure this guards is not a wrong answer but a *missing* one: a
 * handler that received `undefined` and passed it on as the scope of its query
 * would run that query unscoped across every tenant. Throwing is the whole
 * design — the decorator's declared return type is `string`, so anything it
 * hands back is trusted to be one.
 */
describe('@CurrentWorkspace()', () => {
    const factory = factoryOf(CurrentWorkspace as () => ParameterDecorator);

    it('returns the id the guard stamped on the request', () => {
        const id = '11111111-1111-4111-8111-111111111111';

        expect(factory(undefined, contextFor(id))).toBe(id);
    });

    it('throws when the route carries no WorkspaceGuard', () => {
        expect(() => factory(undefined, contextFor(undefined))).toThrow(
            InternalServerErrorException
        );
    });

    it('throws on an empty id rather than passing it through [workspaces:I-06]', () => {
        // An empty string is falsy but very much a value: handed to a `where`
        // clause it matches nothing rather than everything, which reads as an
        // empty workspace instead of a wiring bug.
        expect(() => factory(undefined, contextFor(''))).toThrow(
            InternalServerErrorException
        );
    });

    it('names the missing guard, so the 500 is diagnosable', () => {
        expect(() => factory(undefined, contextFor(undefined))).toThrow(
            '@CurrentWorkspace() used on a route without WorkspaceGuard.'
        );
    });

    it.each([[undefined], ['']])(
        'never returns undefined for %p',
        (workspaceId) => {
            let returned: unknown = 'untouched';
            try {
                returned = factory(undefined, contextFor(workspaceId));
            } catch {
                // expected — the assertion below is that nothing was returned
            }
            expect(returned).toBe('untouched');
        }
    );
});
