#!/usr/bin/env node
// rows.json → компактные SQL-чанки для заливки через Lovable MCP query_database.
//
// Зачем компактно: заливка идёт через переписку с моделью, а прямолинейный
// «INSERT на строку» раздувал 129 КБ данных до 612 КБ — из них 480 КБ служебка
// (список колонок ×557 и ПОЛНЫЙ текст задачи, продублированный внутри вызова
// kb_normalize_fingerprint). Здесь: VALUES-таблица + константы один раз на чанк,
// fingerprint — отдельным UPDATE в конце.
//
// Выход: out/chunks/diana-NN.sql + out/chunks/clone-vladimir.sql
// Запуск: node scripts/otp-import/emit-sql.mjs [размер-чанка]

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "out");
const CHUNKS = resolve(OUT, "chunks");

const DIANA = "e9117975-4543-472d-abb1-3330c4cabd5c";
const VLADIMIR = "13feb6bd-4fee-462c-a638-6d3b9851f077";
const VLAD_ROOT_NAME = "Проверка импорта · База Дианы";

const CHUNK = Number(process.argv[2]) || 80;
const { folders, rows } = JSON.parse(readFileSync(resolve(OUT, "rows.json"), "utf8"));

const lit = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

rmSync(CHUNKS, { recursive: true, force: true });
mkdirSync(CHUNKS, { recursive: true });

const files = [];
const write = (name, sql) => { writeFileSync(resolve(CHUNKS, name), sql, "utf8"); files.push(name); };

// --- 1. папки ---------------------------------------------------------------
write("diana-00-folders.sql",
  `INSERT INTO public.kb_folders (id, owner_id, parent_id, name, sort_order)\nSELECT v.id::uuid, ${lit(DIANA)}::uuid, v.parent::uuid, v.name, v.ord\nFROM (VALUES\n` +
  folders.map((f) => `(${lit(f.id)},${f.parent_id ? lit(f.parent_id) : "NULL"},${lit(f.name)},${f.sort_order})`).join(",\n") +
  `\n) AS v(id, parent, name, ord)\nON CONFLICT (id) DO NOTHING;`);

// --- 2. задачи чанками ------------------------------------------------------
// Константы (check_format/task_kind/primary_score/source_label) пишутся один раз
// на чанк, а не в каждой строке.
let n = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const part = rows.slice(i, i + CHUNK);
  n += 1;
  write(`diana-${String(n).padStart(2, "0")}-tasks.sql`,
    `INSERT INTO public.kb_tasks\n` +
    `  (id, folder_id, owner_id, exam, kim_number, text, answer, options_json, solution,\n` +
    `   check_format, task_kind, primary_score, source_label)\n` +
    `SELECT v.id::uuid, v.fid::uuid, ${lit(DIANA)}::uuid, v.exam::public.exam_type, v.kim, v.text, v.ans,\n` +
    `       v.opts::jsonb, v.sol, 'short_answer', 'numeric', 1, 'my'\n` +
    `FROM (VALUES\n` +
    part.map((r) => `(${lit(r.id)},${lit(r.folder_id)},${lit(r.exam)},${r.kim_number},${lit(r.text)},${lit(r.answer)},${r.options_json ? lit(JSON.stringify(r.options_json)) : "NULL"},${lit(r.solution)})`).join(",\n") +
    `\n) AS v(id, fid, exam, kim, text, ans, opts, sol)\nON CONFLICT (id) DO NOTHING;`);
}

// --- 3. fingerprint одним проходом -----------------------------------------
write(`diana-${String(n + 1).padStart(2, "0")}-fingerprint.sql`,
  `UPDATE public.kb_tasks SET fingerprint = public.kb_normalize_fingerprint(text, answer, attachment_url)\n` +
  `WHERE owner_id = ${lit(DIANA)}::uuid AND fingerprint IS NULL;`);

// --- 4. копия для проверяющего — целиком ВНУТРИ базы ------------------------
// Данные не пересылаются второй раз: id пересчитываются детерминированно
// (md5 от исходного id с солью), поэтому повторный прогон идемпотентен.
write("clone-vladimir.sql", `-- Копия партии в кабинет проверяющего, отдельным корнем.
-- id выводятся из исходных детерминированно → ON CONFLICT DO NOTHING идемпотентен.
WITH src_root AS (
  SELECT uuid_in(md5('otp-clone-root')::cstring)::uuid AS id
), ins_root AS (
  INSERT INTO public.kb_folders (id, owner_id, parent_id, name, sort_order)
  SELECT id, ${lit(VLADIMIR)}::uuid, NULL, ${lit(VLAD_ROOT_NAME)}, 0 FROM src_root
  ON CONFLICT (id) DO NOTHING RETURNING id
)
INSERT INTO public.kb_folders (id, owner_id, parent_id, name, sort_order)
SELECT uuid_in(md5('otp-clone:' || f.id::text)::cstring)::uuid,
       ${lit(VLADIMIR)}::uuid,
       COALESCE(uuid_in(md5('otp-clone:' || f.parent_id::text)::cstring)::uuid,
                (SELECT id FROM src_root)),
       f.name, f.sort_order
FROM public.kb_folders f
WHERE f.owner_id = ${lit(DIANA)}::uuid
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.kb_tasks
  (id, folder_id, owner_id, exam, kim_number, text, answer, options_json, solution,
   check_format, task_kind, primary_score, source_label, fingerprint)
SELECT uuid_in(md5('otp-clone:' || t.id::text)::cstring)::uuid,
       uuid_in(md5('otp-clone:' || t.folder_id::text)::cstring)::uuid,
       ${lit(VLADIMIR)}::uuid,
       t.exam, t.kim_number, t.text, t.answer, t.options_json, t.solution,
       t.check_format, t.task_kind, t.primary_score, t.source_label, t.fingerprint
FROM public.kb_tasks t
WHERE t.owner_id = ${lit(DIANA)}::uuid
ON CONFLICT (id) DO NOTHING;`);

const total = files.reduce((s, f) => s + readFileSync(resolve(CHUNKS, f), "utf8").length, 0);
console.log(`чанков: ${files.length}`);
for (const f of files) console.log(`  ${f}  ${readFileSync(resolve(CHUNKS, f), "utf8").length} байт`);
console.log(`итого: ${total} байт (было 612157 на владельца, и ×2 владельца)`);
