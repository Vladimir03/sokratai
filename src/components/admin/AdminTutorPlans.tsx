import { useCallback, useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";
import {
  listTutorPlans,
  grantTutorPlan,
  revokeTutorPlan,
  type AdminTutorPlanRow,
} from "@/lib/adminTutorPlansApi";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RefreshCw, ShieldCheck, ShieldAlert, Users, Info } from "lucide-react";

function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function defaultGrantDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 180);
  return d;
}

/** End of the picked local day, as ISO — what we store in subscription_expires_at. */
function endOfDayISO(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString();
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "d MMM yyyy", { locale: ru });
  } catch {
    return "—";
  }
}

function statusInfo(row: AdminTutorPlanRow): { label: string; tone: "paid" | "trial" | "none" } {
  const now = Date.now();
  const premiumValid =
    row.subscription_tier === "premium" &&
    (!row.subscription_expires_at || parseISO(row.subscription_expires_at).getTime() > now);
  if (premiumValid) {
    return {
      label: row.subscription_expires_at
        ? `Премиум до ${fmtDate(row.subscription_expires_at)}`
        : "Премиум (бессрочно)",
      tone: "paid",
    };
  }
  const trialValid =
    !!row.trial_ends_at && parseISO(row.trial_ends_at).getTime() > now;
  if (trialValid) {
    return { label: `Триал до ${fmtDate(row.trial_ends_at)}`, tone: "trial" };
  }
  return { label: "Не оплачен", tone: "none" };
}

const TONE_CLASS: Record<"paid" | "trial" | "none", string> = {
  paid: "bg-emerald-100 text-emerald-900",
  trial: "bg-amber-100 text-amber-900",
  none: "bg-red-100 text-red-900",
};

/** Платящие первыми, затем триалы, затем остальные (RPC отдаёт наоборот — не трогаем, сортируем на клиенте). */
const TONE_RANK: Record<"paid" | "trial" | "none", number> = { paid: 0, trial: 1, none: 2 };

export function AdminTutorPlans() {
  const [rows, setRows] = useState<AdminTutorPlanRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [grantTarget, setGrantTarget] = useState<AdminTutorPlanRow | null>(null);
  const [grantDate, setGrantDate] = useState<Date | undefined>(undefined);
  const [grantNote, setGrantNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<AdminTutorPlanRow | null>(null);

  const today = useMemo(() => startOfToday(), []);

  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const rankDiff = TONE_RANK[statusInfo(a).tone] - TONE_RANK[statusInfo(b).tone];
        if (rankDiff !== 0) return rankDiff;
        if (a.active_students !== b.active_students) return b.active_students - a.active_students;
        return (a.name ?? "").localeCompare(b.name ?? "", "ru");
      }),
    [rows],
  );

  const fetchRows = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listTutorPlans();
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить список репетиторов.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const openGrant = (row: AdminTutorPlanRow) => {
    const prefill =
      row.subscription_tier === "premium" && row.subscription_expires_at
        ? parseISO(row.subscription_expires_at)
        : defaultGrantDate();
    setGrantDate(prefill);
    setGrantNote("");
    setGrantTarget(row);
  };

  const confirmGrant = async () => {
    if (!grantTarget || !grantTarget.email || !grantDate) return;
    setIsSaving(true);
    try {
      const res = await grantTutorPlan(grantTarget.email, endOfDayISO(grantDate), grantNote);
      toast.success(
        `Тариф выдан: ${res.name ?? grantTarget.name} до ${fmtDate(res.expires_at)}. ` +
          `Ученики получат 50 сообщений/день в ДЗ.`,
      );
      setGrantTarget(null);
      await fetchRows();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось выдать тариф.");
    } finally {
      setIsSaving(false);
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget || !revokeTarget.email) return;
    setIsSaving(true);
    try {
      await revokeTutorPlan(revokeTarget.email);
      toast.success(`Тариф снят: ${revokeTarget.name}.`);
      setRevokeTarget(null);
      await fetchRows();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось снять тариф.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Тарифы репетиторов</h2>
          <p className="text-sm text-muted-foreground">
            Премиум репетитора → его ученики получают 50 AI-сообщений в день в ДЗ (вместо 10).
          </p>
        </div>
        <Button variant="outline" onClick={fetchRows} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
          Обновить
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        <span>
          Автоматической оплаты тарифа репетитора пока нет — статус «оплачено» выдаётся здесь
          вручную. Каждое действие пишется в журнал (кто, кому, до какой даты).
        </span>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 p-4 text-destructive">{error}</div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 p-8 text-center text-muted-foreground">
          Репетиторов пока нет.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Репетитор</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 font-medium text-right">Учеников</th>
                <th className="px-4 py-3 font-medium text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((row) => {
                const st = statusInfo(row);
                const isPremium = row.subscription_tier === "premium" && st.tone === "paid";
                return (
                  <tr key={row.user_id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium text-slate-900">
                        {st.tone === "none" ? (
                          <ShieldAlert className="h-4 w-4 text-red-500" aria-hidden="true" />
                        ) : (
                          <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                        )}
                        {row.name}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.email ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[st.tone]}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        {row.active_students}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => openGrant(row)}>
                          {isPremium ? "Продлить" : "Выдать тариф"}
                        </Button>
                        {isPremium && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRevokeTarget(row)}
                          >
                            Снять
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Grant / extend dialog */}
      <Dialog open={grantTarget !== null} onOpenChange={(o) => !o && setGrantTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {grantTarget?.subscription_tier === "premium" ? "Продлить тариф" : "Выдать тариф"}
              {grantTarget ? ` — ${grantTarget.name}` : ""}
            </DialogTitle>
            <DialogDescription>
              Премиум до выбранной даты. Ученики ({grantTarget?.active_students ?? 0}) получат
              50 AI-сообщений в день в ДЗ.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Оплачено до</p>
              <div className="flex justify-center rounded-lg border border-slate-200 p-2">
                <Calendar
                  mode="single"
                  selected={grantDate}
                  onSelect={(d) => d && setGrantDate(d)}
                  disabled={(date) => date < today}
                  locale={ru}
                  className="p-0 pointer-events-auto"
                />
              </div>
              {grantDate && (
                <p className="mt-2 text-sm text-slate-600">
                  Действует до конца {format(grantDate, "d MMMM yyyy", { locale: ru })}.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="grant-note">
                Заметка (необязательно)
              </label>
              <Input
                id="grant-note"
                value={grantNote}
                onChange={(e) => setGrantNote(e.target.value)}
                placeholder="например: оплатила до ноября, 50 учеников"
                className="text-base"
                maxLength={300}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantTarget(null)} disabled={isSaving}>
              Отмена
            </Button>
            <Button onClick={confirmGrant} disabled={isSaving || !grantDate}>
              {isSaving ? "Сохраняю…" : "Выдать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <AlertDialog open={revokeTarget !== null} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Снять тариф у {revokeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Репетитор станет «free», а его ученики ({revokeTarget?.active_students ?? 0}) вернутся
              к лимиту 10 сообщений в день в ДЗ. Действие можно повторить позже.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRevoke();
              }}
              disabled={isSaving}
            >
              {isSaving ? "Снимаю…" : "Снять тариф"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default AdminTutorPlans;
