/**
 * The **entry-write extension port** — how a downstream plugin stores state of
 * its own *about* an entry, inside the entry's own write transaction and inside
 * the entry's own version history.
 *
 * Content-server declares the port, calls it from `EntryWriterService`, and
 * records what it returns in the revision snapshot's `extra` bag;
 * `@orthacms/segments-server` binds one for reader entitlements, so who may read
 * a record is set on Save, committed with the record, captured by the version,
 * and put back when a version is restored.
 *
 * ## Why not a second HTTP call
 *
 * Nothing forced this port on us — segments already had a `PUT` of its own, and
 * the admin could call it after saving. Three properties are what it buys, none
 * of which a second request has:
 *
 * - **One transaction.** The entry, its links, its audiences and the version
 *   recording all three commit together or not at all. Two requests can land
 *   half a change: an entry saved and its restriction not applied.
 * - **A truthful version.** A revision is built *inside* the write, so a
 *   separate later request could only ever be captured by the **next** save —
 *   the version would record the access the entry used to have.
 * - **A restorable one.** Restoring version 3 re-applies its snapshot through
 *   the same writer, so the extension's own state travels with it. Without that,
 *   "go back to Tuesday" would put Tuesday's words in front of today's readers.
 *
 * ## Why a registry rather than a DI token
 *
 * Nest has **no multi-provider**: two dynamic modules binding one token do not
 * merge, the second silently replaces the first. For this port the loss would be
 * silent in the worst way — an extension that stopped being called writes
 * nothing and captures nothing, so a restriction quietly stops applying. So a
 * plugin registers through {@link entryWriteExtensionRegistrar}, the same shape
 * and the same reason as `contentReadScopeRegistrar` and `copilotToolsRegistrar`.
 *
 * ## Why not `CONTENT_ENTRY_EXTENSION`
 *
 * That port is a documented **single binding** and i18n holds it. It also
 * answers a different question: it extends how *this package's own* row is
 * written (envelope columns, sibling sync). This one is about state a
 * **different plugin** owns, in a table content-server knows nothing about, and
 * the two must be able to coexist — an i18n installation with segments enabled
 * is the ordinary case, not a conflict.
 *
 * ## Two rules an implementation must keep
 *
 * **Use the executor you are handed, never a connection of your own.** It is the
 * save's transaction; a write on any other connection commits separately and
 * takes the atomicity above with it.
 *
 * **`capture` is called for every snapshot, `apply` only when asked.** A save
 * that carried nothing for an extension must leave that extension's state alone
 * — but its *version* still has to record what the state was, or restoring that
 * version would read as "this had no audiences" and open the entry up.
 */

import {
    Injectable,
    Logger,
    type OnApplicationBootstrap,
    type Provider,
    type Type
} from '@nestjs/common';
import type { DbTransaction } from '../entries/infrastructure/persistence/relation-link.service';
import type { AnyContentType } from '../types/content-type';

/** The entry an extension is reading or writing state for. */
export interface EntryWriteExtensionTarget {
    /**
     * The save's own transaction. Every read and write an extension makes MUST
     * go through it — a write on another connection commits on its own, which is
     * the whole thing this port exists to prevent.
     */
    readonly executor: DbTransaction;
    /** The content type being saved. */
    readonly type: AnyContentType;
    /** The row's id. On a create, the row that has just been inserted. */
    readonly entryId: string;
    /** The workspace the entry belongs to. */
    readonly workspaceId: string;
}

/** A write: the target, plus what the caller sent for this extension. */
export interface EntryWriteExtensionInput extends EntryWriteExtensionTarget {
    /**
     * The caller's value under this extension's {@link EntryWriteExtension.key},
     * verbatim and **unvalidated** — content-server declares the bag as opaque
     * and never looks inside it, exactly as it does for `locale`. An extension
     * validates its own slice and throws a `BadRequestException` /
     * `UnprocessableEntityException` on a bad one, which rolls the save back.
     *
     * On a **restore** this is the value the restored version captured, so the
     * same code path puts state back that put it there.
     */
    readonly value: unknown;
}

/** One plugin's state alongside an entry, written and versioned with it. */
export interface EntryWriteExtension {
    /**
     * The extension's slot — in the request's `extensions` bag and in the
     * revision snapshot's `extra`. Must be stable: a stored snapshot names it,
     * so renaming the key orphans every version already captured.
     */
    readonly key: string;

    /**
     * Write this extension's state for the entry, on the save's transaction.
     *
     * Called **only** when the request carried a value under {@link key} — a
     * save that said nothing about audiences must not clear them.
     *
     * Return the ids of **other** entries this write also changed — the locale
     * siblings segments writes an entry's audiences to, for instance. Content
     * appends a revision for each, exactly as it does for the rows i18n's shared
     * -field sync rewrote: a row whose stored state moved while its timeline did
     * not is a history that hides the change and, on the next restore, undoes
     * it. Return nothing when only the named entry changed.
     */
    apply(input: EntryWriteExtensionInput): Promise<readonly string[] | void>;

    /**
     * What the revision should record, read back on the same transaction so it
     * reflects what actually committed.
     *
     * Called for **every** snapshot, including a save that never mentioned this
     * extension and including the locale siblings an extension rewrote — a
     * version that omitted the state it did not change would read, on restore,
     * as a version that had none.
     *
     * Return `undefined` to record nothing (the key is then absent from `extra`,
     * which is what an unconfigured installation should produce).
     */
    capture(target: EntryWriteExtensionTarget): Promise<unknown>;

    /**
     * A row has just been **inserted** — a chance to give it whatever the rest
     * of its locale group already has.
     *
     * Optional, and called on every create **after** {@link apply}, so an
     * extension that has just been told what to store is not asked to inherit
     * over it. It exists because `apply` runs only for keys the caller sent, and
     * "create a translation" sends none: without this, translating a restricted
     * article produced a public German copy of it, which is the failure mode a
     * reader notices and an editor never does.
     *
     * The equivalent for content's own columns is `CONTENT_ENTRY_EXTENSION`'s
     * create-only relation inheritance; this is the same posture for state a
     * different plugin owns.
     */
    inherit?(target: EntryWriteExtensionTarget): Promise<void>;
}

/** Every registered extension, in registration order. */
@Injectable()
export class EntryWriteExtensionRegistry {
    private readonly extensions: EntryWriteExtension[] = [];

    /** Adds an extension. Registering the same instance twice is a no-op. */
    register(extension: EntryWriteExtension): void {
        if (!this.extensions.includes(extension)) {
            this.extensions.push(extension);
        }
    }

    /** Whether anything is registered — the check that keeps a bare install free. */
    get configured(): boolean {
        return this.extensions.length > 0;
    }

    /**
     * Run every extension the caller sent a value for.
     *
     * An unknown key is **ignored**, not an error: the bag is forwarded from a
     * client that may be talking to an installation without that plugin, and
     * failing the whole save over it would make a request that works on one
     * deployment a 400 on another. What the save then records is the truth —
     * `capture` reports no state for a key nothing owns.
     */
    async applyAll(
        target: EntryWriteExtensionTarget,
        inputs: Record<string, unknown> | undefined
    ): Promise<string[]> {
        if (!inputs || !this.extensions.length) return [];
        // Every *other* entry the extensions changed, so the caller can give
        // each one the revision its moved state deserves. Deduplicated, and the
        // named entry is dropped: it gets its own snapshot either way.
        const alsoChanged = new Set<string>();
        for (const extension of this.extensions) {
            if (!(extension.key in inputs)) continue;
            const touched = await extension.apply({
                ...target,
                value: inputs[extension.key]
            });
            for (const id of touched ?? []) {
                if (id !== target.entryId) alsoChanged.add(id);
            }
        }
        return [...alsoChanged];
    }

    /**
     * Let every extension that wants to give a **just-inserted** row what its
     * locale group already holds.
     *
     * Runs after {@link applyAll} on a create, and only there: an extension the
     * caller just told what to store must not then inherit over it.
     */
    async inheritAll(target: EntryWriteExtensionTarget): Promise<void> {
        for (const extension of this.extensions) {
            await extension.inherit?.(target);
        }
    }

    /**
     * Everything the extensions hold for one entry, keyed by extension.
     *
     * Returns `undefined` — not an empty object — when there is nothing to
     * record, so a snapshot taken on an installation with no extensions is
     * byte-for-byte what it was before this port existed.
     */
    async captureAll(
        target: EntryWriteExtensionTarget
    ): Promise<Record<string, unknown> | undefined> {
        if (!this.extensions.length) return undefined;
        const extra: Record<string, unknown> = {};
        for (const extension of this.extensions) {
            const value = await extension.capture(target);
            if (value !== undefined) extra[extension.key] = value;
        }
        return Object.keys(extra).length ? extra : undefined;
    }
}

/** Registers a plugin's entry-write extensions with content at bootstrap. */
class EntryWriteExtensionBootstrapper implements OnApplicationBootstrap {
    private readonly logger = new Logger(EntryWriteExtensionBootstrapper.name);

    constructor(
        private readonly label: string,
        private readonly registry: EntryWriteExtensionRegistry | null,
        private readonly extensions: readonly EntryWriteExtension[]
    ) {}

    onApplicationBootstrap(): void {
        // A deployment without `ContentPlugin` is not a real configuration, but
        // a binding plugin should still boot rather than fail on an injection it
        // cannot influence.
        if (!this.registry) return;
        for (const extension of this.extensions) {
            this.registry.register(extension);
        }
        this.logger.log(
            `Registered the ${this.label} entry-write extension with content.`
        );
    }
}

/**
 * Builds the DI provider that registers `extensions` with content's entry-write
 * registry at bootstrap.
 *
 * A factory with an explicit `inject` list rather than a class with reflected
 * parameters, for the reason `contentReadScopeRegistrar` documents: an optional
 * dependency typed `Foo | null` emits `Object` for `design:paramtypes`, Nest
 * injects `undefined` with no error, and the plugin registers nothing.
 */
export function entryWriteExtensionRegistrar(
    label: string,
    ...extensions: Type<EntryWriteExtension>[]
): Provider {
    return {
        provide: `ENTRY_WRITE_EXTENSION_REGISTRAR_${label.toUpperCase()}`,
        useFactory: (
            registry: EntryWriteExtensionRegistry | null,
            ...resolved: EntryWriteExtension[]
        ) => new EntryWriteExtensionBootstrapper(label, registry, resolved),
        inject: [
            { token: EntryWriteExtensionRegistry, optional: true },
            ...extensions
        ]
    };
}
