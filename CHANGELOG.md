## 0.5.2 (2026-09-07)

### 🩹 Fixes

- **create-ortha-app:** configure the plugins the template only registered ([#250](https://github.com/ortha-source/ortha-cms/pull/250))

### ❤️ Thank You

- Claude Opus 5 (1M context)
- Pavel Makhanko @pmknk

## 0.5.1 (2026-09-07)

### 🩹 Fixes

- **release:** pack what the build compiles, and state media-domain's licence ([771bdbef](https://github.com/ortha-source/ortha-cms/commit/771bdbef))

### ❤️ Thank You

- Claude Opus 5 (1M context)
- Pavel Makhanko

## 0.5.0 (2026-09-07)

### 🚀 Features

- **activity:** close the silent gaps in the audit trail (server) ([41a038c6](https://github.com/ortha-source/ortha-cms/commit/41a038c6))
- **activity:** audit the contexts that raised no events at all ([599485a5](https://github.com/ortha-source/ortha-cms/commit/599485a5))
- **activity:** make the trail's gaps and one entry's history reachable ([57e3cd02](https://github.com/ortha-source/ortha-cms/commit/57e3cd02))
- **activity-admin:** render every kind the server writes, and pin it ([e9d1640b](https://github.com/ortha-source/ortha-cms/commit/e9d1640b))
- **cli:** add `ortha --version` ([68564167](https://github.com/ortha-source/ortha-cms/commit/68564167))
- **design-system:** let MultiSelect add what was typed, and use it ([364fa2b7](https://github.com/ortha-source/ortha-cms/commit/364fa2b7))
- **users-admin:** filter Members through the inline panel, not a drawer ([8a440191](https://github.com/ortha-source/ortha-cms/commit/8a440191))
- **webhooks:** deliver content changes to configured endpoints ([9246ffb4](https://github.com/ortha-source/ortha-cms/commit/9246ffb4))
- **webhooks-admin:** configure endpoints and read the delivery log ([2c9583a8](https://github.com/ortha-source/ortha-cms/commit/2c9583a8))
- **webhooks-admin:** pick content types, without closing the list ([465c1cb4](https://github.com/ortha-source/ortha-cms/commit/465c1cb4))
- **webhooks-admin:** scope the type picker to the chosen workspaces ([ecb37070](https://github.com/ortha-source/ortha-cms/commit/ecb37070))
- **webhooks-admin:** a status switch that asks, and custom headers ([e746ef56](https://github.com/ortha-source/ortha-cms/commit/e746ef56))

### 🩹 Fixes

- **admin:** close the ten UI tickets ORT-197…ORT-206 ([#247](https://github.com/ortha-source/ortha-cms/pull/247))
- **admin:** pick the Action filter by label, and lift the empty-group mute to AA ([09f647ff](https://github.com/ortha-source/ortha-cms/commit/09f647ff))
- **alarms:** say the severity on the two surfaces that had stopped ([4940789b](https://github.com/ortha-source/ortha-cms/commit/4940789b))
- **api-tokens:** answer honestly about an expiry, a scope, and an empty bucket ([37934330](https://github.com/ortha-source/ortha-cms/commit/37934330))
- **api-tokens-admin:** keep a credential from being minted twice, and give focus somewhere to land ([275b5df9](https://github.com/ortha-source/ortha-cms/commit/275b5df9))
- **cli:** answer `ortha --help` instead of "Unknown command" ([25ca4018](https://github.com/ortha-source/ortha-cms/commit/25ca4018))
- **config:** read the environment only through readEnv, so a blank key means absent ([f9c1a50f](https://github.com/ortha-source/ortha-cms/commit/f9c1a50f))
- **content:** describe the public content API in the OpenAPI document ([f36b0ade](https://github.com/ortha-source/ortha-cms/commit/f36b0ade))
- **copilot:** keep a partial answer when a run ends mid-stream ([21ea4223](https://github.com/ortha-source/ortha-cms/commit/21ea4223))
- **create-ortha-app:** expect the plugins the template actually registers ([66649d4a](https://github.com/ortha-source/ortha-cms/commit/66649d4a))
- **design-system:** drop the dropdown exit animation, which kept closed overlays live ([13622011](https://github.com/ortha-source/ortha-cms/commit/13622011))
- **design-system:** the spinner stops rotating under reduced motion, without stopping ([ab4f6aed](https://github.com/ortha-source/ortha-cms/commit/ab4f6aed))
- **e2e:** stop the memory advisory crying wolf on macOS ([bb11484f](https://github.com/ortha-source/ortha-cms/commit/bb11484f))
- **i18n:** join the ambient unit of work when checking a translation group ([65904430](https://github.com/ortha-source/ortha-cms/commit/65904430))
- **identity-admin:** say why the session ended, and ask for the confirm once ([1f36533c](https://github.com/ortha-source/ortha-cms/commit/1f36533c))
- **identity-admin:** answer an unknown /identity path instead of a blank page ([f5e89918](https://github.com/ortha-source/ortha-cms/commit/f5e89918))
- **media:** move the timed-text track types out of infrastructure ([80219e9a](https://github.com/ortha-source/ortha-cms/commit/80219e9a))
- **media:** give the storage port its own package, so an adapter costs an adapter ([82d12871](https://github.com/ortha-source/ortha-cms/commit/82d12871))
- **query-builder:** restore `like` to the reverse map, which silently dropped it ([4574cfd9](https://github.com/ortha-source/ortha-cms/commit/4574cfd9))
- **query-builder:** open the filter panel without scrolling its own clip ([0fc39073](https://github.com/ortha-source/ortha-cms/commit/0fc39073))
- **segments:** check an entry's workspace before writing its audiences ([5e974b41](https://github.com/ortha-source/ortha-cms/commit/5e974b41))
- **server-e2e:** retry a deadlocked truncate, and unpin two stale expectations ([aedcd992](https://github.com/ortha-source/ortha-cms/commit/aedcd992))
- **server-e2e:** bind the harness to loopback, so the suite stops losing requests ([99a648f7](https://github.com/ortha-source/ortha-cms/commit/99a648f7))
- **transfer:** let the link pass see what the first write actually wrote ([585418d2](https://github.com/ortha-source/ortha-cms/commit/585418d2))
- **users-server:** reject an explicit null name instead of clearing it ([d73d8ffa](https://github.com/ortha-source/ortha-cms/commit/d73d8ffa))
- **webhooks:** purge a deleted workspace's subscription rows ([#245](https://github.com/ortha-source/ortha-cms/pull/245))
- **webhooks-admin:** keep node:crypto out of the browser bundle ([a58eeb4c](https://github.com/ortha-source/ortha-cms/commit/a58eeb4c))
- **webhooks-admin:** the three things only a browser could find ([7e73abdf](https://github.com/ortha-source/ortha-cms/commit/7e73abdf))
- **webhooks-admin:** name the two filter pickers ([7c3bf771](https://github.com/ortha-source/ortha-cms/commit/7c3bf771))
- **workspaces:** purge the rows a deleted workspace used to strand ([ba4632b1](https://github.com/ortha-source/ortha-cms/commit/ba4632b1))
- **workspaces-admin:** stop the roster surfaces failing quietly ([3b12ffef](https://github.com/ortha-source/ortha-cms/commit/3b12ffef))
- **wysiwyg:** actually clear the alt when an image is marked decorative ([dd0b9676](https://github.com/ortha-source/ortha-cms/commit/dd0b9676))
- **wysiwyg:** keep a passage's language when formatting is cleared ([fcd1f3b9](https://github.com/ortha-source/ortha-cms/commit/fcd1f3b9))
- **wysiwyg:** stop Tab re-appending the row TableTab just bounded ([5b0a906a](https://github.com/ortha-source/ortha-cms/commit/5b0a906a))

### ❤️ Thank You

- Claude
- Claude Opus 5
- Claude Opus 5 (1M context)
- Pavel Makhanko @pmknk

## 0.4.3 (2026-08-28)

### 🚀 Features

- **alarms:** content rules that flag problems without blocking a write ([b86f4499](https://github.com/ortha-source/ortha-cms/commit/b86f4499))
- **alarms:** expose findings to the copilot and render them ([dfbfe29b](https://github.com/ortha-source/ortha-cms/commit/dfbfe29b))
- **alarms:** group flagged records by the alarm that flagged them ([3d5740b1](https://github.com/ortha-source/ortha-cms/commit/3d5740b1))
- **alarms:** mark required fields, remove muting, wire the relation picker ([7c6de578](https://github.com/ortha-source/ortha-cms/commit/7c6de578))
- **alarms:** re-check from a group header, and collapse the builder on apply ([b4e19c50](https://github.com/ortha-source/ortha-cms/commit/b4e19c50))
- **content:** saved list views for collection records ([dcf80402](https://github.com/ortha-source/ortha-cms/commit/dcf80402))
- **content,segments:** version an entry's access with the entry ([1828438b](https://github.com/ortha-source/ortha-cms/commit/1828438b))
- **identity:** let a contributor delete content and media ([9ae9248c](https://github.com/ortha-source/ortha-cms/commit/9ae9248c))
- **query-builder:** a named category for flat fields, and put segments in one ([22107929](https://github.com/ortha-source/ortha-cms/commit/22107929))
- **segments:** reader access as two lists on the entry ([e5f500e9](https://github.com/ortha-source/ortha-cms/commit/e5f500e9))
- **segments:** apply entry access on the entry's own Save/Publish ([7716a0ab](https://github.com/ortha-source/ortha-cms/commit/7716a0ab))
- **segments:** audience pages, workspace scope, pagination, bulk set ([f1f2afc3](https://github.com/ortha-source/ortha-cms/commit/f1f2afc3))
- **segments:** filter records by audience; move the Access tab's directory link ([ec850b2e](https://github.com/ortha-source/ortha-cms/commit/ec850b2e))
- **segments:** default the audience filter to multi-select, and cover both halves by e2e ([7e4106a7](https://github.com/ortha-source/ortha-cms/commit/7e4106a7))
- **segments:** revise every locale a save's audiences reached, and load into skeletons ([7ceebbb5](https://github.com/ortha-source/ortha-cms/commit/7ceebbb5))
- **segments:** reach reader entitlements from MCP, the copilot and a token ([0a6b6ab2](https://github.com/ortha-source/ortha-cms/commit/0a6b6ab2))

### 🩹 Fixes

- **admin-e2e:** sort from the header's button, not the cell around it ([33eddbfb](https://github.com/ortha-source/ortha-cms/commit/33eddbfb))
- **alarms:** rebuild the alarms UI around what people actually reported ([e8311ae5](https://github.com/ortha-source/ortha-cms/commit/e8311ae5))
- **alarms:** drop the dead space under a group that does not page ([a1f76dc9](https://github.com/ortha-source/ortha-cms/commit/a1f76dc9))
- **content:** apply the read scope inside relation windows, not only on hydration ([bb379d58](https://github.com/ortha-source/ortha-cms/commit/bb379d58))
- **create-ortha-app:** refuse a feature id no group defines ([b6c4a98c](https://github.com/ortha-source/ortha-cms/commit/b6c4a98c))
- **release:** stop pack leaving a broken package staged ([b2e085ec](https://github.com/ortha-source/ortha-cms/commit/b2e085ec))
- **segments:** space badge icons in the design system, validate the segment form ([da7a3191](https://github.com/ortha-source/ortha-cms/commit/da7a3191))
- **segments:** bind reader/audience ids as one uuid[] parameter ([f4bf6dd5](https://github.com/ortha-source/ortha-cms/commit/f4bf6dd5))
- **segments:** write an entry's audiences to its whole locale group ([c364a01c](https://github.com/ortha-source/ortha-cms/commit/c364a01c))
- **server-e2e:** give the run the heap the run actually needs ([be0df263](https://github.com/ortha-source/ortha-cms/commit/be0df263))
- **server-e2e:** bound resetDb's wait for its own locks ([29aabc9b](https://github.com/ortha-source/ortha-cms/commit/29aabc9b))

### ❤️ Thank You

- Claude
- Claude Opus 5
- Claude Opus 5 (1M context)
- Pavel Makhanko @pmknk

## 0.4.2 (2026-08-24)

### 🩹 Fixes

- **create-ortha-app:** make Tailwind actually scan the installed packages ([8951c7e2](https://github.com/ortha-source/ortha-cms/commit/8951c7e2))

### ❤️ Thank You

- Claude Opus 5 (1M context)
- Pavel Makhanko @pmknk

## 0.4.1 (2026-08-24)

### 🩹 Fixes

- **create-ortha-app:** let a second picker read the keyboard ([b47c1e70](https://github.com/ortha-source/ortha-cms/commit/b47c1e70))
- **release:** declare the phantom deps that kept two packages off npm ([7232e0c6](https://github.com/ortha-source/ortha-cms/commit/7232e0c6))

### ❤️ Thank You

- Claude
- Claude Opus 5 (1M context)
- Pavel Makhanko @pmknk

## 0.4.0 (2026-08-24)

### 🚀 Features

- **cli:** add `ortha` and `npx create-ortha-app` ([5c056f81](https://github.com/ortha-source/ortha-cms/commit/5c056f81))
- **content-admin:** a ⋯ menu for the collection, and move Import into it ([#201](https://github.com/ortha-source/ortha-cms/issues/201))
- **content-admin:** move the ⋯ menu right, and fold bulk actions into one ([c5aaaec0](https://github.com/ortha-source/ortha-cms/commit/c5aaaec0))
- **create-ortha-app:** pick features at scaffold time, in a proper wizard ([860b424f](https://github.com/ortha-source/ortha-cms/commit/860b424f))
- **create-ortha-app:** ship the copilot by default, ask about protocols ([4af15060](https://github.com/ortha-source/ortha-cms/commit/4af15060))
- **create-ortha-app:** declare every reachable package in a new app ([17a97fbd](https://github.com/ortha-source/ortha-cms/commit/17a97fbd))
- **create-ortha-app:** ship a working test setup in the generated app ([ea90aa47](https://github.com/ortha-source/ortha-cms/commit/ea90aa47))
- **create-ortha-app:** split e2e into server and admin suites ([70411c97](https://github.com/ortha-source/ortha-cms/commit/70411c97))
- **identity:** SSO phase 0 — the provider seam, with no real IdP in it ([3afa9655](https://github.com/ortha-source/ortha-cms/commit/3afa9655))
- **identity:** SSO phase 1 — a real identity provider ([c48b13ee](https://github.com/ortha-source/ortha-cms/commit/c48b13ee))
- **identity:** SSO phase 2 — what a sign-in is allowed to do ([67a88113](https://github.com/ortha-source/ortha-cms/commit/67a88113))
- **identity:** SSO phase 3 — the long tail ([c7aa471e](https://github.com/ortha-source/ortha-cms/commit/c7aa471e))
- **insights:** put the selected range in the URL, so a dashboard can be shared ([bf0c3e91](https://github.com/ortha-source/ortha-cms/commit/bf0c3e91))
- **media:** one storage provider per deployment, passed as one object ([96c7b028](https://github.com/ortha-source/ortha-cms/commit/96c7b028))
- **media:** ship the in-memory storage provider as a package ([218be993](https://github.com/ortha-source/ortha-cms/commit/218be993))
- **media:** implement the S3-compatible storage provider ([8589f095](https://github.com/ortha-source/ortha-cms/commit/8589f095))
- **media:** serve downloads as a signed redirect when the backend can ([57f0f806](https://github.com/ortha-source/ortha-cms/commit/57f0f806))
- **media:** add the Azure Blob Storage provider ([ffa1558c](https://github.com/ortha-source/ortha-cms/commit/ffa1558c))
- **media:** add the Google Cloud Storage provider ([fc674283](https://github.com/ortha-source/ortha-cms/commit/fc674283))
- **media:** add the Vercel Blob provider ([a5a662a0](https://github.com/ortha-source/ortha-cms/commit/a5a662a0))
- **transfer:** the transfer kernel — document contract, formats, identity ([37235c74](https://github.com/ortha-source/ortha-cms/commit/37235c74))
- **transfer:** the server plugin — one-hop export, two-phase import ([fd6eb11c](https://github.com/ortha-source/ortha-cms/commit/fd6eb11c))
- **transfer:** the admin plugin, and a bulk-action slot to hang it on ([7c8b293a](https://github.com/ortha-source/ortha-cms/commit/7c8b293a))
- **transfer:** register the plugin, and write down why it exists ([d1abf7c8](https://github.com/ortha-source/ortha-cms/commit/d1abf7c8))
- **transfer:** link related records on import instead of copying them ([744ab919](https://github.com/ortha-source/ortha-cms/commit/744ab919))

### 🩹 Fixes

- **admin-a11y:** stop the route announcer reading loading skeletons; give every skeleton an <h1> ([36f955d0](https://github.com/ortha-source/ortha-cms/commit/36f955d0))
- **admin-e2e:** close the permission drift and two stale locators ([810bc1fb](https://github.com/ortha-source/ortha-cms/commit/810bc1fb))
- **bootstrap-admin:** wire slot contributions from empty, so a hot update stops doubling them ([99f1cf8d](https://github.com/ortha-source/ortha-cms/commit/99f1cf8d))
- **content-graphql:** close the maxComplexity budget's prototype-name fail-open ([1298af42](https://github.com/ortha-source/ortha-cms/commit/1298af42))
- **content-graphql:** bound SchemaCache, which kept one schema per grant set ever seen ([a3bde042](https://github.com/ortha-source/ortha-cms/commit/a3bde042))
- **copilot-admin:** make the transcript and the composer one column ([33a8c2a6](https://github.com/ortha-source/ortha-cms/commit/33a8c2a6))
- **copilot-provider-openai:** retry a transient upstream failure, as anthropic does ([d54d4153](https://github.com/ortha-source/ortha-cms/commit/d54d4153))
- **create-ortha-app:** classify the two provider-authoring packages ([94a294d8](https://github.com/ortha-source/ortha-cms/commit/94a294d8))
- **database:** drain the pool and the in-flight outbox batch on shutdown ([ac173ef8](https://github.com/ortha-source/ortha-cms/commit/ac173ef8))
- **identity-server:** drop sessionSecret and tokenSecret, which nothing read ([2d5b9b6c](https://github.com/ortha-source/ortha-cms/commit/2d5b9b6c))
- **media-server:** map the media tools' domain errors, so a bad argument is a 400 not an opaque 500 ([474a7ead](https://github.com/ortha-source/ortha-cms/commit/474a7ead))
- **media-server:** answer 404, not 500, when an asset's blob is missing from storage ([98d6624b](https://github.com/ortha-source/ortha-cms/commit/98d6624b))
- **server-e2e:** stop the local-storage suite leaking rows into the next file ([1532d740](https://github.com/ortha-source/ortha-cms/commit/1532d740))
- **transfer:** key localized fields, and fold the locale into the match ([5b5fb271](https://github.com/ortha-source/ortha-cms/commit/5b5fb271))
- **transfer:** stop the import's link pass blanking the fields it just wrote ([7510195a](https://github.com/ortha-source/ortha-cms/commit/7510195a))
- **transfer-admin:** refresh the list after an import, and explain the options ([ffaf843c](https://github.com/ortha-source/ortha-cms/commit/ffaf843c))

### ❤️ Thank You

- Claude
- Claude Opus 4.8
- Claude Opus 5
- Claude Opus 5 (1M context)
- Pavel Makhanko @pmknk

## 0.3.0 (2026-08-22)

### 🚀 Features

- **admin:** give the last six lazy routes a skeleton instead of a blank page ([b7b39376](https://github.com/ortha-source/ortha-cms/commit/b7b39376))
- **content:** mark entry-editor tabs that still hold required fields ([a2588e6f](https://github.com/ortha-source/ortha-cms/commit/a2588e6f))
- **content:** model richtext as a structured document, not an opaque string ([3c1fe332](https://github.com/ortha-source/ortha-cms/commit/3c1fe332))
- **content:** model alt text on a media value (ORT-83, ORT-91) ([c573e30a](https://github.com/ortha-source/ortha-cms/commit/c573e30a))
- **content-admin:** draw the boundary between translated and shared fields ([4fb331de](https://github.com/ortha-source/ortha-cms/commit/4fb331de))
- **content-server:** batch the writes for the API, MCP and the copilot ([c06de351](https://github.com/ortha-source/ortha-cms/commit/c06de351))
- **copilot:** keep a thread's model and its attached page with the session ([3812cc36](https://github.com/ortha-source/ortha-cms/commit/3812cc36))
- **copilot:** cache the prompt, and lift all three run ceilings together ([cf6d8fd6](https://github.com/ortha-source/ortha-cms/commit/cf6d8fd6))
- **copilot:** say what a save must contain, which depends on publishable ([12b950a9](https://github.com/ortha-source/ortha-cms/commit/12b950a9))
- **copilot:** drop defaultProvider — the provider list is the setting ([6930757e](https://github.com/ortha-source/ortha-cms/commit/6930757e))
- **copilot:** stand the dock down on the Agents view, and let a panel move there ([e6c41781](https://github.com/ortha-source/ortha-cms/commit/e6c41781))
- **copilot-server:** tell the model that shared fields are not translatable ([a98ea87a](https://github.com/ortha-source/ortha-cms/commit/a98ea87a))
- **dev:** per-worktree dev stack slots for parallel tickets ([c2b29a14](https://github.com/ortha-source/ortha-cms/commit/c2b29a14))
- **i18n-server:** batch the translations, and stop content saves joining a group ([c037a12c](https://github.com/ortha-source/ortha-cms/commit/c037a12c))
- **identity,users:** admin-generated password reset links ([#11](https://github.com/ortha-source/ortha-cms/issues/11))
- **media:** let an asset carry captions and subtitles (ORT-92) ([53c6ba6c](https://github.com/ortha-source/ortha-cms/commit/53c6ba6c))
- **users-server:** machine codes on conflicts, and a resend cooldown ([#140](https://github.com/ortha-source/ortha-cms/issues/140))

### 🩹 Fixes

- **a11y:** landmarks, headings, dialog names, titles and localized chrome ([586135ef](https://github.com/ortha-source/ortha-cms/commit/586135ef))
- **a11y:** name the scrollport, contain the mobile panel, fix the copilot transcript ([90245924](https://github.com/ortha-source/ortha-cms/commit/90245924))
- **a11y:** reachable tooltips, a shared shortcut guard, bounded table Tab ([35a9fe45](https://github.com/ortha-source/ortha-cms/commit/35a9fe45))
- **a11y:** make the query builder usable by screen reader (ORT-157) ([1d7eba91](https://github.com/ortha-source/ortha-cms/commit/1d7eba91))
- **a11y:** give the copilot consent prompt a deadline the user can see and extend (ORT-118) ([90def351](https://github.com/ortha-source/ortha-cms/commit/90def351))
- **a11y:** prompt for alt in the copilot write path, declare direction, mark a prefill's language ([6eb1c45d](https://github.com/ortha-source/ortha-cms/commit/6eb1c45d))
- **a11y:** re-enable the structural axe rules, and fix what they caught ([985c73a5](https://github.com/ortha-source/ortha-cms/commit/985c73a5))
- **activity-admin:** render every audit kind the server writes, and stop a bad timestamp blanking the app ([4c709a01](https://github.com/ortha-source/ortha-cms/commit/4c709a01))
- **activity-server:** audit the media library, invite acceptance, and refuse an unnameable subject ([490c5dca](https://github.com/ortha-source/ortha-cms/commit/490c5dca))
- **admin-e2e:** make typecheck — the suite's only static gate — pass again ([daaba15c](https://github.com/ortha-source/ortha-cms/commit/daaba15c))
- **api-tokens:** let the workspace picker scroll by wheel inside its dialog ([03404fc7](https://github.com/ortha-source/ortha-cms/commit/03404fc7))
- **api-tokens-admin:** stop the one-time secret being silently lost, and label what mints it ([72d89760](https://github.com/ortha-source/ortha-cms/commit/72d89760))
- **apps:** validate the two composition roots instead of trusting them ([47f6fe13](https://github.com/ortha-source/ortha-cms/commit/47f6fe13))
- **bootstrap-admin:** stop one plugin from taking the whole app down ([c52bf23d](https://github.com/ortha-source/ortha-cms/commit/c52bf23d))
- **bootstrap-admin:** stop the route announcer naming the page you just left ([647be7d6](https://github.com/ortha-source/ortha-cms/commit/647be7d6))
- **bootstrap-server:** let the host trust its proxy so login throttling buckets per client ([b22e8b66](https://github.com/ortha-source/ortha-cms/commit/b22e8b66))
- **bootstrap-server:** make the host's four deployment-shaped failures survivable ([d190f0db](https://github.com/ortha-source/ortha-cms/commit/d190f0db))
- **content:** count only real transitions in a bulk unpublish ([ac382912](https://github.com/ortha-source/ortha-cms/commit/ac382912))
- **content:** stop the globe meaning two opposite things across the editor ([1f57541a](https://github.com/ortha-source/ortha-cms/commit/1f57541a))
- **content:** disclose when a proposed edit rewrites every locale ([b6814544](https://github.com/ortha-source/ortha-cms/commit/b6814544))
- **content:** reject inherited Object.prototype names in the ?fields= whitelist ([#164](https://github.com/ortha-source/ortha-cms/issues/164))
- **content:** raise domain events for entry create, update, delete and restore ([900fc277](https://github.com/ortha-source/ortha-cms/commit/900fc277))
- **content-admin:** tell refusal, absence and failure apart ([78b29def](https://github.com/ortha-source/ortha-cms/commit/78b29def))
- **content-domain:** close seven validation holes in the shared kernel ([e99aad93](https://github.com/ortha-source/ortha-cms/commit/e99aad93))
- **content-graphql:** a 620-byte query no longer wedges the process ([25ad080a](https://github.com/ortha-source/ortha-cms/commit/25ad080a))
- **content-graphql:** a single-record read costs one record, not a page ([65e64e21](https://github.com/ortha-source/ortha-cms/commit/65e64e21))
- **content-graphql:** drop the needless escapes in the MediaAsset.alt description ([1a4707ad](https://github.com/ortha-source/ortha-cms/commit/1a4707ad))
- **content-graphql:** escape the cache key's separator instead of embedding it ([b09b571d](https://github.com/ortha-source/ortha-cms/commit/b09b571d))
- **content-server:** enforce workspace content grants on the admin API ([cfb43bf2](https://github.com/ortha-source/ortha-cms/commit/cfb43bf2))
- **copilot:** put a replayed tool result back on a user turn ([36d2691b](https://github.com/ortha-source/ortha-cms/commit/36d2691b))
- **copilot:** tell the model when an earlier turn was cut off ([87334049](https://github.com/ortha-source/ortha-cms/commit/87334049))
- **copilot-admin:** one thread one window, and controls that mean what they say ([b523ddcb](https://github.com/ortha-source/ortha-cms/commit/b523ddcb))
- **copilot-admin:** say what the run is doing, and give a failed change room ([84127e97](https://github.com/ortha-source/ortha-cms/commit/84127e97))
- **copilot-domain:** bound the untrusted fence and tighten the port's contracts ([5843c225](https://github.com/ortha-source/ortha-cms/commit/5843c225))
- **copilot-server:** own the parked run, bound the tool loop, keep every receipt ([4ce655b0](https://github.com/ortha-source/ortha-cms/commit/4ce655b0))
- **database:** stop the outbox from wedging the pool it drains ([81f3eb03](https://github.com/ortha-source/ortha-cms/commit/81f3eb03))
- **design-system:** settle the toast corner in one place ([e62427ad](https://github.com/ortha-source/ortha-cms/commit/e62427ad))
- **design-system:** per-toast dismissal, localizable names, forced colors ([5ae28bd4](https://github.com/ortha-source/ortha-cms/commit/5ae28bd4))
- **design-system:** give the button focus ring enough contrast to see ([8533c758](https://github.com/ortha-source/ortha-cms/commit/8533c758))
- **design-system:** watch the table, not just the wrapper, for overflow ([75ca80b5](https://github.com/ortha-source/ortha-cms/commit/75ca80b5))
- **hooks:** the catalog drift hooks never matched a file ([42475e30](https://github.com/ortha-source/ortha-cms/commit/42475e30))
- **i18n-admin:** tell "nothing" from "we couldn't ask", and state language ([#144](https://github.com/ortha-source/ortha-cms/issues/144))
- **i18n-server:** a group lock, a guarded POST, an orphan check, honest filters ([69d7c10e](https://github.com/ortha-source/ortha-cms/commit/69d7c10e))
- **identity:** announce a forced sign-out and explain it on the sign-in page ([f325e9e6](https://github.com/ortha-source/ortha-cms/commit/f325e9e6))
- **identity-admin:** drop the previous session's cache when the tab changes hands ([10047aa4](https://github.com/ortha-source/ortha-cms/commit/10047aa4))
- **identity-admin:** stop advertising controls the sign-in page cannot honour ([#8](https://github.com/ortha-source/ortha-cms/issues/8))
- **identity-admin:** stop reporting an invite-lookup outage as a dead link ([9a27ff04](https://github.com/ortha-source/ortha-cms/commit/9a27ff04))
- **identity-admin:** tell the user when signing out fails ([b1b502a6](https://github.com/ortha-source/ortha-cms/commit/b1b502a6))
- **identity-admin:** tell an API outage apart from being signed out ([4aa274af](https://github.com/ortha-source/ortha-cms/commit/4aa274af))
- **identity-admin:** give an empty field one validation message, not two ([12eb2d4e](https://github.com/ortha-source/ortha-cms/commit/12eb2d4e))
- **identity-admin:** close the four open ORT-57 accessibility findings ([#129](https://github.com/ortha-source/ortha-cms/issues/129))
- **identity-admin:** stop the focus ring boxing the auth page title ([2748e914](https://github.com/ortha-source/ortha-cms/commit/2748e914))
- **identity-server:** count the password ceiling in bytes, the unit bcrypt truncates on ([22d94f82](https://github.com/ortha-source/ortha-cms/commit/22d94f82))
- **identity-server:** gate a member's session list on users:update, not users:read ([1c535c62](https://github.com/ortha-source/ortha-cms/commit/1c535c62))
- **identity-server:** revoke sessions on a password change, and audit it ([143564f7](https://github.com/ortha-source/ortha-cms/commit/143564f7))
- **identity-server:** audit API-token mint and revoke ([84b463cc](https://github.com/ortha-source/ortha-cms/commit/84b463cc))
- **identity-server:** reject an API token minted for a workspace that does not exist ([17099ddc](https://github.com/ortha-source/ortha-cms/commit/17099ddc))
- **identity-server:** reconcile the RBAC seeder so a retired permission stops being granted ([297d75c7](https://github.com/ortha-source/ortha-cms/commit/297d75c7))
- **mcp-server:** answer every verb, bound every exchange, map every resource failure ([2e59ee23](https://github.com/ortha-source/ortha-cms/commit/2e59ee23))
- **media:** browse the library on the server, and page it ([f0859a15](https://github.com/ortha-source/ortha-cms/commit/f0859a15))
- **media-admin:** say what the server said, and let alt text be written ([8e55bf8f](https://github.com/ortha-source/ortha-cms/commit/8e55bf8f))
- **media-admin, copilot-admin:** two landmark bugs the new axe rules found ([efaaae29](https://github.com/ortha-source/ortha-cms/commit/efaaae29))
- **media-provider-local:** make a write all-or-nothing, and keep every key inside the root ([74a393ee](https://github.com/ortha-source/ortha-cms/commit/74a393ee))
- **media-server:** treat a download as hostile bytes, and mean the limits ([f0cafb35](https://github.com/ortha-source/ortha-cms/commit/f0cafb35))
- **nx:** stop db:generate caching a schema it cannot see, and refuse a migration nobody aimed ([05dd392b](https://github.com/ortha-source/ortha-cms/commit/05dd392b))
- **packaging:** declare the deps four packages import but never listed ([fac626ff](https://github.com/ortha-source/ortha-cms/commit/fac626ff))
- **query-builder-admin,insights-admin:** close the crafted-filter crash and the silent dashboard states ([259b536f](https://github.com/ortha-source/ortha-cms/commit/259b536f))
- **server-e2e:** a broken run says so instead of blaming the product ([90ef675a](https://github.com/ortha-source/ortha-cms/commit/90ef675a))
- **server-e2e:** close the state a test could leak into the next one ([1d150224](https://github.com/ortha-source/ortha-cms/commit/1d150224))
- **server-e2e:** say "memory" before the run says "regression" ([7c68d69a](https://github.com/ortha-source/ortha-cms/commit/7c68d69a))
- **shell-admin:** stop the chrome dropping focus, and stop a phone rewriting a desktop preference ([6f07f315](https://github.com/ortha-source/ortha-cms/commit/6f07f315))
- **tools-server:** validate what a tool is handed, and fail the deploy on a bad catalogue ([89b61fbc](https://github.com/ortha-source/ortha-cms/commit/89b61fbc))
- **users-admin:** close the eleven confirmed ORT-66 QA findings ([dee5c07c](https://github.com/ortha-source/ortha-cms/commit/dee5c07c))
- **users-admin:** anchor roster focus outside the table ([1ae4d71b](https://github.com/ortha-source/ortha-cms/commit/1ae4d71b))
- **users-admin:** take the member timeline's action labels from the one shared catalogue ([a92eff31](https://github.com/ortha-source/ortha-cms/commit/a92eff31))
- **users-server:** guard state-changing routes and stop blanket locking ([d6abb024](https://github.com/ortha-source/ortha-cms/commit/d6abb024))
- **utils-admin:** repair five seams every admin plugin inherits ([6de165d0](https://github.com/ortha-source/ortha-cms/commit/6de165d0))
- **utils-server:** make the filter whitelist a whitelist again ([3833733e](https://github.com/ortha-source/ortha-cms/commit/3833733e))
- **utils-server:** reject a filter operator the column type cannot answer ([2ddcf4d1](https://github.com/ortha-source/ortha-cms/commit/2ddcf4d1))
- **workspaces-admin:** close the five confirmed ORT-60 QA findings ([0f52010e](https://github.com/ortha-source/ortha-cms/commit/0f52010e))
- **workspaces-admin:** close the eleven ORT-60 accessibility findings ([69674691](https://github.com/ortha-source/ortha-cms/commit/69674691))
- **workspaces-admin:** give the switcher a width again, and fold the quick-list ([25ee2d8d](https://github.com/ortha-source/ortha-cms/commit/25ee2d8d))
- **workspaces-server:** close the eight confirmed ORT-53 QA findings ([450210e8](https://github.com/ortha-source/ortha-cms/commit/450210e8))
- **workspaces-server:** purge cross-plugin rows when a workspace is deleted ([#136](https://github.com/ortha-source/ortha-cms/issues/136))
- **wysiwyg-admin:** let the editor say what language it is in, and how to leave ([a1c5e88f](https://github.com/ortha-source/ortha-cms/commit/a1c5e88f))

### ❤️ Thank You
- Pavel Makhanko @pmknk
