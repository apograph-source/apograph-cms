import { HttpException } from '@nestjs/common';
import { EVENT_ACTOR_TYPE, type EventActor } from '@orthacms/database';
import type {
    PublishActor,
    PublishRefused
} from '../../../extension/publish-guard';

/**
 * A guard's refusal as the exception the caller receives.
 *
 * Content relays rather than interprets: the status, the code and the details
 * are the guard's, because what makes a publish refusable is the guard's rule
 * and content has no vocabulary for it. The one thing content insists on is the
 * envelope shape — `{ code, message, … }` — so a client can branch on `code`
 * across every guard that ever exists.
 *
 * **409 is the interesting default** (set by the port, not here). A refusal is a
 * conflict with the state of the world; `403` would be indistinguishable from
 * lacking `content:publish`, and the difference is exactly what the caller needs
 * to know whether to ask an administrator for a permission or a colleague for an
 * approval.
 */
export function refusalToHttp(refusal: PublishRefused): HttpException {
    return new HttpException(
        {
            statusCode: refusal.status,
            code: refusal.code,
            message: refusal.message,
            ...(refusal.details ?? {})
        },
        refusal.status
    );
}

/**
 * The publish's principal as a guard is told about it.
 *
 * A bearer token is `userId: null` — it names no person, which is the whole
 * reason a guard may want to treat it differently. `EventActor.type` is what
 * distinguishes the two; an actor with no type predates token attribution and
 * is therefore a user, the same default `attachActor` applies.
 */
export function toPublishActor(actor?: EventActor): PublishActor {
    const isToken = actor?.type === EVENT_ACTOR_TYPE.ApiToken;
    return {
        userId: isToken ? null : (actor?.id ?? null),
        isToken
    };
}
