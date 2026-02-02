import { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  getCurrentTutor, 
  getTutorStudents, 
  getTutorStudent,
  getMockExams,
  getStudentChats,
  getStudentChatMessages,
  getTutorPayments,
  getTutorWeeklySlots,
  getTutorLessons,
  getReminderSettings,
  getTutorPublicInfo,
  getAvailableBookingSlots
} from '@/lib/tutors';
import type { 
  Tutor, 
  TutorStudentWithProfile, 
  MockExam,
  StudentChat,
  StudentChatMessage,
  TutorPaymentWithStudent,
  TutorWeeklySlot,
  TutorLessonWithStudent,
  TutorReminderSettings,
  TutorPublicInfo,
  BookingSlot
} from '@/types/tutor';

export function useTutor() {
  const [tutor, setTutor] = useState<Tutor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTutor = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCurrentTutor();
      setTutor(data);
    } catch (err) {
      console.error('Error in useTutor:', err);
      setError('Не удалось загрузить профиль');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTutor();
  }, [fetchTutor]);

  return { tutor, loading, error, refetch: fetchTutor };
}

export function useTutorStudents() {
  const [students, setStudents] = useState<TutorStudentWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTutorStudents();
      setStudents(data);
    } catch (err) {
      console.error('Error in useTutorStudents:', err);
      setError('Не удалось загрузить учеников');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  return { students, loading, error, refetch: fetchStudents };
}

/**
 * Хук для получения одного ученика по ID
 */
export function useTutorStudent(tutorStudentId: string | undefined) {
  const [student, setStudent] = useState<TutorStudentWithProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStudent = useCallback(async () => {
    if (!tutorStudentId) {
      setStudent(null);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const data = await getTutorStudent(tutorStudentId);
      setStudent(data);
    } catch (err) {
      console.error('Error in useTutorStudent:', err);
      setError('Не удалось загрузить данные ученика');
    } finally {
      setLoading(false);
    }
  }, [tutorStudentId]);

  useEffect(() => {
    fetchStudent();
  }, [fetchStudent]);

  return { student, loading, error, refetch: fetchStudent };
}

/**
 * Хук для получения пробников ученика
 */
export function useMockExams(tutorStudentId: string | undefined) {
  const [mockExams, setMockExams] = useState<MockExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMockExams = useCallback(async () => {
    if (!tutorStudentId) {
      setMockExams([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const data = await getMockExams(tutorStudentId);
      setMockExams(data);
    } catch (err) {
      console.error('Error in useMockExams:', err);
      setError('Не удалось загрузить пробники');
    } finally {
      setLoading(false);
    }
  }, [tutorStudentId]);

  useEffect(() => {
    fetchMockExams();
  }, [fetchMockExams]);

  return { mockExams, loading, error, refetch: fetchMockExams };
}

/**
 * Хук для получения чатов ученика
 */
export function useStudentChats(studentId: string | undefined) {
  const [chats, setChats] = useState<StudentChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChats = useCallback(async () => {
    if (!studentId) {
      setChats([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const data = await getStudentChats(studentId);
      setChats(data);
    } catch (err) {
      console.error('Error in useStudentChats:', err);
      setError('Не удалось загрузить чаты');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  return { chats, loading, error, refetch: fetchChats };
}

/**
 * Хук для получения сообщений чата
 */
export function useStudentChatMessages(chatId: string | undefined) {
  const [messages, setMessages] = useState<StudentChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async (beforeTimestamp?: string) => {
    if (!chatId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const data = await getStudentChatMessages(chatId, 50, beforeTimestamp);
      
      if (beforeTimestamp) {
        // Дозагрузка старых сообщений
        setMessages(prev => [...data, ...prev]);
      } else {
        // Первоначальная загрузка
        setMessages(data);
      }
      
      setHasMore(data.length === 50);
    } catch (err) {
      console.error('Error in useStudentChatMessages:', err);
      setError('Не удалось загрузить сообщения');
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const loadMore = useCallback(() => {
    if (messages.length > 0 && hasMore) {
      fetchMessages(messages[0].created_at);
    }
  }, [messages, hasMore, fetchMessages]);

  return { messages, loading, hasMore, error, loadMore, refetch: () => fetchMessages() };
}

/**
 * Хук для получения всех оплат репетитора
 */
export function useTutorPayments() {
  const [payments, setPayments] = useState<TutorPaymentWithStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTutorPayments();
      setPayments(data);
    } catch (err) {
      console.error('Error in useTutorPayments:', err);
      setError('Не удалось загрузить оплаты');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  return { payments, loading, error, refetch: fetchPayments };
}

// =============================================
// A1: Хуки для календаря
// =============================================

/**
 * Хук для получения недельных слотов репетитора
 */
export function useTutorWeeklySlots() {
  const [slots, setSlots] = useState<TutorWeeklySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTutorWeeklySlots();
      setSlots(data);
    } catch (err) {
      console.error('Error in useTutorWeeklySlots:', err);
      setError('Не удалось загрузить слоты');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  return { slots, loading, error, refetch: fetchSlots };
}

/**
 * Хук для получения занятий за указанную неделю
 */
export function useTutorLessons(weekStartDate: Date) {
  const [lessons, setLessons] = useState<TutorLessonWithStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Вычислить начало и конец недели
  const { startDate, endDate } = useMemo(() => {
    const start = new Date(weekStartDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString()
    };
  }, [weekStartDate]);

  const fetchLessons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTutorLessons(startDate, endDate);
      setLessons(data);
    } catch (err) {
      console.error('Error in useTutorLessons:', err);
      setError('Не удалось загрузить занятия');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  return { lessons, loading, error, refetch: fetchLessons };
}

/**
 * Хук для настроек напоминаний
 */
export function useTutorReminderSettings() {
  const [settings, setSettings] = useState<TutorReminderSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getReminderSettings();
      setSettings(data);
    } catch (err) {
      console.error('Error in useTutorReminderSettings:', err);
      setError('Не удалось загрузить настройки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return { settings, loading, error, refetch: fetchSettings };
}

// =============================================
// Public Booking Hooks
// =============================================

/**
 * Хук для получения публичной информации о репетиторе
 */
export function useTutorPublicInfo(bookingLink: string | undefined) {
  const [tutor, setTutor] = useState<TutorPublicInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTutor = useCallback(async () => {
    if (!bookingLink) {
      setTutor(null);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const data = await getTutorPublicInfo(bookingLink);
      setTutor(data);
    } catch (err) {
      console.error('Error in useTutorPublicInfo:', err);
      setError('Не удалось загрузить данные репетитора');
    } finally {
      setLoading(false);
    }
  }, [bookingLink]);

  useEffect(() => {
    fetchTutor();
  }, [fetchTutor]);

  return { tutor, loading, error, refetch: fetchTutor };
}

/**
 * Хук для получения доступных слотов для записи
 */
export function useAvailableBookingSlots(bookingLink: string | undefined, daysAhead: number = 7) {
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSlots = useCallback(async () => {
    if (!bookingLink) {
      setSlots([]);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    try {
      const data = await getAvailableBookingSlots(bookingLink, daysAhead);
      setSlots(data);
    } catch (err) {
      console.error('Error in useAvailableBookingSlots:', err);
      setError('Не удалось загрузить доступные слоты');
    } finally {
      setLoading(false);
    }
  }, [bookingLink, daysAhead]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  return { slots, loading, error, refetch: fetchSlots };
}
