import { useState } from 'react';
import QRCode from 'react-qr-code';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
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

  // Learning goal preset state
  const [learningGoalPreset, setLearningGoalPreset] = useState<string>('');
  const [learningGoalOther, setLearningGoalOther] = useState<string>('');

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

    // Determine learning goal from preset or custom input
    const learningGoal =
      learningGoalPreset === 'other' ? learningGoalOther : learningGoalPreset;

    // Validate required fields
    if (!formData.name.trim()) {
      toast({ title: 'Введите имя ученика', variant: 'destructive' });
      return;
    }
    if (!formData.telegram_username.trim()) {
      toast({ title: 'Введите Telegram username', variant: 'destructive' });
      return;
    }
    if (!learningGoal.trim()) {
      toast({ title: 'Выберите цель занятий', variant: 'destructive' });
      return;
    }
    if (learningGoalPreset === 'other' && !learningGoalOther.trim()) {
      toast({ title: 'Опишите цель занятий', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await manualAddTutorStudent({
        ...formData,
        learning_goal: learningGoal,
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
      setLearningGoalPreset('');
      setLearningGoalOther('');

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
      <DialogContent className="sm:max-w-2xl">
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
            <DialogDescription className="mb-4">
              Заполните данные ученика. Обязательные поля отмечены.
            </DialogDescription>

            <ScrollArea className="h-[60vh] pr-4">
              <form onSubmit={handleManualSubmit} className="space-y-6 py-2">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Имя ученика</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => handleFormChange('name', e.target.value)}
                      placeholder="Например, Иван"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="telegram_username">Telegram username</Label>
                    <Input
                      id="telegram_username"
                      value={formData.telegram_username}
                      onChange={(e) =>
                        handleFormChange('telegram_username', e.target.value)
                      }
                      placeholder="@username"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Цель занятий</Label>
                    <Select
                      value={learningGoalPreset || undefined}
                      onValueChange={(value) => setLearningGoalPreset(value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите цель" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ЕГЭ">ЕГЭ</SelectItem>
                        <SelectItem value="ОГЭ">ОГЭ</SelectItem>
                        <SelectItem value="Школьная программа">
                          Школьная программа
                        </SelectItem>
                        <SelectItem value="Олимпиада">Олимпиада</SelectItem>
                        <SelectItem value="other">Другое</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {learningGoalPreset === 'other' && (
                    <div className="space-y-2">
                      <Label htmlFor="learningGoalOther">Опишите цель</Label>
                      <Input
                        id="learningGoalOther"
                        value={learningGoalOther}
                        onChange={(e) => setLearningGoalOther(e.target.value)}
                        placeholder="Например, подготовка к олимпиаде"
                        required
                      />
                    </div>
                  )}
                </div>

                <Accordion type="single" collapsible>
                  <AccordionItem value="optional">
                    <AccordionTrigger>Дополнительные данные</AccordionTrigger>
                    <AccordionContent>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="parent_contact">Контакт родителя</Label>
                          <Input
                            id="parent_contact"
                            value={formData.parent_contact || ''}
                            onChange={(e) =>
                              handleFormChange(
                                'parent_contact',
                                e.target.value || undefined
                              )
                            }
                            placeholder="+7 999 123-45-67 или @telegram"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="grade">Класс</Label>
                          <Input
                            id="grade"
                            type="number"
                            min={1}
                            max={11}
                            value={formData.grade ?? ''}
                            onChange={(e) =>
                              handleFormChange(
                                'grade',
                                e.target.value ? parseInt(e.target.value) : undefined
                              )
                            }
                            placeholder="Например, 10"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Экзамен</Label>
                          <Select
                            value={formData.exam_type || undefined}
                            onValueChange={(value) =>
                              handleFormChange(
                                'exam_type',
                                value as 'ege' | 'oge' | undefined
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Не выбран" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ege">ЕГЭ</SelectItem>
                              <SelectItem value="oge">ОГЭ</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="subject">Предмет</Label>
                          <Input
                            id="subject"
                            value={formData.subject || ''}
                            onChange={(e) =>
                              handleFormChange(
                                'subject',
                                e.target.value || undefined
                              )
                            }
                            placeholder="Математика"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="start_score">Стартовый балл</Label>
                          <Input
                            id="start_score"
                            type="number"
                            min={0}
                            max={100}
                            value={formData.start_score ?? ''}
                            onChange={(e) =>
                              handleFormChange(
                                'start_score',
                                e.target.value ? parseInt(e.target.value) : undefined
                              )
                            }
                            placeholder="Например, 50"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="target_score">Целевой балл</Label>
                          <Input
                            id="target_score"
                            type="number"
                            min={0}
                            max={100}
                            value={formData.target_score ?? ''}
                            onChange={(e) =>
                              handleFormChange(
                                'target_score',
                                e.target.value ? parseInt(e.target.value) : undefined
                              )
                            }
                            placeholder="Например, 85"
                          />
                        </div>
                      </div>

                      <div className="space-y-2 mt-4">
                        <Label htmlFor="notes">Заметки</Label>
                        <Textarea
                          id="notes"
                          value={formData.notes || ''}
                          onChange={(e) =>
                            handleFormChange('notes', e.target.value || undefined)
                          }
                          placeholder="Дополнительные детали о ученике"
                          rows={3}
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    disabled={isSubmitting}
                  >
                    Отмена
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                </div>
              </form>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
