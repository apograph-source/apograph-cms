import {
    BadRequestException,
    ForbiddenException,
    Injectable
} from '@nestjs/common';
import type {
    EntryWriteExtension,
    EntryWriteExtensionInput,
    EntryWriteExtensionTarget
} from '@orthacms/content-server';
import { PERMISSIONS, PermissionsService } from '@orthacms/identity-server';
import type { Database } from '@orthacms/database';
import { isOpen, type EntryAccess } from '@orthacms/segments-domain';
import { EntryAccessService } from '../application/entry-access.service';
import type { EventActor } from '@orthacms/database';
import { PrincipalStore } from '../application/principal.store';
import { ENTRY_ACCESS_IDS_MAX } from '../http/segments.dto';

/**
 * The key this extension's state travels under — in a save body's `extensions`
 * bag and in a revision snapshot's `extra`.
 *
 * **Stable forever.** Every version already captured names it, so renaming it
 * would orphan the access recorded in the whole existing history — and a restore
 * that finds no bag leaves the entry's audiences alone, which is exactly the
 * silence you would not notice.
 */
export const ACCESS_EXTENSION_KEY = 'access';

/** The shape this extension accepts and records. Two lists, nothing else. */
type AccessPayload = { allow: string[]; deny: string[] };

/**
 * Reads a caller's (or a snapshot's) value for this extension.
 *
 * Content-server declares the `extensions` bag **opaque** and forwards it
 * unvalidated, so the shape check is ours. It is deliberately strict — a
 * malformed payload is a 400 that rolls the save back, rather than a silent
 * partial write that leaves an entry restricted to half of what was asked.
 */
function parse(value: unknown): AccessPayload {
    const bag = value as Partial<EntryAccess> | null | undefined;
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) {
        throw new BadRequestException(
            'extensions.access must be an object with "allow" and "deny" lists.'
        );
    }
    const list = (name: 'allow' | 'deny'): string[] => {
        const raw = bag[name];
        if (raw === undefined) return [];
        if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string')) {
            throw new BadRequestException(
                `extensions.access.${name} must be a list of segment ids.`
            );
        }
        // The same per-side cap the two `PUT` routes declare. It has to be
        // repeated because this path has no DTO — content forwards the bag
        // opaquely — and this is the path the admin actually writes through, so
        // a cap only the routes applied was one an entry could exceed here and
        // then never be rewritten through there.
        if (raw.length > ENTRY_ACCESS_IDS_MAX) {
            throw new BadRequestException(
                `extensions.access.${name} may name at most ${ENTRY_ACCESS_IDS_MAX} segments.`
            );
        }
        return raw as string[];
    };
    return { allow: list('allow'), deny: list('deny') };
}

/**
 * Who may read an entry, written and versioned **with** the entry.
 *
 * This is the whole reason segments binds content's entry-write port rather than
 * keeping to its own `PUT`. Three things follow from being inside the save:
 *
 * - The access row and the entry row commit together. A save cannot land with
 *   its restriction missing.
 * - The revision taken by that same save captures the access it applied — not
 *   the access it replaced, which is all a later separate request could ever
 *   manage.
 * - Restoring a version puts its audiences back with its words. "Go back to
 *   Tuesday" that restored Tuesday's draft in front of today's readers would be
 *   the quiet half of a restore nobody thinks to check.
 *
 * The `PUT /segments/entries/:entryId` route stays, for an API client that is
 * not saving an entry — it simply does not get the atomicity or the version.
 */
@Injectable()
export class EntryAccessWriteExtension implements EntryWriteExtension {
    readonly key = ACCESS_EXTENSION_KEY;

    constructor(
        private readonly access: EntryAccessService,
        // Who is acting, and what their role grants. The save's own gate is
        // `content:update`; deciding who may *read* the record is a different
        // authority, and nothing between the controller and here would have
        // checked it.
        private readonly principal: PrincipalStore,
        private readonly permissions: PermissionsService
    ) {}

    /**
     * Refuse a caller who may edit the record but not decide who reads it.
     *
     * Checked here rather than at a route, because there is no route: this write
     * arrives inside an entry save that asked only for `content:update`. Without
     * it a contributor could restrict — or un-restrict — any entry they can edit
     * by naming the key in the save body, which is precisely the escalation the
     * admin's own gate on the Access tab exists to prevent.
     *
     * No principal in scope is a refusal, not a pass: a caller that cannot be
     * identified cannot be shown to hold the permission.
     */
    /**
     * The acting user as an {@link EventActor}, or `undefined`.
     *
     * Read from the same {@link PrincipalStore} the permission check uses, so
     * "who was allowed to do this" and "who the log says did it" cannot
     * disagree. {@link assertMayManage} has already refused an absent
     * principal by the time this is called on the write path, so the
     * `undefined` branch is defensive rather than reachable.
     */
    private currentActor(): EventActor | undefined {
        const user = this.principal.current();
        return user ? { id: user.id, email: user.email ?? null } : undefined;
    }

    private async assertMayManage(): Promise<void> {
        const user = this.principal.current();
        const granted = user ? await this.permissions.forRole(user.roleId) : [];
        if (!granted.includes(PERMISSIONS.SEGMENTS_MANAGE)) {
            throw new ForbiddenException(
                'Changing who can read an entry needs the "segments:manage" permission.'
            );
        }
    }

    /**
     * Apply the audiences the save carried.
     *
     * Called only when the request named this key, so a save that says nothing
     * about who may read the entry leaves that alone — which is what an editor
     * who never opened the Access tab must get.
     *
     * Written to the entry's whole **locale group**. Access is not a translated
     * field, so it travels like a non-localized one: set on the English article,
     * set on the German one. See `EntryAccessService.setForGroup`.
     *
     * The sibling ids are **returned**, so content appends a revision for each —
     * the same thing it does for the rows i18n's shared-field sync rewrote. A
     * sibling whose audiences moved while its timeline did not is a history that
     * hides the change, and restoring any of its versions would silently undo it.
     */
    async apply({
        executor,
        type,
        entryId,
        workspaceId,
        value
    }: EntryWriteExtensionInput): Promise<readonly string[] | void> {
        const payload = parse(value);
        // A request that asks for exactly what is already stored changes
        // nothing, so it needs no authority — and skipping the write keeps a
        // **restore** working for anyone who may restore: putting back a version
        // whose audiences match today's is not a decision about access. A
        // restore that genuinely *would* change them is refused, which is the
        // right answer rather than a special case: it is a change to who can
        // read the entry, whatever button started it.
        //
        // Asked of the whole **locale group**, not of this row: a save that
        // matches the English article but not the German one still has work to
        // do, and skipping it would leave the group half-restricted with nothing
        // on any screen to say so.
        const settled = await this.access.groupHas(
            workspaceId,
            type,
            entryId,
            payload,
            executor as unknown as Database
        );
        if (settled) return;
        await this.assertMayManage();
        const written = await this.access.setForGroup({
            workspaceId,
            type,
            entryId,
            allow: payload.allow,
            deny: payload.deny,
            // The save's own transaction. Writing on the plugin's connection
            // instead would commit separately and give up every property this
            // port exists for.
            executor: executor as unknown as Database,
            // The entry save's actor, so setting audiences on Save reaches the
            // log named the same way the save itself does.
            actor: this.currentActor()
        });
        return written.entryIds;
    }

    /**
     * Give a just-created row whatever the rest of its locale group holds.
     *
     * The case is "create a translation", which sends no `extensions` bag at all
     * — so `apply` never runs and the new German row was born public while the
     * English one it was translated from stayed restricted. A reader notices
     * that; the editor never does.
     *
     * **No permission check, deliberately.** Nothing is being decided here: the
     * group's audiences were decided when they were set, and this row is joining
     * a record that already has them. Requiring `segments:manage` would mean a
     * contributor could not translate a restricted article at all — and the
     * alternative to inheriting is publishing it to everyone, which is the
     * outcome the permission exists to prevent.
     */
    async inherit({
        executor,
        type,
        entryId,
        workspaceId
    }: EntryWriteExtensionTarget): Promise<void> {
        await this.access.inheritFromGroup(
            workspaceId,
            type,
            entryId,
            executor as unknown as Database
        );
    }

    /**
     * What the version should record.
     *
     * Returns `undefined` for an unrestricted entry, so a snapshot of ordinary
     * open content is byte-for-byte what it was before this extension existed —
     * and an installation that has never restricted anything grows no history.
     *
     * Note the asymmetry with {@link apply}: this runs for **every** snapshot,
     * including saves that never mentioned access and including the locale
     * siblings a shared field was synced to. A version that recorded access only
     * when access changed would, on restore, read as a version that had none.
     */
    async capture({
        executor,
        entryId,
        workspaceId
    }: EntryWriteExtensionTarget): Promise<unknown> {
        const current = await this.access.get(
            workspaceId,
            entryId,
            executor as unknown as Database
        );
        return isOpen(current) ? undefined : current;
    }
}
