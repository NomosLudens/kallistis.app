# Codebase Memory — KALLÍSTIS Genesis

## Implemented architecture

The application is one Bun + Vite + TanStack Start + React application. KALLÍSTIS owns routes, sessions, character domain data, rules, validation, campaigns, tables, progression, and PostgreSQL persistence. There is one router and one application package manifest. The KALLÍSTIS Worker entry can run with local process environment and request context while retaining Cloudflare binding support. Local AI uses the existing OpenRouter provider; `OPENROUTER_API_KEY` is supplied only through the ignored local `.env` and is not committed. ZeroClaw is installed locally but is not connected to an application API contract or KALLÍSTIS-scoped agent.

## Main code locations

- `src/server.ts`: request entry, security headers, local/Worker runtime context.
- `src/routes/_authenticated/criar-personagem.tsx`, `src/routes/api/character-creation.ts`: guided character creation UI and server API.
- `src/server/characters/`: character contracts, canonical choices, validation, progression, and repositories.
- `src/lib/canonical-rules.server.ts`: canonical catalog retrieval and rules grounding.
- `src/server/local-core/`: authentication, authorization, chat, campaign/table repositories, and PostgreSQL executor.
- `src/server/chat/kallistis-chat-runtime.ts`: AI-backed chat and structured KALLÍSTIS actions.
- `src/components/ChatView.tsx`: player conversation, active persisted character selection, and compact mobile chat navigation.
- `src/routes/_authenticated/personagem/$characterId/ficha.tsx`: persisted character sheet route.
- `db/migrations/`: PostgreSQL schema history; a local development database has the app schema migrations applied, excluding data-specific/auth-provider and QA-only migrations documented in the run notes.
- `CANON/`: KALLÍSTIS canon references.
- `public/jogar/`: Forge, canonical browser, and Velarim static experiences.
- `docs/SOURCE_PROVENANCE.md`: pinned source commits and component reuse record.

## Data and authority contracts

Character creation, rules, and persistence use KALLÍSTIS server routes and PostgreSQL repositories. Character choices must pass canonical validation before save. The character sheet loads the same persisted character identity. Velmoor contributes interaction inspiration only; it does not own game rules or data. No Totalidade or Velmoor backend, router, or database was included.

## Verification state

- Confirmed: target repository cloned from the requested empty remote; local branch is `master`; selected source commits are recorded; local server entry has a Node/Bun context path; production config, credentials, personal exports, and deployment scripts were excluded. Local checkpoint commit `7fe22a51b6f7019bf879b94dd49662befebf3d30` preserves G1 before follow-up fixes; current source changes remain uncommitted. Dependencies installed with the locked Bun dependency file. The app starts at `http://127.0.0.1:5175/`. Local PostgreSQL is running in a dedicated container/database.
- G1 real flow passed locally on 2026-10-26. The ignored local `.env` key was confirmed present in the restarted server process without printing its value. OpenRouter made successful real requests using `deepseek/deepseek-v4-flash-0731`; no mock or fallback provider was used. The user signed out and back in through the browser, recovered the same character and conversation, opened its read-only sheet, and opened that same character ID in Character Forge.
- Read-only SQL after the G2 narrative update against `kallistis_genesis`: still 1 character; `Ilyra`, ID `5a9d19a9-7401-4455-926d-f516fc4aeb02`; `draft`, version 51; `snapshot.completo=true`; creation progress `complete`; 23 confirmed paths; 71 creation messages; 51 version rows. The confirmed biography now includes the player's exact narrative preference; no mechanical choice changed. Ilyra remains unsubmitted. The canonical `submit` action validates the full snapshot and transitions a ready draft to `submitted` for Mestre review, so it changes access and is not a neutral completion marker; no such transition was made.
- Canonically confirmed choices include Povo Aelvari, Herança Cronista, Origem Criado na Luz, Ofício Curador, Papel Amparo, attribute and skill distributions, and equipment. The server validated confirmed proposals before persistence. OpenRouter returned malformed structured output in some attempts; those attempts were retained as honest history, not persisted as choices, and the existing retry flow later succeeded. One assistant explanation of the origin added unsupported narrative flavor; it was not stored as a mechanical rule or character effect. Treat AI free-form lore explanations as a remaining content-grounding limitation.
- Real player-chat readback used the persisted active character after reload/login and a real OpenRouter response. The server previously sent character-bound rule questions through a keyword-only excerpt shortcut, which returned unrelated sections; it now routes character-bound turns through the contextual AI path. Reloading `character_creation` scope previously cleared the selected character; the client now retains a valid persisted selection. Browser checks covered 1440×900 desktop and 390×844 mobile; the mobile chat navigation now uses two compact action columns and a full-width character selector. These checks do not prove behavior on physical devices.
- ZeroClaw v0.8.3 inspection: only the existing `kaline` agent is configured; its global memory backend is disabled. No dedicated KALLÍSTIS agent, scoped memory, or authenticated backend-tool bridge is implemented. Do not reuse Kaline, grant SQL/shell access, or claim ZeroClaw memory based on the KALLÍSTIS/PostgreSQL biography.
- No second authorized account was available to test cross-user or cross-campaign memory isolation. No production database was accessed. No push or deploy was performed. Local database evidence applies only to this dedicated Genesis environment.

## G1 real-character checkpoint — 2026-10-26

- Destination remains on local `master` at checkpoint `7fe22a51b6f7019bf879b94dd49662befebf3d30`. Remote `origin/main` points to `a459c07bb39f7b679731b1602f7feb5001c25583` and contains `PERCURSO.md`; divergence remains unresolved. No merge, rebase, reset, push, or PERCURSO edit was performed.
- Local runtime at `http://127.0.0.1:5175/` returned HTTP 200. Restarted with `.env` loaded; process-level presence of `OPENROUTER_API_KEY` was checked as a boolean only. The key value was not displayed or persisted in documentation.
- Manual G1 sequence: real local authentication → real OpenRouter conversation → canonical proposal confirmation → server validation → PostgreSQL persistence → logout → new login → same character and history recovery → read-only sheet → same character opened in Forge. Evidence and database counts are recorded above.
- The local database verification used an explicit read-only transaction. No production database, source checkout, deployment, or remote Git state was changed.

## G2 player experience — 2026-10-26

- G1 data and history remain preserved. After the real logout/login, OpenRouter answered from Ilyra's persisted biography; the same chat thread and active character recovered. The player's narrative update was confirmed through the existing preview action and saved as version 51.
- Player-chat routing and reload selection fixes are in `src/server/chat/kallistis-chat-runtime.ts` and `src/components/chat-view-state.ts`. Mobile chat controls were compacted in `src/components/ChatView.tsx`.
- G2 is `PARTIAL`: ZeroClaw agent/context/memory isolation and real second-identity/campaign tests remain unverified. The current chat's separate PostgreSQL narrative persistence is verified and must not be described as ZeroClaw memory. No new character was created because the sequential G2.2 integration gate remains incomplete.
