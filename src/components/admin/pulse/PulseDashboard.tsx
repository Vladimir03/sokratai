import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { PulseHeader } from "./PulseHeader";
import { PulsePreFunnel } from "./PulsePreFunnel";
import { PulseFunnel } from "./PulseFunnel";
import { PulseChannels } from "./PulseChannels";
import { PulseAtRisk } from "./PulseAtRisk";
import { EditTutorTagsDialog, type TutorTagsValues } from "./EditTutorTagsDialog";
import type { PulseAtRiskTutor, PulsePayload } from "./pulseTypes";

/**
 * «Пульс» — CEO-дашборд: шапка здоровья, воронка активации поимённо,
 * каналы привлечения, зона риска. Данные — edge `admin-ceo-dashboard`
 * (агрегация в _shared/ceo-pulse.ts, переиспользуется Telegram-дайджестом).
 */
export const PulseDashboard = () => {
  const [data, setData] = useState<PulsePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<TutorTagsValues | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: resp, error: invokeErr } = await supabase.functions.invoke("admin-ceo-dashboard", {
        body: {},
      });
      if (invokeErr) throw new Error(invokeErr.message);
      if (resp?.error) throw new Error(resp.error);
      setData(resp as PulsePayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить Пульс");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openEdit = (t: PulseAtRiskTutor) => {
    setEditTarget({
      tutorId: t.userId, // tutor_pilot_crm ключуется по auth user id
      username: t.name,
      isPilot: false,
      willingToPay: t.willingToPay,
      riskStatus: t.riskStatus,
      keyPain: t.keyPain,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Пульс</h2>
          <p className="text-sm text-muted-foreground">
            Здоровье бизнеса, воронка активации поимённо и каналы привлечения.
            {data?.generatedAt && (
              <span className="ml-1 text-xs">
                Обновлено {format(parseISO(data.generatedAt), "d MMM, HH:mm", { locale: ru })}
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          Обновить
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive rounded-lg p-4">{error}</div>
      )}

      {loading && !data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-56" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      ) : data ? (
        <>
          <PulseHeader header={data.header} />
          {data.preFunnel && (
            <PulsePreFunnel data={data.preFunnel} newTutors7d={data.header.newTutors7d} />
          )}
          <PulseFunnel funnel={data.funnel} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PulseChannels channels={data.channels} />
            <PulseAtRisk tutors={data.atRisk} onEdit={openEdit} />
          </div>
        </>
      ) : null}

      <EditTutorTagsDialog
        key={editTarget?.tutorId ?? "none"}
        open={editTarget != null}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
        initial={editTarget}
        onSaved={fetchData}
      />
    </div>
  );
};
