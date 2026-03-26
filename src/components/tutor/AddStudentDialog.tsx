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
import { Switch } from '@/components/ui/switch';
import { Copy, ExternalLink, Check, Loader2, Link, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { manualAddTutorStudent } from '@/lib/tutors';
import type { ManualAddTutorStudentInput, TutorGroup } from '@/types/tutor';

interface AddStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteCode: string | undefined;
  inviteWebLink: string;
  inviteTelegramLink: string;
  miniGroupsEnabled: boolean;
  groups: TutorGroup[];
  onCreateGroup: (name: string) => Promise<TutorGroup | null>;
  onSyncStudentMembership: (tutorStudentId: string, tutorGroupId: string | null) => Promise<void>;
  onManualAdded: (tutorStudentId: string) => void;
}

export function AddStudentDialog({
  open,
  onOpenChange,
  inviteCode,
  inviteWebLink,
  inviteTelegramLink,
  miniGroupsEnabled,
  groups,
  onCreateGroup,
  onSyncStudentMembership,
  onManualAdded,
}: AddStudentDialogProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Learning goal preset state
  const [learningGoalPreset, setLearningGoalPreset] = useState<string>('');
  const [learningGoalOther, setLearningGoalOther] = useState<string>('');
  const [isInMiniGroup, setIsInMiniGroup] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  // Form state for manual add
  const [formData, setFormData] = useState<ManualAddTutorStudentInput>({
    name: '',
    telegram_username: '',
    email: '',
    learning_goal: '',
    grade: undefined,
    exam_type: undefined,
    subject: undefined,
    start_score: undefined,
    target_score: undefined,
    notes: '',
    parent_contact: '',
    hourly_rate_cents: undefined,
  });

  const resetManualForm = () => {
    setFormData({
      name: '',
      telegram_username: '',
      email: '',
      learning_goal: '',
      grade: undefined,
      exam_type: undefined,
      subject: undefined,
      start_score: undefined,
      target_score: undefined,
      notes: '',
      parent_contact: '',
      hourly_rate_cents: undefined,
    });
    setLearningGoalPreset('');
    setLearningGoalOther('');
    setIsInMiniGroup(false);
    setSelectedGroupId('');
    setNewGroupName('');
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetManualForm();
    }
    onOpenChange(nextOpen);
  };

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

  const handleCreateMiniGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toast({ title: 'Введите название мини-группы', variant: 'destructive' });
      return;
    }

    setIsCreatingGroup(true);
    try {
      const createdGroup = await onCreateGroup(name);
      if (!createdGroup) {
        throw new Error('Не удалось создать мини-группу');
      }

      setSelectedGroupId(createdGroup.id);
      setNewGroupName('');
      toast({
        title: 'Мини-группа создана',
        description: `Выбрана группа "${createdGroup.short_name || createdGroup.name}"`,
      });
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: error instanceof Error ? error.message : 'Не удалось создать мини-группу',
        variant: 'destructive',
      });
    } finally {
      setIsCreatingGroup(false);
    }
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
    const hasEmail = formData.email?.trim();
    const hasTelegram = formData.telegram_username?.trim();
    if (!hasEmail && !hasTelegram) {
      toast({ title: 'Укажите email или Telegram ученика', variant: 'destructive' });
      return;
    }
    if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hasEmail)) {
      toast({ title: 'Некорректный формат email', variant: 'destructive' });
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
    if (!formData.hourly_rate_cents) {
      toast({ title: 'Укажите часовую ставку', variant: 'destructive' });
      return;
    }
    if (miniGroupsEnabled && isInMiniGroup && !selectedGroupId) {
      toast({
        title: 'Выберите мини-группу',
        description: 'При включенном тумблере нужно выбрать или создать группу',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await manualAddTutorStudent({
        ...formData,
        learning_goal: learningGoal,
        telegram_username: formData.telegram_username
          ? formData.telegram_username.replace('@', '').trim()
          : undefined,
        email: formData.email?.trim() || undefined,
      });

      let membershipSyncFailed = false;
      if (miniGroupsEnabled && isInMiniGroup && selectedGroupId) {
        try {
          await onSyncStudentMembership(response.tutor_student_id, selectedGroupId);
        } catch (membershipError) {
          console.error('Membership sync failed after student creation:', membershipError);
          membershipSyncFailed = true;
        }
      }

      toast({
        title: 'Ученик добавлен',
        description: membershipSyncFailed
          ? `${formData.name} добавлен. Привязку к группе повторите в профиле ученика.`
          : `${formData.name} успешно добавлен`,
        variant: membershipSyncFailed ? 'destructive' : 'default',
      });

      resetManualForm();

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
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
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
                    <Label htmlFor="student_email">Email ученика</Label>
                    <Input
                      id="student_email"
                      type="email"
                      value={formData.email || ''}
                      onChange={(e) =>
                        handleFormChange('email', e.target.value)
                      }
                      placeholder="student@example.com"
                      className="text-base"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="telegram_username">Telegram username</Label>
                    <Input
                      id="telegram_username"
                      value={formData.telegram_username || ''}
                      onChange={(e) =>
                        handleFormChange('telegram_username', e.target.value)
                      }
                      placeholder="@username"
                    />
                  </div>

                  <p className="text-xs text-muted-foreground md:col-span-2">
                    Заполните email или Telegram (или оба). Рекомендуем указать email — Telegram может быть недоступен
                  </p>

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

                  <div className="space-y-2">
                    <Label htmlFor="hourly_rate_top">Часовая ставка (₽/ч)</Label>
                    <Input
                      id="hourly_rate_top"
                      type="number"
                      min={0}
                      value={formData.hourly_rate_cents ? formData.hourly_rate_cents / 100 : ''}
                      onChange={(e) =>
                        handleFormChange(
                          'hourly_rate_cents',
                          e.target.value ? parseInt(e.target.value) * 100 : undefined
                        )
                      }
                      placeholder="например, 1500"
                      required
                    />
                    <p className="text-xs text-muted-foreground">Ставка за 60 минут. Используется в расписании.</p>
                  </div>

                  {miniGroupsEnabled && (
                    <div className="space-y-3 rounded-md border p-3 md:col-span-2">
                      <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <Label className="text-sm font-medium">Занимается в мини-группе</Label>
                          <p className="text-xs text-muted-foreground">
                            OFF: индивидуально, ON: ученик входит в выбранную группу
                          </p>
                        </div>
                        <Switch
                          checked={isInMiniGroup}
                          onCheckedChange={(checked) => {
                            setIsInMiniGroup(checked);
                            if (!checked) {
                              setSelectedGroupId('');
                            }
                          }}
                        />
                      </div>

                      {isInMiniGroup && (
                        <div className="space-y-3">
                          {groups.length > 0 && (
                            <div className="space-y-2">
                              <Label>Мини-группа</Label>
                              <Select
                                value={selectedGroupId || undefined}
                                onValueChange={(value) => setSelectedGroupId(value)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Выберите мини-группу" />
                                </SelectTrigger>
                                <SelectContent>
                                  {groups.map((group) => (
                                    <SelectItem key={group.id} value={group.id}>
                                      {group.short_name || group.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          <div className="space-y-2">
                            <Label htmlFor="newMiniGroupName">Быстрое создание мини-группы</Label>
                            <div className="flex gap-2">
                              <Input
                                id="newMiniGroupName"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                placeholder="Например, 11 класс ЕГЭ база"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleCreateMiniGroup}
                                disabled={isCreatingGroup}
                              >
                                {isCreatingGroup ? 'Создание...' : 'Создать'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
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
