import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

/**
 * Админ ретро-привязка «Кто привёл» (Stage 3 рефералки, Excel-кейс владельца):
 * выбор реферера из справочника кодов → admin-overwrite через
 * admin-ceo-dashboard {action: "set_referrer"}. Mount с key={tutorId}
 * (начальные значения захватываются на mount — паттерн EditTutorTagsDialog).
 */

const CLEAR_VALUE = "__clear__";

export interface SetReferrerTarget {
  userId: string;
  name: string;
  referredByCode: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: SetReferrerTarget | null;
  directory: Array<{ code: string; name: string }>;
  onSaved: () => void;
}

export const SetReferrerDialog = ({ open, onOpenChange, target, directory, onSaved }: Props) => {
  const { toast } = useToast();
  const [selected, setSelected] = useState<string>(target?.referredByCode ?? CLEAR_VALUE);
  const [saving, setSaving] = useState(false);

  if (!target) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-ceo-dashboard", {
        body: {
          action: "set_referrer",
          tutor_user_id: target.userId,
          referral_code: selected === CLEAR_VALUE ? null : selected,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Сохранено",
        description:
          selected === CLEAR_VALUE
            ? "Привязка снята"
            : `Привязано: ${data?.referrer_name ?? "реферер"}`,
      });
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
          <DialogTitle>Кто привёл: {target.name}</DialogTitle>
          <DialogDescription>
            Ретро-привязка реферера (например, из ручных записей). Перезаписывает
            текущую атрибуцию — админ авторитетен.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          <Label>Реферер</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CLEAR_VALUE}>— без привязки —</SelectItem>
              {directory.map((d) => (
                <SelectItem key={d.code} value={d.code}>
                  {d.name} · {d.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Сохраняю…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
