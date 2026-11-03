import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

describe("migrations locais", () => {
  it("adiciona a declaração de ação, narrativa única do Coro e Resistência de uso único", () => {
    const fix = readFileSync(`${migrationsDirectory}/0075_nexo_simplification_fix.sql`, "utf8");
    expect(fix).toContain("ADD COLUMN IF NOT EXISTS action_description");
    expect(fix).toContain("ADD COLUMN IF NOT EXISTS narrative");
    expect(fix).toContain("nexo_resistance_assignments_one_pending");
    expect(fix).toContain("consumed_at IS NULL");
    expect(fix).not.toMatch(/DROP TABLE|DELETE FROM/i);
  });

  it("mantém o ledger local legado e usa uma faixa NEXO sem colisão", () => {
    const mappings = [
      {
        legacyVersion: "0065",
        version: "0071",
        legacyFile: "0065_nexo_ruleset_core.sql",
        file: "0071_nexo_ruleset_core.sql",
        checksum: "4279c02b1ffe8adff53b68a1fe48b2419eddbfd6654b5730175a659a5ea41950",
      },
      {
        legacyVersion: "0066",
        version: "0072",
        legacyFile: "0066_nexo_coro_contributions.sql",
        file: "0072_nexo_coro_contributions.sql",
        checksum: "9b437cac715e07050f99a6a716d839c6c240b75696d59c04c393f04b2e9ee43e",
      },
      {
        legacyVersion: "0067",
        version: "0073",
        legacyFile: "0067_nexo_coro_solo_master_adjudication.sql",
        file: "0073_nexo_coro_solo_master_adjudication.sql",
        checksum: "35ccf19f06fd96de7ca69a4e15ec429360792128c6e614d18e42b4ddb88b408b",
      },
      {
        legacyVersion: "0068",
        version: "0074",
        legacyFile: "0068_nexo_coro_manifestations.sql",
        file: "0074_nexo_coro_manifestations.sql",
        checksum: "34037c595fe2b952cdd70d24cd1e15ea918305be7ed82c94e65d6e4b992a3e4d",
      },
      {
        legacyVersion: "0069",
        version: "0075",
        legacyFile: "0069_nexo_simplification_fix.sql",
        file: "0075_nexo_simplification_fix.sql",
        checksum: "22b92f4693f0df0dd7ee82ef6fab2e8f34c09e12be6e29867b40b9831931e526",
      },
      {
        legacyVersion: "0070",
        version: "0076",
        legacyFile: "0070_nexo_action_argument_adjudication.sql",
        file: "0076_nexo_action_argument_adjudication.sql",
        checksum: "8349862cfc2b0bf23ae2eb32e779a332737f9c27559bd2327179f0ec7f7b3803",
      },
    ];

    for (const mapping of mappings) {
      const sql = readFileSync(`${migrationsDirectory}/${mapping.file}`, "utf8");
      expect(sql).toContain(`version = '${mapping.legacyVersion}'`);
      expect(sql).toContain(`filename = '${mapping.legacyFile}'`);
      expect(sql).toContain(`checksum_sha256 = '${mapping.checksum}'`);
      expect(sql).toContain(`version = '${mapping.version}'`);
      expect(sql).toContain(`nexo_migration_${mapping.version}_already_registered`);
      expect(sql).not.toMatch(/DELETE FROM public\.kallistis_schema_migrations/i);
    }
  });

  it("mantêm a ordem mínima, sem autoridade Supabase", () => {
    const agenda = readFileSync(migrationsDirectory + "/0035_agenda_multiscope.sql", "utf8");
    expect(agenda).toContain("scope_type IN ('PRIVATE','MESA','GLOBAL','PLAYER')");
    expect(agenda).toContain("target_user_id = created_by");
    const names = [
      "0001_identity.sql",
      "0002_chat.sql",
      "0003_memory.sql",
      "0004_memory_atomic.sql",
      "0005_runtime_grants.sql",
      "0006_runtime_chat_grants.sql",
      "0025_campaigns.sql",
      "0027_memory_campaign_scope.sql",
      "0026_contexto_externo_scopes.sql",
      "0046_auth_identity_bridge.sql",
    ];
    for (const name of names)
      expect(readFileSync(`${migrationsDirectory}/${name}`, "utf8")).toBeTruthy();
    const atomic = readFileSync(`${migrationsDirectory}/0004_memory_atomic.sql`, "utf8");
    expect(atomic).not.toMatch(/auth\.uid|auth\.users|service_role/i);
    expect(atomic).toContain("FOR UPDATE");
    expect(atomic).toContain("array_length(p_source_ids, 1), 0) <> 5");
    expect(atomic).toContain("p_user_id");
    const memory = readFileSync(`${migrationsDirectory}/0003_memory.sql`, "utf8");
    expect(memory).toContain("'rascunho', 'em_revisao', 'confirmado', 'descartado'");
    expect(memory).toContain("domain IN ('memory')");
    expect(memory).toContain("source IN ('chat', 'manual', 'system')");
    const grants = readFileSync(`${migrationsDirectory}/0005_runtime_grants.sql`, "utf8");
    expect(grants).toContain("GRANT USAGE ON SCHEMA public TO kallistis");
    expect(grants).not.toContain("DELETE");
    const registroDelete = readFileSync(
      `${migrationsDirectory}/0055_registro_vivo_runtime_delete_grant.sql`,
      "utf8",
    );
    expect(registroDelete).toContain("GRANT DELETE ON TABLE public.registro_vivo TO kallistis");
    expect(registroDelete).not.toMatch(/TO\s+(anon|authenticated|PUBLIC)/i);
    expect(registroDelete).not.toContain("SECURITY DEFINER");
    const chatGrants = readFileSync(`${migrationsDirectory}/0006_runtime_chat_grants.sql`, "utf8");
    expect(chatGrants).toContain("GRANT INSERT ON TABLE public.chat_threads TO kallistis");
    expect(chatGrants).not.toMatch(/GRANT ALL|SUPERUSER|ALL TABLES|ALL SEQUENCES/i);
    const campaigns = readFileSync(`${migrationsDirectory}/0025_campaigns.sql`, "utf8");
    expect(campaigns).toContain("CREATE TABLE IF NOT EXISTS public.campaigns");
    expect(campaigns).toContain("REFERENCES public.mesas(id)");
    expect(campaigns).toContain("ADD COLUMN IF NOT EXISTS campaign_id");
    expect(campaigns).not.toContain("CREATE TABLE IF NOT EXISTS public.campaign_members");
    const contexts = readFileSync(
      `${migrationsDirectory}/0026_contexto_externo_scopes.sql`,
      "utf8",
    );
    expect(contexts).toContain("ADD COLUMN IF NOT EXISTS mesa_id");
    expect(contexts).toContain("ADD COLUMN IF NOT EXISTS campaign_id");
    expect(contexts).toContain("contexto_externo_scope_exclusive");
    expect(contexts).toContain("REFERENCES public.campaigns(id)");
    const memoryScope = readFileSync(
      `${migrationsDirectory}/0027_memory_campaign_scope.sql`,
      "utf8",
    );
    expect(memoryScope).toContain("ADD COLUMN IF NOT EXISTS campaign_id");
    expect(memoryScope).toContain("REFERENCES public.campaigns(id)");
    expect(memoryScope).toContain("CREATE OR REPLACE FUNCTION public.confirm_sediment_atomic");
    expect(memoryScope).toContain("t.campaign_id");
    expect(memoryScope).toContain("campaign_id)");
  });
});
