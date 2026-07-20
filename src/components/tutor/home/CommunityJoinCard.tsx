/**
 * Community-CTA «Вы не одни — загляните в сообщество» на /tutor/home (фича
 * egor-qr-onboarding). Зовём в чат репетиторов + прямую линию с командой ПОСЛЕ
 * первого «вау» (демо-разбор), не до — иначе ощущается спамом (UX doc 16).
 *
 * Гейт — флаг `sokrat-demo-seen` (ставится при открытии демо, `demoSeen.ts`):
 * до демо карточки нет, после — появляется без reload (same-tab event).
 *
 * Non-blocking, НЕ primary-CTA (rule 90): две вторичные ссылки-кнопки (outline),
 * не filled — не конкурируют с шагом чеклиста / плашкой тарифа. Ссылки — из
 * одной константы (`tutorPlanCopy.ts`), не хардкод инлайн. Lucide, sentence
 * case, без эмодзи/градиентов/теней. Наследует data-sokrat-mode="tutor" от
 * AppFrame.
 */
import { useEffect, useState } from "react";
import { MessageCircle, Send, Users } from "lucide-react";
import {
  SOKRAT_COMMUNITY_TELEGRAM_URL,
  SOKRAT_COMMUNITY_VK_URL,
} from "@/lib/tutorPlanCopy";
import { hasDemoSeen, subscribeDemoSeen } from "@/lib/demoSeen";
import { trackCommunityCtaClicked } from "@/lib/tutorProgressApi";

export function CommunityJoinCard() {
  const [seen, setSeen] = useState<boolean>(() => hasDemoSeen());

  useEffect(() => {
    if (seen) return; // уже видно — подписка не нужна
    return subscribeDemoSeen(() => setSeen(true));
  }, [seen]);

  if (!seen) return null;

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
          aria-hidden="true"
        >
          <Users className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">
            Вы не одни — загляните в сообщество
          </h2>
          <p className="text-sm text-slate-600">
            Репетиторы, прямая линия с нами и анонсы
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={SOKRAT_COMMUNITY_TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackCommunityCtaClicked("telegram")}
          style={{ touchAction: "manipulation" }}
          className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-socrat-telegram/40 bg-white px-3.5 text-sm font-semibold text-socrat-telegram transition-colors hover:bg-socrat-telegram/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-telegram/40"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Сообщество в Telegram
        </a>
        <a
          href={SOKRAT_COMMUNITY_VK_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackCommunityCtaClicked("vk")}
          style={{ touchAction: "manipulation" }}
          className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Чат в VK
        </a>
      </div>
    </div>
  );
}

export default CommunityJoinCard;
