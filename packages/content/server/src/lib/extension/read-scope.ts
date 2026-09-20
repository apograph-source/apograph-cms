/**
 * The **read scope port** — the seam a downstream plugin uses to narrow what
 * the public content API returns, without this package knowing why.
 *
 * Content-server declares the port and consults it from `PublicEntriesQuery`
 * and `PublicExpansionQuery`; an implementing plugin
 * (`@orthacms/segments-server`, for reader entitlements) registers a scope
 * through {@link contentReadScopeRegistrar}. Every fragment returned is AND-ed
 * onto the visibility predicate the public read already states, so a scope can
 * only ever *subtract* rows — there is no shape of return value that widens a
 * read.
 *
 * ## Why a registry rather than a DI token
 *
 * The port takes any number of independent narrowings, and Nest has **no
 * multi-provider**: two dynamic modules binding the same token do not merge,
 * the second silently replaces the first. A second scoping plugin would
 * therefore switch the first one off, with nothing to notice it — which for a
 * visibility rule means content quietly becoming visible. So registration is a
 * runtime `register(...)` call against a registry this module owns, the same
 * shape and the same reason as `copilotToolsRegistrar`.
 *
 * ## Why not `CONTENT_ENTRY_EXTENSION`
 *
 * That port is documented as a **single binding**: one provider per app, and
 * i18n already holds it. Its own note suggests binding a composite when a
 * second extension appears, and for a write-pipeline extension that composes
 * cleanly — but "narrow a read" and "extend a write" are different
 * responsibilities with different failure modes. A composite would fuse i18n
 * and entitlements into one provider, where a fault in either silently drops
 * the other's clause.
 *
 * ## Two constraints on an implementation
 *
 * **Synchronous.** The predicate is assembled inside the query builder, and
 * making that path async would ripple through every public read for the benefit
 * of one provider. A scope that needs I/O — resolving who the caller is, say —
 * must do it earlier in the request (a guard, an interceptor, middleware) and
 * read the result from its own request-scoped state here.
 *
 * **Public reads only.** These fragments are not applied to the admin's own
 * entries list. An admin caller is a member of the workspace looking at their
 * own CMS, while a reader entitlement is about who may *consume* published
 * content, and scoping the editor's list by it would hide from an author the
 * very rows they are responsible for. The same split content grants already
 * make.
 */

import {
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type Provider,
    type Type
} from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import type { AnyContentType } from '../types/content-type';

/** What a scope is told about the read it is narrowing. */
export interface ContentReadScopeContext {
    /** The content type being read. Its table is `type.table`. */
    readonly type: AnyContentType;
    /**
     * The workspace the request resolved to. Every emitted fragment MUST stay
     * inside it — a subquery that forgets the workspace turns one tenant's
     * scope into a cross-tenant read.
     */
    readonly workspaceId: string;
}

/**
 * One contributed narrowing of the public read.
 *
 * Returning `undefined` means "nothing to add for this read", which is how an
 * implementation opts out per type, per workspace, or entirely — a plugin that
 * is installed but unconfigured must return `undefined` rather than a fragment
 * matching everything, so an unconfigured install pays nothing at all.
 */
export interface ContentReadScope {
    /** A predicate AND-ed onto the public visibility rule. */
    scope(context: ContentReadScopeContext): SQL | undefined;
}

/**
 * Every registered narrowing, in registration order.
 *
 * Order does not affect the result — the fragments are AND-ed — but it is kept
 * stable so a query log reads the same way twice.
 */
@Injectable()
export class ContentReadScopeRegistry {
    private readonly scopes: ContentReadScope[] = [];

    /** Adds a scope. Registering the same instance twice is a no-op. */
    register(scope: ContentReadScope): void {
        if (!this.scopes.includes(scope)) {
            this.scopes.push(scope);
        }
    }

    /** Every registered scope. Empty on an installation with none. */
    all(): readonly ContentReadScope[] {
        return this.scopes;
    }

    /**
     * The fragments for one read, ready to be spread into `and(...)`.
     *
     * Returns an empty array — not a fragment matching everything — when
     * nothing is registered, which is the state every installation without a
     * scoping plugin stays in.
     */
    fragments(context: ContentReadScopeContext): (SQL | undefined)[] {
        if (!this.scopes.length) {
            return [];
        }
        return this.scopes.map((scope) => scope.scope(context));
    }
}

/** Registers a plugin's read scopes with content at bootstrap. */
class ReadScopeBootstrapper implements OnApplicationBootstrap {
    private readonly logger = new Logger(ReadScopeBootstrapper.name);

    constructor(
        private readonly label: string,
        private readonly registry: ContentReadScopeRegistry | null,
        private readonly scopes: readonly ContentReadScope[]
    ) {}

    onApplicationBootstrap(): void {
        // A deployment that does not register `ContentPlugin` is not a real
        // configuration, but a binding plugin should still boot rather than
        // fail on an injection it cannot influence.
        if (!this.registry) {
            return;
        }
        for (const scope of this.scopes) {
            this.registry.register(scope);
        }
        this.logger.log(
            `Registered the ${this.label} read scope with the content API.`
        );
    }
}

/**
 * Builds the DI provider that registers `scopes` with content's read-scope
 * registry at bootstrap.
 *
 * A factory with an explicit `inject` list rather than a class with reflected
 * parameters, for the reason `copilotToolsRegistrar` documents: an optional
 * dependency typed as `Foo | null` emits `Object` for `design:paramtypes`, Nest
 * injects `undefined` with no error, and the plugin ends up registering
 * nothing. Here that failure would mean a visibility rule that silently stopped
 * being applied.
 */
export function contentReadScopeRegistrar(
    label: string,
    ...scopes: Type<ContentReadScope>[]
): Provider {
    return {
        provide: `CONTENT_READ_SCOPE_REGISTRAR_${label.toUpperCase()}`,
        useFactory: (
            registry: ContentReadScopeRegistry | null,
            ...resolved: ContentReadScope[]
        ) => new ReadScopeBootstrapper(label, registry, resolved),
        inject: [{ token: ContentReadScopeRegistry, optional: true }, ...scopes]
    };
}
