import type { DomainEvent } from '@orthacms/database';
import { FolderId } from './value-objects/folder-id';
import { hasControlCharacters } from './value-objects/control-characters';
import { InvalidFolderNameError } from './errors/invalid-folder-name.error';
import { folderEvent, MEDIA_EVENT_KINDS } from './events/media-events';

/** Upper bound on a folder name's length. */
const MAX_NAME_LENGTH = 120;

/** Everything needed to build a brand-new folder. */
export interface NewFolderProps {
    id: FolderId;
    workspaceId: string;
    /** Parent folder, or `null` for a top-level (root) folder. */
    parentId: FolderId | null;
    name: string;
}

/** The persisted shape used to rehydrate a loaded folder. */
export interface FolderState {
    id: string;
    workspaceId: string;
    parentId: string | null;
    name: string;
}

/**
 * The media folder aggregate root. A lightweight aggregate — it owns its name
 * and parentage and raises `media.folder.*` events; emptiness on delete is a
 * cross-row rule the delete use-case enforces via counts (the aggregate can't
 * see its children).
 */
export class Folder {
    private readonly events: DomainEvent[] = [];

    private constructor(
        private readonly _id: FolderId,
        private readonly _workspaceId: string,
        private readonly _parentId: FolderId | null,
        private _name: string,
        private readonly _isNew: boolean
    ) {}

    /** Creates a new folder — raises `media.folder.created`. */
    static create(props: NewFolderProps): Folder {
        const name = Folder.normalizeName(props.name);
        const folder = new Folder(
            props.id,
            props.workspaceId,
            props.parentId,
            name,
            true
        );
        folder.events.push(
            folderEvent(MEDIA_EVENT_KINDS.FOLDER_CREATED, props.id.value, {
                workspaceId: props.workspaceId,
                name,
                parentId: props.parentId?.value ?? null
            })
        );
        return folder;
    }

    /** Rebuilds a loaded folder — raises no events. */
    static rehydrate(state: FolderState): Folder {
        return new Folder(
            FolderId.create(state.id),
            state.workspaceId,
            state.parentId ? FolderId.create(state.parentId) : null,
            state.name,
            false
        );
    }

    private static normalizeName(raw: string): string {
        const trimmed = raw.trim();
        if (
            trimmed.length === 0 ||
            trimmed.length > MAX_NAME_LENGTH ||
            hasControlCharacters(trimmed)
        ) {
            throw new InvalidFolderNameError(raw);
        }
        return trimmed;
    }

    /** The folder id. */
    get id(): FolderId {
        return this._id;
    }
    /** The owning workspace id. */
    get workspaceId(): string {
        return this._workspaceId;
    }
    /** The parent folder, or `null` at the root. */
    get parentId(): FolderId | null {
        return this._parentId;
    }
    /** The current folder name. */
    get name(): string {
        return this._name;
    }
    /** Whether this aggregate has never been persisted. */
    get isNew(): boolean {
        return this._isNew;
    }

    /** Renames the folder (idempotent). */
    rename(raw: string): void {
        const next = Folder.normalizeName(raw);
        if (next === this._name) return;
        this._name = next;
        this.events.push(
            folderEvent(MEDIA_EVENT_KINDS.FOLDER_RENAMED, this._id.value, {
                workspaceId: this._workspaceId,
                name: next
            })
        );
    }

    /** Marks the folder deleted — raises `media.folder.deleted`. */
    markDeleted(): void {
        this.events.push(
            folderEvent(MEDIA_EVENT_KINDS.FOLDER_DELETED, this._id.value, {
                workspaceId: this._workspaceId
            })
        );
    }

    /** Drains and returns the accumulated domain events. */
    pullEvents(): DomainEvent[] {
        return this.events.splice(0, this.events.length);
    }
}
