import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useKbSources, useSubtopics, useTopics } from '@/hooks/useKnowledgeBase';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
import { cn } from '@/lib/utils';
import { SubjectSelect } from '@/components/tutor/SubjectSelect';
import type { CatalogFilter } from '@/types/kb';

/** Тип задания: задаёт фильтр тем + переключает «№ КИМ» ↔ «уровень сложности». */
export type TaskClassType = '' | 'ege' | 'oge' | 'olympiad';

const TASK_TYPE_OPTIONS: { value: TaskClassType; label: string }[] = [
  { value: '', label: 'Не указан' },
  { value: 'ege', label: 'ЕГЭ' },
  { value: 'oge', label: 'ОГЭ' },
  { value: 'olympiad', label: 'Олимпиада' },
];

const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5];

const SELECT_CLASS =
  'w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]';
const INPUT_CLASS = SELECT_CLASS;
const LEGEND_CLASS = 'mb-1.5 text-xs font-semibold text-slate-500';

const CUSTOM_SOURCE = '__custom__';

export interface TaskClassificationValue {
  taskType: TaskClassType;
  kimNumber: string;
  difficulty: string;
  primaryScore: string;
  topicId: string;
  subtopicId: string;
  sourceLabel: string;
  /**
   * @deprecated Запрос Егора #60 (2026-07-11): селект «Формат ответа» удалён из UI
   * (дублировал «Формат проверки»; грейдинг его не читает, колонка legacy живёт).
   * Проп принимается и игнорируется — чтобы не трогать callsite в HWTaskCard
   * (high-risk rule 40). Убрать вместе с пропами ниже при следующем касании HWTaskCard.
   */
  answerFormat?: string;
}

interface TaskClassificationFieldsProps extends TaskClassificationValue {
  /**
   * Мультипредметный каталог (2026-07-06): предмет скоупит выпадающий список тем
   * (`useTopics(filter, subject)`). Опционален — когда не задан (undefined),
   * селектор «Предмет» скрыт и темы не скоупятся (обратная совместимость: homework
   * конструктор не передаёт → все темы, как раньше). КБ-модалки задают оба.
   */
  subject?: string;
  onSubjectChange?: (v: string) => void;
  onTaskTypeChange: (v: TaskClassType) => void;
  onKimNumberChange: (v: string) => void;
  onDifficultyChange: (v: string) => void;
  onPrimaryScoreChange: (v: string) => void;
  onTopicIdChange: (v: string) => void;
  onSubtopicIdChange: (v: string) => void;
  onSourceLabelChange: (v: string) => void;
  /** @deprecated см. answerFormat — принимается и игнорируется. */
  onAnswerFormatChange?: (v: string) => void;
  disabled?: boolean;
  /** @deprecated см. answerFormat — «Формат ответа» удалён из UI совсем (#60). */
  hideAnswerFormat?: boolean;
  /**
   * unified-task-model F2 (2026-07-05): вариант для конструктора ДЗ — балл
   * ведёт «Макс. баллов» карточки (авто-балл по КИМ подсказывается там).
   */
  hidePrimaryScore?: boolean;
}

/**
 * Каскадный блок классификации задачи (общий для CreateTaskModal / EditTaskModal).
 * Тип → фильтрует темы (`useTopics(filter)`); ЕГЭ/ОГЭ → № КИМ + авто-балл (по ФИПИ,
 * редактируемо); Олимпиада → уровень сложности 1–5 (= балл). Источник — из
 * управляемого справочника (`kb_sources`) + «Другой» (свободный ввод).
 */
export function TaskClassificationFields({
  taskType,
  kimNumber,
  difficulty,
  primaryScore,
  topicId,
  subtopicId,
  sourceLabel,
  subject,
  onSubjectChange,
  onTaskTypeChange,
  onKimNumberChange,
  onDifficultyChange,
  onPrimaryScoreChange,
  onTopicIdChange,
  onSubtopicIdChange,
  onSourceLabelChange,
  disabled = false,
  hidePrimaryScore = false,
}: TaskClassificationFieldsProps) {
  const showSubject = subject !== undefined && onSubjectChange !== undefined;
  const topicFilter: CatalogFilter | undefined = taskType === '' ? undefined : taskType;
  const { topics = [], loading: topicsLoading } = useTopics(topicFilter, subject);
  const { subtopics, loading: subtopicsLoading } = useSubtopics(topicId || undefined);
  const { sources = [], loading: sourcesLoading } = useKbSources();

  const isOlympiad = taskType === 'olympiad';
  const isExam = taskType === 'ege' || taskType === 'oge';

  // Авто-балл по № КИМ (только ЕГЭ/ОГЭ). primaryScore — ручной override:
  // пусто = «использовать авто», непусто = ручное значение.
  const examForScore = taskType === 'ege' ? 'ege' : taskType === 'oge' ? 'oge' : null;
  const kimNum = kimNumber.trim() ? parseInt(kimNumber.trim(), 10) : null;
  // Авто-балл по КИМ — только физика; для обществознания null → ручной ввод.
  const autoScore = getKimPrimaryScoreForSubject(subject, examForScore, kimNum);
  const overrideActive = primaryScore.trim() !== '';

  // Источник: select из kb_sources + «Другой» (свободный ввод).
  // Прелоад кастомного значения (Edit): показываем его отдельной опцией value=label,
  // чтобы не конфликтовать со значением «Другой» (CUSTOM_SOURCE).
  const sourceNames = sources.map((s) => s.name);
  const [customSourceMode, setCustomSourceMode] = useState(false);
  const labelIsCustom = sourceLabel !== '' && !sourceNames.includes(sourceLabel);
  const showSourceInput = customSourceMode;
  const sourceSelectValue = customSourceMode ? CUSTOM_SOURCE : sourceLabel;

  return (
    <div className="space-y-4">
      {/* Предмет — скоупит список тем. Полный школьный словарь SUBJECTS (14),
          умная группировка «Ваши предметы»/«Другие» из профиля (Ф2) — ничего
          не прячем: разовая задача по чужому предмету всегда возможна. */}
      {showSubject ? (
        <fieldset>
          <legend className={LEGEND_CLASS}>Предмет</legend>
          <SubjectSelect
            value={subject}
            onChange={(v) => onSubjectChange!(v)}
            disabled={disabled}
            className={SELECT_CLASS}
          />
        </fieldset>
      ) : null}

      {/* Тип задания + (№ КИМ / уровень сложности) */}
      <div className="grid grid-cols-2 gap-3">
        <fieldset>
          <legend className={LEGEND_CLASS}>Тип</legend>
          <select
            value={taskType}
            onChange={(e) => onTaskTypeChange(e.target.value as TaskClassType)}
            disabled={disabled}
            className={SELECT_CLASS}
          >
            {TASK_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </fieldset>

        {isOlympiad ? (
          <fieldset>
            <legend className={LEGEND_CLASS}>Сложность</legend>
            <div className="flex gap-1.5">
              {DIFFICULTY_LEVELS.map((lvl) => {
                const active = difficulty === String(lvl);
                return (
                  <button
                    key={lvl}
                    type="button"
                    disabled={disabled}
                    onClick={() => onDifficultyChange(active ? '' : String(lvl))}
                    aria-pressed={active}
                    className={cn(
                      'flex h-10 flex-1 items-center justify-center rounded-lg border text-[16px] font-semibold [touch-action:manipulation]',
                      active
                        ? 'border-socrat-primary bg-socrat-primary text-white'
                        : 'border-socrat-border bg-white text-slate-600 hover:border-socrat-primary/40',
                    )}
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <fieldset>
            <legend className={LEGEND_CLASS}>№ задания (КИМ)</legend>
            <input
              type="text"
              inputMode="numeric"
              value={kimNumber}
              onChange={(e) => onKimNumberChange(e.target.value.replace(/\D/g, ''))}
              placeholder="1–30"
              disabled={disabled}
              className={INPUT_CLASS}
            />
          </fieldset>
        )}
      </div>

      {/* Балл: для олимпиады = сложность (подсказка); для ЕГЭ/ОГЭ — авто/ручной;
          для «Не указан» — ручной ввод. */}
      {hidePrimaryScore ? null : isOlympiad ? (
        difficulty.trim() ? (
          <p className="-mt-2 text-xs text-slate-500">
            Уровень сложности = балл за задачу (1 — лёгкая, 5 — сложная).
          </p>
        ) : (
          <p className="-mt-2 text-xs text-amber-600">
            Выберите уровень сложности (1–5) — это балл за задачу.
          </p>
        )
      ) : isExam && autoScore != null && !overrideActive ? (
        <div className="flex items-center justify-between rounded-lg border border-socrat-border bg-slate-50/60 px-3 py-2">
          <span className="text-sm text-slate-700">
            Первичный балл: <span className="font-semibold">{autoScore}</span>{' '}
            <span className="text-xs text-slate-400">— по ФИПИ</span>
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPrimaryScoreChange(String(autoScore))}
            className="inline-flex items-center gap-1 text-xs font-medium text-socrat-primary hover:underline [touch-action:manipulation]"
          >
            <Pencil className="h-3 w-3" />
            Изменить
          </button>
        </div>
      ) : (
        <fieldset>
          <legend className={LEGEND_CLASS}>Первичный балл</legend>
          <input
            type="text"
            inputMode="numeric"
            value={primaryScore}
            onChange={(e) => onPrimaryScoreChange(e.target.value.replace(/\D/g, ''))}
            placeholder="1–4"
            disabled={disabled}
            className={INPUT_CLASS}
          />
          {isExam && autoScore != null ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPrimaryScoreChange('')}
              className="mt-1 text-xs font-medium text-socrat-primary hover:underline [touch-action:manipulation]"
            >
              Сбросить к баллу ФИПИ ({autoScore})
            </button>
          ) : null}
        </fieldset>
      )}

      {/* Тема (фильтр по типу) */}
      <fieldset>
        <legend className={LEGEND_CLASS}>Тема</legend>
        <select
          value={topicId}
          onChange={(e) => onTopicIdChange(e.target.value)}
          disabled={disabled || topicsLoading}
          className={SELECT_CLASS}
        >
          <option value="">Не выбрана</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </fieldset>

      {/* Подтема — только когда выбрана тема */}
      {topicId ? (
        <fieldset>
          <legend className={LEGEND_CLASS}>Подтема</legend>
          <select
            value={subtopicId}
            onChange={(e) => onSubtopicIdChange(e.target.value)}
            disabled={disabled || subtopicsLoading}
            className={SELECT_CLASS}
          >
            <option value="">Не выбрана</option>
            {subtopics.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </fieldset>
      ) : null}

      {/* Источник — справочник kb_sources + «Другой» */}
      <fieldset>
        <legend className={LEGEND_CLASS}>Источник задачи</legend>
        <select
          value={sourceSelectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === CUSTOM_SOURCE) {
              setCustomSourceMode(true);
            } else {
              setCustomSourceMode(false);
              onSourceLabelChange(v);
            }
          }}
          disabled={disabled || sourcesLoading}
          className={SELECT_CLASS}
        >
          <option value="">Не указан</option>
          {sources.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
          {labelIsCustom && !customSourceMode ? (
            <option value={sourceLabel}>{sourceLabel}</option>
          ) : null}
          <option value={CUSTOM_SOURCE}>Другой (вписать)…</option>
        </select>
        {showSourceInput ? (
          <input
            type="text"
            value={sourceLabel}
            onChange={(e) => onSourceLabelChange(e.target.value)}
            placeholder="ФИПИ, Решу ЕГЭ, свой авторский, учебник…"
            disabled={disabled}
            className={cn(INPUT_CLASS, 'mt-2')}
          />
        ) : null}
      </fieldset>

      {/* «Формат ответа» удалён (#60, Егор 2026-07-11): дублировал «Формат
          проверки» в секции «Ответ и решение»; грейдинг answer_format не читает.
          Колонка kb_tasks.answer_format — legacy, старые значения продолжают
          работать через фолбэк resolveCheckFormatFromKb при импорте в ДЗ. */}
    </div>
  );
}
