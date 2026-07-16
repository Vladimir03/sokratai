import { memo } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { ExternalLink } from "lucide-react";
import { ChannelBadge, PlanBadge } from "./PulseBadges";
import type { PulseTutor } from "./pulseTypes";

const fmtDate = (iso: string | null | undefined) =>
  iso ? format(parseISO(iso), "d MMM yyyy", { locale: ru }) : "—";

const TutorRow = memo(
  ({
    tutor,
    onSetReferrer,
  }: {
    tutor: PulseTutor;
    onSetReferrer?: (tutor: PulseTutor) => void;
  }) => (
  <tr className="border-b border-slate-100 last:border-0">
    <td className="py-2 pr-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-slate-900">{tutor.name}</span>
        <PlanBadge isPaying={tutor.isPaying} isTrial={tutor.isTrial} />
      </div>
    </td>
    <td className="py-2 pr-3">
      {onSetReferrer ? (
        <button
          type="button"
          onClick={() => onSetReferrer(tutor)}
          title="Кто привёл (ретро-привязка реферера)"
          className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          style={{ touchAction: "manipulation" }}
        >
          <ChannelBadge channel={tutor.channel} />
        </button>
      ) : (
        <ChannelBadge channel={tutor.channel} />
      )}
    </td>
    <td className="py-2 pr-3 text-sm text-slate-600 tabular-nums whitespace-nowrap">
      {fmtDate(tutor.registeredAt)}
    </td>
    <td className="py-2 pr-3 text-sm text-slate-600 tabular-nums whitespace-nowrap">
      {fmtDate(tutor.lastActivityAt)}
    </td>
    <td className="py-2 pr-3 text-sm text-slate-600 tabular-nums text-right">
      {tutor.activeStudents}
    </td>
    <td className="py-2">
      {tutor.telegram ? (
        <a
          href={`https://t.me/${tutor.telegram}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-socrat-telegram hover:underline whitespace-nowrap"
        >
          @{tutor.telegram}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      ) : (
        <span className="text-sm text-slate-400">—</span>
      )}
    </td>
  </tr>
  ),
);
TutorRow.displayName = "PulseTutorRow";

/**
 * Поимённый список репетиторов ступени воронки — рабочий список
 * «кому написать», а не отчёт. Клик по бейджу канала (при onSetReferrer) —
 * админ ретро-привязка «кто привёл».
 */
export const PulseStageTutorList = ({
  tutors,
  emptyText,
  onSetReferrer,
}: {
  tutors: PulseTutor[];
  emptyText: string;
  onSetReferrer?: (tutor: PulseTutor) => void;
}) => {
  if (tutors.length === 0) {
    return <p className="text-sm text-muted-foreground py-3">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto touch-pan-x">
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-slate-200">
            <th className="py-2 pr-3 font-medium">Репетитор</th>
            <th className="py-2 pr-3 font-medium">Канал</th>
            <th className="py-2 pr-3 font-medium">Регистрация</th>
            <th className="py-2 pr-3 font-medium">Активность</th>
            <th className="py-2 pr-3 font-medium text-right">Ученики</th>
            <th className="py-2 font-medium">Telegram</th>
          </tr>
        </thead>
        <tbody>
          {tutors.map((t) => (
            <TutorRow key={t.tutorId} tutor={t} onSetReferrer={onSetReferrer} />
          ))}
        </tbody>
      </table>
    </div>
  );
};
