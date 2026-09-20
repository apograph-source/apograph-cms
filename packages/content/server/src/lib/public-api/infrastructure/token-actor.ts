import { EVENT_ACTOR_TYPE, type EventActor } from '@orthacms/database';
import type { ToolActor } from '@orthacms/tools-server';
import type { PublicApiToken } from '../http/api-token-request';

/**
 * The API token as the {@link EventActor} a public-API write stamps onto its
 * domain events.
 *
 * Every write over the public REST API, GraphQL and MCP used to reach the audit
 * log with no actor at all and render as "System" — not an oversight but the
 * only honest option at the time, since `actor_id` meant "a `users` row" and a
 * token is not one. `activity_events.actor_type` is what makes naming the
 * credential possible, so this is the seam that fills it.
 *
 * `email` carries the token's **label**, because that is the readable name a
 * row needs and a token has no address; `actor_type` is what tells a client not
 * to read it as one. The token id goes in `id` — the same handle the API Tokens
 * page lists and the revoke button acts on, so a row leads straight to the
 * credential it names.
 *
 * A revision's `created_by` still gets `null` for a token: that column really is
 * a `users` FK. The split lives in `EntryWriterService`'s `revisionActorId`.
 */
export function toTokenActor(token: PublicApiToken): EventActor {
    return {
        id: token.id,
        email: token.name,
        type: EVENT_ACTOR_TYPE.ApiToken,
        label: token.name
    };
}

/**
 * The {@link EventActor} for a write made through the shared **tool registry** —
 * an MCP client, or the copilot's own run loop.
 *
 * `ToolActor` already carries the distinction this needs (`kind`, `id`,
 * `displayName`), which is the point of it being transport-neutral: one
 * conversion covers both surfaces, and neither had any actor on its writes
 * before. A token acts as itself here exactly as it does over REST — the
 * minting user in `actor.userId` is attribution for a revision's `created_by`,
 * not the principal that performed the call, and conflating them would name a
 * person for every request an integration makes.
 */
export function toToolEventActor(actor: ToolActor): EventActor {
    return actor.kind === 'token'
        ? {
              id: actor.id,
              email: actor.displayName,
              type: EVENT_ACTOR_TYPE.ApiToken,
              label: actor.displayName
          }
        : {
              id: actor.id,
              email: actor.displayName,
              type: EVENT_ACTOR_TYPE.User
          };
}
