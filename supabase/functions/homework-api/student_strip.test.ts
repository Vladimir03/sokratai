/**
 * Анти-утечки student-ответа треда ДЗ (rule 40, слой 2).
 *
 * Эти стрипы — единственный фильтр между service_role-SELECT'ом (обходит RLS)
 * и payload'ом ученика. Регресс любого из них = tutor-only поле уезжает в
 * браузер ученика. До 2026-08-05 функции жили внутри `index.ts` и не
 * покрывались ничем (найдено при разборе багов Ульяны/Елены).
 */
import { describe, expect, it } from "vitest";
import {
  stripHiddenMessages,
  stripIndependentPreRevealFields,
  stripStudentSensitiveTaskStateFields,
} from "./student_strip";

function makeThread(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "thread-1",
    status: "active",
    homework_tutor_thread_messages: [],
    homework_tutor_task_states: [],
    ...overrides,
  };
}

describe("stripHiddenMessages", () => {
  it("вырезает сообщения с visible_to_student=false (скрытые заметки репетитора)", () => {
    const thread = makeThread({
      homework_tutor_thread_messages: [
        { id: "m1", content: "видно", visible_to_student: true },
        { id: "m2", content: "скрытая заметка", visible_to_student: false },
        { id: "m3", content: "поле не задано (legacy) — видно" },
      ],
    });
    const out = stripHiddenMessages(thread);
    const ids = (out.homework_tutor_thread_messages as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toEqual(["m1", "m3"]);
  });

  it("не трогает тред без массива сообщений", () => {
    const thread = makeThread({ homework_tutor_thread_messages: undefined });
    expect(stripHiddenMessages(thread)).toBe(thread);
  });
});

describe("stripStudentSensitiveTaskStateFields", () => {
  const fullState = {
    id: "ts-1",
    task_id: "task-1",
    status: "completed",
    earned_score: 2,
    best_earned_score: 2,
    ai_score: 2,
    // tutor-only поля, которые ОБЯЗАНЫ вырезаться:
    ai_score_comment: "черновой комментарий AI для репетитора",
    tutor_force_completed_by: "uuid-репетитора",
    tutor_reviewed_by: "uuid-репетитора",
    // видимые ученику маркеры (бейдж «проверено») — обязаны ОСТАТЬСЯ:
    tutor_force_completed_at: "2026-08-01T10:00:00Z",
    tutor_reviewed_at: "2026-08-01T10:00:00Z",
  };

  it("вырезает ai_score_comment и *_by, сохраняя *_at и баллы", () => {
    const out = stripStudentSensitiveTaskStateFields(
      makeThread({ homework_tutor_task_states: [fullState] }),
    );
    const state = (out.homework_tutor_task_states as Record<string, unknown>[])[0];
    expect(state).not.toHaveProperty("ai_score_comment");
    expect(state).not.toHaveProperty("tutor_force_completed_by");
    expect(state).not.toHaveProperty("tutor_reviewed_by");
    expect(state.tutor_force_completed_at).toBe("2026-08-01T10:00:00Z");
    expect(state.tutor_reviewed_at).toBe("2026-08-01T10:00:00Z");
    expect(state.earned_score).toBe(2);
    expect(state.best_earned_score).toBe(2);
  });

  it("исходный объект не мутируется (стрип возвращает копию)", () => {
    const thread = makeThread({ homework_tutor_task_states: [{ ...fullState }] });
    stripStudentSensitiveTaskStateFields(thread);
    const original = (thread.homework_tutor_task_states as Record<string, unknown>[])[0];
    expect(original.ai_score_comment).toBe("черновой комментарий AI для репетитора");
  });

  it("не падает на не-объектных элементах и отсутствующем массиве", () => {
    const withJunk = makeThread({ homework_tutor_task_states: [null, "мусор", 42] });
    expect(() => stripStudentSensitiveTaskStateFields(withJunk)).not.toThrow();
    const noArray = makeThread({ homework_tutor_task_states: undefined });
    expect(stripStudentSensitiveTaskStateFields(noArray)).toBe(noArray);
  });
});

describe("stripIndependentPreRevealFields (самостоятельная работа ДО сдачи)", () => {
  it("оставляет только user/tutor-сообщения — вердикты AI фильтруются", () => {
    const out = stripIndependentPreRevealFields(
      makeThread({
        homework_tutor_thread_messages: [
          { id: "m1", role: "user", content: "мой ответ" },
          { id: "m2", role: "assistant", content: "ВЕРДИКТ: верно" },
          { id: "m3", role: "system", content: "интро" },
          { id: "m4", role: "tutor", content: "человеческое сообщение" },
        ],
      }),
    );
    const roles = (out.homework_tutor_thread_messages as Array<{ role: string }>).map(
      (m) => m.role,
    );
    expect(roles).toEqual(["user", "tutor"]);
  });

  it("зануляет ВСЕ носители балла/вердикта (P0 2026-07-25: best_earned_score утекал)", () => {
    const out = stripIndependentPreRevealFields(
      makeThread({
        homework_tutor_task_states: [
          {
            id: "ts-1",
            task_id: "task-1",
            status: "completed",
            attempts: 1,
            hint_count: 0,
            best_score: 2,
            wrong_answer_count: 3,
            available_score: 2,
            earned_score: 2,
            best_earned_score: 2,
            ai_help_events: 0,
            ai_score: 2,
            tutor_score_override: 1.5,
            tutor_score_override_comment: "секрет",
            tutor_score_override_at: "2026-08-01T10:00:00Z",
            ai_criteria_json: [{ label: "К1" }],
            ai_nodes_json: [{ node: 1 }],
          },
        ],
      }),
    );
    const state = (out.homework_tutor_task_states as Record<string, unknown>[])[0];
    // required-number поля клиентского типа → 0, optional → null (контракт кода).
    expect(state.best_score).toBe(0);
    expect(state.wrong_answer_count).toBe(0);
    for (const field of [
      "available_score",
      "earned_score",
      "best_earned_score",
      "ai_help_events",
      "ai_score",
      "tutor_score_override",
      "tutor_score_override_comment",
      "tutor_score_override_at",
      "ai_criteria_json",
      "ai_nodes_json",
    ]) {
      expect(state[field], field).toBeNull();
    }
    // UI-поля остаются: «Сдано»/лок ввода без раскрытия вердикта.
    expect(state.status).toBe("completed");
    expect(state.attempts).toBe(1);
    expect(state.hint_count).toBe(0);
  });

  it("не падает на пустом треде", () => {
    const out = stripIndependentPreRevealFields(
      makeThread({
        homework_tutor_thread_messages: undefined,
        homework_tutor_task_states: undefined,
      }),
    );
    expect(out.homework_tutor_thread_messages).toEqual([]);
    expect(out.homework_tutor_task_states).toEqual([]);
  });
});
