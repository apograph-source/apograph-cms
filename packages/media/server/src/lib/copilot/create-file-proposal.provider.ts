import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { PERMISSIONS } from '@orthacms/identity-server';
import type { ProposalDraft } from '@orthacms/copilot-domain';
import { ToolRegistry } from '@orthacms/tools-server';
import type { ToolDefinition, ToolProvider } from '@orthacms/tools-server';
import { ListFoldersQuery } from '../infrastructure/queries/list-folders.query';
import {
    FILE_FORMATS,
    FILE_FORMAT_NAMES,
    isFileFormat,
    resolveFileName,
    type FileFormat
} from './file-formats';
import { MEDIA_PROPOSAL_KINDS } from './proposal-kinds';

/**
 * Largest file Ortha AI may author, in UTF-8 bytes.
 *
 * Far below `maxUploadBytes` (50 MB by default) on purpose. The content arrives
 * as a **tool argument**, so it was generated token by token — a megabyte of it
 * is not a big report, it is a model that has stopped terminating. The upload
 * cap protects the process; this one catches a malfunction while the run can
 * still say something useful about it.
 */
export const MAX_AUTHORED_BYTES = 1024 * 1024;

/** Characters of file content mirrored into the proposal's review diff. */
const PREVIEW_CHARS = 2000;

/**
 * `media_propose_file` — Ortha AI writes a report, summary or export into the
 * media library as an ordinary asset.
 *
 * **It writes nothing.** Like every `propose` tool it returns a `ProposalDraft`
 * and the run engine does the rest: it parks the run for the user's approval,
 * records a `copilot_proposals` row, and only then hands the draft to
 * `CreateFileProposalApplier`. Because the run parks *before* the call, the
 * permission prompt shows the file's text — the user is reviewing a draft
 * rather than discovering a file that already exists.
 *
 * The file that results is not special in any way: it is an asset in the Media
 * Library, movable, renamable, deletable, attachable to a content record's
 * media field, and reachable through the same download routes as anything
 * someone uploaded by hand. Giving generated files their own store would have
 * meant a second copy of the storage seam, the workspace scoping, the audit
 * trail and the blob reclamation, and none of them would be better for it.
 */
@Injectable()
export class CreateFileProposalToolProvider
    implements ToolProvider, OnModuleInit
{
    constructor(
        private readonly folders: ListFoldersQuery,
        @Optional() private readonly toolRegistry?: ToolRegistry
    ) {}

    /** Register with the shared registry once the DI graph is built. */
    onModuleInit(): void {
        this.toolRegistry?.register(this);
    }

    /** The one file-authoring tool. */
    tools(): readonly ToolDefinition[] {
        return [this.proposeFile()];
    }

    private proposeFile(): ToolDefinition {
        return {
            name: 'media_propose_file',
            title: 'Create a file',
            description:
                'Write a new text file into the media library — a report, a summary, a CSV ' +
                'you have assembled from other tool results. Despite the name, an approved ' +
                'call creates the file immediately and the user gets a link to it. ' +
                'Pick `format` by what the content actually is; the file type and extension ' +
                'follow from it, so do not put one in `fileName`. `fileName` must be a plain ' +
                'name with no folders in it — use `folderId` (from media_folders_list) to ' +
                'choose where it goes, or omit it for the top level. Write the whole file in ' +
                '`content`: nothing is appended later, and there is no second call.',
            inputSchema: {
                type: 'object',
                properties: {
                    fileName: {
                        type: 'string',
                        maxLength: 200,
                        description:
                            'Plain file name, no folders and no extension, e.g. “Q3 content audit”.'
                    },
                    format: {
                        type: 'string',
                        enum: [...FILE_FORMAT_NAMES],
                        description:
                            'md for a report or anything with headings, csv for tabular data, ' +
                            'json for structured data, html for a formatted document, txt for plain notes.'
                    },
                    content: {
                        type: 'string',
                        description:
                            'The complete contents of the file, in the chosen format.'
                    },
                    folderId: {
                        type: 'string',
                        description:
                            'Destination folder id from media_folders_list. Omit for the top level.'
                    },
                    alt: {
                        type: 'string',
                        maxLength: 1000,
                        description:
                            'A one-line description of what this file is, stored as its ' +
                            'alternative text. It becomes the accessible name wherever the ' +
                            'file is linked or embedded, so write it for someone who cannot ' +
                            'open it — not a repeat of the file name.'
                    },
                    summary: {
                        type: 'string',
                        maxLength: 200,
                        description:
                            'One line for the approval card, written for a person, ' +
                            'e.g. “Q3 content audit as Markdown”.'
                    }
                },
                // `alt` is offered but not required, and that is a deliberate
                // narrowing of `ORT-120`'s first bullet. Every `format` this
                // tool writes is **text** (md/csv/json/html/txt), so there is no
                // image here whose meaning would otherwise be lost — 1.1.1 is
                // not at stake the way it is for `media_propose_alt_text`. What
                // it does buy is a real accessible name wherever the file is
                // linked, instead of a file name.
                required: ['fileName', 'format', 'content', 'summary'],
                additionalProperties: false
            },
            requires: [PERMISSIONS.MEDIA_CREATE],
            readOnly: false,
            effect: 'propose',
            // Copilot-only. An MCP client reaching a propose tool would create
            // a change with nothing able to approve it — and the public API's
            // token scopes deliberately withhold library curation anyway.
            surfaces: ['copilot'],
            handler: async (input, ctx): Promise<ProposalDraft> => {
                const args = (input ?? {}) as {
                    fileName: string;
                    format: string;
                    content: string;
                    folderId?: string;
                    alt?: string;
                    summary: string;
                };

                if (!isFileFormat(args.format)) {
                    throw new Error(
                        `"${args.format}" is not a format I can write. Choose one of: ${FILE_FORMAT_NAMES.join(', ')}.`
                    );
                }
                const format: FileFormat = args.format;

                if (typeof args.content !== 'string') {
                    throw new Error(
                        'The file needs its contents in `content`.'
                    );
                }
                const size = Buffer.byteLength(args.content, 'utf8');
                if (size === 0) {
                    throw new Error(
                        'The file has no contents. Write the whole file in `content`.'
                    );
                }
                if (size > MAX_AUTHORED_BYTES) {
                    throw new Error(
                        `That file is ${Math.round(size / 1024)}KB, over the ${Math.round(
                            MAX_AUTHORED_BYTES / 1024
                        )}KB limit for a generated file.`
                    );
                }

                // `resolveFileName` throws a message the model can act on — a
                // path gets named as a path, an over-long name as too long.
                // Doing it here rather than in the applier is what keeps that
                // failure recoverable: the model can correct the draft and
                // propose again, whereas an applier that threw would have a
                // recorded change nobody can retry.
                const fileName = resolveFileName(args.fileName, format);

                // Same reason the alt-text tool re-reads its asset: a bad
                // folder id must fail while the model can still fix it, not
                // inside the applier, where the change is already recorded and
                // the file simply cannot be filed.
                const folderId = args.folderId ?? null;
                if (folderId !== null) {
                    const { folders } = await this.folders.execute(
                        ctx.workspaceId
                    );
                    if (!folders.some((folder) => folder.id === folderId)) {
                        throw new Error(
                            `No folder "${folderId}" in this workspace. Call media_folders_list for the ids.`
                        );
                    }
                }

                const alt = (args.alt ?? '').trim();

                return {
                    kind: MEDIA_PROPOSAL_KINDS.createFile,
                    target: { fileName, folderId },
                    patch: {
                        format,
                        content: args.content,
                        ...(alt ? { alt } : {})
                    },
                    summary: args.summary,
                    changes: [
                        {
                            field: 'fileName',
                            label: 'File',
                            after: `${fileName} · ${FILE_FORMATS[format].label} · ${size} bytes`
                        },
                        // On the card whether or not it was supplied. The card
                        // is a receipt rather than a review since ADR-0009, but
                        // a receipt is still where someone notices — and an
                        // accessibility gap nobody is shown is one nobody
                        // fixes (`ORT-120`).
                        {
                            field: 'alt',
                            label: 'Description',
                            after: alt || '(none supplied)'
                        },
                        {
                            field: 'content',
                            label: 'Contents',
                            // A preview, not the file. The whole text is
                            // already in the permission prompt the user
                            // approved; copying it again into an append-only
                            // table would store every generated report twice,
                            // with a different deletion story for each copy.
                            after: preview(args.content)
                        }
                    ]
                };
            }
        };
    }
}

/** The opening of a file, marked when there is more of it. */
function preview(content: string): string {
    return content.length <= PREVIEW_CHARS
        ? content
        : `${content.slice(0, PREVIEW_CHARS)}\n…`;
}
