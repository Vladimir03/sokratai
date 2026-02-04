import { useState } from 'react';
import QRCode from 'react-qr-code';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Copy, ExternalLink, Check, Loader2, Link, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { manualAddTutorStudent } from '@/lib/tutors';
import type { ManualAddTutorStudentInput } from '@/types/tutor';

interface AddStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteCode: string | undefined;
  inviteWebLink: string;
  inviteTelegramLink: string;
  onManualAdded: (tutorStudentId: string) => void;
}

export function AddStudentDialog({
  open,
  onOpenChange,
  inviteCode,
  inviteWebLink,
  inviteTelegramLink,
  onManualAdded,
}: AddStudentDialogProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form state for manual add
  const [formData, setFormData] = useState<ManualAddTutorStudentInput>({
    name: '',
    telegram_username: '',
    learning_goal: '',
    grade: undefined,
    exam_type: undefined,
    subject: undefined,
    start_score: undefined,
    target_score: undefined,
    notes: '',
    parent_contact: '',
  });

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteWebLink);
      setCopied(true);
      toast({
        title: 'Ссылка скопирована',
        description: 'Отправьте её ученику',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось скопировать ссылку',
        variant: 'destructive',
      });
    }
  };

  const handleOpenTelegram = () => {
    window.open(inviteTelegramLink, '_blank');
  };

  const handleFormChange = (field: keyof ManualAddTutorStudentInput, value: string | number | undefined) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required fields
    if (!formData.name.trim()) {
      toast({ title: 'Введите имя ученика', variant: 'destructive' });
      return;
    }
    if (!formData.telegram_username.trim()) {
      toast({ title: 'Введите Telegram username', variant: 'destructive' });
      return;
    }
    if (!formData.learning_goal.trim()) {
      toast({ title: 'Введите цель обучения', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await manualAddTutorStudent({
        ...formData,
        telegram_username: formData.telegram_username.replace('@', '').trim(),
      });
      
      toast({
        title: 'Ученик добавлен',
        description: `${formData.name} успешно добавлен`,
      });
      
      // Reset form
      setFormData({
        name: '',
        telegram_username: '',
        learning_goal: '',
        grade: undefined,
        exam_type: undefined,
        subject: undefined,
        start_score: undefined,
        target_score: undefined,
        notes: '',
        parent_contact: '',
      });
      
      onOpenChange(false);
      onManualAdded(response.tutor_student_id);
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: error instanceof Error ? error.message : 'Не удалось добавить ученика',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить ученика</DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="link" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="link" className="flex items-center gap-2">
              <Link className="h-4 w-4" />
              По ссылке
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Вручную
            </TabsTrigger>
          </TabsList>
          
          {/* Tab: By Link */}
          <TabsContent value="link" className="space-y-4 mt-4">
            {inviteCode ? (
              <>
                <div className="flex justify-center p-4 bg-white rounded-lg">
                  <QRCode value={inviteTelegramLink} size={180} />
                </div>
                
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-2">
                    Код приглашения
                  </p>
                  <p className="text-xl font-mono font-bold tracking-wider">
                    {inviteCode}
                  </p>
                </div>
                
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleCopyLink}
                  >
                    {copied ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    {copied ? 'Скопировано!' : 'Копировать ссылку'}
                  </Button>
                  
                  <Button
                    className="w-full"
                    onClick={handleOpenTelegram}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Открыть в Telegram
                  </Button>
                </div>
                
                <p className="text-xs text-muted-foreground text-center">
                  Ученик перейдёт по ссылке и автоматически привяжется к вам
                </p>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Загрузка кода приглашения...
              </div>
            )}
          </TabsContent>
          
          {/* Tab: Manual */}
          <TabsContent value="manual" className="mt-4">
            <form onSubmit={handleManualSubmit} className="space-y-4">
              {/* Required fields */}
              <div className="space-y-3">
                <div>
                  <Label htmlFor="name">Имя ученика *</Label>
                  <Input
                    id="name"
                    placeholder="Иван Петров"
                    value={formData.name}
                    onChange={(e) => handleFormChange('name', e.target.value)}
                    required
                  />
                </div>
                
                <div>
                  <Label htmlFor="telegram_username">Telegram username *</Label>
                  <Input
                    id="telegram_username"
                    placeholder="@username"
                    value={formData.telegram_username}
                    onChange={(e) => handleFormChange('telegram_username', e.target.value)}
                    required
                  />
                </div>
                
                <div>
                  <Label htmlFor="learning_goal">Цель обучения *</Label>
                  <Input
                    id="learning_goal"
                    placeholder="Подготовка к ЕГЭ"
                    value={formData.learning_goal}
                    onChange={(e) => handleFormChange('learning_goal', e.target.value)}
                    required
                  />
                </div>
              </div>
              
              {/* Optional fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="grade">Класс</Label>
                  <Select
                    value={formData.grade?.toString() || ''}
                    onValueChange={(v) => handleFormChange('grade', v ? parseInt(v) : undefined)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите" />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 6, 7, 8, 9, 10, 11].map((g) => (
                        <SelectItem key={g} value={g.toString()}>
                          {g} класс
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="exam_type">Экзамен</Label>
                  <Select
                    value={formData.exam_type || ''}
                    onValueChange={(v) => handleFormChange('exam_type', v || undefined)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ege">ЕГЭ</SelectItem>
                      <SelectItem value="oge">ОГЭ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div>
                <Label htmlFor="subject">Предмет</Label>
                <Input
                  id="subject"
                  placeholder="Математика"
                  value={formData.subject || ''}
                  onChange={(e) => handleFormChange('subject', e.target.value || undefined)}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="start_score">Начальный балл</Label>
                  <Input
                    id="start_score"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0"
                    value={formData.start_score ?? ''}
                    onChange={(e) => handleFormChange('start_score', e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                </div>
                
                <div>
                  <Label htmlFor="target_score">Целевой балл</Label>
                  <Input
                    id="target_score"
                    type="number"
                    min={0}
                    max={100}
                    placeholder="100"
                    value={formData.target_score ?? ''}
                    onChange={(e) => handleFormChange('target_score', e.target.value ? parseInt(e.target.value) : undefined)}
                  />
                </div>
              </div>
              
              <div>
                <Label htmlFor="parent_contact">Контакт родителя</Label>
                <Input
                  id="parent_contact"
                  placeholder="+7 999 123-45-67 или @username"
                  value={formData.parent_contact || ''}
                  onChange={(e) => handleFormChange('parent_contact', e.target.value || undefined)}
                />
              </div>
              
              <div>
                <Label htmlFor="notes">Заметки</Label>
                <Textarea
                  id="notes"
                  placeholder="Дополнительная информация..."
                  value={formData.notes || ''}
                  onChange={(e) => handleFormChange('notes', e.target.value || undefined)}
                  rows={2}
                />
              </div>
              
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Добавление...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Добавить ученика
                  </>
                )}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
