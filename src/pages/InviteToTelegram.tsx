import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Copy, ExternalLink, MessageCircle, Check, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getTutorInviteTelegramLink } from '@/utils/telegramLinks';

interface TutorInfo {
  id: string;
  name: string;
  invite_code: string;
}

export default function InviteToTelegram() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const [tutor, setTutor] = useState<TutorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchTutor() {
      if (!inviteCode) {
        setError('Неверная ссылка');
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from('tutors')
          .select('id, name, invite_code')
          .eq('invite_code', inviteCode)
          .single();

        if (fetchError || !data) {
          setError('Ссылка недействительна или устарела');
          setLoading(false);
          return;
        }

        setTutor(data);
      } catch {
        setError('Ошибка при загрузке');
      } finally {
        setLoading(false);
      }
    }

    fetchTutor();
  }, [inviteCode]);

  const telegramLink = inviteCode ? getTutorInviteTelegramLink(inviteCode) : '';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(telegramLink);
      setCopied(true);
      toast.success('Ссылка скопирована');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const handleOpenTelegram = () => {
    window.open(telegramLink, '_blank');
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Skeleton className="h-8 w-48 mx-auto mb-2" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </CardHeader>
          <CardContent className="space-y-6">
            <Skeleton className="h-48 w-48 mx-auto" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error || !tutor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle className="text-destructive">Ошибка</CardTitle>
            <CardDescription>{error || 'Репетитор не найден'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                На главную
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <MessageCircle className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Подключиться к AI-помощнику</CardTitle>
          <CardDescription>
            Вас пригласил репетитор <strong>{tutor.name}</strong>
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Instructions */}
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-medium text-primary">1</span>
              </div>
              <p className="text-muted-foreground">
                Нажмите кнопку «Открыть Telegram» или отсканируйте QR-код
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-medium text-primary">2</span>
              </div>
              <p className="text-muted-foreground">
                Нажмите «Начать» в Telegram-боте Сократ
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-xs font-medium text-primary">3</span>
              </div>
              <p className="text-muted-foreground">
                Готово! Отправляйте фото задач и вопросы AI-помощнику
              </p>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex justify-center">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <QRCode
                value={telegramLink}
                size={180}
                level="M"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <Button 
              onClick={handleOpenTelegram} 
              className="w-full"
              size="lg"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Открыть Telegram
            </Button>
            
            <Button 
              onClick={handleCopyLink} 
              variant="outline" 
              className="w-full"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Скопировано
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Скопировать ссылку
                </>
              )}
            </Button>
          </div>

          {/* Footer */}
          <p className="text-xs text-center text-muted-foreground">
            Сократ — AI-помощник для подготовки к ЕГЭ и ОГЭ
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
