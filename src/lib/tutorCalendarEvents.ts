import { supabase } from '@/lib/supabaseClient';
import { getCurrentTutor } from '@/lib/tutors';
import type { TutorCalendarEvent, TutorLessonWithStudent } from '@/types/tutor';

// types.ts (generated) ещё НЕ содержит tutor_calendar_events / новых RPC —
// регенерируется Lovable после применения миграции. До тех пор работаем через
// нетипизированный доступ (тот же escape-hatch, что `as never` для RPC в rule 99).
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as unknown as {
  from: (table: string) => any;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type DeleteCalendarEventScope = 'this' | 'this_and_following' | 'all';

export interface CreateCalendarEventInput {
  tutor_id?: string;
  start_at: string;            // ISO timestamptz
  duration_min: number;
  title: string;
  notes?: string | null;
  is_recurring?: boolean;
  recurrence_rule?: string | null;
  parent_event_id?: string | null;
}

/** Личные дела репетитора в окне [startISO, endISO). RLS + явный tutor_id (mirror getTutorLessons). */
export async function getTutorCalendarEvents(
  startISO: string,
  endISO: string,
): Promise<TutorCalendarEvent[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const { data, error } = await db
    .from('tutor_calendar_events')
    .select('*')
    .eq('tutor_id', tutor.id)
    .gte('start_at', startISO)
    .lt('start_at', endISO)
    .order('start_at', { ascending: true });

  if (error) {
    console.error('Error fetching calendar events:', error);
    return [];
  }
  return (data as TutorCalendarEvent[]) ?? [];
}

export async function createCalendarEvent(
  input: CreateCalendarEventInput,
): Promise<TutorCalendarEvent | null> {
  let tutorId = input.tutor_id;
  if (!tutorId) {
    const tutor = await getCurrentTutor();
    if (!tutor) {
      console.error('Cannot create calendar event: tutor not found');
      return null;
    }
    tutorId = tutor.id;
  }

  const { data, error } = await db
    .from('tutor_calendar_events')
    .insert({
      tutor_id: tutorId,
      start_at: input.start_at,
      duration_min: input.duration_min,
      title: input.title,
      notes: input.notes ?? null,
      is_recurring: input.is_recurring ?? false,
      recurrence_rule: input.recurrence_rule ?? null,
      parent_event_id: input.parent_event_id ?? null,
    })
    .select('*')
    .single();

  if (error) {
    console.error('Error creating calendar event:', error);
    return null;
  }
  return data as TutorCalendarEvent;
}

/** Еженедельная серия личных дел. Зеркалит createLessonSeries (MAX 60, calendar-day +7, DST-safe). */
export async function createCalendarEventSeries(
  input: CreateCalendarEventInput,
  repeatUntil: string,
): Promise<{ root: TutorCalendarEvent | null; count: number }> {
  const MAX_INSTANCES = 60;
  const startDate = new Date(input.start_at);
  const untilDate = new Date(new Date(repeatUntil).setHours(23, 59, 59, 999));

  let tutorId = input.tutor_id;
  if (!tutorId) {
    const tutor = await getCurrentTutor();
    if (!tutor) {
      console.error('Cannot create calendar event series: tutor not found');
      return { root: null, count: 0 };
    }
    tutorId = tutor.id;
  }

  const dates: Date[] = [];
  for (let week = 0; dates.length < MAX_INSTANCES; week++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + week * 7);
    if (d > untilDate) break;
    dates.push(d);
  }

  if (dates.length === 0) {
    return { root: null, count: 0 };
  }

  // Один сгенерированный экземпляр — не серия, обычное событие.
  if (dates.length === 1) {
    const single = await createCalendarEvent({
      ...input,
      tutor_id: tutorId,
      start_at: dates[0].toISOString(),
      is_recurring: false,
      recurrence_rule: null,
      parent_event_id: null,
    });
    return { root: single, count: single ? 1 : 0 };
  }

  const root = await createCalendarEvent({
    ...input,
    tutor_id: tutorId,
    start_at: dates[0].toISOString(),
    is_recurring: true,
    recurrence_rule: 'weekly',
    parent_event_id: null,
  });
  if (!root) {
    return { root: null, count: 0 };
  }

  const childRows = dates.slice(1).map((d) => ({
    tutor_id: tutorId,
    start_at: d.toISOString(),
    duration_min: input.duration_min,
    title: input.title,
    notes: input.notes ?? null,
    is_recurring: true,
    recurrence_rule: 'weekly',
    parent_event_id: root.id,
  }));

  const { error } = await db.from('tutor_calendar_events').insert(childRows);
  if (error) {
    console.error('Error creating calendar event series children:', error);
    return { root, count: 1 };
  }
  return { root, count: dates.length };
}

export async function updateCalendarEvent(
  id: string,
  patch: { start_at?: string; duration_min?: number; title?: string; notes?: string | null },
): Promise<TutorCalendarEvent | null> {
  const { data, error } = await db
    .from('tutor_calendar_events')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    console.error('Error updating calendar event:', error);
    return null;
  }
  return data as TutorCalendarEvent;
}

export interface UpdateCalendarEventSeriesResult {
  ok: boolean;
  updatedCount: number;
  error?: string;
}

export async function updateCalendarEventSeries(
  event: { id: string; parent_event_id?: string | null; start_at: string },
  input: {
    title?: string;
    notes?: string | null;
    duration_min?: number;
    applyTimeShift?: boolean;
    shiftMinutes?: number;
    /** 'this_and_following' (default) = выбранное + будущие; 'all' = вся серия. */
    scope?: 'this_and_following' | 'all';
  },
): Promise<UpdateCalendarEventSeriesResult> {
  const rootId = event.parent_event_id || event.id;
  const fromStartAt = input.scope === 'all' ? '1970-01-01T00:00:00.000Z' : event.start_at;

  const args: Record<string, unknown> = {
    _root_event_id: rootId,
    _selected_event_id: event.id,
    _from_start_at: fromStartAt,
    _apply_time_shift: input.applyTimeShift ?? false,
    _shift_minutes: input.shiftMinutes ?? 0,
    ...(input.title !== undefined && { _title: input.title }),
    ...(input.notes !== undefined && { _notes: input.notes }),
    ...(input.duration_min !== undefined && { _duration_min: input.duration_min }),
  };

  const { data, error } = await db.rpc('update_calendar_event_series', args);
  if (error) {
    console.error('Error updating calendar event series:', error);
    return { ok: false, updatedCount: 0, error: error.message };
  }
  const updatedCount = typeof data === 'number' ? data : Number(data ?? 0);
  if (!Number.isFinite(updatedCount) || updatedCount <= 0) {
    return { ok: false, updatedCount: 0, error: 'No events were updated' };
  }
  return { ok: true, updatedCount };
}

export async function deleteCalendarEventsScoped(
  eventId: string,
  scope: DeleteCalendarEventScope,
): Promise<{ ok: boolean; deleted: number; error?: string }> {
  const { data, error } = await db.rpc('tutor_delete_calendar_events', {
    _event_id: eventId,
    _scope: scope,
  });
  if (error) {
    console.error('Error deleting calendar events:', error);
    return { ok: false, deleted: 0, error: error.message };
  }
  const deleted = (data as { deleted?: number } | null)?.deleted ?? 0;
  return { ok: true, deleted };
}

export interface ConflictResult {
  lessons: TutorLessonWithStudent[];
  events: TutorCalendarEvent[];
}

/**
 * Чистый детектор пересечений по времени (half-open: aStart < bEnd && bStart < aEnd).
 * Без буфера — это мягкое предупреждение репетитору (буфер — забота публичной записи, server-side).
 * Отменённые занятия и исключённые id пропускаются (drag не конфликтует сам с собой).
 */
export function findConflicts(
  candidateStart: Date,
  candidateEnd: Date,
  lessons: TutorLessonWithStudent[],
  events: TutorCalendarEvent[],
  opts?: { excludeLessonId?: string; excludeEventId?: string },
): ConflictResult {
  const cs = candidateStart.getTime();
  const ce = candidateEnd.getTime();
  if (!Number.isFinite(cs) || !Number.isFinite(ce) || ce <= cs) {
    return { lessons: [], events: [] };
  }
  const overlaps = (s: number, e: number) => cs < e && s < ce;

  const lessonHits = (lessons ?? []).filter((l) => {
    if (opts?.excludeLessonId && l.id === opts.excludeLessonId) return false;
    if (l.status === 'cancelled') return false;
    const s = new Date(l.start_at).getTime();
    const e = s + (l.duration_min ?? 60) * 60000;
    return Number.isFinite(s) && overlaps(s, e);
  });

  const eventHits = (events ?? []).filter((ev) => {
    if (opts?.excludeEventId && ev.id === opts.excludeEventId) return false;
    const s = new Date(ev.start_at).getTime();
    const e = s + (ev.duration_min ?? 60) * 60000;
    return Number.isFinite(s) && overlaps(s, e);
  });

  return { lessons: lessonHits, events: eventHits };
}
