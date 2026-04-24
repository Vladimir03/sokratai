import { TrendingUp } from "lucide-react";

import { trackTutorLandingGoal } from "@/lib/tutorLandingAnalytics";

import ProductTour from "./ProductTour";

export default function ProductTour1() {
  return (
    <ProductTour
      id="tour-1"
      badge={{ Icon: TrendingUp, label: "Экономия 80% времени" }}
      headline={
        <>
          Проверка ДЗ:{" "}
          <span className="tour-h2-transform-group">
            <span className="tour-h2-before">3 часа</span>{" "}
            <span className="tour-h2-arrow">→</span>{" "}
            <span className="tour-h2-after">40 минут</span>
          </span>
        </>
      }
      lede="Одна цепочка: AI читает рукопись, распознаёт ошибку, пишет черновик фидбека в вашей интонации. Когда ученик застрял — ведёт его сократовским диалогом прямо в чате задания."
      bullets={[
        {
          title: "Рукопись, формулы, графики",
          body:
            "AI читает тетрадочное решение по физике и математике — формулы с дробями, векторы, графики. Точность распознавания 92%. Оставшиеся 8% AI сам помечает как «нужна ваша проверка» — они попадают в отдельную очередь.",
        },
        {
          title: "Классификация ошибок",
          body:
            "Отличает вычислительную ошибку (перепутал знак, забыл множитель) от концептуальной (не применил закон сохранения импульса). Методологические ошибки привязаны к теме кодификатора ФИПИ — сразу видно, к чему ученика возвращать.",
        },
        {
          title: "Сократовский диалог с учеником",
          body:
            "Ученик решает, застревает, открывает чат задания — AI ведёт его только наводящими вопросами. Никогда готовое решение. ChatGPT даёт ответ — ученик списывает и не учится. Сократ AI ведёт к ответу — ученик приходит сам и запоминает. После вашей проверки ученик может пересдать и закрепить навык в том же чате.",
        },
      ]}
      inlineCTA={{
        label: "Попробовать за 200 ₽ →",
        href: "/signup?ref=tutor-landing&tier=ai-start",
        onClick: () => trackTutorLandingGoal("tutor_landing_cta_tour1"),
      }}
      videoPlaceholderText="AI-проверка ДЗ + сократовский диалог"
      videoPlaceholderCaption="Видео 25 сек — добавится после записи"
      videoSrc={undefined}
      zigzag="text-left"
    />
  );
}
