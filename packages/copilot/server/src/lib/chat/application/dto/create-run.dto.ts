import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    MaxLength,
    MinLength,
    ValidateNested
} from 'class-validator';
import {
    MAX_RUN_SKILLS,
    MAX_SKILL_NAME_LENGTH,
    SKILL_NAME_PATTERN
} from '@orthacms/copilot-domain';

/** Longest message we accept. Bounds the prompt before the model bounds it. */
export const MAX_MESSAGE_LENGTH = 8_000;

/**
 * Files one turn may carry.
 *
 * A ceiling rather than none, because each attachment costs a resolve and a
 * line of prompt, and a request naming two hundred ids would spend both before
 * the model is ever called.
 */
export const MAX_RUN_ATTACHMENTS = 8;

/**
 * The surfaces a run can be started from (design §2).
 *
 * `create` is the new-entry form. It is a separate surface rather than
 * `records` because the client cannot describe it any other way: the URL has a
 * content type but no entry id, so the form used to arrive here claiming the
 * person was looking at a list.
 */
export const RUN_SURFACES = [
    'chat',
    'palette',
    'entry',
    'records',
    'create'
] as const;

/**
 * Where the user was when they asked. Every field is optional — the chat panel
 * knows only the workspace, the entry editor knows the type and the entry.
 *
 * **This class exists because of the host's strict `ValidationPipe`.** It runs
 * with `whitelist: true` + `forbidNonWhitelisted: true`, and those apply to
 * nested objects too: without `@ValidateNested()` + `@Type()` here, a nested
 * `context` object is not traversed as a DTO at all — its properties are
 * stripped by the whitelist and the handler silently receives `{}`. Declaring
 * the nested class is what makes the payload arrive intact.
 */
export class RunContextDto {
    /** Where the run was started from. */
    @ApiPropertyOptional({ enum: RUN_SURFACES })
    @IsOptional()
    @IsIn(RUN_SURFACES)
    surface?: (typeof RUN_SURFACES)[number];

    /** The content type in view, if any. */
    @ApiPropertyOptional({ type: String, maxLength: 128 })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    contentType?: string;

    /** The entry in view, if any. */
    @ApiPropertyOptional({ type: String, maxLength: 64 })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    entryId?: string;

    /** The content locale in view, if any. */
    @ApiPropertyOptional({ type: String, maxLength: 35 })
    @IsOptional()
    @IsString()
    @MaxLength(35)
    locale?: string;
}

/**
 * One file attached to a turn — an **id only**.
 *
 * The client has the whole asset view in hand after uploading, and sending the
 * name and size along would save the server a lookup. It deliberately does not:
 * the id is the only part the server can verify, and everything the model is
 * told about a file has to come from the row rather than from the request, or a
 * caller could describe someone else's asset — or their own — as anything they
 * liked.
 *
 * A class rather than a bare string array for the same reason `RunContextDto`
 * is a class: the strict pipe traverses a nested array only with
 * `@ValidateNested({ each: true })` + `@Type()`, and it leaves room for a
 * per-attachment field later without changing the wire shape.
 */
export class RunAttachmentDto {
    /** The media asset's id, as returned by the upload it came from. */
    @ApiProperty({ type: String, format: 'uuid' })
    @IsUUID()
    assetId!: string;
}

/**
 * One skill attached to a turn — a **name only**.
 *
 * The same discipline as {@link RunAttachmentDto}, and the reason is sharper
 * here: a skill's `instructions` are prompt text, so a request that could carry
 * a body would let anyone holding `copilot:use` write their own system prompt.
 * The name is the only part the server can check, and everything the model is
 * told comes from the catalogue row it resolves to.
 *
 * A class rather than a bare string array because the strict pipe traverses a
 * nested array only with `@ValidateNested({ each: true })` + `@Type()`.
 */
export class RunSkillDto {
    /** The skill's machine name, as served by `GET /api/copilot/skills`. */
    @ApiProperty({
        type: String,
        maxLength: MAX_SKILL_NAME_LENGTH,
        pattern: SKILL_NAME_PATTERN.source,
        example: 'house-style'
    })
    @IsString()
    @MaxLength(MAX_SKILL_NAME_LENGTH)
    @Matches(SKILL_NAME_PATTERN)
    name!: string;
}

/**
 * Body of `POST /api/copilot/runs`.
 *
 * Every field the client may send is declared here, including the nested
 * context above — the host's pipe sets `forbidNonWhitelisted: true`, so an
 * undeclared key is a **400 naming the property**, not a silently ignored
 * extra. That is the behaviour we want (a typo'd field is a loud failure), but
 * it means adding a client-side field without adding it here breaks the request
 * with an error that reads as unrelated.
 */
export class CreateRunDto {
    /** What the user typed. */
    @ApiProperty({ type: String, minLength: 1, maxLength: MAX_MESSAGE_LENGTH })
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_MESSAGE_LENGTH)
    message!: string;

    /** Continue this thread. Omit to start a new one. */
    @ApiPropertyOptional({ type: String, format: 'uuid' })
    @IsOptional()
    @IsUUID()
    conversationId?: string;

    /**
     * The admin UI's locale, so the model answers in the language the person
     * is reading (`docs/design/copilot.md` §8, "Localized output"). Sent by the
     * client rather than inferred from `Accept-Language`, because the admin's
     * locale is an app preference, not a browser one.
     */
    @ApiPropertyOptional({ type: String, maxLength: 35, default: 'en' })
    @IsOptional()
    @IsString()
    @MaxLength(35)
    uiLocale?: string;

    /**
     * The registered provider to run on — one of the names in
     * `GET /api/copilot/models`. Omit to let the host's resolver decide.
     *
     * Naming a provider is **not** an escalation: the registry is fixed at boot
     * by the operator, so the worst a caller can do is pick a different backend
     * the operator already configured. An unregistered name is refused.
     */
    @ApiPropertyOptional({ type: String, maxLength: 64 })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    provider?: string;

    /**
     * The model id to run on, from the chosen provider's list. Omit for that
     * provider's default. A user switches model by sending a different value on
     * the next turn — the choice is **per run**, so a conversation can start
     * cheap and escalate.
     *
     * The thread does carry a `modelChoice` (see `UpdateConversationDto`), and
     * it is a memory rather than a pin: it is what the picker is *seeded* from
     * when a saved conversation is reopened, and nothing about it constrains
     * what this field may be on the next turn.
     */
    @ApiPropertyOptional({ type: String, maxLength: 128 })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    model?: string;

    /** Where the user is. */
    @ApiPropertyOptional({ type: RunContextDto })
    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => RunContextDto)
    context?: RunContextDto;

    /**
     * Files the user attached to this turn, already uploaded to the media
     * library through `POST /api/media/assets`.
     *
     * Uploading is **not** part of the run: it happens first, over the ordinary
     * media route, with the user's own session and their own `media:create`.
     * That is what keeps the authority model intact — attaching a file is the
     * person uploading it, exactly as they would from the Media Library, from a
     * different button. The copilot never gains a write path; by the time a run
     * starts, the asset already exists and this names it.
     */
    @ApiPropertyOptional({ type: [RunAttachmentDto] })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_RUN_ATTACHMENTS)
    @ValidateNested({ each: true })
    @Type(() => RunAttachmentDto)
    attachments?: RunAttachmentDto[];

    /**
     * Skills the person attached to this turn, by name.
     *
     * Per turn rather than pinned to the thread, like the model choice: a
     * conversation can rewrite one paragraph under the house style skill and
     * the next under none. The workspace's always-on skills are **not** listed
     * here — they are in force whatever the client sends, and a client that
     * could omit them could turn workspace configuration off by not asking for
     * it.
     */
    @ApiPropertyOptional({ type: [RunSkillDto], maxItems: MAX_RUN_SKILLS })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_RUN_SKILLS)
    @ValidateNested({ each: true })
    @Type(() => RunSkillDto)
    skills?: RunSkillDto[];
}
