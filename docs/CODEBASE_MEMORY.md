# Codebase Memory — KALLÍSTIS Genesis

## Implemented architecture

The application is one Bun + Vite + TanStack Start + React application. KALLÍSTIS owns routes, sessions, character domain data, rules, validation, campaigns, tables, progression, and PostgreSQL persistence. There is one router and one application package manifest. The KALLÍSTIS Worker entry can run with local process environment and request context while retaining Cloudflare binding support. Local AI uses the existing OpenRouter provider; `OPENROUTER_API_KEY` is supplied only through the ignored local `.env` and is not committed. ZeroClaw is not yet connected to an application API contract.

## Main code locations

- `src/server.ts`: request entry, security headers, local/Worker runtime context.
- `src/routes/_authenticated/criar-personagem.tsx`, `src/routes/api/character-creation.ts`: guided character creation UI and server API.
- `src/server/characters/`: character contracts, canonical choices, validation, progression, and repositories.
- `src/lib/canonical-rules.server.ts`: canonical catalog retrieval and rules grounding.
- `src/server/local-core/`: authentication, authorization, chat, campaign/table repositories, and PostgreSQL executor.
- `src/server/chat/kallistis-chat-runtime.ts`: AI-backed chat and structured KALLÍSTIS actions.
- `src/routes/_authenticated/personagem/$characterId/ficha.tsx`: persisted character sheet route.
- `db/migrations/`: PostgreSQL schema history; a local development database has the app schema migrations applied, excluding data-specific/auth-provider and QA-only migrations documented in the run notes.
- `CANON/`: KALLÍSTIS canon references.
- `public/jogar/`: Forge, canonical browser, and Velarim static experiences.
- `docs/SOURCE_PROVENANCE.md`: pinned source commits and component reuse record.

## Data and authority contracts

Character creation, rules, and persistence use KALLÍSTIS server routes and PostgreSQL repositories. Character choices must pass canonical validation before save. The character sheet loads the same persisted character identity. Velmoor contributes interaction inspiration only; it does not own game rules or data. No Totalidade or Velmoor backend, router, or database was included.

## Verification state

- Confirmed: target repository cloned from the requested empty remote; local branch is `master`; selected source commits are recorded; local server entry has a Node/Bun context path; production config, credentials, personal exports, and deployment scripts were excluded. Dependencies installed with the locked Bun dependency file. The app starts at `http://127.0.0.1:5175/`. Local PostgreSQL is running in a dedicated container/database. A real local account authenticated in the browser, and the app created and reloaded a persisted character draft containing the submitted narrative.
- G1 real flow passed locally on 2026-10-26. The ignored local `.env` key was confirmed present in the restarted server process without printing its value. OpenRouter made successful real requests using `deepseek/deepseek-v4-flash-0731`; no mock or fallback provider was used. The user signed out and back in through the browser, recovered the same character and conversation, opened its read-only sheet, and opened that same character ID in Character Forge.
- Read-only SQL after Forge access against `kallistis_genesis`: 1 character; `Ilyra`, ID `5a9d19a9-7401-4455-926d-f516fc4aeb02`; `draft`, version 50; `serverCreationProgress.status=complete`; 23 confirmed paths; 71 conversation messages; 50 version rows; all version snapshots include creation progress; current snapshot equals latest version. The character is Marco 1 and has not been submitted to a Mestre. The Forge read left the version and history unchanged.
- Canonically confirmed choices include Povo Aelvari, Herança Cronista, Origem Criado na Luz, Ofício Curador, Papel Amparo, attribute and skill distributions, and equipment. The server validated confirmed proposals before persistence. OpenRouter returned malformed structured output in some attempts; those attempts were retained as honest history, not persisted as choices, and the existing retry flow later succeeded. One assistant explanation of the origin added unsupported narrative flavor; it was not stored as a mechanical rule or character effect. Treat AI free-form lore explanations as a remaining content-grounding limitation.
- ZeroClaw runtime/API integration is not implemented or verified. No production database was accessed. No push or deploy was performed. Local database evidence applies only to this dedicated Genesis environment.

## G1 real-character checkpoint — 2026-10-26

- Destination remains on local `master` with no commit/HEAD. Remote `origin/main` points to `a459c07bb39f7b679731b1602f7feb5001c25583` and contains `PERCURSO.md`; divergence remains unresolved. No merge, rebase, reset, push, or PERCURSO edit was performed.
- Local runtime at `http://127.0.0.1:5175/` returned HTTP 200. Restarted with `.env` loaded; process-level presence of `OPENROUTER_API_KEY` was checked as a boolean only. The key value was not displayed or persisted in documentation.
- Manual G1 sequence: real local authentication → real OpenRouter conversation → canonical proposal confirmation → server validation → PostgreSQL persistence → logout → new login → same character and history recovery → read-only sheet → same character opened in Forge. Evidence and database counts are recorded above.
- The local database verification used an explicit read-only transaction. No production database, source checkout, deployment, or remote Git state was changed.
