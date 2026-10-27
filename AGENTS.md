# KALLISTIS Genesis

This repository is the isolated reconstruction target. All implementation changes belong here.

- The Totalidade source at `6ac9aadb3f5e9b97bbaf71f3cb034a1ab33648c9` supplied the compatible Bun, Vite, TypeScript, and UI-tooling foundation.
- KALLÍSTIS at `8c6770dacbb2f7869079b55336007323b4aba8c1` is the authority for game canon, character data, validation, persistence contracts, campaigns, tables, and rules.
- Velmoor at `7c544841f19fd3464fd95b27f929c9f24996a4d6` is read-only reference material for conversational creation interaction. Do not import D&D rules or Supabase table contracts.
- Keep one TanStack Start application, one router, and the KALLÍSTIS PostgreSQL domain model. Never add test fixtures or fake providers as product behavior.
- Do not use production credentials, databases, Cloudflare configuration, or deployment commands. Local credentials belong only in an ignored `.env` created by the developer.
- Never edit the source checkouts or `/home/tonyus-dev/Portifolio/kallistis.app` from this repository task.

Run local development with `bun run dev`. The app binds to `127.0.0.1:5175`.
