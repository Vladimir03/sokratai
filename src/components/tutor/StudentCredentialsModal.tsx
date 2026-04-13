import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

interface StudentCredentialsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentName: string;
  loginEmail: string;
  plainPassword: string;
}

const LOGIN_PAGE_URL = 'https://sokratai.ru/login';

export function StudentCredentialsModal({
  open,
  onOpenChange,
  studentName,
  loginEmail,
  plainPassword,
}: StudentCredentialsModalProps) {
  const { toast } = useToast();

  const formattedText = `Страница входа в платформу:\n${LOGIN_PAGE_URL}\n\nПочта от аккаунта:\n${loginEmail}\n\nПароль для входа:\n${plainPassword}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedText);
      toast({ title: 'Скопировано' });
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось скопировать данные для входа',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl p-6">
        <DialogHeader className="space-y-2 text-left">
          <DialogTitle>Данные для входа ученика</DialogTitle>
          <DialogDescription className="text-base text-slate-600">
            Отправьте данные ученику {studentName} или покажите их на уроке.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-base">
          <div className="space-y-1">
            <p className="font-medium text-slate-700">Страница входа</p>
            <p className="break-all text-slate-900">{LOGIN_PAGE_URL}</p>
          </div>

          <div className="space-y-1">
            <p className="font-medium text-slate-700">Почта</p>
            <p className="break-all text-slate-900">{loginEmail}</p>
          </div>

          <div className="space-y-1">
            <p className="font-medium text-slate-700">Пароль</p>
            <p className="font-mono text-2xl font-bold tracking-wide text-slate-900">
              {plainPassword}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="w-full border-slate-200 bg-white text-base text-slate-700 touch-manipulation sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Закрыть
          </Button>
          <Button
            type="button"
            className="w-full bg-accent text-base text-white hover:bg-accent/90 touch-manipulation sm:w-auto"
            onClick={handleCopy}
          >
            <Copy className="h-4 w-4" />
            Скопировать для отправки
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
