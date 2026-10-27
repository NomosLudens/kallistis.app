# Source provenance

The sources below were read from existing local checkouts. Their worktrees were not edited. Only committed files at the recorded revisions were used; uncommitted source changes were excluded.

| Source | Local read-only checkout | Commit used | Working-tree note |
|---|---|---|---|
| Totalidade | `/home/tonyus-dev/Portifolio/CONGELADO/totalidade` | `6ac9aadb3f5e9b97bbaf71f3cb034a1ab33648c9` | Checkout had uncommitted changes; only the pinned commit was read. |
| Velmoor Legacy | `/home/tonyus-dev/Portifolio/KALLISTIS/velmoor-legacy` | `7c544841f19fd3464fd95b27f929c9f24996a4d6` | Checkout was clean at inspection. |
| KALLÍSTIS | `/home/tonyus-dev/Portifolio/KALLISTIS_RECOVERY/kallistis-clean` | `8c6770dacbb2f7869079b55336007323b4aba8c1` | Checkout had local WIP; only the pinned commit was read. |

## Reuse record

- **Reused directly:** Totalidade Bun/Vite/TanStack-compatible project configuration (`bunfig.toml`, `vite.config.ts`, `tsconfig.json`, UI generator configuration, lint and formatting configuration); KALLÍSTIS application routes and server/domain modules, canonical Markdown, PostgreSQL migrations, character Forge and canon-browser assets.
- **Adapted:** KALLÍSTIS package scripts were reduced to local development and maintenance commands; the server entry now supports local Node/Bun invocation as well as Cloudflare Worker bindings; the invalid source CSP frame-ancestor entries were corrected for local development.
- **Adapted from Velmoor:** conversational creation is retained as a guided chat interaction with staged progress and visible choices, while KALLÍSTIS server-side canonical retrieval and validation remain authoritative. Velmoor mechanics, D&D terminology, direct Supabase table operations, and D&D catalogs were excluded.
- **Reimplemented for this target:** local-only run configuration, secret-free `.env.example`, source provenance, repository instructions, and reconstruction memory documentation.
- **Not integrated yet:** ZeroClaw has no application API integration; OpenRouter credentials are not configured; full manual create-save-reload proof is incomplete. A dedicated local PostgreSQL database and local account are configured. No production service or database was contacted.

The new repository was cloned from `https://github.com/NomosLudens/kallistis.app.git`, which was empty at creation. Its local initial branch is `master`; no commit or push was made.
