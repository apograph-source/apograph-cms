import {
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    text,
    timestamp,
    uuid
} from 'drizzle-orm/pg-core';
import type {
    AttachmentRef,
    ModelContentBlock,
    SkillRef
} from '@orthacms/copilot-domain';
import { copilotConversations } from './conversations';

/** Who produced a turn. Mirrors the port's `ModelMessage['role']`. */
export const copilotMessageRole = pgEnum('copilot_message_role', [
    'user',
    'assistant'
]);

/**
 * One turn of a conversation — **append-only**. This is the transcript used for
 * replay and audit, so a row is never edited after it is written: a turn that
 * failed keeps its `stopReason`, and a turn that was cancelled keeps whatever
 * text had streamed. Rewriting history here would defeat the point of having it.
 *
 * The user's message is written **before** the model is called (design §5, step
 * 3), so a dropped connection never loses what someone typed.
 */
export const copilotMessages = pgTable(
    'copilot_messages',
    {
        /** Primary key. */
        id: uuid('id').primaryKey().defaultRandom(),
        /** The thread this turn belongs to. */
        conversationId: uuid('conversation_id')
            .notNull()
            .references(() => copilotConversations.id, { onDelete: 'cascade' }),
        /**
         * The run that produced this turn. The user message that opened the
         * run carries the same id, so one run's turns select together.
         */
        runId: uuid('run_id').notNull(),
        /** Who produced the turn. */
        role: copilotMessageRole('role').notNull(),
        /**
         * The turn's content blocks, exactly as the port models them — text,
         * tool_use and tool_result. Stored as the port's shape rather than a
         * provider's, so a transcript survives switching provider.
         */
        content: jsonb('content').$type<ModelContentBlock[]>().notNull(),
        /**
         * Files the user attached to this turn, resolved at send time. Null on
         * an assistant turn and on a user turn with none.
         *
         * Its own column rather than another `content` block, for two reasons.
         * The port's `ModelContentBlock` union is what every adapter switches
         * on, so a sixth member would be a change to three adapters for
         * something no provider needs to see; and the transcript read wants
         * this **structured** — the panel renders attachments as chips, and
         * recovering them by sniffing a text block's prefix is the kind of
         * parsing that works until someone types the prefix.
         *
         * The engine folds them back into a fenced text block when it builds
         * model messages, so a follow-up turn still knows what was attached.
         */
        attachments: jsonb('attachments').$type<AttachmentRef[]>(),
        /**
         * The skills that were in force for this turn — attached by the person
         * *and* the workspace's always-on ones. Null on an assistant turn and
         * on a user turn that ran with none.
         *
         * A **snapshot** (name, title, source), not ids: a skill can be renamed
         * or deleted, and a thread read months later still has to be able to
         * say what shaped the answer. It is also what the transcript renders as
         * chips, which is the only way a person ever learns, after the fact,
         * that an answer was written under instructions they did not see.
         *
         * Its own column rather than a content block, for the same two reasons
         * `attachments` is: no adapter needs to switch on it, and recovering it
         * by parsing a text block works until someone types the prefix.
         */
        skills: jsonb('skills').$type<SkillRef[]>(),
        /** Which model produced an assistant turn; null on a user turn. */
        model: text('model'),
        /** Which registered provider served it; null on a user turn. */
        provider: text('provider'),
        /** Why the run ended, on the final assistant turn. */
        stopReason: text('stop_reason'),
        /** Tokens billed as input across the run. */
        inputTokens: integer('input_tokens'),
        /** Tokens the model generated across the run. */
        outputTokens: integer('output_tokens'),
        /**
         * Monotonic position within the thread. Explicit rather than inferred
         * from `createdAt`: two turns of one run can land inside the same
         * millisecond, and a transcript that renders out of order is worse
         * than one that renders slowly.
         */
        position: integer('position').notNull(),
        /** Row creation timestamp. */
        createdAt: timestamp('created_at', { withTimezone: true })
            .notNull()
            .defaultNow()
    },
    (table) => [
        // The transcript read: one thread's turns, in order.
        index('copilot_messages_thread_idx').on(
            table.conversationId,
            table.position
        )
    ]
);
