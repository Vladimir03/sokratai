import { describe, expect, it } from "vitest";
import {
  homeworkTaskFieldsToKbRow,
  homeworkTaskFieldsToKbUpdate,
  kbTaskMaxScore,
  kbTaskToTemplateTaskJson,
  templateTaskContentEquals,
  type HomeworkTaskFieldsForKb,
  type KbTaskLike,
} from "./kb_snapshot.ts";

/**
 * Тесты на ЕДИНСТВЕННЫЙ конвертер kb_tasks ↔ homework-снимок / шаблон-shape.
 *
 * Зачем: этот модуль — последняя общая точка перед записью в kb_tasks для
 * ТРЁХ путей (авто-зеркало ДЗ→База, push-to-kb «Обновить в Базе», синтез
 * шаблонов). Ошибка здесь не падает — она МОЛЧА портит задачу-источник в Базе
 * у всех, кто на неё ссылается. Ровно так «форк каталожной задачи терял
 * варианты» (ревью 5.6): options_json, не доехавший до конвертера, затирал
 * колонку у источника. Тесты закрепляют решения, которые из кода не следуют:
 *   • Update — presence-семантика ТОЛЬКО для каскада (exam/difficulty/topic/
 *     subtopic/source_label): нет ключа → колонка не трогается;
 *   • options_json и весь контент пишутся БЕЗУСЛОВНО — отсутствие ключа
 *     затирает (инвариант rule 40, фиксируем как есть);
 *   • whitelist-проекция options_json (normalizeOptionsJson) отсекает
 *     `correct` и прочий мусор именно здесь, а не «где-то выше».
 */

const kbTask = (over: Partial<KbTaskLike> = {}): KbTaskLike => ({
  id: "kb-1",
  owner_id: null,
  text: "Найдите ускорение",
  answer: "2",
  solution: "a = F/m",
  attachment_url: null,
  solution_attachment_url: null,
  rubric_text: null,
  rubric_image_urls: null,
  check_format: null,
  task_kind: null,
  cefr_level: null,
  grading_criteria_json: null,
  options_json: null,
  kim_number: null,
  exam: null,
  primary_score: null,
  difficulty: null,
  source_label: null,
  ...over,
});

const validOptions = {
  kind: "single_choice",
  options: [
    { key: "1", text: "Вариант один" },
    { key: "2", text: "Вариант два" },
  ],
};

describe("kbTaskMaxScore — приоритет источника балла", () => {
  it("primary_score (ФИПИ/ручной) бьёт difficulty", () => {
    expect(kbTaskMaxScore({ primary_score: 3, difficulty: 5 })).toBe(3);
  });

  it("без primary_score балл берётся из difficulty (олимпиада: уровень = балл)", () => {
    // 0 и отрицательные значения — не балл: гейт `> 0`, а не «не null».
    expect(kbTaskMaxScore({ primary_score: null, difficulty: 4 })).toBe(4);
    expect(kbTaskMaxScore({ primary_score: 0, difficulty: 4 })).toBe(4);
  });

  it("нет ни того ни другого → фолбэк 1, а не 0 и не null", () => {
    expect(kbTaskMaxScore({ primary_score: null, difficulty: null })).toBe(1);
    expect(kbTaskMaxScore({ primary_score: -2, difficulty: 0 })).toBe(1);
  });
});

describe("kbTaskToTemplateTaskJson — синтез legacy tasks_json из живой строки Базы", () => {
  it("пустой text → плейсхолдер «[Задача на фото]», строки триммятся", () => {
    const row = kbTaskToTemplateTaskJson(kbTask({ text: "   ", answer: "  42  " }));
    expect(row.task_text).toBe("[Задача на фото]");
    expect(row.correct_answer).toBe("42");
    expect(row.source_kb_task_id).toBe("kb-1");
    expect(row.max_score).toBe(1);
  });

  it("невалидные check_format/task_kind/cefr — ключ ОТСУТСТВУЕТ (не null): сравнение с legacy-снимком не должно видеть фантомных полей", () => {
    const bad = kbTaskToTemplateTaskJson(
      kbTask({ check_format: "essay", task_kind: "quiz", cefr_level: "C2" }),
    );
    expect("check_format" in bad).toBe(false);
    expect("task_kind" in bad).toBe(false);
    expect("cefr_level" in bad).toBe(false);

    const good = kbTaskToTemplateTaskJson(
      kbTask({ check_format: "detailed_solution", task_kind: "proof", cefr_level: "A1" }),
    );
    expect(good.check_format).toBe("detailed_solution");
    expect(good.task_kind).toBe("proof");
    expect(good.cefr_level).toBe("A1");
  });

  it("kim_number едет только числом; пустой массив критериев — как отсутствие", () => {
    const row = kbTaskToTemplateTaskJson(kbTask({ kim_number: 17, grading_criteria_json: [] }));
    expect(row.kim_number).toBe(17);
    expect("grading_criteria_json" in row).toBe(false);

    const withCriteria = kbTaskToTemplateTaskJson(
      kbTask({ kim_number: null, grading_criteria_json: [{ name: "К1", max: 2 }] }),
    );
    expect("kim_number" in withCriteria).toBe(false);
    expect(withCriteria.grading_criteria_json).toEqual([{ name: "К1", max: 2 }]);
  });

  it("options_json проходит whitelist-проекцию: мусорный `correct` отсекается, битая структура → ключа нет (ревью 5.6 — потеря вариантов при форке)", () => {
    const row = kbTaskToTemplateTaskJson(
      kbTask({
        options_json: {
          kind: "single_choice",
          options: [
            { key: "1", text: "Вариант один", correct: true },
            { key: "2", text: "Вариант два" },
          ],
        },
      }),
    );
    expect(row.options_json).toEqual(validOptions);

    // Ключ «10» — два символа: посимвольный чекер его не сматчит никогда,
    // нормализация fail-closed отвергает ВЕСЬ options_json.
    const broken = kbTaskToTemplateTaskJson(
      kbTask({
        options_json: {
          kind: "single_choice",
          options: [
            { key: "10", text: "x" },
            { key: "2", text: "y" },
          ],
        },
      }),
    );
    expect("options_json" in broken).toBe(false);
  });
});

describe("homeworkTaskFieldsToKbRow — INSERT-зеркало ДЗ→База", () => {
  const opts = { ownerId: "tutor-1", folderId: "folder-1", fingerprint: "fp-1" };

  it("дробный max_score округляется в primary_score (smallint), невалидный → null", () => {
    expect(homeworkTaskFieldsToKbRow({ max_score: 12.5 }, opts).primary_score).toBe(13);
    expect(homeworkTaskFieldsToKbRow({ max_score: 0 }, opts).primary_score).toBeNull();
    expect(homeworkTaskFieldsToKbRow({ max_score: NaN }, opts).primary_score).toBeNull();
    expect(homeworkTaskFieldsToKbRow({ max_score: 99999 }, opts).primary_score).toBe(32767);
  });

  it("exam — whitelist ege/oge: olympiad живёт как NULL (готча ALTER TYPE, rule 50)", () => {
    expect(homeworkTaskFieldsToKbRow({}, { ...opts, exam: "ege" }).exam).toBe("ege");
    expect(homeworkTaskFieldsToKbRow({}, { ...opts, exam: "olympiad" }).exam).toBeNull();
    expect(homeworkTaskFieldsToKbRow({}, { ...opts, exam: null }).exam).toBeNull();
  });

  it("kim_number клампится в 1..40 с округлением, difficulty — гейт 1..5", () => {
    const row = homeworkTaskFieldsToKbRow({ kim_number: 41.7 }, { ...opts, difficulty: 5.2 });
    expect(row.kim_number).toBe(40);
    // 5.2 вне гейта `<= 5` → null (гейт проверяется ДО округления).
    expect(row.difficulty).toBeNull();
    expect(homeworkTaskFieldsToKbRow({ kim_number: 0.4 }, opts).kim_number).toBe(1);
    expect(homeworkTaskFieldsToKbRow({}, { ...opts, difficulty: 3.4 }).difficulty).toBe(3);
    expect(homeworkTaskFieldsToKbRow({ kim_number: "17" }, opts).kim_number).toBeNull();
  });

  it("options_json нормализуется и в INSERT-пути (сырой payload импорт-скрипта с `correct` не доезжает до kb_tasks); дефолты: text-плейсхолдер, source_label='my'", () => {
    const row = homeworkTaskFieldsToKbRow(
      {
        options_json: {
          kind: "single_choice",
          options: [
            { key: "1", text: "Вариант один", correct: true },
            { key: "2", text: "Вариант два" },
          ],
          leaked_field: "мусор",
        },
      },
      opts,
    );
    expect(row.options_json).toEqual(validOptions);
    expect(row.text).toBe("[Задача на фото]");
    expect(row.source_label).toBe("my");
    expect(row.answer_format).toBeNull();
    expect(row.fingerprint).toBe("fp-1");
    expect(row.owner_id).toBe("tutor-1");
    expect(row.folder_id).toBe("folder-1");
  });
});

describe("homeworkTaskFieldsToKbUpdate — presence-семантика каскада (rule 40)", () => {
  it("каскад-ключей нет в body → колонки НЕ трогаются (edit-prefill Базу не грузит; слепой null затёр бы тему источника)", () => {
    const row = homeworkTaskFieldsToKbUpdate({}, "fp-2");
    for (const key of ["exam", "difficulty", "topic_id", "subtopic_id", "source_label"]) {
      expect(key in row, `${key} не должен попасть в UPDATE без ключа в body`).toBe(false);
    }
  });

  it("каскад-ключ ПРИСУТСТВУЕТ с пустым значением → явный null (затирает намеренно)", () => {
    const row = homeworkTaskFieldsToKbUpdate(
      { exam: "", difficulty: 0, topic_id: "", subtopic_id: "", source_label: "   " },
      "fp-2",
    );
    expect(row.exam).toBeNull();
    expect(row.difficulty).toBeNull();
    expect(row.topic_id).toBeNull();
    expect(row.subtopic_id).toBeNull();
    expect(row.source_label).toBeNull();
  });

  it("присланный каскад с валидными значениями пишется; exam='olympiad' → null (в БД олимпиада = exam NULL)", () => {
    const row = homeworkTaskFieldsToKbUpdate(
      { exam: "oge", difficulty: 2.6, topic_id: "topic-9", source_label: "fipi" },
      "fp-2",
    );
    expect(row.exam).toBe("oge");
    expect(row.difficulty).toBe(3);
    expect(row.topic_id).toBe("topic-9");
    expect(row.source_label).toBe("fipi");
    expect(homeworkTaskFieldsToKbUpdate({ exam: "olympiad" }, "fp").exam).toBeNull();
  });

  it("options_json пишется БЕЗУСЛОВНО: ключа нет в body → в UPDATE уезжает null — ровно механизм «форк терял варианты» из ревью 5.6", () => {
    // Фиксируем поведение КАК ЕСТЬ: защита от затирания живёт не здесь, а в
    // вызывающем коде (PUSH_TO_KB_DRAFT_FIELDS + SELECT). Если этот тест упал —
    // кто-то поменял контракт конвертера, и все write-site надо перепроверить.
    const row = homeworkTaskFieldsToKbUpdate({}, "fp-3");
    expect("options_json" in row).toBe(true);
    expect(row.options_json).toBeNull();

    const withOptions = homeworkTaskFieldsToKbUpdate({ options_json: validOptions }, "fp-3");
    expect(withOptions.options_json).toEqual(validOptions);
  });

  it("контент тоже безусловный: без task_text → плейсхолдер, без answer → null; fingerprint и updated_at всегда в UPDATE", () => {
    const row = homeworkTaskFieldsToKbUpdate({ correct_answer: "  " }, "fp-4");
    expect(row.text).toBe("[Задача на фото]");
    expect(row.answer).toBeNull();
    expect(row.fingerprint).toBe("fp-4");
    expect(typeof row.updated_at).toBe("string");
    expect(Number.isNaN(Date.parse(row.updated_at as string))).toBe(false);
    expect(homeworkTaskFieldsToKbUpdate({ max_score: 2.5 } as HomeworkTaskFieldsForKb, "fp").primary_score).toBe(3);
  });
});

describe("templateTaskContentEquals — гейт промоушена шаблона в ссылочный режим", () => {
  it("одинаковый контент при разном порядке ключей и null-vs-отсутствие → равно (stableSerialize)", () => {
    expect(
      templateTaskContentEquals(
        { task_text: "x", max_score: 2, correct_answer: null },
        { max_score: 2, task_text: "x" },
      ),
    ).toBe(true);
  });

  it("source_kb_task_id — провенанс, из сравнения исключён", () => {
    expect(
      templateTaskContentEquals(
        { task_text: "x", source_kb_task_id: "kb-a" },
        { task_text: "x", source_kb_task_id: "kb-b" },
      ),
    ).toBe(true);
  });

  it("реальное расхождение контента → false (ложное «равно» = шаблон молча покажет другую задачу)", () => {
    expect(
      templateTaskContentEquals({ task_text: "x", max_score: 3 }, { task_text: "x", max_score: 2.5 }),
    ).toBe(false);
    expect(
      templateTaskContentEquals(
        { options_json: validOptions },
        { options_json: { ...validOptions, options: [...validOptions.options].reverse() } },
      ),
    ).toBe(false);
  });
});
