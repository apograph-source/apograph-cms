/**
 * The **publish guard port** — the seam a downstream plugin uses to refuse a
 * publish, without this package knowing why.
 *
 * Content-server declares the port and consults it from the publish use-cases;
 * an implementing plugin (`@orthacms/protection-server`, for approval rules)
 * registers a guard through {@link contentPublishGuardRegistrar}. Every
 * registered guard must allow the publish for it to proceed — a refusal from
 * any one of them refuses.
 *
 * ## Where it sits in the publish path
 *
 * Third, and last:
 *
 * 1. `content:publish` — the `PermissionsGuard` on the route (403; the admin
 *    never rendered the button).
 * 2. The **publish gate** — required field values and required relations, which
 *    `Entry.publish` enforces (422, with the failing checks).
 * 3. **This port** (409 by default, and whatever else a guard asks for).
 *
 * The order is load-bearing and the bypass in {@link ContentPublishGuardContext}
 * passes **only the third**: an entry that fails the publish gate stays
 * unpublishable for an administrator too, because "is this entry complete" has
 * exactly one owner and it is not this port.
 *
 * ## Why a registry rather than a DI token
 *
 * The same reason `contentReadScopeRegistrar` documents: Nest has **no
 * multi-provider**, so two dynamic modules binding one token do not merge — the
 * second silently replaces the first. For a read scope that means content
 * quietly becoming visible; here it would mean a publish rule quietly switched
 * off, which is worse, because the installation that bought the rule is the one
 * that would never notice. So registration is a runtime `register(...)` call
 * against a registry this module owns.
 *
 * ## Two constraints on an implementation
 *
 * **It runs inside the publish transaction.** A guard reads whatever it needs
 * through the ambient unit of work, and the events it returns are appended to
 * the outbox with the status write, so a refusal leaves nothing behind and an
 * allowed bypass cannot lose its audit row.
 *
 * **It authorizes; it does not validate.** A guard that inspected field values
 * would be a second opinion on the question the publish gate already answers,
 * and the two would diverge (ADR-0015). Refuse on *who is asking* and *what
 * they have arranged*, never on what the entry contains.
 */

import {
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type Provider,
    type Type
} from '@nestjs/common';
import type { DomainEvent } from '@orthacms/database';
import type { AnyContentType } from '../types/content-type';

/**
 * Who is asking to publish, as much as content can say about them.
 *
 * Deliberately not a role or a permission set: content does not know which
 * permission a guard cares about, and a guard that needs one resolves it
 * itself. `userId` is `null` exactly when the caller is a bearer token, which
 * is the distinction every guard so far has actually needed.
 */
export interface PublishActor {
    /** The acting user, or `null` for a bearer token. */
    readonly userId: string | null;
    /** Whether the caller authenticated with an API token rather than a session. */
    readonly isToken: boolean;
}

/** What a guard is told about the publish it may refuse. */
export interface ContentPublishGuardContext {
    /** The content type being published. */
    readonly type: AnyContentType;
    /** The live row's id. On a localized type this is one locale's row. */
    readonly entryId: string;
    /**
     * The workspace the request resolved to. A guard's every read MUST stay
     * inside it — one that forgets turns a rule lookup into a cross-tenant read.
     */
    readonly workspaceId: string;
    readonly actor: PublishActor;
    /**
     * Whether the caller explicitly asked to publish past a guard that would
     * refuse. Content does not interpret it: whether a bypass exists at all
     * and who may take one are the guard's rules.
     */
    readonly bypass?: boolean;
}

/** The publish may proceed. */
export interface PublishAllowed {
    readonly allowed: true;
    /**
     * Events the guard wants committed **with** the publish — an allowed bypass
     * recording that it happened, typically.
     *
     * Returned rather than written by the guard so they land in the same
     * transaction and the same outbox append as the status change: a bypass
     * whose audit row could be lost separately from the publish it excused is
     * not an audit row. The acting principal is merged in by the use-case,
     * which is the layer that knows it.
     */
    readonly events?: readonly DomainEvent[];
}

/** The publish is refused, and why, in terms the caller can act on. */
export interface PublishRefused {
    readonly allowed: false;
    /**
     * The HTTP status this refusal maps to. **409 unless the guard says
     * otherwise** — a refusal is a conflict with the state of the world, not an
     * authorization failure, and `403` here would be indistinguishable from
     * lacking `content:publish`. The caller has to be able to tell "ask an
     * administrator for the permission" from "ask a colleague for an approval".
     *
     * The other two exist for the bypass: `403` for a caller who may not take
     * one, `400` for a reason that is not usable.
     */
    readonly status: 400 | 403 | 409;
    /** A stable machine code, namespaced by the guard (`protection.…`). */
    readonly code: string;
    /** A human sentence, safe to show. */
    readonly message: string;
    /** Whatever the caller needs to act — counts, a rule's terms. */
    readonly details?: Readonly<Record<string, unknown>>;
}

/** A guard's answer. */
export type PublishVerdict = PublishAllowed | PublishRefused;

/** One contributed refusal point on the publish path. */
export interface ContentPublishGuard {
    /**
     * Decides one publish. Runs inside the publish transaction, so a read here
     * sees the row about to change and a refusal rolls the whole thing back.
     */
    check(context: ContentPublishGuardContext): Promise<PublishVerdict>;
}

/** The verdict an installation with no guards gets, allocated once. */
const ALLOWED: PublishAllowed = { allowed: true };

/**
 * Every registered guard, in registration order.
 *
 * Order does not change the outcome — a refusal from any guard refuses — but it
 * decides *which* refusal a caller sees when two would refuse, so it is kept
 * stable rather than incidental.
 */
@Injectable()
export class ContentPublishGuardRegistry {
    private readonly guards: ContentPublishGuard[] = [];

    /** Adds a guard. Registering the same instance twice is a no-op. */
    register(guard: ContentPublishGuard): void {
        if (!this.guards.includes(guard)) {
            this.guards.push(guard);
        }
    }

    /** Every registered guard. Empty on an installation with none. */
    all(): readonly ContentPublishGuard[] {
        return this.guards;
    }

    /**
     * The verdict for one publish: the first refusal, or an allowance carrying
     * whatever events the guards asked to have committed.
     *
     * **With nothing registered this returns without awaiting anything.** That
     * is the whole of invariant I-01: a host that never installs a guarding
     * plugin runs the publish path it ran before this port existed, with no
     * extra round trip and no behavioural difference to find.
     */
    async check(context: ContentPublishGuardContext): Promise<PublishVerdict> {
        if (!this.guards.length) return ALLOWED;

        const events: DomainEvent[] = [];
        for (const guard of this.guards) {
            const verdict = await guard.check(context);
            if (!verdict.allowed) return verdict;
            if (verdict.events?.length) events.push(...verdict.events);
        }
        return events.length ? { allowed: true, events } : ALLOWED;
    }
}

/** Registers a plugin's publish guards with content at bootstrap. */
class PublishGuardBootstrapper implements OnApplicationBootstrap {
    private readonly logger = new Logger(PublishGuardBootstrapper.name);

    constructor(
        private readonly label: string,
        private readonly registry: ContentPublishGuardRegistry | null,
        private readonly guards: readonly ContentPublishGuard[]
    ) {}

    onApplicationBootstrap(): void {
        // A deployment that does not register `ContentPlugin` is not a real
        // configuration, but a binding plugin should still boot rather than
        // fail on an injection it cannot influence.
        if (!this.registry) return;
        for (const guard of this.guards) {
            this.registry.register(guard);
        }
        this.logger.log(
            `Registered the ${this.label} publish guard with the content API.`
        );
    }
}

/**
 * Builds the DI provider that registers `guards` with content's publish-guard
 * registry at bootstrap.
 *
 * A factory with an explicit `inject` list rather than a class with reflected
 * parameters, for the reason `contentReadScopeRegistrar` documents: an optional
 * dependency typed `Foo | null` emits `Object` for `design:paramtypes`, Nest
 * injects `undefined` with no error, and the plugin registers nothing. Here
 * that failure is a publish rule that silently stopped applying — the one
 * failure mode this whole feature exists to prevent, arriving as a success.
 */
export function contentPublishGuardRegistrar(
    label: string,
    ...guards: Type<ContentPublishGuard>[]
): Provider {
    return {
        provide: `CONTENT_PUBLISH_GUARD_REGISTRAR_${label.toUpperCase()}`,
        useFactory: (
            registry: ContentPublishGuardRegistry | null,
            ...resolved: ContentPublishGuard[]
        ) => new PublishGuardBootstrapper(label, registry, resolved),
        inject: [
            { token: ContentPublishGuardRegistry, optional: true },
            ...guards
        ]
    };
}
