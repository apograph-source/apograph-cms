---
name: server-e2e
description: Authoring or extending Ortha CMS server end-to-end tests (apps/server-e2e) — the in-process testcontainer + supertest harness for the NestJS API. Covers createTestApp/closeTestApp, the Postgres testcontainer + per-plugin migrations, DI-based seeding, resetDb isolation, cookie/session flows, and per-suite config overrides (e.g. rate limit). Use when adding an e2e suite for an endpoint, testing a new plugin's HTTP routes, or changing the e2e harness.
user-invocable: false
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(npx nx *), Bash(npm exec nx *), Bash(docker *)
---

# Ortha CMS server e2e tests

`apps/server-e2e` boots the **real** NestJS server **in-process** against a
throwaway Postgres **testcontainer** and drives it with `supertest`. No separate
server process, no Docker Compose, no `tsx`/IPC — just `npx nx e2e server-e2e`
(which needs a running Docker daemon).

> **Reference suites:** `src/server/auth/login.spec.ts` (exhaustive validation +
> guard coverage), `auth/me.spec.ts` (cookie/session lifecycle),
> `auth/logout.spec.ts` (state-change + idempotency), and
> `auth/login-throttle.spec.ts` (per-suite config override). Read the closest
> one before writing a new suite. Package notes live in
> [`apps/server-e2e/CLAUDE.md`](../../../apps/server-e2e/CLAUDE.md).

This skill is the companion to **`server-plugin`**: when you add a controller to
a plugin, add an e2e suite here that exercises it end-to-end.

---

## The five non-negotiables

1. **Boot the real app via `createTestApp()`** — never re-declare `NestFactory`,
   the global prefix, or the `ValidationPipe` in a spec, and never call
   `listen()` yourself. That mirrors `createServer`, and it binds `127.0.0.1`
   deliberately: supertest dials loopback but binds the wildcard, which is how
   requests used to be answered by other processes on the machine (see
   `apps/server-e2e/AGENTS.md` → Failure modes). Re-declaring drifts from prod;
   re-listening reopens that hole.
2. **Seed through DI**, never raw bcrypt/SQL for credentials — use the
   `seed.ts` helpers, which hash via the app's real `HashingService`.
3. **Isolate with `resetDb()`** in `beforeEach` — truncates mutable tables,
   leaving seeded system roles. Don't rely on test ordering.
4. **One suite per endpoint/concern**, grouped by feature folder under
   `src/server/` (e.g. `src/server/auth/login.spec.ts`); the folder names the
   domain. Cross-project imports stay in `src/support/**` (the only
   module-boundary-exempt place), never in specs.
5. **Don't touch `bootstrap-server`** to make something testable — the harness
   reuses its public `ServerModule` + `buildPlugins`; extend the harness
   instead.

---

## Harness API (`src/support/`)

```ts
// test-app.ts
createTestApp(overrides?: TestConfigOverrides): Promise<{ app, server }>
closeTestApp(harness): Promise<void>           // closes app + per-file pool

// test-config.ts
interface TestConfigOverrides {
    rateLimit?: { ttlSeconds: number; limit: number };
    allowedOrigins?: string[];
}
TEST_ALLOWED_ORIGIN                              // the configured dev origin

// seed.ts
seedActiveUser(app, { email, password, role })  // active user, valid creds
seedUser(app, { email, password?, role, status? })  // any status; null hash if no password
resetDb()                                       // TRUNCATE mutable tables
expireUserSessions(userId) / revokeUserSessions(userId) / deleteUser(userId)
countUserSessions(userId)
```

`role` is a seeded system-role key: `'admin' | 'contributor' | 'viewer'`.

## Adding a suite — the shape

```ts
import request from 'supertest';
import { closeTestApp, createTestApp, type TestApp } from '../support/test-app';
import { resetDb, seedActiveUser, type SeededUser } from '../support/seed';

const EMAIL = 'widgets-test@example.com';
const PASSWORD = 'SecurePass123!';

describe('POST /api/widgets', () => {
    let harness: TestApp;
    let user: SeededUser;

    beforeAll(async () => {
        harness = await createTestApp();
    });
    afterAll(async () => {
        await closeTestApp(harness);
    });
    beforeEach(async () => {
        await resetDb();
        user = await seedActiveUser(harness.app, {
            email: EMAIL,
            password: PASSWORD,
            role: 'admin'
        });
    });

    it('creates a widget for an authenticated caller', async () => {
        const agent = request.agent(harness.server); // carries the session cookie
        await agent
            .post('/api/auth/login')
            .send({ email: EMAIL, password: PASSWORD })
            .expect(201);

        await agent.post('/api/widgets').send({ name: 'w' }).expect(201);
    });
});
```

### Cover, at minimum

- **Happy path** + the exact response shape (and that secrets/hashes never leak
  — assert the precise key set, e.g. `Object.keys(body).sort()`).
- **AuthN/AuthZ:** missing/invalid session → 401; wrong role/permission → 403.
- **Validation (400):** missing field, wrong type, malformed value, and an
  **unknown extra field** (the global pipe is `forbidNonWhitelisted`).
- **Guards:** `OriginGuard` on state-changing routes → 403 for a disallowed
  `Origin`, allowed for `TEST_ALLOWED_ORIGIN` and for no `Origin`.
- **Side effects:** assert the DB row was written/revoked/deleted via the
  `seed.ts` query helpers, not just the status code.

## Cookie & session flows

- Use **`request.agent(harness.server)`** to carry `Set-Cookie` from login into
  later requests.
- For a single request, forward the cookie explicitly:
  `.set('Cookie', 'ortha_session=<value>')` — extract it from the login
  response's `set-cookie` header.
- Simulate session states with `expireUserSessions` / `revokeUserSessions` /
  `deleteUser`, then assert the protected route returns 401.

## Per-suite config (rate limit, origins)

The default app relaxes the login rate limit so suites don't self-throttle. To
test a throttled path, boot a **dedicated** app with a low limit — it's per-app
and in-memory, so it won't bleed into other suites:

```ts
harness = await createTestApp({ rateLimit: { ttlSeconds: 60, limit: 3 } });
// 3 requests pass, the 4th → 429
```

If a new sensitive endpoint needs its own configurable limit, add it to the
plugin's config (see the `server-plugin` skill) rather than hardcoding.

## Gotchas

- **`@Post` → 201 by default** (no `@HttpCode`). Assert `201`, not `200`.
- **`maxWorkers: 1`** — suites run serially against one shared container so they
  don't race on `resetDb`. Don't add cross-suite shared state.
- Each spec **file** is its own module registry → own app, pool, and throttler.
  That's why `closeTestApp` ends the pool per file.
- New plugin? `global-setup` applies migrations for **every** plugin in
  `buildPlugins`, so a DB-backed plugin's tables appear automatically once it's
  registered in `apps/server/src/plugins.ts` — no harness change needed.

## After writing

```bash
npx nx e2e server-e2e         # needs Docker running
npx nx run-many -t typecheck lint -p server-e2e
```
