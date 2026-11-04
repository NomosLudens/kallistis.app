import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createWorkerPostgresExecutor } from "../src/server/local-core/postgres";

type SourceRow = {
  excelRow: number;
  respondent: string;
  mesaAnswer: string;
  name: string;
  appearance: string;
  history: string;
  originAnswer: string;
  peopleAnswer: string;
  officeAnswer: string;
  manifestation: string;
  memory: string;
  promise: string;
  loss: string;
  question: string;
  topicsToAvoid: string;
  talkToMaster: string;
};

const sourcePath = resolve(
  process.env.KALLISTIS_CHARACTER_SOURCE ||
    "/home/tonyus-dev/Downloads/KALLÍSTIS — A História Antes da Ficha (Respostas).xlsx",
);
const sourceBytes = await readFile(sourcePath);
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");

// Python's standard library reads XLSX without installing a parser dependency.
// The JSON stays in this process; private answers are never logged or written to disk.
const python = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET, re, json
path = sys.argv[1]
ns = {'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
book = zipfile.ZipFile(path)
strings=[]
if 'xl/sharedStrings.xml' in book.namelist():
  for si in ET.fromstring(book.read('xl/sharedStrings.xml')).findall('m:si',ns):
    strings.append(''.join(t.text or '' for t in si.findall('.//m:t',ns)))
sheet=ET.fromstring(book.read('xl/worksheets/sheet1.xml'))
def col_index(ref):
  value=0
  for ch in re.match(r'[A-Z]+',ref).group(0): value=value*26+ord(ch)-64
  return value-1
rows=[]
for row in sheet.findall('.//m:sheetData/m:row',ns):
  cells={}
  for cell in row.findall('m:c',ns):
    value=cell.find('m:v',ns); inline=cell.find('m:is',ns)
    text=''.join(t.text or '' for t in inline.findall('.//m:t',ns)) if inline is not None else (value.text if value is not None else '')
    if cell.attrib.get('t')=='s' and text: text=strings[int(text)]
    cells[col_index(cell.attrib['r'])]=text
  rows.append(cells)
if len(rows) != 6: raise ValueError('source_row_count_invalid')
headers={index:value.strip() for index,value in rows[0].items()}
required={
 'respondent':'Qual é seu nome?', 'mesaAnswer':'Em qual mesa você joga?',
 'name':'Qual é o nome do seu personagem?', 'appearance':'Como é a aparência e a personalidade do personagem?',
 'history':'Conte um pouco da história do seu personagem.', 'originAnswer':'Qual é a origem cosmológica de seu personagem?',
 'peopleAnswer':'A qual Povo pertence seu personagem?', 'officeAnswer':'Qual Ofício combina com o caminho que você imagina?',
 'manifestation':'Quando seu personagem usa suas capacidades, o que acontece visualmente?',
 'memory':'Quem ou o que você jamais esqueceria?', 'promise':'Qual promessa sustenta as decisões do seu personagem?',
 'loss':'Que perda seu personagem ainda carrega?', 'question':'Que pergunta pessoal seu personagem deseja responder durante a jornada?',
 'topicsToAvoid':'Existe algum tema narrativo que você prefere evitar?',
 'talkToMaster':'Você gostaria de conversar com o Mestre antes de concluir?'
}
by_header={value:key for key,value in headers.items()}
columns={}
for target,header in required.items():
  if header not in by_header: raise ValueError('source_header_missing')
  columns[target]=by_header[header]
result=[]
for row_number,row in enumerate(rows[1:],start=2):
  record={'excelRow':row_number}
  record.update({target:row.get(index,'') for target,index in columns.items()})
  if not all(record.get(key,'').strip() for key in ('name','mesaAnswer','originAnswer','peopleAnswer','officeAnswer','appearance','history','manifestation','memory','promise','loss','question')):
    raise ValueError('source_required_answer_missing')
  result.append(record)
print(json.dumps(result,ensure_ascii=False,separators=(',',':')))
`;
const parsed = spawnSync("python3", ["-c", python, sourcePath], {
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
});
if (parsed.status !== 0) throw new Error("source_spreadsheet_parse_failed");
const rows = JSON.parse(parsed.stdout) as SourceRow[];
if (rows.length !== 5) throw new Error("source_character_count_invalid");

const splitChoice = (value: string) => {
  const [label, ...description] = value.split(" — ");
  return { label: label.trim(), description: description.join(" — ") };
};
const allowed = {
  origins: new Set(["Criado na Luz", "Criado na Escuridão", "Trocado"]),
  peoples: new Set(["Nomos", "Dóreos", "Draken", "Kragor", "Livres"]),
  offices: new Set(["Tecelão", "Evocador", "Artífice", "Guardião"]),
};
const seenNames = new Set<string>();
const normalized = rows.map((row) => {
  const name = row.name.trim();
  const key = name.normalize("NFKC").toLocaleLowerCase("pt-BR");
  if (seenNames.has(key)) throw new Error("source_duplicate_character_name");
  seenNames.add(key);
  const origin = splitChoice(row.originAnswer);
  const people = splitChoice(row.peopleAnswer);
  const office = splitChoice(row.officeAnswer);
  if (
    !allowed.origins.has(origin.label) ||
    !allowed.peoples.has(people.label) ||
    !allowed.offices.has(office.label)
  )
    throw new Error("source_canonical_choice_invalid");
  if (!row.mesaAnswer.startsWith("Taverna dos Pandas")) throw new Error("source_mesa_invalid");
  const id = `hist-${sourceSha256.slice(0, 20)}-${String(row.excelRow).padStart(2, "0")}`;
  const sourceKey = `history-before-sheet:${sourceSha256}:${row.excelRow}`;
  const snapshot = {
    nome: name,
    jogador: "",
    povo: people.label,
    povoDescricao: people.description,
    origem: origin.label,
    origemDescricao: origin.description,
    oficioNarrativo: office.label,
    oficioDescricao: office.description,
    aparencia: row.appearance,
    biografia: row.history,
    manifestacao_pessoal: row.manifestation,
    memoria: row.memory,
    promessa: row.promise,
    ferida: row.loss,
    pergunta: row.question,
    completo: false,
    fonteNarrativa: "KALLISTIS_HISTORIA_ANTES_DA_FICHA",
  };
  const privatePayload = {
    respondent: row.respondent,
    mesaAnswer: row.mesaAnswer,
    originalCanonicalAnswers: {
      origin: row.originAnswer,
      people: row.peopleAnswer,
      office: row.officeAnswer,
    },
    topicsToAvoid: row.topicsToAvoid,
    talkToMaster: row.talkToMaster,
  };
  return { ...row, id, sourceKey, snapshot, privatePayload };
});

const databaseUrl = process.env.KALLISTIS_DATABASE_URL;
if (!databaseUrl) throw new Error("local_database_configuration_missing");
const localDatabaseUrl = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost", "::1"].includes(localDatabaseUrl.hostname) ||
  !["5432", ""].includes(localDatabaseUrl.port)
)
  throw new Error("database_connection_not_local_genesis");
const sql = createWorkerPostgresExecutor(databaseUrl);
if (!sql.transaction) {
  sql.close();
  throw new Error("database_transactions_unavailable");
}

type ExistingCharacter = {
  id: string;
  owner_user_id: string;
  master_user_id: string;
  status: string;
  name: string;
  player_name: string;
  snapshot: Record<string, unknown>;
  version: number;
  mechanical_fingerprint: string;
};
const hashExisting = (items: ExistingCharacter[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        items
          .map((item) => ({
            id: item.id,
            owner: item.owner_user_id,
            master: item.master_user_id,
            status: item.status,
            name: item.name,
            player: item.player_name,
            snapshot: item.snapshot,
            version: item.version,
            fingerprint: item.mechanical_fingerprint,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    )
    .digest("hex");
const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

let stage = "database_identity";
try {
  const result = await sql.transaction(async (tx) => {
    const database = await tx.query<{
      database_name: string;
      server_address: string | null;
      server_port: number;
    }>(
      "SELECT current_database() AS database_name, inet_server_addr()::text AS server_address, inet_server_port() AS server_port",
    );
    const identity = database[0];
    if (identity?.database_name !== "kallistis_genesis" || Number(identity.server_port) !== 5432)
      throw new Error("database_identity_not_local_genesis");

    const mesaRows = await tx.query<{ id: string }>(
      "SELECT id::text AS id FROM public.mesas WHERE lower(name)=lower($1)",
      ["Taverna dos Pandas"],
    );
    if (mesaRows.length !== 1) throw new Error("target_mesa_not_unique");
    const mesaId = mesaRows[0].id;
    stage = "tal_identity";
    const talRows = await tx.query<{ id: string }>(
      `SELECT u.id::text AS id FROM public.users u
         JOIN public.system_roles sr ON sr.user_id=u.id AND sr.system_role='system_master'
         JOIN public.profiles p ON p.id=u.id
        WHERE u.status='active' AND lower(p.display_name)='antonio'`,
    );
    if (talRows.length !== 1) throw new Error("tal_system_master_not_unique");
    const talId = talRows[0].id;
    const before = await tx.query<ExistingCharacter>(
      `SELECT id,owner_user_id::text,master_user_id::text,status,name,player_name,snapshot,version,mechanical_fingerprint
         FROM public.characters ORDER BY id`,
    );
    const imported = new Set(normalized.map((item) => item.id));
    const originalCharacters = before.filter((item) => !imported.has(item.id));
    const beforeHash = hashExisting(originalCharacters);
    let created = 0;
    let skipped = 0;
    const ids: string[] = [];

    for (const item of normalized) {
      stage = "existing_record_check";
      const source = await tx.query<{ character_id: string; source_sha256: string }>(
        "SELECT character_id,source_sha256 FROM public.character_master_source_notes WHERE source_key=$1",
        [item.sourceKey],
      );
      const byId = await tx.query<ExistingCharacter>(
        `SELECT id,owner_user_id::text,master_user_id::text,status,name,player_name,snapshot,version,mechanical_fingerprint
           FROM public.characters WHERE id=$1`,
        [item.id],
      );
      const byName = await tx.query<{ id: string }>(
        "SELECT id FROM public.characters WHERE lower(name)=lower($1)",
        [item.name.trim()],
      );
      if (source.length || byId.length) {
        if (
          source.length !== 1 ||
          byId.length !== 1 ||
          source[0].character_id !== item.id ||
          source[0].source_sha256 !== sourceSha256 ||
          byId[0].owner_user_id !== talId ||
          byId[0].master_user_id !== talId ||
          byId[0].status !== "draft" ||
          byId[0].player_name !== "" ||
          byId[0].name !== item.name.trim() ||
          byId[0].version !== 1 ||
          stableJson(byId[0].snapshot) !== stableJson(item.snapshot)
        )
          throw new Error("existing_source_record_conflict");
        const privateNote = await tx.query<{ private_payload: Record<string, unknown> }>(
          "SELECT private_payload FROM public.character_master_source_notes WHERE character_id=$1",
          [item.id],
        );
        if (
          privateNote.length !== 1 ||
          stableJson(privateNote[0].private_payload) !== stableJson(item.privatePayload)
        )
          throw new Error("existing_private_source_conflict");
        const mesa = await tx.query<{ present: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM public.character_mesas WHERE character_id=$1 AND mesa_id=$2) AS present",
          [item.id, mesaId],
        );
        if (!mesa[0]?.present) throw new Error("existing_source_mesa_conflict");
        skipped++;
        ids.push(item.id);
        continue;
      }
      if (byName.length) throw new Error("existing_character_name_conflict");

      stage = "insert_character";
      await tx.query(
        `INSERT INTO public.characters
           (id,owner_user_id,master_user_id,status,ruleset,name,player_name,snapshot,version,mechanical_fingerprint,created_at,updated_at)
         VALUES ($1,$2,$2,'draft','KALLISTIS_REGRAS_CANONICAS_2.0',$3,'',$4::jsonb,1,'',now(),now())`,
        [item.id, talId, item.name.trim(), item.snapshot],
      );
      stage = "insert_version";
      await tx.query(
        `INSERT INTO public.character_versions (character_id,version,snapshot,reason,actor_user_id)
         VALUES ($1,1,$2::jsonb,'history_before_sheet_import',$3)`,
        [item.id, item.snapshot, talId],
      );
      stage = "insert_event";
      await tx.query(
        `INSERT INTO public.character_events (character_id,actor_user_id,event_type,payload,version_before,version_after)
         VALUES ($1,$2,'source_imported',$3::jsonb,NULL,1)`,
        [
          item.id,
          talId,
          {
            source: "history_before_sheet",
            source_row: item.excelRow,
            source_sha256: sourceSha256,
          },
        ],
      );
      stage = "link_mesa";
      await tx.query("INSERT INTO public.character_mesas (character_id,mesa_id) VALUES ($1,$2)", [
        item.id,
        mesaId,
      ]);
      stage = "insert_private_notes";
      await tx.query(
        `INSERT INTO public.character_master_source_notes
           (character_id,source_key,source_sha256,source_row,private_payload,recorded_by_user_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [item.id, item.sourceKey, sourceSha256, item.excelRow, item.privatePayload, talId],
      );
      created++;
      ids.push(item.id);
    }

    const after = await tx.query<ExistingCharacter>(
      `SELECT id,owner_user_id::text,master_user_id::text,status,name,player_name,snapshot,version,mechanical_fingerprint
         FROM public.characters WHERE id=ANY($1::text[]) ORDER BY id`,
      [normalized.map((item) => item.id)],
    );
    stage = "verify_imported_characters";
    if (after.length !== normalized.length) throw new Error("imported_character_count_mismatch");
    const afterById = new Map(after.map((item) => [item.id, item]));
    for (const item of normalized) {
      const character = afterById.get(item.id);
      if (
        !character ||
        character.name !== item.name.trim() ||
        character.status !== "draft" ||
        character.owner_user_id !== talId ||
        character.master_user_id !== talId ||
        character.player_name !== "" ||
        character.version !== 1 ||
        stableJson(character.snapshot) !== stableJson(item.snapshot)
      )
        throw new Error("imported_character_validation_failed");
    }
    const remaining = await tx.query<ExistingCharacter>(
      `SELECT id,owner_user_id::text,master_user_id::text,status,name,player_name,snapshot,version,mechanical_fingerprint
         FROM public.characters WHERE id <> ALL($1::text[]) ORDER BY id`,
      [normalized.map((item) => item.id)],
    );
    const afterHash = hashExisting(remaining);
    if (beforeHash !== afterHash) throw new Error("preexisting_character_integrity_changed");
    const privateCount = await tx.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.character_master_source_notes WHERE character_id=ANY($1::text[])",
      [normalized.map((item) => item.id)],
    );
    if (Number(privateCount[0]?.count) !== normalized.length)
      throw new Error("private_notes_count_mismatch");
    return { created, skipped, ids, count: after.length, preexistingIntegritySha256: afterHash };
  });
  console.log(JSON.stringify({ sourceRows: rows.length, sourceSha256, ...result }));
} catch (error) {
  const safe = error as { code?: string; severity?: string; routine?: string };
  console.error(
    `IMPORT_FAILED=${stage};code=${safe.code || "unknown"};severity=${safe.severity || "unknown"};routine=${safe.routine || "unknown"}`,
  );
  process.exitCode = 1;
} finally {
  sql.close();
}
