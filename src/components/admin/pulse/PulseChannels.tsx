import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChannelBadge } from "./PulseBadges";
import type { PulseChannelSummary } from "./pulseTypes";

/** Каналы привлечения: сколько пришло, сколько дошло до триала и оплаты. */
export const PulseChannels = ({ channels }: { channels: PulseChannelSummary[] }) => (
  <Card animate={false}>
    <CardHeader className="pb-3">
      <CardTitle className="text-base">Каналы привлечения</CardTitle>
      <p className="text-sm text-muted-foreground">
        Исторические факты по каждому каналу: сколько пришло, у скольких ученик хоть раз
        сдал ДЗ, сколько хоть раз платили (ручные гранты не считаются).
      </p>
    </CardHeader>
    <CardContent>
      {channels.length === 0 ? (
        <p className="text-sm text-muted-foreground">Пока нет данных.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-slate-200">
              <th className="py-2 pr-3 font-medium">Канал</th>
              <th className="py-2 pr-3 font-medium text-right">Всего</th>
              <th className="py-2 pr-3 font-medium text-right">Дошли до ценности</th>
              <th className="py-2 font-medium text-right">Оплатили</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={`${c.kind}:${c.label}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3">
                  <ChannelBadge channel={{ kind: c.kind, label: c.label }} />
                </td>
                <td className="py-2 pr-3 text-sm tabular-nums text-right">{c.total}</td>
                <td className="py-2 pr-3 text-sm tabular-nums text-right">{c.reachedValue}</td>
                <td className="py-2 text-sm tabular-nums text-right font-medium">{c.paidEver}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </CardContent>
  </Card>
);
