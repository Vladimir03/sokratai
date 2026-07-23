import { TrendingUp } from "lucide-react";

import { trackTutorLandingGoal } from "@/lib/tutorLandingAnalytics";

import ProductTour from "./ProductTour";
import Tour1Video from "./Tour1Video";

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
      lede="AI читает рукопись, находит ошибки и пишет черновик фидбека в вашей интонации. Вы подтверждаете балл — финальное слово всегда за вами."
      bullets={[
        {
          title: "Рукопись, формулы, сочинения",
          body:
            "Тетрадочные решения по физике и математике, сочинения по русскому, эссе по обществознанию. Языки — по критериям CEFR/DELF. Точность распознавания 92%; сомнительные места AI сам помечает «нужна ваша проверка».",
        },
        {
          title: "Ошибки — по полочкам",
          body:
            "Отличает вычислительную ошибку от концептуальной и привязывает к теме кодификатора — сразу видно, что повторять.",
        },
        {
          title: "Сократовский диалог с учеником",
          body:
            "Застрял — AI ведёт наводящими вопросами, готовое решение не выдаёт. ChatGPT даёт списать; Сократ доводит до ответа — ученик приходит сам.",
        },
      ]}
      inlineCTA={{
        label: "🎁 Попробовать 7 дней бесплатно →",
        href: "/signup?ref=tutor-landing&trial=7",
        onClick: () => trackTutorLandingGoal("tutor_landing_cta_tour1"),
      }}
      videoPlaceholderText="AI-проверка ДЗ + сократовский диалог"
      videoPlaceholderCaption="Видео 25 сек — добавится после записи"
      videoSrc={undefined}
      videoSlot={<Tour1Video />}
      zigzag="text-left"
    />
  );
}
