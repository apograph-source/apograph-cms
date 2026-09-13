# Activity

_Package group · packages/activity_

**Who did what and when — the Apograph activity log**

Activity is the **shared audit sink**. It knows nothing about content, the media library or accounts: it subscribes to the transactional outbox and turns other plugins' domain events into rows of a single `activity_events` table. The schema is deliberately open — `kind` and `meta` — because the catalogue of event kinds belongs to whoever produces them, not to whoever stores them. Hence the package's main rule: **adding a producer means adding a mapper here**, and an event with no mapper is lost silently.

- **2** packages in the group
- **3** HTTP routes
- **1** database table
- **2** migrations
- **62** source events → **60** audit kinds
- **13** subject types
- **9** producing plugins
- **1** screen + **3** admin slots
- **1** copilot tool

## Contents

- [01. Business description](#01-business-description)
- [02. Composition of the package group](#02-composition-of-the-package-group)
- [03. The catalogue of event kinds](#03-the-catalogue-of-event-kinds)
- [04. Roles and permissions](#04-roles-and-permissions)
- [05. Data model](#05-data-model)
- [06. An event's lifecycle](#06-an-events-lifecycle)
- [07. Flows — how it works, step by step](#07-flows-how-it-works-step-by-step)
- [08. HTTP API](#08-http-api)
- [09. Admin UI](#09-admin-ui)
- [10. Configuration](#10-configuration)
- [11. Security and reliability](#11-security-and-reliability)
- [12. Invariants](#12-invariants)
- [13. Testing checklist](#13-testing-checklist)
- [14. Boundaries of responsibility](#14-boundaries-of-responsibility)
- [15. Discrepancies between code and documentation](#15-discrepancies-between-code-and-documentation)

## 01. Business description

Activity answers the one question every organisation eventually asks: **"who did this?"**. Not "what is in the database now" — the content itself shows that — but "how did it come to be this way, by whose hand and when". The log is append-only: rows are only ever added, and the package has not one route for editing or deleting.

### The problem it solves

- **Incident investigation.** An entry vanished, somebody suddenly acquired permissions, somebody issued a long-lived API token — the log gives the actor, the exact time, and the little about the subject that is needed to find it elsewhere.
- **Editorial accountability.** Publishing, unpublishing, deleting and finally purging an entry are four different facts, and each is recorded as its own event kind, because to an auditor they are different events.
- **Access auditing.** Invitations, role changes, issuing a password-reset link, signing in through a corporate provider, issuing and revoking a bearer token — all of these are administrative actions, and they sit in the same stream as the editorial ones.
- **The log outlives its subjects.** `actor_id` has no foreign key, `actor_email` is a frozen snapshot, and `subject_id` is text. Delete a user, remove an entry, rename a workspace — the log row stays readable.

### Who sees it

#### Administrator

The only role holding `activity:read`. Sees the `/activity` page, the "Recent activity" panel on the home screen and the "Activity" tab on a member's card, and can ask the copilot.

#### Contributor and viewer

Do not see the _log_: the sidebar item is hidden, the home panel is not rendered, `GET /activity` refuses, and the tool is not offered to the copilot when its catalogue is assembled. They _do_ see **one entry's own trail** in the editor's Properties rail — a separate route under `content:read`, returning only rows about a record they may already open.

#### Plugin developer

Calls nothing directly. They raise a domain event into their own outbox — and must remember that a log row appears only if a mapper for that kind exists here.

### What Activity is not

- **It is not a per-workspace view.** The page and the copilot tool both read the whole installation, and their copy says "across this deployment" — it used to say "across the workspace", which lied to the administrator of a multi-workspace installation on the very page whose job is to be the source of truth. `activity_events` _does_ now carry a nullable `workspace_id` and the route accepts a `workspaceId` filter, so a scoped view became _buildable_ — but it is deliberately not built for the page: invitations, role changes, sign-in failures and the workspace's own lifecycle belong to no workspace, and a filter that silently drops them would be worse than its absence. The column exists so a narrow question can be asked (see the entry-scoped route), not to scope the log.
- **It is not the source of truth about permissions.** Permissions live in identity; Activity only reads the `PERMISSIONS.ACTIVITY_READ` constant and the `PermissionsGuard`.
- **It is not a debugging tool.** Technical logs, HTTP errors and stack traces never reach the log — only business facts somebody deliberately decided to record as an event kind.
- **It is not an alerting system.** Nothing is sent anywhere, there are no rules, no subscriptions and no export. There is a table and three read routes — and the third of them, `/dead-letters`, is the closest the package comes to raising its hand: it reports events that _failed_ to be recorded, so a reader can tell an empty log from an incomplete one.

> **The key architectural idea**
>
> The audit is **moved downstream** of the write. A producing plugin puts a domain event into the transactional outbox _in the same transaction_ as the mutation itself; after the commit, `OutboxDispatcher` delivers the event to the `AuditEventSubscriber`, and that is what writes the log row. The row's primary key is the **event's id**, and the insert is `ON CONFLICT DO NOTHING`. So at-least-once delivery is safe, and the write path and the audit path evolve independently.

## 02. Composition of the package group

The `packages/activity` group is **two** packages, split exactly along the server/admin seam. There is no domain package and no core, deliberately: **ADR-0003** says "do not impose DDD where there is CRUD", and Activity is a read context plus one appender. An empty `domain/` folder here would be a violation of the ADR rather than compliance with it.

| Package | npm name                  | Role                                                                                                                 | What it owns                                                                               |
| ------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| server  | @apograph/activity-server | The NestJS plugin: the outbox subscriber, a pure mapper, the read service, the controller, the schema and migrations | 1 table, 3 routes, `FACET_MAPPERS` over 62 event kinds, the `activity_recent` copilot tool |
| admin   | @apograph/activity-admin  | The admin plugin: the log page, the sidebar item, the home panel, a reusable hook                                    | `/activity`, `useActivityLog`, `ACTIVITY_KINDS`, `formatActivityAction`                    |

### The server package's layout

| Path                                                  | What is there                                                                                                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lib/schema/activity-events.ts                         | The single table plus three indexes                                                                                                                                           |
| lib/activity/infrastructure/audit-event-mapping.ts    | **The heart of the package.** The pure, database-free `toAuditRow` function, the `FACET_MAPPERS` table, the `UnmappableAuditEventError`, and the `AUDITED_EVENT_KINDS` export |
| lib/activity/infrastructure/audit-event.subscriber.ts | `AuditEventSubscriber` — the log's only live writer. It registers with the dispatcher in `onApplicationBootstrap`                                                             |
| lib/activity/services/activity.service.ts             | `ActivityService.list` (reading) and `record` (`@deprecated`; nothing writes through it)                                                                                      |
| lib/activity/controllers/list-activity.controller.ts  | A thin controller: the guard, the permission, delegation to the service                                                                                                       |
| lib/activity/dto/list-activity-query.dto.ts           | Every query parameter with validation and Swagger descriptions                                                                                                                |
| lib/activity/activity-filter.ts                       | `ACTIVITY_FILTER_SCHEMA` — the field allow-list for the filter builder                                                                                                        |
| lib/copilot/activity-tool.provider.ts                 | The `activity_recent` tool, registered in the shared tool registry                                                                                                            |
| migrations/0000_init.sql                              | The only migration; the journal table is `__drizzle_migrations_activity`                                                                                                      |

### The admin package's layout

The package is layered (ADR-0003) but **with no `domain/` layer** — there are no mutations and no client-side domain rules; it is a viewer over a projection.

| Layer           | Modules                                                                                                    | The rule                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| infrastructure/ | `activityGateway` (the port), `httpActivityGateway`, `activityMapper`, `activityKeys`                      | The only place `apiClient` is used; every error is normalised into an `ApiError`                                       |
| application/    | `useActivityLog`                                                                                           | Calls the gateway, never `apiClient`. Exported outwards — the member tab in `users-admin` uses it                      |
| presentation/   | The page, the components, `activityPlugin`, `activityFilterFields`, `activityMessages`, `activityDateTime` | Sees only view models and the hook; not one hardcoded action string                                                    |
| types/          | `activityEvent`, `activityKinds`                                                                           | The shared type core: the infrastructure mapper must be able to build them without depending on the presentation layer |

> **Neighbours that are easy to confuse**
>
> **`@apograph/database`** owns the outbox itself (`outbox_events`, `OutboxWriter`, `OutboxDispatcher`, the `DomainEvent` contract); Activity is merely one of its subscribers. **`@apograph/identity-server`** owns the `ACTIVITY_RECORDER` port and the `activity:read` permission, as well as the `IDENTITY_ACTIVITY_KINDS` catalogue from which Activity takes some of its kind strings. **`@apograph/alarms-server`** is also an outbox subscriber, but solves an entirely different problem (content checks), and its findings never reach the log.

## 03. The catalogue of event kinds

This is the dossier's most valuable part and at the same time the only place in the repository where the whole catalogue is gathered together in prose. The source is `FACET_MAPPERS` in `audit-event-mapping.ts`: **62 incoming domain events** mapping onto **60 distinct `kind` values** — the two collisions are deliberate, since `user.disabled` and `user.enabled` land on the same audit kinds as their `member.*` counterparts.

Read the table like this: **"Kind in the log"** is what sits in the `kind` column and what the UI filters on; **"Source event"** is the `kind` in `outbox_events`. They do not always match: `member.*` is renamed to `user.*`, `auth.signed_in` to `user.signed_in`, and `api_token.*` to `token.*`. The two catalogues are kept apart deliberately: a domain event names a fact in its own context, and an audit kind names it in the terms a person reads.

> **The catalogue is now checked, in both directions**
>
> Two lists are exported and pinned by `audit-event-mapping.spec.ts`. `AUDITED_EVENT_KINDS` is what the mappers _consume_; `AUDIT_KINDS` and `AUDIT_SUBJECT_TYPES` are what they _produce_ — the client contract. The spec drives every mapper once to prove the declaration honest, then compares it with the admin's `ACTIVITY_KINDS`, so a kind the server can write and the admin would render as a raw dotted token is a failing test, and so is a dead label the server can no longer produce.
>
> It reads the admin's catalogue module _as text_ rather than importing it: an import would put a React package in the audit plugin's TypeScript project graph. This closed the gap that let the three `user.sso_*` kinds ship rendering literally — see §15.

### 3.1 Identity and accounts

| Kind in the log            | Source event                 | Producer | Subject       | What it means                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | meta fields                                     |
| -------------------------- | ---------------------------- | -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| user.invited               | member.invited               | users    | user          | An administrator wrote an invitation; the account is created with status `pending`                                                                                                                                                                                                                                                                                                                                                                                                       | email                                           |
| user.invite_resent         | member.invite_resent         | users    | user          | The invitation was written again                                                                                                                                                                                                                                                                                                                                                                                                                                                         | email                                           |
| user.invite_revoked        | member.removed               | users    | user          | An invitee was deleted before activation. The audit kind is called "invitation revoked" rather than "deleted": only an unactivated account can be deleted                                                                                                                                                                                                                                                                                                                                | email                                           |
| user.password_reset_issued | member.password_reset_issued | users    | user          | An administrator issued a one-time reset link. Written at the moment of **issue** rather than redemption: handing out a link capable of taking over an account is an administrative action in its own right, and it must be attributed to whoever issued it, even if nobody ever used the link                                                                                                                                                                                           | email                                           |
| user.activated             | user.activated               | identity | user          | The invitation was accepted: the first password was set, and the status went `pending → active`. A separate fact from a sign-in — before this fix the log showed the invitation, then a sign-in, but never the moment the account became usable                                                                                                                                                                                                                                          | none (null)                                     |
| user.profile_updated       | member.profile_updated       | users    | user          | A member was renamed. The event is minted by the use case rather than the aggregate — only it knows the previous name                                                                                                                                                                                                                                                                                                                                                                    | name: {from, to}                                |
| user.role_changed          | member.role_changed          | users    | user          | A role change — that is, a change of permissions. The most readable row in the log when investigating access                                                                                                                                                                                                                                                                                                                                                                             | from, to                                        |
| user.suspended             | member.disabled              | users    | user          | A member was disabled; their sessions die along with it                                                                                                                                                                                                                                                                                                                                                                                                                                  | none (null)                                     |
| user.reactivated           | member.reactivated           | users    | user          | A disabled member was switched back on                                                                                                                                                                                                                                                                                                                                                                                                                                                   | none (null)                                     |
| user.password_changed      | user.password_changed        | identity | user          | A credential rotation — a self-service change or the redemption of a reset link. The actor in both cases is the account's owner: an administrator issued the link, but the person chose the password                                                                                                                                                                                                                                                                                     | sessionsRevoked                                 |
| user.signed_in             | auth.signed_in               | identity | user          | A sign-in, and **where from**. The IP and User-Agent used to be stored on the `sessions` row and nowhere else, so the log could say somebody signed in and never from where — and a session is eventually pruned while the audit row is not. A provider sign-in additionally records the method and the provider, the first question once a provider is broken or decommissioned                                                                                                         | ipAddress, userAgent (+ method:'sso', provider) |
| user.signed_out            | auth.signed_out              | identity | user          | A sign-out. Only the presented session is revoked                                                                                                                                                                                                                                                                                                                                                                                                                                        | none (null) — see the note below                |
| user.sign_in_failed        | auth.sign_in_failed          | identity | login_attempt | A password sign-in was **refused**. The one authentication fact the log did not record: `auth.signed_in` fires on success only, so a log full of successful sign-ins was equally consistent with nobody ever guessing and with a sustained attack. The subject is the **address**, not a user — the failures worth reading are exactly the ones with no account behind them. The HTTP response is unchanged, in body and in timing; the `reason` exists only in an `activity:read` store | reason, userId, ipAddress, userAgent            |
| user.session_revoked       | user.session_revoked         | identity | user          | An administrator ended **another member's** session. Distinct from `user.signed_out`, which is somebody ending their own: the subject here is the member who was signed out and the actor is the admin who did it. This was the one route under `/users/:id` that wrote nothing at all                                                                                                                                                                                                   | sessionId                                       |
| user.suspended             | user.disabled                | identity | user          | The identity aggregate's own lifecycle pair, mapped onto the same audit kinds as `member.*`. Nothing in the product calls `UserAccount.disable()` today, but the methods are public API of a published package, and an unmapped kind would reproduce this package's signature failure — an account silently locked out with nothing in the log                                                                                                                                           | none (null)                                     |
| user.reactivated           | user.enabled                 | identity | user          | The other half of the pair, for the same reason                                                                                                                                                                                                                                                                                                                                                                                                                                          | none (null)                                     |
| user.sso_linked            | user.sso_linked              | identity | user          | An external provider's subject was linked to an existing account — a **second** way in now exists. Written once per link, not on every sign-in                                                                                                                                                                                                                                                                                                                                           | provider                                        |
| user.sso_provisioned       | user.sso_provisioned         | identity | user          | An account was created from a verified profile — with no invitation and no password. The only path in the product by which an account nobody explicitly invited comes into being                                                                                                                                                                                                                                                                                                         | provider, role                                  |
| user.sso_role_mapped       | user.sso_role_mapped         | identity | user          | The role-mapping handler changed a role at sign-in — that is, permissions were changed by something other than an administrator. Written only on an actual change, or the row would appear on every sign-in for the rest of the account's life                                                                                                                                                                                                                                           | provider, role                                  |

> **Two losses of information visible only in the code — both still open**
>
> **Back-channel logout.** `sso-backchannel-logout.use-case.ts` puts `{ method: 'sso_backchannel', provider }` into the event, but the `auth.signed_out` mapper hardcodes `meta: null`. In the log a provider-initiated sign-out looks exactly like an ordinary user sign-out. The asymmetry got sharper rather than smaller: `auth.signed_in` now carries the IP, the User-Agent _and_ the method; `signed_out` still carries nothing.
>
> **The back-channel sign-out's actor.** In the same place the actor is given `email ?? ''` — an empty string instead of an address snapshot, so the log row gets an actor with no readable name.

### 3.2 Workspaces

Here the audit kind and the event kind are **the same string** (the catalogue belongs to identity, in the `IDENTITY_ACTIVITY_KINDS` constants). The important exception is membership: the row's subject becomes the **user**, not the workspace.

| Kind (= event)            | Producer   | Subject   | What it means                                                                                                                                        | meta fields        |
| ------------------------- | ---------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| workspace.created         | workspaces | workspace | A workspace was created                                                                                                                              | name, slug         |
| workspace.updated         | workspaces | workspace | A workspace's attributes were changed                                                                                                                | fields: string\[\] |
| workspace.archived        | workspaces | workspace | A workspace was archived                                                                                                                             | {}                 |
| workspace.unarchived      | workspaces | workspace | A workspace was brought back from the archive                                                                                                        | {}                 |
| workspace.deleted         | workspaces | workspace | A workspace was deleted; the name and slug are frozen into `meta`, because there is nowhere else left to look them up                                | name, slug         |
| workspace.member_added    | workspaces | user      | A member was added to a workspace. The subject is the **member**: "what happened to this person" matters more than "what happened to this workspace" | workspaceId, email |
| workspace.member_removed  | workspaces | user      | A member was removed. `email` may be `null` if the account no longer exists                                                                          | workspaceId, email |
| workspace.content_granted | workspaces | workspace | A workspace was granted access to a content type                                                                                                     | slug, kind         |
| workspace.content_revoked | workspaces | workspace | Access to a content type was revoked (possible only when the workspace holds no entries of that type)                                                | slug               |

### 3.3 Content

The audit kind equals the event kind. Seven rows cover an entry's whole lifecycle. Two of them (`entry.published`/`entry.unpublished`) are raised by the `Entry` aggregate, and the other five are minted by builders and raised by the write path: "created" has no invariant that can be violated, so there is no reason to erect an aggregate around the fact (and a publication status on a type that is never published).

| Kind (= event)    | Subject       | What it means                                                                                                                                                                                                                                                                        | meta fields                            |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| entry.created     | content_entry | A new entry appeared                                                                                                                                                                                                                                                                 | contentType, title                     |
| entry.updated     | content_entry | The entry's values changed. `fields` is what turns the row from a fact into a review: "edited the heading and the body" rather than "somebody saved". A save that changed nothing produces **no event at all**, so the log counts editorial changes rather than visits to the editor | contentType, title, fields: string\[\] |
| entry.published   | content_entry | The entry was published (re-publishing is idempotent and produces no event)                                                                                                                                                                                                          | contentType, title                     |
| entry.unpublished | content_entry | The entry was unpublished (unpublishing an already-draft entry is a no-op with no event)                                                                                                                                                                                             | contentType, title                     |
| entry.deleted     | content_entry | The entry was deleted. `soft` distinguishes two very different facts: a tombstone recoverable from the bin, and a row that left the table at commit time                                                                                                                             | contentType, title, soft: boolean      |
| entry.restored    | content_entry | The tombstone was lifted and the entry came back                                                                                                                                                                                                                                     | contentType, title                     |
| entry.purged      | content_entry | The entry was destroyed for good. The only content action after which there is nothing left to investigate — which is why this row is the entire remaining trace, and why `title` matters most here                                                                                  | contentType, title                     |

> **Every entry row now names the record and its workspace**
>
> `title` is a **frozen snapshot** of the entry's label at the moment of the event, taken by the writer from the row it is writing — not a lookup. An audit row keeps no foreign key and no denormalised name, so its whole handle on the subject was a uuid: survivable while the entry exists, and permanently unreadable after `entry.purged`, which is precisely the row this is the last remaining record of.
>
> `workspaceId` rides the same payload and is lifted into the row's own column. Entries are the most-produced audited fact in the product, so an entry event that omitted it would have left that column mostly empty and the workspace-shaped question mostly unanswerable.

### 3.4 The media library

The audit kind equals the event kind, and `meta` is **the event's whole payload minus the `actor` key** (which now includes `workspaceId` on every one of them, since both aggregates hold it). It works that way because media payloads are fundamentally different in shape: an upload carries the file's name and kind, an update only the field that changed, a move the destination folder, and a delete the storage key. Flattening that into one shape would lose exactly what the row is read for.

| Kind (= event)       | Subject      | What it means                                                                                                                                     | meta fields                   |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| media.asset.uploaded | media_asset  | A file was uploaded into the media library                                                                                                        | name, kind, folderId          |
| media.asset.updated  | media_asset  | **One** attribute of a file changed. One kind for four different edits — the aggregate raises it from `rename`, `retag`, `setTracks` and `setAlt` | name \| tags \| tracks \| alt |
| media.asset.moved    | media_asset  | A file was moved to another folder (`null` means the root)                                                                                        | folderId                      |
| media.asset.deleted  | media_asset  | A file was deleted. The storage key travels in `meta`, because the same event is the seam for garbage collection in the blob store                | storageKey, storageProvider   |
| media.folder.created | media_folder | A folder was created                                                                                                                              | name, parentId                |
| media.folder.renamed | media_folder | A folder was renamed                                                                                                                              | name                          |
| media.folder.deleted | media_folder | A folder was deleted                                                                                                                              | {}                            |

### 3.5 External API tokens

| Kind in the log | Source event      | Subject   | What it means                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | meta fields                                            |
| --------------- | ----------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| token.created   | api_token.created | api_token | A long-lived bearer token to workspaces' content was issued. The subject is the token itself, and the issuing administrator arrives as the actor                                                                                                                                                                                                                                                                                                                                                                                                                                                   | name, scope, workspaceIds, lookupPrefix                |
| token.revoked   | api_token.revoked | api_token | The token was revoked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | name, scope, workspaceIds, lookupPrefix                |
| token.used      | api_token.used    | api_token | The token authenticated a request. **Throttled, not per request**: it rides the same schedule as the token's `last_used_at` touch — at most one row per token per minute — because the question worth answering is "was this credential live, and over what period", not "how many requests did it make". `last_used_at` already answers "when was it last used"; what it cannot answer is the _shape_ over time, and a token dormant for six months that woke up on Tuesday reads identically to one in daily use. `previousUseAt` is the gap, and the touch overwrites the only other copy of it | name, scope, workspaceIds, lookupPrefix, previousUseAt |

> **Why a token's meta holds neither the secret nor its hash**
>
> `api_tokens` stores only a SHA-256 — precisely so that reading _another_ table yields no working credential. The log is another table, and one deliberately lower in trust: every administrator sees it and the copilot reads it. So `meta` carries only the non-secret `lookupPrefix` — enough to match the log row against a row on the tokens screen, and nothing more.

### 3.6 Content transfer

The audit kind equals the event kind, and the subject is the **content type** that moved — there is no single entry to point at, since an export names a selection and an import names a file, and both fan out across relations, files and locales.

| Kind (= event)            | Subject      | What it means                                                                                                                                                                                                                                                                                                                                                                                                        | meta fields                           |
| ------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| transfer.content.exported | content_type | Content left the system in bulk, files included. **An export is a read that raises an audit event**, which is unusual enough to say why: nothing in the content tables changes, so this row is the only record that it happened. It is written _before_ a byte streams — a download interrupted halfway still moved data, and recording only completed transfers would leave the most interesting case with no trace | workspaceId, format, selected, counts |
| transfer.content.imported | content_type | Content was written in from a file. The individual writes also appear as `entry.created`/`entry.updated` — an import goes through `EntryWriterService` like any other write — but those rows say a hundred entries changed, not that one person imported a file. Different facts, and an operator asks about the second                                                                                              | workspaceId, counts                   |

### 3.7 Reader entitlements (segments)

Segments answer **who may read published content**. Four access-control decisions that produced no event of any kind until recently, so the log could not answer "when did this article stop being public, and who decided that": an entry's revisions carry its access, but only for entries saved afterwards, and a segment's tag list is in no revision at all.

| Kind (= event)               | Subject       | What it means                                                                                                                                                                                                                                                                                                                                                                                                                                | meta fields                                        |
| ---------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| segment.created              | segment       | An audience came into existence                                                                                                                                                                                                                                                                                                                                                                                                              | key, label, tags, workspaceIds                     |
| segment.updated              | segment       | An audience was renamed, re-tagged or re-scoped. **Re-tagging is the one that matters most and is the least visible**: the audience keeps its name and its entries while the set of readers it resolves to changes completely, so the row records the tags on both sides                                                                                                                                                                     | key, label, tags:{from,to}, workspaceIds:{from,to} |
| segment.deleted              | segment       | An audience was deleted — and with it, its mention on every entry that named it. That second half is a bulk change to stored access with no screen for it, and after the commit there is nowhere left to look the audience up                                                                                                                                                                                                                | key, label, tags, workspaceIds                     |
| segment.entry_access_changed | content_entry | An entry's allow/deny lists were replaced, on every locale of the record — access travels with the record rather than the translation. **The subject is the entry, not the segment**, deliberately: "who may read this" is a fact about the record, so the row belongs in that entry's own history beside its edits and publishes, which is where somebody asking why nobody can read it will look. One row per decision, not one per locale | workspaceId, contentType, allow, deny, entryIds    |

### 3.8 Content checks (alarms)

The **rules**, never the findings. An alarm never gates a write (ADR-0015), which is exactly why its configuration is worth a row: disable a rule and everything downstream — the entry rail's checks block, the records column, the alarms page — simply goes quiet, with nothing saying a person chose the silence, and after a delete the rule that would have explained it is gone. Findings stay unaudited: one per matching entry per sweep would make the trail a metrics feed.

| Kind (= event)       | Subject    | What it means                                                                                                                                                                                                                      | meta fields                                                      |
| -------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| alarm.rule.created   | alarm_rule | A rule was written                                                                                                                                                                                                                 | workspaceId, name, contentType, severity, enabled                |
| alarm.rule.updated   | alarm_rule | A rule was edited. `enabled` is called out on both sides because a disabled rule is indistinguishable from a rule that finds nothing                                                                                               | workspaceId, name, fields, enabled:{from,to}, severity:{from,to} |
| alarm.rule.deleted   | alarm_rule | A rule was deleted, taking every finding it produced with it by FK cascade                                                                                                                                                         | workspaceId, name, contentType, severity                         |
| alarm.rule.rescanned | alarm_rule | A rule was re-run across its whole collection by hand — the manual recovery path, so this row is what explains a jump in a workspace's finding counts that no rule edit accounts for. Recorded after the scan, carrying its result | workspaceId, name, scanned, opened, resolved, open               |

### 3.9 Saved list views

A view is a bookmark rather than a grant — it replays through the ordinary list query with the reader's own permissions, so it can never show anyone a row they could not already reach. It is audited because a `workspace`-visible view is genuinely shared state: it is in every member's switcher, sharing it is its own permission (`views:share`), and deleting one takes it away from everybody.

| Kind (= event)     | Subject    | What it means                                                                                                                                       | meta fields                                            |
| ------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| saved_view.created | saved_view | A slice was saved under a name                                                                                                                      | workspaceId, scope, name, visibility                   |
| saved_view.updated | saved_view | Renamed, re-captured, or shared/unshared. `visibility` is on both sides: unsharing takes a view out of every member's switcher without telling them | workspaceId, scope, name, fields, visibility:{from,to} |
| saved_view.deleted | saved_view | A view was deleted                                                                                                                                  | workspaceId, scope, name, visibility                   |

**Setting a personal default raises nothing, deliberately.** It is the reader's own landing choice — the same class of thing as `PUT /preferences` — and it is set by clicking a view. A row per click would be a usage metric wearing an audit row's clothes, in a log with no way to filter it out.

### 3.10 Copilot

Authority a human hands the agent, and nothing else. A **skill** is standing instruction: it changes what the copilot does in a workspace on every future run, and one set to `auto` runs without being asked for. A **tool permission** is the same decision at one moment — a person allowing one parked call to proceed, bounded by human interaction rather than by traffic.

| Kind (= event)                  | Subject       | What it means                                                                                                                                                                                                                                                                                                                                                                                                                                                            | meta fields                                                  |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| copilot.skill.created           | copilot_skill | A skill was written into a workspace                                                                                                                                                                                                                                                                                                                                                                                                                                     | workspaceId, name, title, mode, enabled                      |
| copilot.skill.updated           | copilot_skill | A skill was edited. `mode` and `enabled` are the two that matter: `auto` means it applies without being asked for, and a disabled skill is indistinguishable from one that never matched                                                                                                                                                                                                                                                                                 | workspaceId, name, fields, mode:{from,to}, enabled:{from,to} |
| copilot.skill.deleted           | copilot_skill | A skill was deleted; its details are frozen here because there is nowhere left to look them up                                                                                                                                                                                                                                                                                                                                                                           | workspaceId, name, title, mode                               |
| copilot.tool_permission.decided | copilot_run   | A person allowed or refused one tool call in a running turn. The subject is the **run**, which is the handle a reviewer has — a transcript is read by run id. Recorded only when the decision was actually _delivered_: a late answer to a run that already gave up had no effect, and a row for it would report authority that was never granted. The run's own transcript records it too, but a transcript is a conversation its author can delete, not an audit store | workspaceId, callId, decision                                |

**Starting a run is not audited, and neither is renaming a conversation.** Everything a run _does_ is already recorded where it happens — under ADR-0009 an applied change is an `entry.*` row, and it now carries the run that produced it (see `via` in §05). A row per run would be a usage metric with no way to filter it out.

### 3.11 Facts that are still not events

The catalogue's remaining holes, as of this revision. Neither is a mapper problem — there is no event to map.

| What is not recorded                                | Where                 | Why it is worth knowing                                                                                                                                  |
| --------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setting a **personal default** view                 | SetDefaultViewUseCase | Deliberate — see §3.9. A landing choice set by clicking, not a change to shared state                                                                    |
| Starting a copilot **run**; renaming a conversation | copilot/server        | Deliberate — see §3.10. What a run does is audited where it happens                                                                                      |
| Alarm **findings**                                  | AlarmEvaluator        | Deliberate — see §3.8. One per matching entry per sweep is a metric, not an audit fact                                                                   |
| **Reads** of content                                | —                     | Not deliberate so much as unaddressed. Who viewed a record is nowhere; the closest thing is `transfer.content.exported`, which covers only the bulk case |

> **The catalogues no longer diverge — and cannot, silently**
>
> Until recently the server wrote **40** kinds while the admin's `ACTIVITY_KINDS` knew **37**: it did not know `user.sso_linked`, `user.sso_provisioned` or `user.sso_role_mapped`, and the "Action" column rendered those literally. Neither a compile error nor a runtime one — the mapper casts `dto.kind as ActivityKind` unchecked and `formatActivityAction` falls back to the raw string. The `apps/admin-e2e` suite written to catch exactly this could not: its `ALL_KINDS_ACTIVITY` seed was built from the same 37 strings, so it proved the list self-consistent and nothing more.
>
> Both halves are now covered, by three different mechanisms: `Record<ActivityKind, …>` makes a missing _label_ a compile error inside the admin; the e2e suite proves each kind actually _renders_; and `audit-event-mapping.spec.ts` compares the server's `AUDIT_KINDS` with the admin's list **in both directions**, so a kind the server can write and the admin cannot render, and a dead label the server can no longer produce, are both failing tests.

## 04. Roles and permissions

The package has **one** permission of its own — `activity:read` (the `PERMISSIONS.ACTIVITY_READ` constant, declared in `identity-server`, in `rbac/system-roles.ts`). There is no write permission and there cannot be one: the log is not written by a person but by a subscriber.

It also _borrows_ one. `GET /activity/entries/:entryId` is gated on **`content:read`**, not on `activity:read`, and that is the whole point of it existing separately: the full log is admin-only for good reasons — it carries invitations, role changes and sign-in failures across the deployment — with the consequence that an **editor could not see the history of their own content**. Every row that route can return is about a record the caller may already open, so it needs no authority beyond having opened it.

| Permission    | What it opens                                                                                                 | admin | contributor | viewer |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ----- | ----------- | ------ |
| activity:read | `GET /api/activity`, the `/activity` page, the home panel, the member tab, the `activity_recent` copilot tool | ✓     | —           | —      |

The `admin` role gets the permission not as "activity" specifically but because its set is a **full enumeration** of `PERMISSION_KEYS`. Neither `contributor` nor `viewer` enumerates it.

| Permission   | What it opens                                                                                                                            | admin | contributor | viewer |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------- | ------ |
| content:read | `GET /api/activity/entries/:id` and the Activity block in the entry editor's rail — one record's own trail, scoped to the open workspace | ✓     | ✓           | ✓      |

### The four places `activity:read` is checked

- **The route** → `@UseGuards(PermissionsGuard)` + `@RequirePermissions(PERMISSIONS.ACTIVITY_READ)` on the controller class. This is the only real check.
- **The sidebar item** → the slot descriptor names `permission: 'activity:read'`, and the shell's `SidebarNavButton` hides the item. Cosmetic, but honest.
- **The page** → `useHasPermission('activity:read')`; without the permission `ActivityNoAccess` renders and the request **never goes out** (`enabled = canRead`).
- **The copilot tool** → `requires: [PERMISSIONS.ACTIVITY_READ]`. The capability profile withholds the tool **at offer time** (ADR-0005 §3) rather than refusing on call: a contributor's run never learns such a tool exists.

> **Why the copilot tool is not scoped to a workspace**
>
> There is nothing to scope it by: the table has no workspace column. The tool's description says outright that its reach is the whole installation, rather than implying a boundary it cannot enforce. The only boundary is `activity:read`, and it is the same one the page has. An administrator who asks the copilot about the log reads exactly what they already see on screen.

## 05. Data model

One table, two migrations (`0000_init` and `0001_actor_type_and_workspace`), and its own journal table `__drizzle_migrations_activity`. The plugin opens no connection — the Drizzle client is injected from `@apograph/database` through `@InjectDatabase()`.

| Column       | Type                 | Purpose, and why it is this way                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | uuid PK              | Defaults to `gen_random_uuid()`, but the subscriber **always supplies the event's id**. That is the idempotency key                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| kind         | text NOT NULL        | An open string of the form `domain.action`. Not an enum and not a foreign key onto a dictionary: the catalogue belongs to the producers, not to the sink                                                                                                                                                                                                                                                                                                                                                                                                   |
| subject_type | text NOT NULL        | Thirteen actual values, exported as `AUDIT_SUBJECT_TYPES`: `user`, `workspace`, `content_entry`, `content_type`, `api_token`, `media_asset`, `media_folder`, `login_attempt`, `segment`, `alarm_rule`, `saved_view`, `copilot_skill`, `copilot_run`                                                                                                                                                                                                                                                                                                        |
| subject_id   | text NOT NULL        | **text rather than uuid**: subjects are not always users and are not always keyed by a uuid. The only handle the row keeps on its subject — no foreign key and no denormalised name                                                                                                                                                                                                                                                                                                                                                                        |
| actor_id     | uuid NULL            | **No foreign key** — the actor may later be deleted, and the row must remain. `null` means a system event                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| actor_type   | text NULL            | What `actor_id` _names_ — `user` or `api_token`. It used to mean "a `users` row" and nothing else, so a write made with a bearer token had to pass **no actor at all** rather than name a person who did not do it: every write over the public REST API, GraphQL and MCP recorded as "System", and which of a workspace's tokens did it was unrecoverable from anywhere. Nullable, because a system-initiated event still has no actor; the migration backfills `'user'` for every existing actored row, which is a statement of fact rather than a guess |
| actor_email  | text NULL            | A frozen snapshot of the address at write time: the log stays readable after the account is deleted or renamed. For an `api_token` actor it carries the token's **label** instead — a token has no address, and a row showing a bare uuid names nothing a reader recognises                                                                                                                                                                                                                                                                                |
| workspace_id | uuid NULL            | Where it happened, or `null` when it belongs to no workspace. **Not a scoping boundary** — `activity:read` still is. What it buys is the ability to _ask_ a workspace-shaped question, which previously had no answer at any price, and it is what lets the entry-scoped route fail closed. Filled from the emitting event's own `payload.workspaceId`, so a producer that has one puts it there                                                                                                                                                           |
| meta         | jsonb NULL           | An open payload; each kind's shape is owned by the producer. Not indexed and not part of the filterable surface. May additionally carry a `via` key — see the note below                                                                                                                                                                                                                                                                                                                                                                                   |
| at           | timestamptz NOT NULL | The fact's **logical** time — taken from `event.occurredAt`, that is, when it happened rather than when it was delivered                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| created_at   | timestamptz NOT NULL | The time of the physical write. **Never selected** in `list` and never sent over the wire — an internal detail                                                                                                                                                                                                                                                                                                                                                                                                                                             |

> **meta.via — how, as against who**
>
> A copilot proposal applies under the authority of the person who accepted it, so the actor is correctly that human — there is no copilot identity and there must not be one. What was missing is that the resulting row was then indistinguishable from one they typed: under **ADR-0009** a proposal applies as it is drafted, so "Ada updated three articles" could equally mean Ada edited three articles or that Ada accepted one agent turn that rewrote them.
>
> `via` rides on the actor (`attachActor`) and is lifted into `meta` by the mapper, merged with the kind's own payload rather than replacing it — a copilot-applied entry update is still an entry update, and a reader wants the changed fields _and_ the run that changed them. Two mechanisms use it today: `{ kind:'copilot', runId, proposalId }` and `{ kind:'revision_restore', revisionNumber }`, the latter so a restore says which version it put back rather than reading as a plain edit. Absent on the overwhelming majority of rows.

### The indexes — for exactly four query shapes

| Index                         | Columns                        | Which question it serves                                                                |
| ----------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| activity_events_subject_idx   | (subject_type, subject_id, at) | "This subject's history" — the member tab, an entry's history                           |
| activity_events_actor_idx     | (actor_id, at)                 | "What did this person do"                                                               |
| activity_events_kind_idx      | (kind, at)                     | "Every publication", "every token issue"                                                |
| activity_events_workspace_idx | (workspace_id, at)             | "What happened in this workspace" — a question the table could not answer at all before |

> **Retention and volume — what is missing**
>
> **The package has not one mechanism for trimming the log.** No scheduled job, no delete route, no retention setting, no partitioning — the table grows without bound, by design (the log is append-only). In practice that means the volume is set by the most frequent event kind: `user.signed_in`, a row per sign-in, and `entry.updated`, a row per effective save (an empty save produces no event, and that is the only built-in limiter). A row is compact, but media's `meta` carries the event's whole payload, the `tracks` array included. Worth remembering separately: `outbox_events` grows downstream as well — delivered rows are never removed there either (a partial index merely takes them off the hot path). The list is sorted by `at` with `id` as a tiebreaker, and a page is taken with `LIMIT/OFFSET` — which is unavoidably expensive at a large offset; there is no keyset pagination.

### What the table deliberately does not store

- **The workspace.** There is no column — and adding a workspace filter to the UI is explicitly forbidden by the package's conventions: there is nothing to filter by, and it is the text that needs fixing, not the query.
- **The subject's name.** Only `subject_id`. A name, where one is needed at all, is put into `meta` by the producer (`workspace.deleted` → `name`, `media.folder.renamed` → `name`).
- **Diffs.** At most a list of changed fields (`fields`) and transitions of the form `{from, to}`. The log stores no "before" values.
- **Secrets.** No passwords, no hashes, no tokens and no token hashes.

## 06. An event's lifecycle

Two lifecycles have to be understood at once: that of an `outbox_events` row (owned by `@apograph/database`) and that of an `activity_events` row (owned by Activity). The second is derived from the first.

**the mutation + the event in one transaction** → **outbox: dispatched_at IS NULL** → **delivery to subscribers** → **outbox: dispatched_at ≠ NULL**

on a subscriber failure: **attempts++ , next_attempt_at** → ×15 → **dead letter: attempts ≥ 15, dispatched_at IS NULL**

### Three outcomes for a delivered event

#### A mapper exists → a row

`toAuditRow` returns an `AuditRow`, the subscriber inserts it `ON CONFLICT DO NOTHING`, and the dispatcher stamps `dispatched_at`. The normal path.

#### No mapper → silence

The dispatcher finds no subscriber for that kind at all (the subscriber's `kinds` list is `AUDITED_EVENT_KINDS`), the loop over subscribers makes zero iterations, and the row is stamped `dispatched_at`. **No error, no log line, no trace.**

#### The mapper refused → a dead letter

`UnmappableAuditEventError` escapes, the dispatcher increments `attempts`, sets `next_attempt_at` and retries with exponential backoff until it parks the row.

### null and an exception mean different things — the package's central decision

`toAuditRow` returns `null` when the kind is absent from `FACET_MAPPERS`: "this is not our event, skip it". And it throws `UnmappableAuditEventError` when the kind **is** ours but the payload does not let it name a subject.

Why not substitute an empty string? Because `subject_id` is the only handle the row keeps on its subject: there is no foreign key, no denormalised name, and `actor_email` belongs to the actor. An empty string passes the `text NOT NULL` check and yields a row naming the action, the workspace and the actor — but not the subject. That is not a degraded record but an **unreadable** one, and nobody can repair it after the fact. Refusing makes the hole loud: the row stays in the outbox, is retried with backoff and eventually lands in the dead-letter selection `dispatched_at IS NULL AND attempts >= 15`. Today exactly one mapper can refuse — `membershipSubject`, when the payload has no `userId`.

### Delivery parameters (owned by `@apograph/database`)

| Parameter                                | Value         | What it means for the audit                                                                                                                                                   |
| ---------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DRAIN_BATCH_SIZE                         | 100           | How many rows one drain claims (`FOR UPDATE SKIP LOCKED`, oldest first)                                                                                                       |
| POLL_INTERVAL_MS                         | 5000          | The safety-net poll. The main trigger is a `drain()` call right after the unit of work commits, and it is awaited, so the log row usually exists by the time the API responds |
| MAX_DELIVERY_ATTEMPTS                    | 15            | After that the row is not claimed at all — otherwise a full batch of permanently failing rows would stick at the head of the queue and new events would stop being delivered  |
| RETRY_BASE_DELAY_MS / RETRY_MAX_DELAY_MS | 1000 / 300000 | Doubling with a plateau at five minutes: roughly half an hour of window before a row is declared a dead letter. With no delay, 15 attempts would burn out in milliseconds     |

> **The log insert is not part of the dispatcher's transaction**
>
> `AuditEventSubscriber.handle` writes through the **root** `this.db` client rather than through the transaction in which the dispatcher claimed and stamps the outbox row. That means a divergence is theoretically possible: the log row was inserted while the `dispatched_at` stamp rolled back — the event will then be delivered again, and only `ON CONFLICT DO NOTHING` saves it. The reverse order (the stamp went through, the insert did not) is impossible, because a subscriber's exception rolls the stamp back. So idempotency here is load-bearing rather than decorative.

## 07. Flows — how it works, step by step

### 7.1 The general pipeline: from an action to a log row

This is the skeleton shared by every kind. The flows that follow cover the cases where the specifics matter.

1. **A user performs an action.** Any writing route of any plugin — publishing an entry, an invitation, a file upload.
2. **An aggregate or a use case raises a domain event.** The aggregate names the fact (`entry.published`), and the use case adds what the aggregate cannot know (`sessionsRevoked` — the aggregate has no idea sessions exist; a member's previous name — only the use case knows it).
   _an event is a fact, not a command: the past tense in the name is no accident_
3. **The actor is attached to the payload.** `attachActor(events, { id, email })` puts the id and the address into `payload.actor`. That is the only way the subscriber learns who acted: it has no HTTP context and can have none — it runs after the response.
4. **The event is written to the outbox _in the same transaction_ as the mutation.** That is the transactional outbox: the event commits if and only if the change does. No two-phase commit is needed.
   _the row: dispatched_at IS NULL, attempts = 0_
5. **After the commit the unit of work calls `drain()`.** The call is awaited, so the log row usually exists by the time the HTTP response leaves for the client. The five-second poll is only insurance against the process dying between the commit and the drain.
6. **The dispatcher selects subscribers by kind.** `AuditEventSubscriber` has `kinds = AUDITED_EVENT_KINDS` — that is, the keys of `FACET_MAPPERS`. An event outside that list never reaches the audit at all.
7. **The mapper builds a row.** A pure function with no database: it picks the audit kind, the subject's type and id, assembles `meta`, lifts the actor off the payload into separate columns, and sets `at = event.occurredAt` and `id = event.eventId`.
   _the actor is not duplicated into meta — it already has two columns of its own_
8. **An insert with `ON CONFLICT DO NOTHING`.** Re-delivering the same event lands on the same primary key and silently does nothing.
9. **The dispatcher stamps `dispatched_at`.** The event is handled; the outbox row stays in the table forever but drops out of the partial index of pending rows.

### 7.2 Inviting a member — why the actor and the subject differ

1. **An administrator presses "Invite".** The users plugin creates a `Member` aggregate, which raises `member.invited` with `{ email }`.
2. **`attachActor` makes the administrator the actor,** while the event's `aggregateId` is the **invitee's** id. That is where the row's asymmetry comes from: the subject is the person invited, the actor the person who invited them.
3. **The mapper renames the kind:** `member.invited → user.invited`. The two catalogues are kept apart because "member" is a term from the member-management context, while the log is read in account terms.
   _the rename is pinned by a parity unit test — it compares the row against what the old in-band recorder wrote_
4. **The person opens the link and sets a password.** The `accept-invite.use-case.ts` use case puts **two** events into the outbox: `user.activated` (the account became usable) and `auth.signed_in` (a session was issued).
5. **Two rows appear in the log.** Two precisely because these are two different facts: "the account received credentials and moved to `active`" and "somebody signed in". Before `user.activated` was added to `FACET_MAPPERS`, the event was raised and stamped delivered but produced no row — the log showed the invitation, then a sign-in, and never the activation itself.
6. **The actor of both rows is the invitee.** An administrator issued the link, but the person chose the password, and at the moment of these events they are already acting in their own name.

### 7.3 Publishing and editing an entry

1. **An editor presses "Publish".** The `Entry.publish(gate)` aggregate checks the publish gate first, then the status transition, and only then raises `entry.published` with `{ contentType }`.
2. **Re-publishing produces no event.** An already published entry is an idempotent early return. The log must not fill up with rows about things that did not happen.
3. **Editing takes a different path.** `entry.updated` is minted not by the aggregate but by the `EntryWriterService` write path, because the fact "the values changed" has no invariant of its own, and building an aggregate around it (with a publication status a non-publishable type does not have) is unnecessary.
4. **The list of changed fields is computed by comparison.** The stored row is compared with the one being written; `fields` is the difference. The side effect is fundamental: **a save that changed nothing produces no event at all** — not a resubmitted form, not a reopened editor, not restoring a version that is already live. The log counts editorial changes rather than round trips through the interface.
   _an empty fields in an old row is an old row, not a no-op_
5. **Deletion forks on `soft`.** One route, two different facts: for a "paranoid" type a recoverable tombstone is set, and for the rest the row leaves the table at commit time. The `soft` flag answers the log reader's question, "can it be brought back?".
6. **The final purge is its own kind.** `entry.purged` is not merged into a second `entry.deleted`: it is the only content action after which there is nothing left to investigate, and therefore the only one for which the log row is the entire remaining trace.

### 7.4 The media library — a flow that was completely silent

Instructive as an illustration of the rule "adding a producer = adding a mapper".

1. **The media aggregates raised their seven events from the start.** Their own comment calls the outbox "the seam for audit and blob garbage collection" outright.
2. **There was no subscriber for them.** The dispatcher found no recipient, stamped the row delivered and moved on.
3. **The result: the log said nothing about the whole media library.** Uploading, renaming, moving and deleting a file, creating, renaming and deleting a folder — eight write paths, eight delivered outbox rows, zero audit rows.
4. **The fix was seven lines in `FACET_MAPPERS`.** The event kind was taken as the audit kind one to one: unlike `member.*`, media had no earlier audit catalogue to stay compatible with, and inventing a second set of names would have created one more correspondence to remember.
5. **`meta` is the whole payload, minus the actor.** The kinds' shapes differ by design, and that difference is exactly what answers "what happened to this file".
6. **Checking that this cannot recur is one query:** compare `select distinct kind from outbox_events` against `AUDITED_EVENT_KINDS`. Plus the `apps/server-e2e/src/server/activity/activity-coverage.spec.ts` suite, where every assertion is a **pair**: the mutation raised an event _and_ a row appeared. Either half on its own passes with an empty log.

### 7.5 An event with no mapper: what exactly happens

1. **The producer puts the event into the outbox.** The row commits with the mutation — everything here is honest.
2. **The dispatcher claims the row** and calls `subscribersFor(kind)`: a filter on `subscriber.kinds.includes(kind)`.
3. **No subscriber matches.** The list is empty, the loop over subscribers makes zero iterations, and there is no exception.
4. **The row is stamped `dispatched_at`.** From the outbox's point of view the event was delivered successfully.
5. **The action is not in the log and never will be.** No error, no warning in the log, no counter, no metric. It can only be reconstructed after the fact from `outbox_events`, while that table is untrimmed — and nobody trims it, so there is plenty of margin, but that is luck rather than a decision.
   _this has already happened three times: API tokens, entry publications and the whole media library_

> **Why it is left exactly like this**
>
> The alternative — failing on an unknown kind — would turn Activity from a sink into a blocking gateway: any plugin raising a new event would break delivery for everyone else until a mapper was added here. A sink that knows every catalogue in the world is exactly the coupling this package avoids. The price of the decision is silence, and it is compensated not with code but with discipline: the checklist "new producer → new mapper", one SQL query for reconciliation, and a paired e2e suite.

### 7.6 An event that cannot be recorded honestly

1. **A `workspace.member_added` arrives with no `payload.userId`.** The `membershipSubject` mapper must name the _member_ as the subject rather than the workspace, and it has nowhere to get the id.
2. **The mapper throws `UnmappableAuditEventError`.** It used to substitute an empty string here: that passes `NOT NULL` and produced a row naming the action, the workspace and the actor — but no subject. In the interface such a "Subject" cell has no accessible name at all.
3. **The dispatcher catches the exception,** increments `attempts`, computes `next_attempt_at` and logs the error with its stack.
4. **The row stays undelivered and is retried with a doubling delay** — roughly half an hour to the ceiling.
5. **On the fifteenth attempt the row is parked.** The dispatcher stops claiming it, and the log names the dead-letter query explicitly. The queue behind it keeps moving — that is the point of the attempt ceiling.
6. **An operator fixes the cause and "replays" the row** by zeroing `attempts`. The event never left the table.

### 7.7 Re-delivery

1. **Delivery is guaranteed at least once.** A drain could have failed between the log insert and the stamp, the process could have taken a `SIGTERM` mid-batch, two processes could have drained overlapping sets.
2. **The log row's primary key is the event's id,** not a generated uuid. That turns "the same event" into "the same key".
3. **`ON CONFLICT DO NOTHING` on `activity_events.id`** makes a repeat literally nothing: no duplicate, no error, no update of the existing row. It matters that this is `DO NOTHING` and not `DO UPDATE`: the first version of a row written is immutable, as an audit's should be.
4. **A graceful shutdown waits for an active drain.** `onModuleDestroy` used only to clear the timer, and a drain caught by `SIGTERM` was abandoned mid-batch — the subscribers had run, the stamps were missing, and everything was delivered again at the next start. It worked only thanks to the single subscriber's idempotency.

### 7.8 Reading the log: from the query string to the SQL

1. **A request arrives at `GET /api/activity`.** The global `AuthGuard` has already let it through on the session cookie; `PermissionsGuard` checks `activity:read`.
2. **The host's `ValidationPipe` parses the DTO.** It transforms but does not coerce implicitly, so the DTO carries `@Type` for `page`/`pageSize` and a `@Transform` for `kind`: the string is split on commas, the items trimmed, and empties dropped.
3. **A predicate is built from the structural parameters.** Everything is intersected with `AND`; `and(undefined, …)` collapses, so a request with no filters is an honest full scan.
   _subjectType, subjectId, actorId — exact equality; kind — IN; from/to — gte/lte on at_
4. **Search by the actor's email is escaped.** An `ilike` against a pattern with surrounding percent signs, but the metacharacters in the needle are escaped — searching for a literal percent behaves literally.
5. **The `?filter=` tree is parsed separately.** The string is capped at 4,096 characters at the DTO level (a crude first line), then the filter engine validates the tree against `ACTIVITY_FILTER_SCHEMA` — six fields, by default no more than 50 nodes and a depth of 3. An invalid tree gives a `FilterException` and HTTP 400.
6. **The two filtering surfaces combine with `AND`,** rather than competing: `and(listPredicate, filterSql)`.
7. **The filter schema is deliberately narrower than the table.** It excludes `meta` (open jsonb — no index and no contract) and `createdAt` (which never exists on the wire at all). Only indexed, frozen columns.
8. **The count and the page run in parallel.** The same `WHERE`, but two independent queries through `Promise.all` — the request pays the maximum of the two times rather than their sum.
9. **The ordering is deterministic.** An allow-list of sort columns, a direction, and a **`id desc` tiebreaker** — otherwise, with identical timestamps, pages would "shuffle" between requests.
10. **`created_at` is not selected at all.** Not "selected and deleted" but never in the `select` — the physical write time never leaves the server.

### 7.9 The log screen: filters, pages, details

1. **The source of truth is the address bar.** `useTableUrlState` keeps the search, the filter tree, the page number and the page size in the query string, so a filtered view can be forwarded to a colleague or bookmarked.
2. **The page size is clamped before the request.** The hook lowers a meaningless value to the default but has no ceiling, and the server answers 400 for a `pageSize` above 100. Such a 400 cannot be recovered from in the UI: the only control that could fix it — the rows-per-page selector — lives inside the data branch, which a failed request does not render. So the value is clamped before sending, and "Retry" has a chance of working.
   _PAGE_SIZE_OPTIONS = [25, 50, 100]; the maximum is taken from that same array_
3. **The filters are a query builder, not a kind drop-down.** The `QueryBuilderPanel` expands right between the toolbar and the table (an accordion, not an overlay), with six fields: `kind`, `actorEmail`, `actorId`, `subjectType`, `subjectId`, `at`. The field list is a static mirror of the server's schema, so a rule assembled here always passes validation.
4. **Collapsed filters turn into chips.** `QueryBuilderSummary` shows the applied conditions and lets any of them be removed.
5. **Search by email is a separate control,** outside the builder: it is the most frequent question ("what did this person do") and must not require assembling a rule.
6. **The page is clamped to `pageCount` after narrowing.** Otherwise a filter that left one page would strand the user on an empty fifth one. The effect deliberately waits for the first data: before the first response `total` is zero and `pageCount` one, and without that guard a deep link of `?page=3` would be reset to the first page.
7. **While the next page loads, the previous one stays visible.** `keepPreviousData` plus an `aria-busy` on the container — the table does not flash empty.
8. **A row expands into a details panel.** The full subject, the actor, the exact time and all of `meta`, flattened into "key: value" pairs. The panel is always in the DOM so it can animate, but while collapsed it is **removed from the accessibility tree entirely** (`aria-hidden` and `inert`) — otherwise a page of 25 events would be announced as a 50-row table with an empty row between every pair.
9. **Clicking a row expands it — but not over a selection.** This is a log, and people copy ids out of it; a click that ends a selection drag is ignored when the document holds selected text.
10. **Dates always go through total functions.** The mapper does not substitute for an unparseable timestamp — putting "now" into an audit row means silently rewriting the record. The price of that correct decision is a possible `Invalid Date`, on which `toISOString()` throws a `RangeError`; so every `datetime` attribute goes through `activityDateTime` and every visible date through `intl.formatDate`. One unguarded call once blanked the whole SPA: there is no error boundary above the home screen's slots.

### 7.10 A member's log on their user card

1. **The tab lives in `users-admin`,** not here — but takes its data through this package's `useActivityLog` hook. That is why the hook is exported outwards and why its name and signature are frozen.
2. **The tab's question is compound:** events _about_ a person and events performed _by_ them. The structural parameters cannot express that — they intersect with `AND`.
3. **So the tab sends a `?filter=` tree with an `or`:** "(`subjectType = user` AND `subjectId = :id`) OR `actorId = :id`".
   _exactly the grammar the endpoint already parses — no second route had to be created_
4. **The action labels come from the shared `formatActivityAction` catalogue**, so that two surfaces an administrator compares by eye call the same event by the same name.

### 7.11 The copilot asks about the log

1. **The tool registers itself in the shared registry** when the DI graph is built. The registry is injected as `@Optional()`: an installation with no copilot and no MCP is normal, and then the provider simply registers with nobody.
2. **`surfaces: ['copilot']`** — the tool is offered to the copilot only, not to the MCP endpoint. An external agent with a bearer token does not read the log.
3. **The capability profile filters the tool out at offer time.** A run by a user without `activity:read` never learns it exists; on execution the permission is checked again.
4. **The page size is clamped twice:** declared in the JSON schema (a maximum of 25) and clamped in the handler anyway. The validator is defence in depth, not a boundary.
5. **The ordering is fixed:** sorted by `at`, direction `desc`. The model cannot ask for another — "newest first" is the tool's entire contract.
6. **`meta` is handed to the model as is.** Some of it is text written by users, that is, untrusted; but it reaches the model inside the run engine's "untrusted content fence", like any other tool result. Safety comes from the fence, not from redaction — redaction would only make the tool less useful.

## 08. HTTP API

Three routes, all reads. Together they are the entire surface available from outside — and the second and third exist because the first one's permission is the right answer to a different question than the one they answer.

| Method and path                    | Access                                    | Response                             |
| ---------------------------------- | ----------------------------------------- | ------------------------------------ |
| GET /api/activity                  | `session` `activity:read`                 | { items\[\], total, page, pageSize } |
| GET /api/activity/entries/:entryId | `session` `content:read` `X-Workspace-Id` | { items\[\], total, page, pageSize } |
| GET /api/activity/dead-letters     | `session` `activity:read`                 | { total, items\[\] }                 |

### The two narrow routes

#### `/entries/:entryId` — one record's own trail

Paging only: the subject is the URL, the workspace is the header, and every other filter the full log offers would be a way of asking a narrower question about a history short enough to read.

**It fails closed.** `WorkspaceGuard` proves membership and the query requires the row's `workspace_id` to match, so an entry id from another workspace reads as an empty history rather than as somebody else's. Rows written before that column existed carry `null` and are therefore excluded — losing old history on a narrow route is the right side to err on, and the full log still has them.

#### `/dead-letters` — what could _not_ be recorded

`dispatched_at IS NULL AND attempts >= MAX_DELIVERY_ATTEMPTS`, newest first, each with the reason it parked (`outbox_events.last_error`). `total` is separate from `items` so a caller can render "3 events could not be recorded" without paging; `limit` caps at 200 and `since` narrows to recent failures.

**It reports rather than repairs.** Replaying a parked row means clearing its `attempts` — a deliberate operator action against a fixed cause, not a button that re-runs whatever failed fifteen times.

### Query parameters

| Parameter   | Type and constraints                          | Semantics                                                                                                                                                                                                                           |
| ----------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| subjectType | a string, at most 255                         | Exact equality. One of the thirteen subject types                                                                                                                                                                                   |
| subjectId   | a string, at most 255                         | Exact equality. One subject's history                                                                                                                                                                                               |
| actorId     | uuid                                          | Exact equality. What one person — or one token — did                                                                                                                                                                                |
| actorType   | a string, at most 255                         | Exact equality: `user` or `api_token`. Free text rather than an enum for the same reason `kind` is — the values are owned by `@apograph/database`'s `EVENT_ACTOR_TYPE`, and a copy here would be a second catalogue to keep in step |
| workspaceId | uuid                                          | Exact equality. Narrows, never widens — and excludes every row that belongs to no workspace, which is the point and also the reason the page does not offer it                                                                      |
| kind        | a comma-separated list, each item at most 255 | Matched with `IN`. Validated as free text, **not** against a central dictionary — the kinds belong to the producers                                                                                                                 |
| actorEmail  | a string, at most 255                         | A case-insensitive substring search over the frozen address snapshot; LIKE metacharacters are escaped                                                                                                                               |
| filter      | a JSON string, at most 4096 characters        | A query-builder tree; validated against an **eight**-field schema (the six original plus `actorType` and `workspaceId`), at most 50 nodes, depth at most 3. Combined with the rest by `AND`                                         |
| from        | ISO 8601                                      | An inclusive lower bound on `at`                                                                                                                                                                                                    |
| to          | ISO 8601                                      | An inclusive upper bound on `at`                                                                                                                                                                                                    |
| page        | an integer of at least 1, default 1           | One-based; the offset is computed by the service                                                                                                                                                                                    |
| pageSize    | an integer from 1 to 100, default 25          | The ceiling is `MAX_PAGE_SIZE = 100`; exceeding it gives a 400                                                                                                                                                                      |
| sort        | `at` or `kind`, default `at`                  | An allow-list of columns. **No UI control sets it** — the field exists for a future sortable header                                                                                                                                 |
| order       | `asc` or `desc`, default `desc`               | Also set by nothing in the UI                                                                                                                                                                                                       |

### The item's shape

Exactly the table row **minus `created_at`**: `id`, `kind`, `subjectType`, `subjectId`, `actorId`, `actorType`, `actorEmail`, `workspaceId`, `meta`, `at`. The actor is returned as three flat fields; collapsing them into an `actor` object (or into `null` for a system event) is done by the admin-side mapper, which passes `actorType` through as `undefined` rather than defaulting it — defaulting belongs on the server, which knows that a row predating the column was written by a person.

<details>
<summary>Response codes to expect</summary>

- `200` — a page of events; an empty result is an empty array and a `total` of zero, which is not an error.
- `400` — the DTO failed validation (say `pageSize=500`, an unknown `sort` value, a non-integer `page`) or the `?filter=` tree did not parse.
- `401` — no live session (the work of the global `AuthGuard`, not of this package).
- `403` — there is a session but no `activity:read` permission.

</details>

The route is fully described in OpenAPI — every DTO parameter carries an `@ApiPropertyOptional` with an example and a description, so on a running server it reads in the Scalar reference at `/reference`.

## 09. Admin UI

The package provides **one route** and **three slot contributions**; a fifth surface is a tab in another package, living on a hook exported from here.

| Surface                  | Where             | What it shows                                                                                                                                                                                                                                                                                                          | Gate                                                                                                          |
| ------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| The log page             | /activity         | A "When · Actor · Action · Subject" table with expandable rows, search, the filter builder and pagination                                                                                                                                                                                                              | `useHasPermission`, otherwise `ActivityNoAccess`                                                              |
| The sidebar item         | SIDEBAR_NAV_SLOT  | Group `overview`, order 20, the `Activity` icon                                                                                                                                                                                                                                                                        | `permission: 'activity:read'` in the slot descriptor                                                          |
| The home panel           | HOME_SECTION_SLOT | `RecentActivityPanel`: the 6 most recent events, the `panel` region, order 20, a "View all" link                                                                                                                                                                                                                       | without the permission it renders `null` rather than an empty card                                            |
| The entry's Activity tab | ENTRY_TAB_SLOT    | `EntryActivityTab` (slug `activity`, order 30): the 25 most recent actions on the open record, between Access and the built-in History. It was a rail section until `ORT-198` — a 240px column shared by four plugins, collapsible as one, so the record's history showed six wrapped rows and vanished with the panel | `content:read`, and it reads a different route; without the permission it renders `null` and makes no request |
| The dead-letter notice   | on the log page   | `DeadLetterNotice`: how many events could **not** be recorded, and the kinds of the most recent ones                                                                                                                                                                                                                   | `activity:read`; renders nothing when the count is zero, and nothing while loading or on error                |
| The member tab           | users-admin       | A personal log: events about a person or performed by them                                                                                                                                                                                                                                                             | the rail hides the tab without the permission                                                                 |

### The page's states

**skeleton** → **table** · **empty** · **empty for this filter** · **error with "Retry"** · **no access**

The skeleton is the same one for the lazy route's fallback and for the loading state — otherwise navigating to the page would give two different placeholders in a row. The empty state distinguishes "the filter found nothing" (offering to clear it) from "the log really is empty" (explaining that rows appear as actions are taken).

> **Why the entry widget and the notice both render nothing on failure**
>
> Both are **caveats about somebody else's content**, and a caveat that fails must not take that content down with it. A page rendering no rows because the _warning_ about the rows errored is strictly worse than one rendering the rows without the warning; an editor seeing "the history could not be loaded" is being told something true, but an editor seeing an empty Activity block would be told something false. Hence the split: the widget says so out loud on error (silence there would read as "nothing has happened"), and the notice stays silent (a failed warning is not itself news).

### Accessibility — what is not obvious here

- **The live region carries a range, not just a count.** The count is invariant across pages: pressing "Next" changed all 25 rows while the region's text stayed the same — so no announcement happened at all. Hence "showing N–M, page X of Y" was added to the text.
- **The expander column's empty header is named.** Otherwise, in column-header mode, a screen reader reads "blank" as the first cell of every row.
- **Focus is not lost when a control disappears.** Clearing the filters unmounts the very "Clear" button that was just clicked; focus is explicitly moved into the search field. Collapsing the filter panel returns focus to the toggle button.
- **The subject type is localised rather than capitalised with CSS.** Otherwise `media_asset` became "Media_asset" and the value stayed untranslatable.
- **The actor's avatar is decorative** (`aria-hidden`) — the meaning is carried by the address beside it.
- **The headers carry no `aria-sort`**, and rightly: there is not one sortable column.

### How "Action" becomes human-readable text

`ACTION_MESSAGES` is typed as a record keyed by the `ActivityKind` type, so a string added to `ACTIVITY_KINDS` without a label is a **compile error**. The two halves of the catalogue cannot drift apart inside the package. The cross-package half is pinned twice over: `activity-kinds.spec.ts` proves each kind actually renders, and `audit-event-mapping.spec.ts` compares this list against the server's `AUDIT_KINDS` in both directions (see §3.11).

**Keep `types/activityKinds` free of imports.** The server-side check reads that module as text rather than importing it, because an import would put this React package in the audit plugin's TypeScript project graph. Two bare `as const` arrays is what makes that work.

The "Details" line reads **one** descriptive field per kind rather than a common shape: media payloads differ by design, and the full record is visible in the expanded row anyway. Three kinds (`media.asset.updated`, `media.asset.moved`, `media.folder.deleted`) have no short summary at all — only the expanded panel.

## 10. Configuration

**The plugin has not one parameter.** `ActivityPlugin()` is called with no arguments, and so is `ActivityModule.forRoot()`. No environment variables, no enablement flag, no retention setting. That follows from the package owning neither the connection, nor a policy, nor a schedule.

| What                        | Value                                        | Where it comes from                                                     |
| --------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| The database connection     | —                                            | Injected from `@apograph/database` through `@InjectDatabase()`          |
| The permission              | activity:read                                | The `PERMISSIONS` constant from `@apograph/identity-server`             |
| The migration journal table | \_\_drizzle_migrations_activity              | The `migrations` descriptor in `ActivityPlugin()`                       |
| Delivery parameters         | a batch of 100, a 5-second poll, 15 attempts | `OutboxDispatcher` constants in `@apograph/database` — not configurable |
| The tool registry           | optional                                     | `@Optional() ToolRegistry` from `@apograph/tools-server`                |

### Registration order matters

In `apps/server/src/plugins.ts` the order is: `DatabasePlugin`, `IdentityPlugin`, `WorkspacesPlugin`, **`ActivityPlugin()`**, `UsersPlugin`, then content and the rest. The reason is not DI (every module is global, and `onPluginInit` runs before the application is created) but **migrations**: they are applied in this list's order.

`ActivityModule.forRoot()` is marked `global: true` and exports `ActivityService` plus the `ACTIVITY_RECORDER` binding. The binding is kept for the stability of the public surface and marked `@deprecated` — nobody writes through it. A reverse search over the repository confirms it: the only mentions of `ACTIVITY_RECORDER` are the port's declaration, the binding and comments.

> **The plugin can be removed — and nothing breaks**
>
> The host composition spec (`apps/server/src/plugins.spec.ts`) records a measured fact: remove `ActivityPlugin` from the array and the application starts cleanly, nothing is written to the log, and audit rows simply stop appearing. Every dependent port is injected as `@Optional()`. For operations that means "the log is empty" and "the log is switched off" look identical.

## 11. Security and reliability

### What it protects

- **Read-only, behind one permission.** Not one route in the package writes; writing to the log over HTTP is impossible altogether. Forging a row requires database access.
- **Only an administrator has the permission.** A log row contains members' addresses and subjects' ids — data about people and about the organisation's work, not a directory.
- **Secrets cannot reach the log by construction.** Not one mapper carries a password, a hash or a token: `apiTokenSubject`'s `meta` field set is fixed by explicit enumeration rather than by copying the payload wholesale — precisely so that a new payload field cannot "arrive" in the log silently.
- **Search escaping.** LIKE metacharacters in the needle are escaped — both for correctness and so that a percent sign in the search box does not turn into a wildcard scan.
- **A sort allow-list.** The sort column is picked from a dictionary object rather than interpolated into SQL.
- **The filterable surface is narrower than the table.** The open `meta` is not in it: filtering over unindexed jsonb is both a performance problem and a leak of a data shape the package does not control.
- **`meta` is fenced off from the model.** Some of its content is written by users; it reaches the copilot inside the run engine's untrusted-content fence.

### What it does not protect

- **Immutability is not enforced at the database level.** There is no trigger on `UPDATE`/`DELETE`, no revocation of privileges from the application role, and no hash chain. "Append-only" is a property of the code rather than of the table: the application simply has no code that would change or delete a row.
- **There is no gap detection.** A hole in the audit (an event with no mapper) produces no metric, no log line and no alert.
- **There is no retention — and no bound on growth.** See section 5.
- **There is no export.** No CSV, no archiving; the log exists only inside the system.

### Reliability: where things can diverge

| Situation                                                          | What happens                                              | What saves it                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| The mutation committed, the process died before the drain          | The log row does not exist yet                            | The five-second poll at the next start; the event is not lost from the outbox                          |
| The log insert went through, the `dispatched_at` stamp rolled back | The event will be delivered again                         | `ON CONFLICT DO NOTHING` on the event's id                                                             |
| The subscriber throws                                              | The attempt counter grows and the delay doubles           | The ceiling of 15 attempts; the queue behind the row keeps moving                                      |
| An event of a kind absent from `FACET_MAPPERS`                     | The outbox row is stamped delivered and there is no audit | Nothing. Only discipline and the coverage e2e suite                                                    |
| The plugin is removed from the host's composition                  | The log stops filling up                                  | Nothing — the start stays clean                                                                        |
| The `at` on the wire does not parse                                | The interface shows `Invalid Date`                        | The total `activityDateTime` and `intl.formatDate`; there is deliberately no substitution of the value |

## 12. Invariants

Statements that must always hold. Both a review list and a starting set of test assertions.

- **I-01** — The log is strictly append-only: the package holds no code that changes or deletes an `activity_events` row, and not one writing HTTP route.
- **I-02** — The only live writer is `AuditEventSubscriber`. `ActivityService.record` and the `ACTIVITY_RECORDER` token are kept, marked `@deprecated`, and nobody writes through them.
- **I-03** — The log row's primary key equals the source event's id, and the insert is `ON CONFLICT DO NOTHING` — re-delivery never produces a duplicate and never rewrites a row already written.
- **I-04** — A row's `at` equals the event's `occurredAt`, that is, the fact's logical time rather than its delivery time. `created_at` is never selected on a read.
- **I-05** — `toAuditRow` is a pure function with no database access; returning `null` means "not our kind", and an exception means "our kind, but there is nothing to name the subject with". The two outcomes are never conflated.
- **I-06** — A row with an empty `subject_id` is never written: the membership mapper refuses rather than substituting a default.
- **I-07** — The actor is lifted off `payload.actor` into the `actor_id`, `actor_type` and `actor_email` columns and is never duplicated inside `meta`. Its `via` — _how_, not who — is the one part that does land in `meta`, merged with the kind's own payload rather than replacing it.
- **I-08** — Not one mapper carries a secret into `meta`: no password, no hash, no token value and no token hash. For an API token the field set is given by enumeration rather than by copying the payload wholesale.
- **I-09** — The subscriber accepts exactly the kinds listed in `FACET_MAPPERS`: `AUDITED_EVENT_KINDS` is its `kinds`, computed from that same table.
- **I-10** — An event of a kind absent from `FACET_MAPPERS` produces an error nowhere: it is stamped delivered and never reaches the log.
- **I-11** — Every audit kind maps from exactly one event kind, with **one deliberate exception**: `user.disabled`/`user.enabled` land on the same audit kinds as `member.disabled`/`member.reactivated`, so 62 mappings produce 60 distinct kinds. Which aggregate performed the change is an internal fact; the reader wants "this account was suspended".
- **I-12** — A kind is renamed only where the two catalogues historically diverged: `member.*` to `user.*`, `auth.signed_in`/`auth.signed_out` to `user.signed_in`/`user.signed_out`, and `api_token.*` to `token.*`. The rest pass straight through.
- **I-13** — The subject of a workspace-membership event is the **user**, not the workspace; the workspace's id travels in `meta.workspaceId`.
- **I-14** — `GET /api/activity` and `/dead-letters` are reachable only with a session and only with the `activity:read` permission; they are unreachable with an external API bearer token. `/entries/:id` takes a session and `content:read`, and additionally requires membership of the workspace named in `X-Workspace-Id`.
- **I-15** — All filters intersect with `AND`, the `?filter=` tree included; the absence of filters gives the full set rather than an empty one.
- **I-16** — The filterable surface is eight columns; `meta` and `created_at` are not in it under any parameters.
- **I-17** — The sort column is picked from an allow-list (`at`, `kind`), and an `id desc` tiebreaker is always appended, so pagination is deterministic with identical timestamps.
- **I-18** — A `pageSize` above `MAX_PAGE_SIZE = 100` is rejected by the server as a `400`; the log page clamps the value before sending so that such a refusal is not unrecoverable from the interface.
- **I-19** — Search by the actor's address is case-insensitive and escapes LIKE metacharacters.
- **I-20** — `created_at` appears in the API response under no parameters.
- **I-21** — The copilot tool is marked `readOnly`, `effect: 'read'`, `surfaces: ['copilot']` and requires the same permission as the route; it is not offered to the MCP surface.
- **I-22** — The tool registry is injected as `@Optional()`: the absence of the copilot and of MCP is a working configuration rather than a startup error.
- **I-23** — The package opens no database connection and owns no schema other than `activity_events`.
- **I-24** — The plugin takes no configuration: `ActivityPlugin()` and `forRoot()` are called with no arguments.
- **I-25** — The admin-side mapper does not substitute for an unparseable timestamp; every `datetime` attribute goes through `activityDateTime` and every visible date through `intl.formatDate`.
- **I-26** — Inside the admin package the kind catalogue and the label catalogue cannot diverge: `ACTION_MESSAGES` is typed as a record keyed by `ActivityKind`.
- **I-27** — A collapsed details panel is removed from the accessibility tree entirely (`aria-hidden` and `inert`), so the number of announced table rows equals the number of events.
- **I-28** — Without the `activity:read` permission the admin UI makes no request at all: the hook's enablement equals the permission, and the home panel returns `null`.
- **I-29** — The page does not stay beyond the last page after a filter narrows the result, but neither does it discard a deep `?page=N` link before the first response arrives.
- **I-30** — The address bar is the single source of truth for every filter and for the page; any filtered state is reproducible from a link.
- **I-31** — `actor_type` is `null` if and only if `actor_id` is: an actored row never claims an unknown kind of principal, and an actor that says nothing about its kind is read as a user.
- **I-32** — A token's id never reaches a revision's `created_by`. The audit path and the revision path take the same `EventActor` and read it differently — `revisionActorId` yields a user id or nothing — so naming a credential in the log cannot corrupt a version's authorship.
- **I-33** — `GET /activity/entries/:id` returns only rows whose `workspace_id` equals the open workspace. An entry id from another workspace yields an empty history, never somebody else's; a row with a `null` workspace is excluded rather than assumed harmless.
- **I-34** — The server's `AUDIT_KINDS` and the admin's `ACTIVITY_KINDS` are equal as sets, and every declared kind is reachable from some mapper. Both directions are asserted by a unit test that drives every mapper.
- **I-35** — `auth.sign_in_failed` changes nothing a caller can observe: every refusal path still returns the same error after the same single bcrypt comparison and the same one insert, and a failure to record is swallowed rather than turned into a 500.
- **I-36** — `api_token.used` is raised only when `last_used_at` is actually touched, so a token produces at most one row per `LAST_USED_TOUCH_INTERVAL_MS` however much traffic it carries.
- **I-37** — The admin's `ACTIVITY_FILTER_FIELDS` and the server's `ACTIVITY_FILTER_SCHEMA` name the same fields, in both directions: a column filterable over HTTP is offered in the UI, and a field the UI offers is one the server whitelists rather than answers `400` to. Asserted by a unit test that reads the admin module as text, like `I-34`.
- **I-38** — A filter over a column the table renders as a localized label — `kind`, `subjectType` — offers that column's vocabulary rather than free text, and labels each option from the **same** descriptor map the cell renders from, so the filter and the table cannot name one row two ways.

## 13. Testing checklist

Phrased as "action → expected result", to be taken into a test case without rewriting. The server side is exercised with `curl` and `psql`, the admin side with a browser. The existing suites: `packages/activity/server/src/lib/activity/infrastructure/audit-event-mapping.spec.ts` (unit, no database), `apps/server-e2e/src/server/activity/` — `activity.spec.ts`, `activity-filter.spec.ts`, `activity-coverage.spec.ts`; `apps/admin-e2e/src/activity/` — `audit-log.spec.ts`, `activity-filter.spec.ts`, `activity-kinds.spec.ts`.

### Write-path coverage — the main thing

- **For each of the 60 audit kinds: perform the action and look in the database** → a row of the right kind appeared in `outbox_events` **and** a row appeared in `activity_events`. Both halves must be checked: either on its own passes with an empty log.
- **Compare `select distinct kind from outbox_events` against `AUDITED_EVENT_KINDS`** → the difference is empty. That is the one-query check for silent losses.
- **Upload, rename, retag, move and delete a file; create, rename and delete a folder** → eight actions, eight log rows with `media_asset` and `media_folder` subjects.
- **Save an entry without changing anything in it** → no event and no log row — the expected behaviour rather than an omission.
- **Publish an already published entry** → no second `entry.published` row appears.
- **Accept an invitation** → two rows: `user.activated` and `user.signed_in`, both with the invitee as the actor.
- **Sign in through an SSO provider** → `user.signed_in` with a `meta` carrying the method and the provider; on a first sign-in, additionally `user.sso_provisioned` and/or `user.sso_linked`.
- **Issue and revoke an API token** → `token.created` and `token.revoked` rows with a `lookupPrefix` and **with no** secret or hash in `meta`.

### Idempotency and delivery failures

- **Null out `dispatched_at` on a delivered outbox row and wait for a drain** → `activity_events` still holds one row with the same id; its content is unchanged.
- **Feed in a `workspace.member_added` event with no `payload.userId`** → no log row is created; the attempt counter grows, `next_attempt_at` moves, and the log holds an error with a stack.
- **Drive the attempt count to 15** → the row is no longer claimed and lands in the `dispatched_at IS NULL AND attempts >= 15` selection; events queued behind it are delivered normally.
- **Zero out `attempts` on a parked row** → delivery resumes.
- **Put an event of an invented kind into the outbox** → `dispatched_at` is set, there is no log row, and nothing in the log.

### Reading and filters

- **`GET /api/activity` with no parameters** → 200, newest first, a page size of 25, and no `createdAt` field in the items.
- **A filter on two comma-separated kinds** → only those two kinds; spaces around commas are allowed and empty items are dropped.
- **An actor search whose value is a single percent sign** → treated literally: it finds only addresses containing a percent sign.
- **`from` and `to` with the same value** → the bounds are inclusive — an event at exactly that second is in the result.
- **`pageSize=101`** → 400. **`pageSize=100`** → 200.
- **Sorting by `kind` ascending** → with equal kinds the order is stable between requests thanks to the id tiebreaker.
- **Two consecutive pages over 30 events with identical `at` values** → no event repeated and none missing.
- **A broken `?filter=`: not JSON, an unknown field, depth 4, 51 nodes, longer than 4096** → 400 in every case, not a 500 and not silent ignoring.
- **A `?filter=` with a disjunction over subject and actor plus a separate address search** → the conditions combine with `AND` rather than replacing each other.
- **A request with no session, then with a contributor's session** → 401 and 403 respectively.
- **The same route with an external API bearer token** → refused.

### The admin UI

- **Sign in as a contributor** → there is no "Activity" item in the sidebar, no home panel, and navigating straight to `/activity` gives the "no access" screen and **not one network request**.
- **Open `/activity?pageSize=500`** → the request goes out with a page size of 100 and the table renders; no 400 is shown.
- **Apply a filter that narrows the result to one page while on page three** → the address and the table jump to the first page, and no empty screen occurs.
- **Open a deep link with page three and an actor filter in a new tab** → page three of the filtered view opens, not page one.
- **Press "Next page" with a screen reader** → the new range and page number are announced, rather than one and the same count.
- **Expand a row and count the table's rows in table-navigation mode** → collapsed details panels are not counted.
- **Select an id in a row with the mouse and release the button** → the row does not collapse and the selection is kept.
- **Clear the filters with the button in the empty state** → focus lands in the search field rather than on the document body.
- **Feed an unparseable `at` value into the response** → the row renders, the time element has no `datetime` attribute, and the application does not fall into a white screen.
- **Show one row of each of the 60 audit kinds at a page size of 100** → no "Action" cell contains a dot, that is, no raw token leaked through. **Today this check fails on the three SSO kinds** — see section 15.
- **Open the "Activity" tab on a member's card** → both events about them and events performed by them are visible; the action labels are the same as on the main page.

### Operations

- **Remove `ActivityPlugin` from the host's composition and start** → the start is clean, the log is silent, and audit rows stop appearing. Check that monitoring would notice — today there is nothing to notice it with.
- **Measure the size of the `activity_events` relation after 10,000 sign-ins** → growth is linear and unbounded; there is no trimming mechanism.
- **Run `npx nx run server:db:migrate` twice** → the second attempt does nothing; the journal table is `__drizzle_migrations_activity`.

## 14. Boundaries of responsibility

| Area                                                                                                                      | Who is responsible                               | What that means in practice                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| The transactional outbox, the dispatcher, the `DomainEvent` contract, `attachActor`                                       | @apograph/database                               | Delivery parameters, retries, dead letters and the growth of `outbox_events` are not Activity's territory                           |
| The `activity:read` permission, `PermissionsGuard`, the `ACTIVITY_RECORDER` port, the `IDENTITY_ACTIVITY_KINDS` catalogue | @apograph/identity-server                        | Activity imports the constants and the guard but defines none of them                                                               |
| Event kinds and the shape of their payloads                                                                               | each producing plugin                            | identity, users, workspaces, content, media, transfer, segments, alarms, copilot. The sink neither dictates nor validates the shape |
| Parsing and translating the `?filter=` tree                                                                               | @apograph/utils-server                           | Activity supplies only the eight-field schema                                                                                       |
| The filter builder in the interface                                                                                       | @apograph/query-builder-admin                    | Activity supplies the field list and their labels                                                                                   |
| The sidebar and home slots, the shell                                                                                     | @apograph/shell-admin                            | Hiding the item by permission is done by `SidebarNavButton`                                                                         |
| The tool registry, call authorisation, the untrusted-content fence                                                        | @apograph/tools-server, @apograph/copilot-server | Activity only declares one tool                                                                                                     |
| The "Activity" tab on a member's card                                                                                     | @apograph/users-admin                            | It lives there but on a hook from here — which is why the hook's signature is frozen                                                |

### What the package does not have

- **Retention, archiving and export.** No job, no route, no setting.
- **A per-workspace view.** And that is not "not yet" but a decision: there is no column, and adding the filter is forbidden by the package's conventions.
- **Sortable headers.** The server supports `sort` and `order`, but no control sets them — which is why `aria-sort` is rightly absent from the table.
- **Cursor pagination.** Only `LIMIT/OFFSET`.
- **Links from the log to its subjects.** The subject is shown as an id; you cannot jump from a row to an entry, a file or a workspace.
- **Notifications and rules.** The log initiates nothing.
- **A domain layer of its own.** And that is compliance with ADR-0003, not an omission.

## 15. Discrepancies between code and documentation

Found while checking this dossier against the source. Some are stale phrasings, some are real holes in the catalogue that mislead developer and tester alike.

> **Closed since the previous revision**
>
> Four of the entries below have been fixed and are kept here as a record rather than as work. **The catalogue drift** — three SSO kinds the admin could not render, the same three missing from the mapper's own JSDoc table, and the e2e seed that could not notice either — is closed, and a two-directional check now makes a recurrence a failing test. **`user.disabled`/`user.enabled`** are mapped, so the day a caller appears the action will not go silent. Rows marked `closed` below carry the detail.

| Where                                                  | What it says                                                                                                                                                                            | How it actually is                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| activity/admin/src/lib/types/activityKinds/index.ts    | The `ACTIVITY_KINDS` list is declared as a catalogue that "must keep pace with `FACET_MAPPERS`"                                                                                         | `closed` — it lagged by three kinds (`user.sso_linked`, `user.sso_provisioned`, `user.sso_role_mapped`), and the `ALL_KINDS_ACTIVITY` seed lagged identically, so the test written to catch it could not. Both lists are complete, and `audit-event-mapping.spec.ts` now compares the admin's list against the server's `AUDIT_KINDS` in both directions — reading the admin module _as text_, so no project-graph edge is created                                                    |
| activity/server/.../audit-event-mapping.ts             | The JSDoc "event → audit kind" table above `FACET_MAPPERS`                                                                                                                              | `closed` — it held 37 rows out of 40. It now documents every mapper, and the machine-readable `AUDIT_KINDS` beside it is what the specs check, so the prose table is no longer the only record                                                                                                                                                                                                                                                                                        |
| CONTEXT-MAP.md, the glossary                           | "Activity event — an append-only audit row, written _in the same transaction_ as the mutation it records"                                                                               | Stale. What is written in the same transaction is the **outbox event**, while the audit row appears after the commit, from the subscriber, through the root client. `ARCHITECTURE.md` §5 already describes this correctly — so two root documents contradict each other                                                                                                                                                                                                               |
| packages/activity/server/AGENTS.md                     | "Registered by `copilotToolsRegistrar('activity', …)` in `ActivityModule.forRoot`"                                                                                                      | There is no such call in the code. The tool is registered by the `ActivityCopilotToolProvider` in its own `onModuleInit` through an `@Optional() ToolRegistry`; in the module it is simply listed among the providers                                                                                                                                                                                                                                                                 |
| packages/activity/server/package.json                  | Dependencies on `@apograph/copilot-domain` and `@apograph/copilot-server`                                                                                                               | Neither is imported anywhere in `src/` — a leftover from the earlier way of registering the tool. Extra edges in the package graph                                                                                                                                                                                                                                                                                                                                                    |
| packages/activity/server/AGENTS.md                     | The route description lists the filters: subject, actor, kind, address search, date range, pagination, sorting                                                                          | The **structural `?filter=` filter** is not mentioned — the second full filtering surface, the one the member tab in `users-admin` rests on. Nor are its limits (4,096 characters, an eight-field schema, the node and depth ceilings)                                                                                                                                                                                                                                                |
| packages/activity/admin/AGENTS.md                      | "a filter toolbar (action/kind select + actor-email search)"                                                                                                                            | There is no kind drop-down on the page. There is an actor-address search and a **query builder**, `QueryBuilderPanel`, with six fields plus the chip summary                                                                                                                                                                                                                                                                                                                          |
| packages/activity/admin/AGENTS.md                      | The top-level components are listed as `ActivityTable`, `ActivityToolbar`, `ActivityPagination`, `ActivityEmpty`, `ActivityNoAccess`, `ActivityLogSkeleton`                             | `RecentActivityPanel` is not named — a top-level component consumed not by the page but by the home slot. The layout is described correctly; the composition is not                                                                                                                                                                                                                                                                                                                   |
| activity/admin/.../activityPlugin/index.tsx            | JSDoc: "its toolbar nav entry, contributed to the shell's `NAVBAR_START_SLOT` at `order: 35` (after Members)"                                                                           | The code puts the item into `SIDEBAR_NAV_SLOT`, group `overview`, `order: 20`. The comment describes the previous navigation design. The JSDoc says nothing at all about the `HOME_SECTION_SLOT` contribution                                                                                                                                                                                                                                                                         |
| packages/activity/server/AGENTS.md                     | "That failure is completely silent, and it has happened three times (API tokens, entry publishes, and the whole media library)"                                                         | `partly closed` — the count is now **four** (content export/import was the fourth), and the note points at the catalogue check. Still incomplete in the same way as before: `user.password_changed` and `user.activated` were silent identically, and the whole ordinary editorial cycle raised no events at all until entries moved onto the unit of work. Those are different ailments with the same symptom, and both are worth naming                                             |
| packages/activity/server/AGENTS.md, the Schema section | Lists the columns and the indexes                                                                                                                                                       | **Still open.** The Schema section now documents `actor_type`, `workspace_id` and `meta.via`, but still says not a word about there being **no retention** and the table growing without bound — even though for `outbox_events` that is stated explicitly in the neighbouring package's documentation                                                                                                                                                                                |
| The kind catalogue, `auth.signed_out`                  | Symmetry with `auth.signed_in`, where the sign-in method is recorded into `meta`                                                                                                        | **Still open, and now more visible.** The `auth.signed_out` mapper sets `meta: null` unconditionally, even though a back-channel sign-out puts the method and the provider into the event. A provider-initiated sign-out is indistinguishable in the log from an ordinary one; the actor there is given `email ?? ''`, an empty string instead of an address snapshot. The asymmetry widened rather than closed: `auth.signed_in` now carries the IP, the User-Agent _and_ the method |
| identity/server/.../identity-events.ts                 | `USER_DISABLED` and `USER_ENABLED` are declared as event kinds of the identity context                                                                                                  | `closed` — they are still raised only by `UserAccount.disable()`/`enable()`, which have no callers in product code, but they are now **mapped**, onto the same audit kinds as their `member.*` counterparts. The methods are public API of a published package; leaving them unmapped meant the first caller to appear would reproduce this package's signature failure with nothing failing anywhere                                                                                 |
| docs/testing/activity-server.md                        | The "Potential Bugs" section holds BUG-03 (no mapper for `user.password_changed`), BUG-04 (no attempt ceiling and no dead letters), BUG-05 (an empty `subject_id` instead of a refusal) | All three are fixed in the code: the mapper exists, the 15-attempt ceiling with exponential backoff exists, and `UnmappableAuditEventError` exists. The testing artifact has fallen behind the implementation and misleads a re-check — and has now fallen further behind: it knows nothing of the twenty new kinds, the two new routes, or the dead-letter surface that answers BUG-04's original complaint                                                                          |

---

**A dossier of the `packages/activity` group.** Written in the same frame as the Identity dossier: business description, composition, the catalogue of event kinds, permissions, data, lifecycle, flows, API, admin UI, configuration, security, invariants, checklist, boundaries, discrepancies. The "Catalogue of event kinds" section was added for this package specifically: it is the only place in the repository that gathers the whole catalogue together in prose.

The source is the source code: `audit-event-mapping.ts`, `audit-event.subscriber.ts`, `activity.service.ts`, the DTOs and the controller, the Drizzle schema and the migration, the event files of the nine producing plugins, the outbox dispatcher in `@apograph/database`, and the admin UI's pages, components and hooks. The `AGENTS.md` files were used as a skeleton, but every claim was checked against the implementation — discrepancies went into section 15.
