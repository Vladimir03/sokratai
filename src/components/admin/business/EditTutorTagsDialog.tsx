import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export type WillingToPay = "yes" | "maybe" | "no" | "unknown";
export type RiskStatus = "healthy" | "watch" | "at_risk";

export interface TutorTagsValues {
  tutorId: string;
  username: string | null;
  isPilot: boolean;
  willingToPay: WillingToPay;
  riskStatus: RiskStatus;
  keyPain: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: TutorTagsValues | null;
  onSaved: () => void;
}

export const EditTutorTagsDialog = ({ open, onOpenChange, initial, onSaved }: Props) => {
  const { toast } = useToast();
  const [isPilot, setIsPilot] = useState(initial?.isPilot ?? false);
  const [willingToPay, setWillingToPay] = useState<WillingToPay>(initial?.willingToPay ?? "unknown");
  const [riskStatus, setRiskStatus] = useState<RiskStatus>(initial?.riskStatus ?? "healthy");
  const [keyPain, setKeyPain] = useState(initial?.keyPain ?? "");
  const [saving, setSaving] = useState(false);

  // Re-sync when initial changes
  useState(() => {
    if (initial) {
      setIsPilot(initial.isPilot);
      setWillingToPay(initial.willingToPay);
      setRiskStatus(initial.riskStatus);
      setKeyPain(initial.keyPain ?? "");
    }
  });

  if (!initial) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("tutor_pilot_crm")
        .upsert({
          tutor_user_id: initial.tutorId,
          is_pilot: isPilot,
          willing_to_pay: willingToPay,
          risk_status: riskStatus,
          key_pain: keyPain.trim() || null,
          updated_by: user?.id ?? null,
        }, { onConflict: "tutor_user_id" });

      if (error) throw error;
      toast({ title: "Сохранено", description: "Ручные теги обновлены" });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast({
        title: "Ошибка",
        description: err instanceof Error ? err.message : "Не удалось сохранить",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ручные CEO-теги</DialogTitle>
          <DialogDescription>
            {initial.username ?? initial.tutorId.slice(0, 8)} — поля заполняются вручную и не пересекаются с системными метриками.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="is-pilot" className="cursor-pointer">В пилотной когорте</Label>
            <Switch id="is-pilot" checked={isPilot} onCheckedChange={setIsPilot} />
          </div>

          <div className="space-y-1.5">
            <Label>Готовность платить</Label>
            <Select value={willingToPay} onValueChange={(v) => setWillingToPay(v as WillingToPay)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes — готов</SelectItem>
                <SelectItem value="maybe">Maybe — рассматривает</SelectItem>
                <SelectItem value="no">No — не готов</SelectItem>
                <SelectItem value="unknown">Unknown — не выяснено</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Risk status</Label>
            <Select value={riskStatus} onValueChange={(v) => setRiskStatus(v as RiskStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="healthy">Healthy</SelectItem>
                <SelectItem value="watch">Watch</SelectItem>
                <SelectItem value="at_risk">At risk</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="key-pain">Key pain</Label>
            <Input
              id="key-pain"
              value={keyPain}
              onChange={(e) => setKeyPain(e.target.value)}
              placeholder="Например: цена, сложность настройки, недоверие к AI"
              maxLength={200}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Сохраняю..." : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
