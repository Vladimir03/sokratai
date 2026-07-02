import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Copy, Check, Link, UserPlus, AlertCircle, RefreshCw, Loader2, Users, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { StudentCredentialsModal } from '@/components/tutor/StudentCredentialsModal';
import {
  manualAddTutorStudent,
  bulkAddTutorStudents,
  createTutorGroup,
  upsertTutorGroupMembership,
} from '@/lib/tutors';
import { useTutor, useTutorGroups } from '@/hooks/useTutor';
import { supabase } from '@/lib/supabaseClient';
import { getTutorInviteWebLink } from '@/utils/telegramLinks';
import { pluralizeRu } from '@/lib/pluralizeRu';
import {
  addStudentToGroupFutureLessons,
  countGroupFutureLessons,
} from '@/lib/tutorScheduleGroupCreate';
import { invalidateGroupRosterCaches } from '@/lib/tutorStudentCacheSync';
import { AddToGroupLessonsPrompt } from '@/components/tutor/AddToGroupLessonsPrompt';
import type { ManualAddTutorStudentInput } from '@/types/tutor';

/**
 * Lightweight, RU-DPI-resilient fetch of the tutor's invite code.
 * Uses the dedicated SECURITY DEFINER RPC (generates the code if missing) with
 * a hard ~10s timeout — independent of the heavy ['tutor','profile'] query that
 * can stall for minutes and used to hang the «По ссылке» tab on «Загрузка…».
 */
async function fetchTutorInviteCode(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const { data, error } = await supabase
      .rpc('tutor_get_invite_code')
      .abortSignal(controller.signal);
    if (error) throw error;
    if (!data || typeof data !== 'string') {
      throw new Error('Пустой код приглашения');
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

interface AddStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteCode: string | undefined;
  inviteWebLink: string;
  inviteTelegramLink: string;
  onManualAdded: (tutorStudentId: string) => void;
}

type StudentCredentialsData = {
  studentName: string;
  loginEmail: string;
  plainPassword: string;
};

export function AddStudentDialog({
  open,
  onOpenChange,
  inviteCode,
  inviteWebLink,
  onManualAdded,
}: AddStudentDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Self-contained: диалог сам добывает мини-группы (единый UX на всех
  // поверхностях — главная / «Все ученики» не могут разойтись пропсами).
  // Ленивый фетч — только при открытой модалке (главная не тяжелеет).
  const { tutor } = useTutor();
  const miniGroupsEnabled = Boolean(tutor?.mini_groups_enabled ?? true);
  const { groups: allGroups } = useTutorGroups(miniGroupsEnabled && open);
  const groups = useMemo(() => allGroups.filter((g) => g.is_primary), [allGroups]);

  // Resilient invite-code fetch (decoupled from the slow tutor-profile query).
  // Seeds instantly from the prop on the happy path; falls back to the RPC
  // (with timeout + retry + error UI) when the profile is still stalled.
  const seededCode = inviteCode && inviteCode.trim() ? inviteCode : undefined;
  const inviteQuery = useQuery({
    queryKey: ['tutor', 'invite-code'],
    queryFn: fetchTutorInviteCode,
    enabled: open,
    initialData: seededCode,
    staleTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  });
  const resolvedInviteCode = inviteQuery.data ?? seededCode;
  const resolvedInviteWebLink = resolvedInviteCode
    ? getTutorInviteWebLink(resolvedInviteCode)
    : inviteWebLink;

  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [credentialsData, setCredentialsData] = useState<StudentCredentialsData | null>(null);
  const [pendingTutorStudentId, setPendingTutorStudentId] = useState<string | null>(null);
  // Roster-driven: после добавления нового ученика в учебную группу предлагаем
  // добавить его в её будущие занятия. finalize/credentials откладываются до
  // ответа на prompt (pending), чтобы диалог не закрылся раньше времени.
  const [groupLessonsPrompt, setGroupLessonsPrompt] = useState<{
    groupId: string;
    groupName: string;
    studentName: string;
    futureCount: number;
    pending: {
      response: Awaited<ReturnType<typeof manualAddTutorStudent>>;
      studentName: string;
      membershipSyncFailed: boolean;
      isPlaceholder: boolean;
    };
  } | null>(null);
  const [isAddingToGroupLessons, setIsAddingToGroupLessons] = useState(false);

  // Learning goal preset state
  const [learningGoalPreset, setLearningGoalPreset] = useState<string>('');
  const [learningGoalOther, setLearningGoalOther] = useState<string>('');
  const [isInMiniGroup, setIsInMiniGroup] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  // Онбординг v2 — массовое добавление по списку имён (контакт NULL).
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkNames, setBulkNames] = useState('');
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

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
    // Phase 8.1 (2026-05-20) — Pol ucenika для AI grammar conjugation.
    gender: null,
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
      gender: null,
    });
    setLearningGoalPreset('');
    setLearningGoalOther('');
    setIsInMiniGroup(false);
    setSelectedGroupId('');
    setNewGroupName('');
    setBulkMode(false);
    setBulkNames('');
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetManualForm();
      setCredentialsData(null);
      setPendingTutorStudentId(null);
    }
    onOpenChange(nextOpen);
  };

  const finalizeManualAdd = (tutorStudentId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['tutor', 'students'] });
    void queryClient.invalidateQueries({ queryKey: ['tutor', 'group-memberships'] });
    void queryClient.invalidateQueries({ queryKey: ['tutor', 'groups'] });
    setCredentialsData(null);
    setPendingTutorStudentId(null);
    resetManualForm();
    onOpenChange(false);
    onManualAdded(tutorStudentId);
  };

  // Пост-добавочная развилка (existing / плейсхолдер / показ credentials),
  // вынесена чтобы её можно было отложить за roster-driven prompt.
  const finalizeAfterAdd = (
    response: Awaited<ReturnType<typeof manualAddTutorStudent>>,
    studentName: string,
    membershipSyncFailed: boolean,
    isPlaceholder: boolean,
  ) => {
    if (response.existing) {
      toast({ title: 'Ученик уже зарегистрирован' });
      finalizeManualAdd(response.tutor_student_id);
      return;
    }
    if (membershipSyncFailed) {
      toast({
        title: 'Ученик добавлен',
        description: `${studentName} добавлен. Привязку к группе повторите в профиле ученика.`,
        variant: 'destructive',
      });
    }
    // Онбординг v2: плейсхолдер по имени (без реального контакта) — логин/пароль
    // бесполезны (temp-email), поэтому НЕ показываем StudentCredentialsModal.
    if (isPlaceholder || !response.login_email || !response.plain_password) {
      if (!membershipSyncFailed) {
        toast({
          title: 'Ученик добавлен',
          description: `${studentName} добавлен. Подключите его ссылкой при отправке первой домашки.`,
        });
      }
      finalizeManualAdd(response.tutor_student_id);
      return;
    }
    setPendingTutorStudentId(response.tutor_student_id);
    setCredentialsData({
      studentName,
      loginEmail: response.login_email,
      plainPassword: response.plain_password,
    });
  };

  const handleConfirmAddToGroupLessons = async () => {
    if (!groupLessonsPrompt) return;
    const { groupId, pending } = groupLessonsPrompt;
    setIsAddingToGroupLessons(true);
    try {
      const res = await addStudentToGroupFutureLessons(groupId, pending.response.tutor_student_id);
      if (res.ok) {
        toast({ title: `Добавлен в ${res.addedCount ?? 0} будущих занятий группы` });
        await invalidateGroupRosterCaches(queryClient);
      } else {
        toast({ title: 'Не удалось добавить в занятия', description: res.error, variant: 'destructive' });
      }
    } catch (e) {
      console.error(e);
      toast({ title: 'Ошибка при добавлении в занятия группы', variant: 'destructive' });
    } finally {
      setIsAddingToGroupLessons(false);
      setGroupLessonsPrompt(null);
      finalizeAfterAdd(pending.response, pending.studentName, pending.membershipSyncFailed, pending.isPlaceholder);
    }
  };

  const handleCancelAddToGroupLessons = () => {
    if (!groupLessonsPrompt) return;
    const { pending } = groupLessonsPrompt;
    setGroupLessonsPrompt(null);
    finalizeAfterAdd(pending.response, pending.studentName, pending.membershipSyncFailed, pending.isPlaceholder);
  };

  const handleCredentialsModalOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      return;
    }

    if (pendingTutorStudentId) {
      finalizeManualAdd(pendingTutorStudentId);
      return;
    }

    setCredentialsData(null);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(resolvedInviteWebLink);
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

  const handleCreateMiniGroup = async () => {
    const name = newGroupName.trim();
    if (!name) {
      toast({ title: 'Введите название мини-группы', variant: 'destructive' });
      return;
    }

    setIsCreatingGroup(true);
    try {
      // Из AddStudentDialog создаётся учебная (основная) группа → is_primary: true.
      const createdGroup = await createTutorGroup({ name, is_primary: true });
      if (!createdGroup) {
        throw new Error('Не удалось создать мини-группу');
      }
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'groups'] });

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

  const handleFormChange = (
    field: keyof ManualAddTutorStudentInput,
    value: string | number | null | undefined,
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleBulkSubmit = async () => {
    const names = bulkNames
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
    if (names.length === 0) {
      toast({ title: 'Введите хотя бы одно имя', variant: 'destructive' });
      return;
    }
    if (names.length > 50) {
      toast({ title: 'За раз не больше 50 имён', variant: 'destructive' });
      return;
    }
    if (miniGroupsEnabled && isInMiniGroup && !selectedGroupId) {
      toast({
        title: 'Выберите мини-группу',
        description: 'Чтобы добавить список в группу, выберите или создайте её',
        variant: 'destructive',
      });
      return;
    }

    setIsBulkSubmitting(true);
    try {
      const res = await bulkAddTutorStudents(names);
      const okN = res.created.length;
      const errN = res.errors.length;

      // Назначить весь добавленный список в выбранную группу (запрос владельца).
      let groupFailN = 0;
      if (miniGroupsEnabled && isInMiniGroup && selectedGroupId && okN > 0) {
        const results = await Promise.allSettled(
          res.created.map((c) => upsertTutorGroupMembership(c.tutor_student_id, selectedGroupId)),
        );
        // upsert возвращает false/null при сбое → любое falsy = неудача (review P1).
        groupFailN = results.filter(
          (r) => r.status === 'rejected' || !r.value,
        ).length;
      }

      void queryClient.invalidateQueries({ queryKey: ['tutor', 'students'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'group-memberships'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'groups'] });

      const descParts: string[] = [];
      if (errN > 0) descParts.push(`не удалось добавить: ${errN}`);
      if (groupFailN > 0) descParts.push(`в группу не попали: ${groupFailN}`);
      const desc =
        descParts.length > 0
          ? descParts.join(' · ')
          : isInMiniGroup && selectedGroupId
            ? 'Добавлены в группу. Подключите каждого ссылкой при первой домашке.'
            : 'Подключите их ссылкой при отправке первой домашки.';
      toast({
        title: `Добавлено ${okN} ${pluralizeRu(okN, ['ученик', 'ученика', 'учеников'])}`,
        description: desc,
        variant: errN > 0 || groupFailN > 0 ? 'destructive' : undefined,
      });
      if (okN > 0) {
        setBulkNames('');
        setIsInMiniGroup(false);
        setSelectedGroupId('');
        setBulkMode(false);
        onOpenChange(false);
      }
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: error instanceof Error ? error.message : 'Не удалось добавить учеников',
        variant: 'destructive',
      });
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  // Секция мини-группы — единый рендер для одиночного и bulk режима (без
  // grid-специфичных классов, чтобы работать в обоих контекстах).
  const renderMiniGroupSection = () => {
    if (!miniGroupsEnabled) return null;
    return (
      <div className="space-y-3 rounded-md border p-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Занимается в мини-группе</Label>
            <p className="text-xs text-muted-foreground">
              Выкл — занимается индивидуально · Вкл — входит в выбранную группу
            </p>
          </div>
          <Switch
            checked={isInMiniGroup}
            onCheckedChange={(checked) => {
              setIsInMiniGroup(checked);
              if (!checked) setSelectedGroupId('');
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
                  <SelectTrigger className="text-base">
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
                  className="text-base"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCreateMiniGroup}
                  disabled={isCreatingGroup}
                >
                  {isCreatingGroup ? 'Создание…' : 'Создать'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
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
    // Онбординг v2 (rule 60): контакт БОЛЬШЕ НЕ обязателен. Имя — единственный
    // обязательный gate; канал понадобится только перед первой отправкой ДЗ.
    if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hasEmail)) {
      toast({ title: 'Некорректный формат email', variant: 'destructive' });
      return;
    }
    // Цель занятий и часовая ставка теперь необязательны (решение Vladimir
    // 2026-06-07). Обязательны только имя + один контакт (email/telegram, выше).
    if (learningGoalPreset === 'other' && !learningGoalOther.trim()) {
      toast({ title: 'Опишите цель занятий', variant: 'destructive' });
      return;
    }
    if (miniGroupsEnabled && isInMiniGroup && !selectedGroupId) {
      toast({
        title: 'Выберите мини-группу',
        description: 'Чтобы добавить ученика в группу, выберите или создайте её',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const studentName = formData.name.trim();
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
          const synced = await upsertTutorGroupMembership(response.tutor_student_id, selectedGroupId);
          if (!synced) membershipSyncFailed = true;
        } catch (membershipError) {
          console.error('Membership sync failed after student creation:', membershipError);
          membershipSyncFailed = true;
        }
      }

      const isPlaceholder = !hasEmail && !hasTelegram;

      // Roster-driven: новый ученик добавлен в учебную группу с будущими занятиями
      // → предложить добавить его и в них. finalize/credentials откладываем до
      // ответа на prompt (существующий / тег / сбой привязки — без prompt, как раньше).
      if (!response.existing && miniGroupsEnabled && isInMiniGroup && selectedGroupId && !membershipSyncFailed) {
        let futureCount = 0;
        try {
          futureCount = await countGroupFutureLessons(selectedGroupId);
        } catch (countErr) {
          console.error('countGroupFutureLessons failed:', countErr);
        }
        if (futureCount > 0) {
          const group = groups.find((g) => g.id === selectedGroupId);
          setGroupLessonsPrompt({
            groupId: selectedGroupId,
            groupName: group?.short_name || group?.name || 'группа',
            studentName,
            futureCount,
            pending: { response, studentName, membershipSyncFailed, isPlaceholder },
          });
          return;
        }
      }

      finalizeAfterAdd(response, studentName, membershipSyncFailed, isPlaceholder);
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
    <>
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
            {resolvedInviteCode ? (
              <>
                <div className="flex justify-center p-4 bg-white rounded-lg">
                  <QRCode value={resolvedInviteWebLink} size={180} />
                </div>

                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-2">
                    Код приглашения
                  </p>
                  <p className="text-xl font-mono font-bold tracking-wider">
                    {resolvedInviteCode}
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
            ) : inviteQuery.isError ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <AlertCircle className="h-8 w-8 text-amber-500" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Не удалось загрузить ссылку-приглашение. Проверьте соединение и попробуйте ещё раз.
                </p>
                <Button
                  variant="outline"
                  onClick={() => void inviteQuery.refetch()}
                  disabled={inviteQuery.isFetching}
                  style={{ touchAction: 'manipulation' }}
                >
                  <RefreshCw
                    className={`mr-2 h-4 w-4 ${inviteQuery.isFetching ? 'animate-spin' : ''}`}
                  />
                  Повторить
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                <span className="text-sm">Загрузка кода приглашения…</span>
              </div>
            )}
          </TabsContent>
          
          {/* Tab: Manual */}
          <TabsContent value="manual" className="mt-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <DialogDescription className="m-0">
                {bulkMode
                  ? 'Добавьте сразу несколько учеников — по одному имени на строку. Контакты и подключение — позже.'
                  : 'Обязательно — только имя. Контакт (email или Telegram) можно добавить позже.'}
              </DialogDescription>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => setBulkMode((v) => !v)}
                style={{ touchAction: 'manipulation' }}
              >
                {bulkMode ? (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Одного
                  </>
                ) : (
                  <>
                    <Users className="mr-2 h-4 w-4" />
                    Списком имён
                  </>
                )}
              </Button>
            </div>

            {bulkMode ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bulk_names">Имена учеников</Label>
                  <Textarea
                    id="bulk_names"
                    value={bulkNames}
                    onChange={(e) => setBulkNames(e.target.value)}
                    rows={8}
                    className="text-base"
                    placeholder={'Иван Петров\nМария Иванова\nПётр Сидоров'}
                  />
                  <p className="text-xs text-muted-foreground">
                    По одному имени на строку, до 50. Контакты добавите позже — каждого подключите ссылкой при первой домашке.
                  </p>
                </div>

                {renderMiniGroupSection()}

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleDialogOpenChange(false)}
                    disabled={isBulkSubmitting}
                  >
                    Отмена
                  </Button>
                  <Button type="button" onClick={handleBulkSubmit} disabled={isBulkSubmitting}>
                    {isBulkSubmitting ? 'Добавление…' : 'Добавить учеников'}
                  </Button>
                </div>
              </div>
            ) : (
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
                      onInvalid={(e) => (e.target as HTMLInputElement).setCustomValidity('Пожалуйста, заполните это поле')}
                      onInput={(e) => (e.target as HTMLInputElement).setCustomValidity('')}
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

                  <div className="md:col-span-2 space-y-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Без контакта — это нормально
                    </span>
                    <p className="text-xs text-muted-foreground">
                      Контакт (email или Telegram) понадобится только перед первой отправкой домашки — тогда подключите ученика ссылкой или QR. Рекомендуем email: Telegram может быть недоступен.
                    </p>
                  </div>

                </div>

                {renderMiniGroupSection()}

                <Accordion type="single" collapsible>
                  <AccordionItem value="optional">
                    <AccordionTrigger>Дополнительно</AccordionTrigger>
                    <AccordionContent>
                      <div className="grid gap-4 md:grid-cols-2">
                        {/* Цель занятий — опционально */}
                        <div className="space-y-2">
                          <Label>Цель занятий</Label>
                          <Select
                            value={learningGoalPreset || undefined}
                            onValueChange={(value) => setLearningGoalPreset(value)}
                          >
                            <SelectTrigger className="text-base">
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
                              className="text-base"
                            />
                          </div>
                        )}

                        {/* Часовая ставка — опционально (для расписания/оплат) */}
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
                                e.target.value ? parseInt(e.target.value) * 100 : undefined,
                              )
                            }
                            placeholder="например, 1500"
                            className="text-base"
                          />
                          <p className="text-xs text-muted-foreground">Ставка за 60 минут. Используется в расписании.</p>
                        </div>

                        {/* Пол ученика (Phase 8.1) — для AI grammar conjugation.
                            Полезно для иностранных имён (Anastasiia, Marie). */}
                        <div className="space-y-2">
                          <Label htmlFor="manual_student_gender">Пол ученика</Label>
                          <select
                            id="manual_student_gender"
                            value={formData.gender ?? ''}
                            onChange={(e) =>
                              handleFormChange(
                                'gender',
                                (e.target.value === 'male' || e.target.value === 'female')
                                  ? e.target.value
                                  : null,
                              )
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="">Не указано</option>
                            <option value="female">Женский</option>
                            <option value="male">Мужской</option>
                          </select>
                          <p className="text-xs text-muted-foreground">
                            Помогает AI правильно склонять глаголы («ты подставила» / «ты подставил»).
                          </p>
                        </div>

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
                            <SelectTrigger className="text-base">
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
                          className="text-base"
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleDialogOpenChange(false)}
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
            )}
          </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {credentialsData && (
        <StudentCredentialsModal
          open={Boolean(credentialsData)}
          onOpenChange={handleCredentialsModalOpenChange}
          studentName={credentialsData.studentName}
          loginEmail={credentialsData.loginEmail}
          plainPassword={credentialsData.plainPassword}
        />
      )}

      <AddToGroupLessonsPrompt
        open={!!groupLessonsPrompt}
        studentName={groupLessonsPrompt?.studentName ?? ''}
        groupName={groupLessonsPrompt?.groupName ?? ''}
        futureCount={groupLessonsPrompt?.futureCount ?? 0}
        isSubmitting={isAddingToGroupLessons}
        onConfirm={handleConfirmAddToGroupLessons}
        onCancel={handleCancelAddToGroupLessons}
      />
    </>
  );
}
