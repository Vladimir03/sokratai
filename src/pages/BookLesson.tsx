import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Calendar, Clock, User, Check, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { 
  getTutorPublicInfo, 
  getAvailableBookingSlots,
  bookLessonSlot 
} from '@/lib/tutorSchedule';
import { format, parseISO, isSameDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { TutorPublicInfo, BookingSlot } from '@/types/tutor';

export default function BookLesson() {
  const { bookingLink } = useParams<{ bookingLink: string }>();
  const navigate = useNavigate();
  
  const [tutor, setTutor] = useState<TutorPublicInfo | null>(null);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setIsAuthenticated(!!user);
    };
    checkAuth();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      if (!bookingLink) return;
      
      setLoading(true);
      try {
        const [tutorData, slotsData] = await Promise.all([
          getTutorPublicInfo(bookingLink),
          getAvailableBookingSlots(bookingLink, 14)
        ]);
        
        setTutor(tutorData);
        setSlots(slotsData);
      } catch (error) {
        console.error('Error loading booking data:', error);
        toast.error('Ошибка загрузки данных');
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [bookingLink]);

  // Group slots by date
  const slotsByDate = useMemo(() => {
    const grouped: Record<string, BookingSlot[]> = {};
    
    slots.forEach(slot => {
      const dateKey = slot.slot_date;
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(slot);
    });
    
    return grouped;
  }, [slots]);

  const availableDates = Object.keys(slotsByDate).sort();

  const handleSelectSlot = (slot: BookingSlot) => {
    if (slot.is_booked) return;
    setSelectedSlot(slot);
  };

  const handleBook = async () => {
    if (!selectedSlot || !bookingLink) return;
    
    if (!isAuthenticated) {
      // Redirect to login with return URL
      toast.info('Войдите, чтобы записаться на занятие');
      navigate(`/login?redirect=/book/${bookingLink}`);
      return;
    }
    
    setBooking(true);
    try {
      await bookLessonSlot(
        bookingLink,
        selectedSlot.slot_date,
        selectedSlot.start_time,
        selectedSlot.duration_min
      );
      setBooked(true);
      toast.success('Вы успешно записались на занятие!');
    } catch (error) {
      console.error('Booking error:', error);
      toast.error('Ошибка записи. Попробуйте ещё раз.');
    } finally {
      setBooking(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <Skeleton className="h-16 w-16 rounded-full mx-auto" />
            <Skeleton className="h-6 w-48 mx-auto mt-4" />
            <Skeleton className="h-4 w-32 mx-auto mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!tutor) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg text-center">
          <CardContent className="py-12">
            <User className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Репетитор не найден</h2>
            <p className="text-muted-foreground mb-6">
              Проверьте правильность ссылки или обратитесь к вашему репетитору
            </p>
            <Button variant="outline" onClick={() => navigate('/')}>
              На главную
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (booked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg text-center">
          <CardContent className="py-12">
            <div className="w-16 h-16 mx-auto bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Вы записаны!</h2>
            <p className="text-muted-foreground mb-2">
              Занятие с {tutor.name}
            </p>
            {selectedSlot && (
              <p className="font-medium mb-6">
                {format(parseISO(selectedSlot.slot_date), 'd MMMM', { locale: ru })} в {selectedSlot.start_time.slice(0, 5)}
              </p>
            )}
            <p className="text-sm text-muted-foreground mb-6">
              Напоминание придёт вам в Telegram перед занятием
            </p>
            <Button onClick={() => navigate('/chat')}>
              Перейти в чат
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Back button */}
        <Button variant="ghost" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Назад
        </Button>

        {/* Tutor Card */}
        <Card>
          <CardContent className="pt-6 text-center">
            <Avatar className="h-20 w-20 mx-auto mb-4">
              <AvatarImage src={tutor.avatar_url || undefined} />
              <AvatarFallback className="text-2xl">
                {tutor.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <h1 className="text-xl font-bold">{tutor.name}</h1>
            {tutor.subjects && tutor.subjects.length > 0 && (
              <div className="flex flex-wrap gap-1 justify-center mt-2">
                {tutor.subjects.map((subject, i) => (
                  <Badge key={i} variant="secondary">{subject}</Badge>
                ))}
              </div>
            )}
            {tutor.bio && (
              <p className="text-muted-foreground mt-3 text-sm">{tutor.bio}</p>
            )}
          </CardContent>
        </Card>

        {/* Available Slots */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Выберите время
            </CardTitle>
            <CardDescription>
              Доступные слоты на ближайшие 2 недели
            </CardDescription>
          </CardHeader>
          <CardContent>
            {availableDates.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Нет доступных слотов. Попробуйте позже.
              </p>
            ) : (
              <div className="space-y-4">
                {availableDates.map(dateStr => {
                  const date = parseISO(dateStr);
                  const daySlots = slotsByDate[dateStr];
                  
                  return (
                    <div key={dateStr}>
                      <h4 className="font-medium text-sm mb-2">
                        {format(date, 'EEEE, d MMMM', { locale: ru })}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {daySlots.map((slot, i) => {
                          const isSelected = selectedSlot && 
                            selectedSlot.slot_date === slot.slot_date && 
                            selectedSlot.start_time === slot.start_time;
                          
                          return (
                            <Button
                              key={i}
                              variant={isSelected ? "default" : slot.is_booked ? "ghost" : "outline"}
                              size="sm"
                              disabled={slot.is_booked}
                              onClick={() => handleSelectSlot(slot)}
                              className={`gap-1 ${slot.is_booked ? 'line-through opacity-50' : ''}`}
                            >
                              <Clock className="h-3 w-3" />
                              {slot.start_time.slice(0, 5)}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Book Button */}
        {selectedSlot && (
          <Card className="sticky bottom-4">
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-medium">
                    {format(parseISO(selectedSlot.slot_date), 'd MMMM', { locale: ru })}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedSlot.start_time.slice(0, 5)} • {selectedSlot.duration_min} мин
                  </p>
                </div>
                <Button onClick={() => setSelectedSlot(null)} variant="ghost" size="sm">
                  Изменить
                </Button>
              </div>
              <Button 
                className="w-full" 
                size="lg" 
                onClick={handleBook}
                disabled={booking}
              >
                {booking ? 'Записываемся...' : isAuthenticated ? 'Записаться' : 'Войти и записаться'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
