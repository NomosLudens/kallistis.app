# KALLÍSTIS Genesis

New isolated KALLÍSTIS application assembled from pinned, read-only source revisions. Local development starts at `http://127.0.0.1:5175` with `bun run dev` after dependency installation.

Real sign-in and character persistence require a local PostgreSQL database initialized from `db/migrations` and local auth configuration. Real AI conversation requires an OpenRouter API key. No mock provider or production service fallback is configured.

See [docs/SOURCE_PROVENANCE.md](docs/SOURCE_PROVENANCE.md) for source commits and reuse decisions, and [docs/CODEBASE_MEMORY.md](docs/CODEBASE_MEMORY.md) for the implemented architecture and verification status.
