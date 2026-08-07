import type { LessonType } from '@/types/tutor';

/**
 * Цветовая система расписания (Волна 1, запрос «4 группы — 4 цвета»).
 *
 * Ячейка занятия красится цветом СУЩНОСТИ (группа → tutor_groups.color,
 * индивидуальный ученик → tutor_students.color); тип занятия при этом
 * показывается тонкой полоской-индикатором слева. Без цвета сущности —
 * прежнее поведение: весь блок цветом типа занятия.
 *
 * Хранение — hex #RRGGBB (CHECK-констрейнт, миграция 20260806130000), но выбор
 * ТОЛЬКО из пресетов ниже (rule 90: «никаких случайных цветов»). Все пресеты
 * дают контраст ≥ 4.5:1 с белым текстом — блоки остаются text-white без
 * дополнительной логики контраста.
 */
export const ENTITY_COLOR_PRESETS: { value: string; label: string }[] = [
  { value: '#0F766E', label: 'Бирюзовый' },
  { value: '#1D4ED8', label: 'Синий' },
  { value: '#7C3AED', label: 'Фиолетовый' },
  { value: '#BE185D', label: 'Малиновый' },
  { value: '#B45309', label: 'Янтарный' },
  { value: '#4D7C0F', label: 'Оливковый' },
  { value: '#0369A1', label: 'Морской' },
  { value: '#57534E', label: 'Графитовый' },
];

/**
 * Типы занятий, предлагаемые при создании (они же — легенда календаря).
 *
 * `consultation` УБРАН 2026-08-07 (решение владельца по данным прода: 4 занятия
 * у одного репетитора, последнее в феврале — тип мёртв). Существующие строки
 * не мигрируем: подпись для них живёт в LEGACY_LESSON_TYPE_LABELS ниже, цвет
 * приходит из фолбэка — история не переименовывается в «Урок».
 */
export const LESSON_TYPES: {
  value: LessonType;
  label: string;
  shortLabel: string;
  color: string;
}[] = [
  { value: 'regular', label: 'Обычный урок', shortLabel: 'Урок', color: 'bg-primary' },
  { value: 'trial', label: 'Пробное занятие', shortLabel: 'Пробное', color: 'bg-amber-500' },
  { value: 'mock_exam', label: 'Пробный экзамен', shortLabel: 'Пробник', color: 'bg-purple-500' },
];

/** Типы, которые больше не предлагаются, но существуют в старых строках. */
const LEGACY_LESSON_TYPE_LABELS: Record<string, string> = {
  consultation: 'Консультация',
};

export function getLessonTypeColor(type: LessonType | string): string {
  return LESSON_TYPES.find(t => t.value === type)?.color || 'bg-primary';
}

/**
 * Цвет полоски-индикатора типа на цветной ячейке = ТОТ ЖЕ класс, что в легенде.
 * Раньше здесь были отдельные «мягкие» оттенки (у обычного урока — bg-white/60),
 * и на цветном фоне полоска фактически исчезала: репетитор видел синюю ячейку
 * без зелёной метки «Урок» (репорт владельца 2026-08-07).
 */
export function getLessonTypeStripeColor(type: LessonType | string): string {
  return getLessonTypeColor(type);
}

export function getLessonTypeLabel(type: LessonType | string): string {
  return (
    LESSON_TYPES.find(t => t.value === type)?.label
    || LEGACY_LESSON_TYPE_LABELS[type as string]
    || 'Урок'
  );
}

/** Валидный пресет-hex или null (защита от мусора в кэше/старых строках). */
export function normalizeEntityColor(color: string | null | undefined): string | null {
  if (!color) return null;
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : null;
}
