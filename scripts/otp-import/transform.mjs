#!/usr/bin/env node
// Online Test Pad → kb_tasks (личная база репетитора). По образцу scripts/fipi-import.
//
// Вход:  out/harvest.json — сырая выгрузка харвестера (см. harvest-in-page.js).
// Выход: out/rows.json    — строки kb_tasks/kb_folders в целевой форме;
//        out/insert-<label>.sql — идемпотентный SQL на каждого владельца.
//
// ⚠️ options_json прогоняется через НАСТОЯЩИЙ normalizeOptionsJson (оба зеркала
// сверяются между собой), а не через локальную копию: whitelist-проекция —
// единственное, что не пускает случайный `correct` из парсера в student-safe
// колонку. Расхождение зеркал = падение с ненулевым кодом.
//
// Запуск: node scripts/otp-import/transform.mjs [путь-к-harvest.json]

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "out");

/**
 * Владельцы копий. id — это auth.users.id, а НЕ tutors.id (rule 60 FK-дрейф):
 * kb_tasks.owner_id ссылается на auth-пользователя.
 * rootPrefix — обёртка для проверочной копии, чтобы не мешалась с своей базой.
 */
const OWNERS = [
  { label: "diana", id: "e9117975-4543-472d-abb1-3330c4cabd5c", rootPrefix: null },
  { label: "vladimir", id: "13feb6bd-4fee-462c-a638-6d3b9851f077", rootPrefix: "Проверка импорта · База Дианы" },
];

// Источник задачи. 'my' — служебный sentinel «личная задача» (см. kbApi
// createTask и TaskCard: 'my'/'socrat' намеренно НЕ показываются бейджем).
// Название чужой платформы в источнике репетитору не нужно.
const SOURCE_LABEL = "my";

/**
 * Тесты вне согласованной партии. У ЕГЭ №15 «Н и НН» в OTP есть три теста с
 * теми же названиями «1/2/3 вариант», но ДРУГИМ содержанием — они попали бы в
 * те же папки и незаметно удвоили их. Партия согласована как 7 вариантов на
 * задание, поэтому лишние исключены явно (решение владельца, 2026-07-27).
 */
const EXCLUDE_UIDS = new Set(["7ufyxvycnqfg4", "jxmamyanqh25u", "usjbtw2tk3opy"]);

// --- детерминированные id: повторный прогон не плодит дубли -----------------
// UUIDv5 (SHA-1) от фиксированного namespace — как в fipi-import.
// Ключ включает owner: у каждой копии свои id, прогон идемпотентен для обеих.
const NS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
function uuidv5(name) {
  const nsBytes = Buffer.from(NS.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([nsBytes, Buffer.from(name, "utf8")])).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const s = b.toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
const folderId = (owner, path) => uuidv5(`sokrat:otp:folder:${owner}:${path}`);
const taskId = (owner, uid, i) => uuidv5(`sokrat:otp:task:${owner}:${uid}#${i}`);

// --- реальные зеркала normalizeOptionsJson ---------------------------------
async function loadModule(rel) {
  const bundled = await build({
    entryPoints: [resolve(HERE, rel)],
    bundle: true, write: false, format: "esm", platform: "neutral", logLevel: "silent",
  });
  return import("data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].text).toString("base64"));
}
const front = await loadModule("../../src/lib/taskOptions.ts");
const deno = await loadModule("../../supabase/functions/_shared/task-options.ts");

/** Нормализация + сверка зеркал. Расхождение — фатально. */
function normalizeOptions(raw) {
  const a = front.normalizeOptionsJson(raw);
  const b = deno.normalizeOptionsJson(raw);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error("ДРЕЙФ ЗЕРКАЛ normalizeOptionsJson: " + JSON.stringify({ front: a, deno: b }));
  }
  return a;
}

// --- разбор названия теста OTP ---------------------------------------------
// «15 задание ЕГЭ по РЯ. Н и НН в прилагательных. 1 вариант»
export function parseTitle(title) {
  // Диана называет тесты ДВУМЯ способами: «9 задание ЕГЭ по РЯ. …» и
  // «ЕГЭ 9. …». Вторая форма роняла разбор целиком — тест уходил в «не
  // распознан экзамен/номер», а папка оставалась пустой.
  const kim = Number(
    (title.match(/^\s*(\d+)\s*задание/i) || [])[1] ??
    (title.match(/^\s*(?:ЕГЭ|ОГЭ)\s*(\d+)\s*[.:]/i) || [])[1] ??
    (title.match(/задани[ея]\s*(\d+)/i) || [])[1],
  ) || null;
  const exam = /ОГЭ/i.test(title) ? "oge" : /ЕГЭ/i.test(title) ? "ege" : null;
  const vm = title.match(/(\d+)\s*вариант/i);
  const variant = vm ? Number(vm[1]) : null;
  // Хвостовая скобка — примечание к ВАРИАНТУ, а не тема: иначе
  // «…18 вариант (5 вопросов)» порождал отдельную папку-задание.
  const noteMatch = title.match(/\(([^)]*)\)\s*$/);
  const note = noteMatch ? noteMatch[1].trim() : null;
  const theme = (title
    .replace(/\(([^)]*)\)\s*$/, "")
    .replace(/^\s*\d+\s*задание\s*/i, "")
    .replace(/(ЕГЭ|ОГЭ)(\s*по\s*РЯ)?\.?\s*/i, "")
    // Форма «ЕГЭ 9. Тема»: после снятия «ЕГЭ» остаётся «9.», и имя папки
    // выходило «Задание 9. 9. Тема». Снимаем ведущий номер задания.
    .replace(/^\s*\d+\s*[.:]\s*/, "")
    .replace(/\d+\s*вариант/i, "")            // вариант может стоять не только в конце
    .replace(/^[.\s]+|[.\s]+$/g, "")) || null;
  return { kim, exam, variant, theme, note };
}

const SECTION = { ege: "ЕГЭ. 11 класс", oge: "ОГЭ. 9 класс" };

/** Одна задача OTP → строка kb_tasks. */
function toRow(q, meta, index) {
  // Пустой текст условия — всегда баг парсера, а не данных. Прецедент: у типа
  // FIB условие лежит ВНУТРИ самого элемента, и первая версия парсера удаляла
  // его вместе с полями ввода — 210 задач из 557 уехали бы в базу «пустой
  // вопрос + ответ». Проверка ответа это не ловила: ответ-то был.
  if (!String(q.text ?? "").trim()) {
    throw new Error(`пустой текст условия: ${meta.uid}#${index} (тип ${q.type})`);
  }
  // Хвост «Ответ: ..» — это подпись поля ввода из OTP плюс наш плейсхолдер
  // пропуска; ученику он не нужен, ответ вводится своим полем.
  const text = String(q.text).replace(/\n*Ответ:\s*\.*\s*$/u, "").trim();
  if (!text) throw new Error(`после чистки текст пуст: ${meta.uid}#${index}`);
  const base = {
    id: taskId(meta.owner, meta.uid, index),
    folder_id: meta.variantFolderId,
    owner_id: meta.owner,
    topic_id: null,           // тем по русскому в kb_topics нет; личная база их не требует
    exam: meta.exam,
    kim_number: meta.kim,
    primary_score: 1,         // ЕГЭ 11/14/15 и ОГЭ 7/9 — по 1 баллу (ФИПИ)
    check_format: "short_answer",
    task_kind: "numeric",
    text,
    answer: null,
    options_json: null,
    solution: q.solution || null,
    source_label: SOURCE_LABEL,
  };

  if (q.type === "choice") {
    const opts = normalizeOptions({ kind: q.kind, options: q.options });
    if (!opts) throw new Error(`options_json отвергнут нормализатором: ${meta.uid}#${index}`);
    if (!/^[0-9]+$/.test(q.answer || "")) {
      throw new Error(`пустой/битый ключ ответа: ${meta.uid}#${index} → «${q.answer}»`);
    }
    return { ...base, options_json: opts, answer: q.answer };
  }
  if (q.type === "match") {
    // Соответствие → options_json kind:'matching'. Ответ — правые ключи в
    // порядке левого столбца («19453768»), ровно формат чекеров пробников.
    // ⚠️ Кап 9×9 в нормализаторе стоит не зря (чекеры посимвольные), а Диана
    // использует этот тип и как «распредели 20 слов по 3 группам» — такие
    // отвергаются fail-closed и попадают в отчёт, а не режутся молча.
    const opts = normalizeOptions({ kind: "matching", left: q.left, right: q.right });
    if (!opts) {
      throw new Error(
        `matching отвергнут нормализатором (лево ${q.left?.length ?? 0}, право ${q.right?.length ?? 0}): ${meta.uid}#${index}`);
    }
    if (!/^[0-9]+$/.test(q.answer || "")) {
      throw new Error(`битый ключ соответствия: ${meta.uid}#${index} → «${q.answer}»`);
    }
    if (q.answer.length !== opts.left.length) {
      throw new Error(
        `длина ответа ${q.answer.length} ≠ числу позиций слева ${opts.left.length}: ${meta.uid}#${index}`);
    }
    return { ...base, options_json: opts, answer: q.answer };
  }

  const ans = (q.answer ?? "").trim();
  if (!ans) throw new Error(`пустой ответ: ${meta.uid}#${index}`);
  return { ...base, answer: ans };
}

export function transform(harvest, owner) {
  const folders = new Map();
  const addFolder = (path, name, parentPath) => {
    if (folders.has(path)) return folders.get(path);
    const f = {
      id: folderId(owner.id, path), owner_id: owner.id, name,
      parent_id: parentPath ? folderId(owner.id, parentPath) : null,
      sort_order: folders.size,
    };
    folders.set(path, f);
    return f;
  };

  const rows = [];
  const skipped = [];
  const collisions = [];
  const skippedQuestions = [];
  for (const test of harvest) {
    if (test.error) { skipped.push({ uid: test.uid, why: test.error }); continue; }
    if (EXCLUDE_UIDS.has(test.uid)) {
      skipped.push({ uid: test.uid, why: "вне согласованной партии", title: test.title });
      continue;
    }
    // Болванка в самом OTP (напр. «7 задание ОГЭ. 0 вариант»): вопросы-пустышки
    // без текста и ответов. Пропускаем ЯВНО. Частично пустой тест сюда не
    // попадает и роняет прогон в toRow — тихо заливать половину нельзя.
    const qs = test.questions || [];
    const noAnswersAtAll = qs.length > 0 && qs.every((q) => !String(q.answer ?? "").trim());
    if (noAnswersAtAll) {
      skipped.push({ uid: test.uid, why: "в OTP не заполнен ключ ответов", title: test.title });
      continue;
    }
    const meta = parseTitle(test.title);
    if (!meta.exam || !meta.kim) {
      skipped.push({ uid: test.uid, why: "не распознан экзамен/номер", title: test.title });
      continue;
    }

    // ⚠️ Разделитель пути — , а НЕ «/»: в темах Дианы слэши встречаются
    // («О / Е / Ё после шипящих»), и вывод имени через split('/') срезал пол-названия.
    const SEP = String.fromCharCode(1);
    const root = owner.rootPrefix;
    if (root) addFolder(root, root, null);
    const sectionPath = root ? `${root}${SEP}${SECTION[meta.exam]}` : SECTION[meta.exam];
    const taskName = `Задание ${meta.kim}${meta.theme ? ". " + meta.theme : ""}`;
    const taskPath = `${sectionPath}${SEP}${taskName}`;
    // У Дианы есть ДВЕ параллельные серии с одинаковой нумерацией (различаются
    // только точкой в названии: «по РЯ. 2 вариант» vs «по РЯ 2 вариант»), а
    // содержание у них разное. Молча слить их в одну папку нельзя — разводим
    // и ОБЯЗАТЕЛЬНО докладываем, чтобы Диана могла переименовать осмысленно.
    const baseVariantName = meta.variant != null
      ? `Вариант ${meta.variant}${meta.note ? ` (${meta.note})` : ""}`
      : test.title;
    let variantName = baseVariantName;
    let variantPath = `${taskPath}${SEP}${variantName}`;
    let series = 1;
    while (folders.has(variantPath)) {
      series += 1;
      variantName = `${baseVariantName} · серия ${series}`;
      variantPath = `${taskPath}${SEP}${variantName}`;
    }
    if (series > 1) collisions.push({ uid: test.uid, title: test.title, folder: variantPath });

    addFolder(sectionPath, SECTION[meta.exam], root);
    addFolder(taskPath, taskName, sectionPath);
    const vf = addFolder(variantPath, variantName, taskPath);
    vf.uid = test.uid;

    // Отдельный невалидный вопрос НЕ должен блокировать весь тест: иначе одна
    // задача без ключа ответа хоронит остальные девять. Но и молча терять
    // нельзя — каждый пропуск попадает в отчёт поимённо (тест + номер + причина).
    test.questions.forEach((q, i) => {
      try {
        rows.push(toRow(q, { ...meta, owner: owner.id, uid: test.uid, variantFolderId: vf.id }, i));
      } catch (e) {
        skippedQuestions.push({
          uid: test.uid, title: test.title, вопрос: i + 1, тип: q.type,
          причина: String(e && e.message || e).replace(/^.*?: /, ''),
        });
      }
    });
  }
  // sort_order — по СМЫСЛУ, а не по порядку появления: репетитор ищет папку
  // глазами («задание 13»), и алфавит/порядок вставки ставили «Задание 11»
  // после «Задание 9», а «Вариант 10» — перед «Вариант 2».
  // Разделы: 9 класс раньше 11. Задания: по номеру КИМ. Варианты: по номеру.
  const num = (name, re) => {
    const m = name.match(re);
    return m ? Number(m[1]) : 9999;
  };
  const list = [...folders.values()];
  const byParent = new Map();
  for (const f of list) {
    const key = f.parent_id ?? "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  for (const siblings of byParent.values()) {
    siblings
      .sort((a, b) =>
        (a.name.startsWith("ОГЭ") ? 0 : a.name.startsWith("ЕГЭ") ? 1 : 2) -
          (b.name.startsWith("ОГЭ") ? 0 : b.name.startsWith("ЕГЭ") ? 1 : 2) ||
        num(a.name, /Задание\s+(\d+)/) - num(b.name, /Задание\s+(\d+)/) ||
        num(a.name, /Вариант\s+(\d+)/) - num(b.name, /Вариант\s+(\d+)/) ||
        a.name.localeCompare(b.name, "ru"))
      .forEach((f, i) => { f.sort_order = i + 1; });
  }

  return { folders: list, rows, skipped, collisions, skippedQuestions };
}

// --- SQL -------------------------------------------------------------------
const lit = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const jsonLit = (v) => (v == null ? "NULL" : `${lit(JSON.stringify(v))}::jsonb`);

export function toSql({ folders, rows }) {
  const out = ["BEGIN;"];
  for (const f of folders) {
    out.push(
      `INSERT INTO public.kb_folders (id, owner_id, parent_id, name, sort_order) VALUES ` +
      `(${lit(f.id)}, ${lit(f.owner_id)}, ${f.parent_id ? lit(f.parent_id) : "NULL"}, ${lit(f.name)}, ${f.sort_order}) ` +
      `ON CONFLICT (id) DO NOTHING;`);
  }
  for (const r of rows) {
    out.push(
      `INSERT INTO public.kb_tasks (id, folder_id, owner_id, topic_id, exam, kim_number, primary_score, ` +
      `check_format, task_kind, text, answer, options_json, solution, source_label, fingerprint) VALUES (` +
      [lit(r.id), lit(r.folder_id), lit(r.owner_id), "NULL", lit(r.exam), r.kim_number, r.primary_score,
       lit(r.check_format), lit(r.task_kind), lit(r.text), lit(r.answer), jsonLit(r.options_json),
       lit(r.solution), lit(r.source_label),
       `public.kb_normalize_fingerprint(${lit(r.text)}, ${lit(r.answer)}, NULL)`].join(", ") +
      `) ON CONFLICT (id) DO NOTHING;`);
  }
  out.push("COMMIT;");
  return out.join("\n");
}

/** Одинаковые ли наборы вопросов у двух тестов (для дублей вариантов в OTP). */
function signature(test) {
  return (test.questions || []).map((q) => `${q.text}|${q.answer}`).join("\n");
}

// --- main ------------------------------------------------------------------
if (process.argv[1]?.endsWith("transform.mjs")) {
  const input = process.argv[2] || resolve(OUT, "harvest.json");
  const harvest = JSON.parse(readFileSync(input, "utf8"));
  mkdirSync(OUT, { recursive: true });

  // дубли вариантов в OTP: одинаковые по содержанию — лишние
  const bySig = new Map();
  const dupes = [];
  for (const t of harvest.filter((x) => !x.error)) {
    const s = signature(t);
    if (bySig.has(s)) dupes.push({ uid: t.uid, sameAs: bySig.get(s), title: t.title });
    else bySig.set(s, t.uid);
  }
  const dupUids = new Set(dupes.map((d) => d.uid));
  const unique = harvest.filter((t) => !dupUids.has(t.uid));

  const report = { owners: [], dupes };
  for (const owner of OWNERS) {
    const result = transform(unique, owner);
    writeFileSync(resolve(OUT, `insert-${owner.label}.sql`), toSql(result), "utf8");
    if (owner.label === OWNERS[0].label) {
      writeFileSync(resolve(OUT, "rows.json"), JSON.stringify(result, null, 2), "utf8");
    }
    const choice = result.rows.filter((r) => r.options_json).length;
    report.owners.push({
      owner: owner.label, folders: result.folders.length, tasks: result.rows.length,
      structural: choice, textual: result.rows.length - choice, skipped: result.skipped,
      collisions: result.collisions,
      skippedQuestions: result.skippedQuestions,
    });
  }

  console.log(`тестов на входе: ${harvest.length}`);
  console.log(`дублей по содержанию: ${dupes.length}`, dupes.map((d) => d.uid).join(", ") || "");
  console.log(`уникальных тестов: ${unique.length}`);
  for (const r of report.owners) {
    console.log(`  ${r.owner}: папок ${r.folders}, задач ${r.tasks} (структурных ${r.structural}, текстовых ${r.textual})` +
      (r.skipped.length ? `, ПРОПУЩЕНО ${r.skipped.length}: ${JSON.stringify(r.skipped)}` : ""));
  }
  writeFileSync(resolve(OUT, "report.json"), JSON.stringify(report, null, 2), "utf8");
}
