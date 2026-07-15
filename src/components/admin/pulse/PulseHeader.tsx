import { PulseMetricCard } from "./PulseMetricCard";
import type { PulsePayload } from "./pulseTypes";

const num = (v: number) => v.toLocaleString("ru-RU");

const deltaSub = (delta: number, unit = "") => {
  if (delta > 0) return <span className="text-emerald-700">↑ +{num(delta)}{unit} за неделю</span>;
  if (delta < 0) return <span className="text-rose-700">↓ {num(delta)}{unit} за неделю</span>;
  return <span>без изменений за неделю</span>;
};

/** Шапка здоровья: 6 цифр, по которым CEO за 30 секунд видит картину. */
export const PulseHeader = ({ header }: { header: PulsePayload["header"] }) => {
  const nsmNames = header.weeklyValueTutors.names;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <PulseMetricCard
        title="MRR"
        value={`${num(header.mrr)} ₽`}
        sub={deltaSub(header.deltas.mrr, " ₽")}
        tooltip="Сумма последнего успешного платежа тарифа «AI-старт» каждого репетитора за последние 35 дней. Ручные гранты премиума в MRR не входят (они входят в «Платящие»)."
        tone={header.mrr > 0 ? "good" : "default"}
      />
      <PulseMetricCard
        title="Платящие"
        value={num(header.payingTutors)}
        tooltip="Репетиторы с действующим premium в profiles (оплата ИЛИ ручной грант)."
      />
      <PulseMetricCard
        title="Триалы"
        value={num(header.trialTutors)}
        tooltip="Действующий триал (trial_ends_at в будущем) без premium."
      />
      <PulseMetricCard
        title="WAU репетиторов"
        value={num(header.tutorWAU)}
        tooltip="Активны за 7 дней: создали ДЗ, отправили ДЗ ученику, написали в тред или добавили ученика."
      />
      <PulseMetricCard
        title="Новые за 7д"
        value={num(header.newTutors7d)}
        sub={deltaSub(header.deltas.newTutors)}
        tooltip="Новые регистрации репетиторов за последние 7 дней. Дельта — к предыдущей неделе."
      />
      <PulseMetricCard
        title="Weekly Value (NSM)"
        value={num(header.weeklyValueTutors.count)}
        sub={deltaSub(header.deltas.weeklyValue)}
        tooltip={
          "North Star: репетиторы, чей ученик реально сдал ДЗ за последние 7 дней — продукт закрыл их Job. Предсказывает будущие оплаты." +
          (nsmNames.length > 0 ? ` Сейчас: ${nsmNames.join(", ")}.` : "")
        }
        tone={header.weeklyValueTutors.count > 0 ? "good" : "warn"}
      />
    </div>
  );
};
