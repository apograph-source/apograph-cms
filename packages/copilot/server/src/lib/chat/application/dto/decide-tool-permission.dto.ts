import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { ToolPermissionDecision } from '@orthacms/copilot-domain';

/** The three answers a parked run accepts. */
const DECISIONS = ['once', 'chat', 'deny'] as const;

/**
 * Body of `POST /api/copilot/runs/:runId/permission`.
 *
 * Every property is declared because the host's `ValidationPipe` runs with
 * `forbidNonWhitelisted` — an undeclared key is a 400 naming it.
 */
export class DecideToolPermissionDto {
    /**
     * The tool call being answered, from the `tool-permission-request` frame.
     *
     * A plain string, not a UUID: it is the **provider's** call id, and the two
     * wire formats mint those differently (`toolu_…` from one, `call_…` from
     * the other). Validating it as a UUID would reject every real run.
     */
    @ApiProperty({
        description:
            'The `id` from the tool-permission-request frame this answers.'
    })
    @IsString()
    @MinLength(1)
    @MaxLength(200)
    callId!: string;

    /** Run it once, run it for the rest of this thread, or refuse it. */
    @ApiProperty({
        enum: [...DECISIONS],
        description:
            '`once` runs this call; `chat` also stops asking about this tool in this thread; `deny` refuses it.'
    })
    @IsIn(DECISIONS)
    decision!: ToolPermissionDecision;
}
