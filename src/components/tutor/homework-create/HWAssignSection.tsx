import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Copy, Search, Check, ExternalLink, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTutorStudents } from '@/hooks/useTutor';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import type { TutorGroupWithMembers } from '@/hooks/useTutorGroups';

type AssignTab = 'groups' | 'students';

function setsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function buildGroupUnionStudentIds(
  groups: TutorGroupWithMembers[],
  selectedGroupIds: Set<string>,
  studentIdByTutorStudentId: Map<string, string>,
): Set<string> {
  const result = new Set<string>();
  for (const group of groups) {
    if (!selectedGroupIds.has(group.id)) continue;
    for (const member of group.members) {
      if (!member.is_active) continue;
      const studentId = studentIdByTutorStudentId.get(member.tutor_student_id);
      if (studentId) {
        result.add(studentId);
      }
    }
  }
  return result;
}

function normalizeGroupSelection(params: {
  groups: TutorGroupWithMembers[];
  selectedGroupIds: Set<string>;
  manuallyRemovedIds: Set<string>;
  manuallyAddedIds: Set<string>;
  studentIdByTutorStudentId: Map<string, string>;
}) {
  const {
    groups,
    selectedGroupIds,
    manuallyRemovedIds,
    manuallyAddedIds,
    studentIdByTutorStudentId,
  } = params;

  const groupUnion = buildGroupUnionStudentIds(
    groups,
    selectedGroupIds,
    studentIdByTutorStudentId,
  );

  const normalizedRemoved = new Set(
    [...manuallyRemovedIds].filter((studentId) => groupUnion.has(studentId)),
  );
  const normalizedAdded = new Set(
    [...manuallyAddedIds].filter((studentId) => !groupUnion.has(studentId)),
  );

  const resolved = new Set(groupUnion);
  for (const studentId of normalizedRemoved) {
    resolved.delete(studentId);
  }
  for (const studentId of normalizedAdded) {
    resolved.add(studentId);
  }

  return {
    groupUnion,
    normalizedRemoved,
    normalizedAdded,
    resolved,
  };
}

function getStudentDisplayName(student: {
  display_name: string | null;
  student_id: string;
  profiles?: {
    username?: string | null;
    telegram_username?: string | null;
  } | null;
}): string {
  if (student.display_name?.trim()) return student.display_name.trim();
  if (student.profiles?.username?.trim()) return student.profiles.username.trim();
  if (student.profiles?.telegram_username?.trim()) {
    return `@${student.profiles.telegram_username.replace(/^@/, '')}`;
  }
  return student.student_id;
}

export interface HWAssignSectionProps {
  selectedIds: Set<string>;
  onChangeSelected: (selection: Set<string>) => void;
  notifyEnabled: boolean;
  onNotifyChange: (value: boolean) => void;
  notifyTemplate: string;
  onTemplateChange: (value: string) => void;
  errors: Record<string, string>;
  miniGroupsEnabled: boolean;
  assignTab: AssignTab;
  onAssignTabChange: (tab: AssignTab) => void;
  onSelectionInteraction?: () => void;
  groups: TutorGroupWithMembers[];
  groupsLoading?: boolean;
  groupsError?: string | null;
  onGroupsRetry?: () => void;
  groupsIsFetching?: boolean;
  groupsIsRecovering?: boolean;
  groupsFailureCount?: number;
  selectedGroupIds: Set<string>;
  onSelectedGroupIdsChange: (groupIds: Set<string>) => void;
  manuallyRemovedIds: Set<string>;
  onManuallyRemovedIdsChange: (studentIds: Set<string>) => void;
  manuallyAddedIds: Set<string>;
  onManuallyAddedIdsChange: (studentIds: Set<string>) => void;
  inviteWebLink: string;
  studentLoginLink: string;
  studentSignupLink: string;
  existingStudentIds?: Set<string>;
  hideNotify?: boolean;
}

export function HWAssignSection({
  selectedIds,
  onChangeSelected,
  notifyEnabled,
  onNotifyChange,
  notifyTemplate,
  onTemplateChange,
  errors,
  miniGroupsEnabled,
  assignTab,
  onAssignTabChange,
  onSelectionInteraction,
  groups,
  groupsLoading = false,
  groupsError = null,
  onGroupsRetry,
  groupsIsFetching = false,
  groupsIsRecovering = false,
  groupsFailureCount = 0,
  selectedGroupIds,
  onSelectedGroupIdsChange,
  manuallyRemovedIds,
  onManuallyRemovedIdsChange,
  manuallyAddedIds,
  onManuallyAddedIdsChange,
  inviteWebLink,
  studentLoginLink,
  studentSignupLink,
  existingStudentIds,
  hideNotify,
}: HWAssignSectionProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const {
    students,
    loading,
    error,
    refetch,
    isFetching,
    isRecovering,
    failureCount,
  } = useTutorStudents();

  const lockedStudentIds = useMemo(
    () => existingStudentIds ?? new Set<string>(),
    [existingStudentIds],
  );
  const hasLockedStudents = lockedStudentIds.size > 0;

  const preserveLockedSelection = useCallback(
    (nextSelection: Set<string>) => {
      if (!hasLockedStudents) return nextSelection;
      const next = new Set(nextSelection);
      for (const id of lockedStudentIds) {
        next.add(id);
      }
      return next;
    },
    [hasLockedStudents, lockedStudentIds],
  );

  const studentIdByTutorStudentId = useMemo(() => {
    const next = new Map<string, string>();
    for (const student of students) {
      next.set(student.id, student.student_id);
    }
    return next;
  }, [students]);

  const groupSelection = useMemo(
    () =>
      normalizeGroupSelection({
        groups,
        selectedGroupIds,
        manuallyRemovedIds,
        manuallyAddedIds,
        studentIdByTutorStudentId,
      }),
    [
      groups,
      selectedGroupIds,
      manuallyRemovedIds,
      manuallyAddedIds,
      studentIdByTutorStudentId,
    ],
  );

  useEffect(() => {
    if (!miniGroupsEnabled || selectedGroupIds.size === 0) return;

    if (!setsEqual(groupSelection.normalizedRemoved, manuallyRemovedIds)) {
      onManuallyRemovedIdsChange(groupSelection.normalizedRemoved);
    }
    if (!setsEqual(groupSelection.normalizedAdded, manuallyAddedIds)) {
      onManuallyAddedIdsChange(groupSelection.normalizedAdded);
    }

    const nextSelection = preserveLockedSelection(groupSelection.resolved);
    if (!setsEqual(nextSelection, selectedIds)) {
      onChangeSelected(nextSelection);
    }
  }, [
    miniGroupsEnabled,
    selectedGroupIds,
    groupSelection,
    manuallyRemovedIds,
    manuallyAddedIds,
    onManuallyRemovedIdsChange,
    onManuallyAddedIdsChange,
    preserveLockedSelection,
    selectedIds,
    onChangeSelected,
  ]);

  const filteredStudents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return students;

    return students.filter((student) => {
      const name = getStudentDisplayName(student).toLowerCase();
      const telegram = (student.profiles?.telegram_username ?? '').toLowerCase();
      return name.includes(query) || telegram.includes(query);
    });
  }, [students, searchQuery]);

  const selectedStudents = useMemo(
    () => students.filter((student) => selectedIds.has(student.student_id)),
    [students, selectedIds],
  );

  const selectedWithoutTelegramStudents = useMemo(
    () =>
      students.filter(
        (student) =>
          selectedIds.has(student.student_id) && !student.profiles?.telegram_user_id,
      ),
    [students, selectedIds],
  );

  const selectedWithoutTelegramPreview = useMemo(() => {
    if (selectedWithoutTelegramStudents.length === 0) return '';
    const names = selectedWithoutTelegramStudents
      .slice(0, 3)
      .map((student) => getStudentDisplayName(student));
    const suffix = selectedWithoutTelegramStudents.length > 3 ? '...' : '';
    return `${names.join(', ')}${suffix}`;
  }, [selectedWithoutTelegramStudents]);

  const handleCopyInviteLink = useCallback(async () => {
    if (!inviteWebLink) return;
    try {
      await navigator.clipboard.writeText(inviteWebLink);
      setInviteCopied(true);
      toast.success('Ссылка приглашения скопирована');
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать ссылку приглашения');
    }
  }, [inviteWebLink]);

  const commitGroupSelection = useCallback(
    (
      nextSelectedGroupIds: Set<string>,
      nextManuallyRemovedIds: Set<string>,
      nextManuallyAddedIds: Set<string>,
    ) => {
      const nextSelection = normalizeGroupSelection({
        groups,
        selectedGroupIds: nextSelectedGroupIds,
        manuallyRemovedIds: nextManuallyRemovedIds,
        manuallyAddedIds: nextManuallyAddedIds,
        studentIdByTutorStudentId,
      });

      onSelectedGroupIdsChange(nextSelectedGroupIds);
      onManuallyRemovedIdsChange(nextSelection.normalizedRemoved);
      onManuallyAddedIdsChange(nextSelection.normalizedAdded);
      onChangeSelected(preserveLockedSelection(nextSelection.resolved));
    },
    [
      groups,
      onSelectedGroupIdsChange,
      onManuallyRemovedIdsChange,
      onManuallyAddedIdsChange,
      onChangeSelected,
      preserveLockedSelection,
      studentIdByTutorStudentId,
    ],
  );

  const handleGroupToggle = useCallback(
    (groupId: string) => {
      onSelectionInteraction?.();

      const nextSelectedGroupIds = new Set(selectedGroupIds);
      if (nextSelectedGroupIds.has(groupId)) {
        nextSelectedGroupIds.delete(groupId);
      } else {
        nextSelectedGroupIds.add(groupId);
      }

      const nextGroupUnion = buildGroupUnionStudentIds(
        groups,
        nextSelectedGroupIds,
        studentIdByTutorStudentId,
      );

      const nextManuallyRemovedIds =
        selectedGroupIds.size === 0
          ? new Set<string>()
          : new Set(manuallyRemovedIds);
      const nextManuallyAddedIds =
        selectedGroupIds.size === 0
          ? new Set(
              [...selectedIds].filter(
                (studentId) => !nextGroupUnion.has(studentId),
              ),
            )
          : new Set(manuallyAddedIds);

      commitGroupSelection(
        nextSelectedGroupIds,
        nextManuallyRemovedIds,
        nextManuallyAddedIds,
      );
    },
    [
      selectedGroupIds,
      groups,
      studentIdByTutorStudentId,
      manuallyRemovedIds,
      manuallyAddedIds,
      selectedIds,
      onSelectionInteraction,
      commitGroupSelection,
    ],
  );

  const handleStudentToggle = useCallback(
    (studentId: string) => {
      if (selectedGroupIds.size === 0) {
        onSelectionInteraction?.();
        const nextSelection = new Set(selectedIds);
        if (nextSelection.has(studentId)) {
          nextSelection.delete(studentId);
        } else {
          nextSelection.add(studentId);
        }
        onChangeSelected(preserveLockedSelection(nextSelection));
        return;
      }

      const nextManuallyRemovedIds = new Set(groupSelection.normalizedRemoved);
      const nextManuallyAddedIds = new Set(groupSelection.normalizedAdded);
      const isGroupStudent = groupSelection.groupUnion.has(studentId);
      const isSelected = selectedIds.has(studentId);

      onSelectionInteraction?.();

      if (isGroupStudent) {
        if (isSelected) {
          nextManuallyRemovedIds.add(studentId);
        } else {
          nextManuallyRemovedIds.delete(studentId);
        }
      } else if (isSelected) {
        nextManuallyAddedIds.delete(studentId);
      } else {
        nextManuallyAddedIds.add(studentId);
      }

      commitGroupSelection(
        new Set(selectedGroupIds),
        nextManuallyRemovedIds,
        nextManuallyAddedIds,
      );
    },
    [
      selectedGroupIds,
      selectedIds,
      onChangeSelected,
      preserveLockedSelection,
      groupSelection,
      onSelectionInteraction,
      commitGroupSelection,
    ],
  );

  const handleSelectAll = useCallback(() => {
    if (selectedGroupIds.size === 0) {
      onSelectionInteraction?.();
      onChangeSelected(
        preserveLockedSelection(new Set(students.map((student) => student.student_id))),
      );
      return;
    }

    onSelectionInteraction?.();

    const nextManuallyAddedIds = new Set(
      students
        .map((student) => student.student_id)
        .filter((studentId) => !groupSelection.groupUnion.has(studentId)),
    );

    commitGroupSelection(
      new Set(selectedGroupIds),
      new Set<string>(),
      nextManuallyAddedIds,
    );
  }, [
    selectedGroupIds,
    onChangeSelected,
    preserveLockedSelection,
    students,
    groupSelection.groupUnion,
    onSelectionInteraction,
    commitGroupSelection,
  ]);

  const handleDeselectAll = useCallback(() => {
    if (selectedGroupIds.size === 0) {
      onSelectionInteraction?.();
      onChangeSelected(preserveLockedSelection(new Set()));
      return;
    }

    onSelectionInteraction?.();

    const nextManuallyRemovedIds = new Set(
      [...groupSelection.groupUnion].filter((studentId) => !lockedStudentIds.has(studentId)),
    );

    commitGroupSelection(
      new Set(selectedGroupIds),
      nextManuallyRemovedIds,
      new Set<string>(),
    );
  }, [
    selectedGroupIds,
    onChangeSelected,
    preserveLockedSelection,
    groupSelection.groupUnion,
    lockedStudentIds,
    onSelectionInteraction,
    commitGroupSelection,
  ]);

  const handleRemoveSelectedStudent = useCallback(
    (studentId: string) => {
      if (lockedStudentIds.has(studentId)) return;
      handleStudentToggle(studentId);
    },
    [lockedStudentIds, handleStudentToggle],
  );

  const selectedGroupCards = useMemo(
    () => groups.filter((group) => selectedGroupIds.has(group.id)),
    [groups, selectedGroupIds],
  );

  const hasManualGroupAdjustments =
    manuallyRemovedIds.size > 0 || manuallyAddedIds.size > 0;

  return (
    <div className="space-y-6">
      {miniGroupsEnabled ? (
        <Tabs
          value={assignTab}
          onValueChange={(value) => onAssignTabChange(value as AssignTab)}
          className="space-y-4"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="groups">Группы</TabsTrigger>
            <TabsTrigger value="students">Ученики</TabsTrigger>
          </TabsList>

          {assignTab === 'groups' && (
            <div className="space-y-4">
              <TutorDataStatus
                error={groupsError}
                isFetching={groupsIsFetching}
                isRecovering={groupsIsRecovering}
                failureCount={groupsFailureCount}
                onRetry={onGroupsRetry ?? (() => {})}
              />

              {groupsLoading && groups.length === 0 ? (
                <div className="grid gap-3">
                  {[1, 2].map((index) => (
                    <Skeleton key={index} className="h-20 rounded-xl" />
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <Card className="bg-muted/30">
                  <CardContent className="py-6 text-sm text-muted-foreground">
                    Активных групп пока нет. Можно продолжить через вкладку «Ученики».
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-3">
                  {groups.map((group) => {
                    const activeMemberCount = group.members.filter((member) => member.is_active).length;
                    const isSelected = selectedGroupIds.has(group.id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => handleGroupToggle(group.id)}
                        className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent/5'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-slate-200"
                            style={{
                              backgroundColor:
                                group.color?.trim() || 'var(--accent)',
                            }}
                            aria-hidden="true"
                          />
                          <Users className="h-4 w-4 shrink-0 text-slate-500" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {group.short_name?.trim() || group.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {activeMemberCount} ученик(ов)
                            </p>
                          </div>
                          {isSelected && (
                            <Badge variant="secondary" className="shrink-0">
                              Выбрано
                            </Badge>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedGroupCards.length > 0 && (
                <Card className="border-slate-200">
                  <CardContent className="space-y-3 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Label className="text-base">Выбранные группы</Label>
                      {selectedGroupCards.map((group) => (
                        <Badge key={group.id} variant="secondary">
                          {group.short_name?.trim() || group.name}
                        </Badge>
                      ))}
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        Выбранные ученики: {selectedStudents.length}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {selectedStudents.map((student) => {
                          const isLocked = lockedStudentIds.has(student.student_id);
                          return (
                            <span
                              key={student.student_id}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs"
                            >
                              <span>{getStudentDisplayName(student)}</span>
                              {!isLocked && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSelectedStudent(student.student_id)}
                                  className="rounded-full p-0.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
                                  aria-label={`Убрать ${getStudentDisplayName(student)}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Можно убрать отдельных учеников или добавить других на вкладке «Ученики».
                    </p>

                    {hasManualGroupAdjustments && (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Состав изменён вручную. Связь с группой не сохранится в метаданных ДЗ.
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </Tabs>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label className="text-base">Ученики</Label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleSelectAll}>
              Выбрать всех
            </Button>
            <Button variant="outline" size="sm" onClick={handleDeselectAll}>
              {hasLockedStudents ? 'Снять новых' : 'Снять всех'}
            </Button>
          </div>
        </div>

        {errors._students && (
          <p className="text-sm text-destructive">{errors._students}</p>
        )}

        <TutorDataStatus
          error={error}
          isFetching={isFetching}
          isRecovering={isRecovering}
          failureCount={failureCount}
          onRetry={refetch}
        />

        {!loading && students.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск по имени или @username"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="pl-9 text-base"
            />
          </div>
        )}

        {loading && !students.length ? (
          <div className="space-y-2">
            {[1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <Card className="bg-muted/30">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                У вас пока нет учеников.{' '}
                <Link to="/tutor/students" className="text-primary underline">
                  Добавить ученика
                </Link>
              </p>
            </CardContent>
          </Card>
        ) : filteredStudents.length === 0 ? (
          <Card className="bg-muted/30">
            <CardContent className="py-6 text-center">
              <p className="text-sm text-muted-foreground">
                По запросу ничего не найдено.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="max-h-[360px] space-y-1 overflow-y-auto rounded-md border p-1">
            {filteredStudents.map((student) => {
              const checked = selectedIds.has(student.student_id);
              const displayName = getStudentDisplayName(student);
              const isTelegramConnected = Boolean(student.profiles?.telegram_user_id);
              const statusLabel =
                student.status === 'active'
                  ? null
                  : student.status === 'paused'
                    ? 'На паузе'
                    : 'Завершён';
              const isLocked = existingStudentIds?.has(student.student_id) ?? false;

              return (
                <label
                  key={student.student_id}
                  className={`flex items-center gap-3 rounded-md p-2.5 transition-colors ${
                    isLocked
                      ? 'cursor-default opacity-70'
                      : 'cursor-pointer hover:bg-muted/50'
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => handleStudentToggle(student.student_id)}
                    disabled={isLocked}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{displayName}</p>
                    {student.profiles?.telegram_username && (
                      <p className="truncate text-xs text-muted-foreground">
                        @{student.profiles.telegram_username}
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={isTelegramConnected ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {isTelegramConnected
                      ? 'Telegram подключен'
                      : 'Telegram не подключен'}
                  </Badge>
                  {statusLabel && (
                    <Badge variant="secondary" className="text-xs">
                      {statusLabel}
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        )}

        {hasLockedStudents && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="space-y-1 pt-4">
              <p className="text-sm font-medium">
                Уже назначенные ученики останутся в этом ДЗ
              </p>
              <p className="text-xs text-muted-foreground">
                В этой итерации можно только добавлять новых учеников. После сохранения
                им ДЗ отправится автоматически.
              </p>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Выбрано: {selectedIds.size} из {students.length}. Без Telegram:{' '}
          {selectedWithoutTelegramStudents.length}
        </p>

        {selectedWithoutTelegramStudents.length > 0 && (
          <Card className="border-amber-500/40 bg-amber-50/40">
            <CardContent className="space-y-3 pt-4">
              <p className="text-sm">
                У {selectedWithoutTelegramStudents.length} ученик(ов) нет Telegram-связки.
                ДЗ будет назначено в кабинет на сайте, но Telegram-уведомление не отправится.
              </p>
              {selectedWithoutTelegramPreview && (
                <p className="text-xs text-muted-foreground">
                  Без Telegram: {selectedWithoutTelegramPreview}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <a href={studentLoginLink} target="_blank" rel="noreferrer">
                    Вход ученика
                    <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={studentSignupLink} target="_blank" rel="noreferrer">
                    Регистрация ученика
                    <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
                {inviteWebLink && (
                  <>
                    <Button size="sm" variant="outline" onClick={handleCopyInviteLink}>
                      {inviteCopied ? (
                        <Check className="mr-1 h-3.5 w-3.5" />
                      ) : (
                        <Copy className="mr-1 h-3.5 w-3.5" />
                      )}
                      {inviteCopied ? 'Скопировано' : 'Копировать инвайт'}
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href={inviteWebLink} target="_blank" rel="noreferrer">
                        Страница приглашения
                        <ExternalLink className="ml-1 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {!hideNotify && (
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="notify-toggle" className="cursor-pointer text-base">
              Отправить уведомления в Telegram
            </Label>
            <Switch
              id="notify-toggle"
              checked={notifyEnabled}
              onCheckedChange={onNotifyChange}
            />
          </div>
          {notifyEnabled && (
            <div className="space-y-2">
              <Label htmlFor="notify-template" className="text-sm text-muted-foreground">
                Текст сообщения (необязательно, по умолчанию стандартный)
              </Label>
              <textarea
                id="notify-template"
                className="min-h-[60px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Новая домашка! Открой ссылку выше, чтобы начать."
                value={notifyTemplate}
                onChange={(event) => onTemplateChange(event.target.value)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
