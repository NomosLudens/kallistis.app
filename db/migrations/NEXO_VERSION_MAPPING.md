# NEXO migration version mapping

Verified against production PostgreSQL and the active release package on 2026-11-03.

Production already reserves `0065` for `0065_admin_account_provisioning.sql` (SHA-256 `921b8f1e8da2e408d30c649346c63f49a426fddfd9880b67272be7017905f265`) and `0066` for `0066_local_account_activation.sql` (SHA-256 `e4120763c8a78a38bb3fa09ed7c44224bfafe6e971828e5c2ecf61ae456c500e`). The production ledger contains only those two rows; the active package's migration files also end at `0066`. Existing production versions and checksums must remain unchanged.

The local development database previously applied the NEXO chain as `0065`–`0070`. Its recorded source checksums are preserved below. The reconciled chain uses `0071`–`0076`: this range follows both known histories, avoids rewriting either ledger, and was absent from the complete production ledger and active release package at verification time.

| Prior local version | Prior local filename | Prior checksum | Reconciled version | Reconciled filename |
| --- | --- | --- | --- | --- |
| 0065 | `0065_nexo_ruleset_core.sql` | `4279c02b1ffe8adff53b68a1fe48b2419eddbfd6654b5730175a659a5ea41950` | 0071 | `0071_nexo_ruleset_core.sql` |
| 0066 | `0066_nexo_coro_contributions.sql` | `9b437cac715e07050f99a6a716d839c6c240b75696d59c04c393f04b2e9ee43e` | 0072 | `0072_nexo_coro_contributions.sql` |
| 0067 | `0067_nexo_coro_solo_master_adjudication.sql` | `35ccf19f06fd96de7ca69a4e15ec429360792128c6e614d18e42b4ddb88b408b` | 0073 | `0073_nexo_coro_solo_master_adjudication.sql` |
| 0068 | `0068_nexo_coro_manifestations.sql` | `34037c595fe2b952cdd70d24cd1e15ea918305be7ed82c94e65d6e4b992a3e4d` | 0074 | `0074_nexo_coro_manifestations.sql` |
| 0069 | `0069_nexo_simplification_fix.sql` | `22b92f4693f0df0dd7ee82ef6fab2e8f34c09e12be6e29867b40b9831931e526` | 0075 | `0075_nexo_simplification_fix.sql` |
| 0070 | `0070_nexo_action_argument_adjudication.sql` | `8349862cfc2b0bf23ae2eb32e779a332737f9c27559bd2327179f0ec7f7b3803` | 0076 | `0076_nexo_action_argument_adjudication.sql` |

## Existing development database

Do not replay `0071`–`0076` against the already-migrated local database. Its original `0065`–`0070` ledger entries and checksums remain historical evidence and must not be deleted, rewritten, or duplicated. Each new migration checks for its matching prior NEXO ledger entry and aborts before DDL if found. The local PostgreSQL service was not running during this reconciliation; the recorded prior state was not modified.

## Application procedure

On a fresh compatible database or an isolated production backup, preflight that the target versions and filenames are unregistered, then apply `0071` through `0076` in order. Record each applied file's actual SHA-256 in `kallistis_schema_migrations` as `APPLIED_IN_THIS_RUN` in the same controlled migration procedure. Stop on any ledger mismatch or SQL error. Do not apply old `0065`–`0070` files and do not delete ledger rows to make a migration fit.

Rollback files were renamed with their corresponding versions. Migration `0075` had no guarded rollback before reconciliation and remains forward-only; do not improvise a destructive rollback. App rollback must leave additive schema in place.
