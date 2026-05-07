import { trackTutorLandingGoal } from "@/lib/tutorLandingAnalytics";

import ProductTour from "./ProductTour";
import Tour3ConceptMockup from "./Tour3ConceptMockup";

export default function ProductTour3() {
  return (
    <ProductTour
      id="tour-3"
      headline={<>Отчёт родителю — пока вы спите</>}
      lede="Еженедельная сводка будет генерироваться автоматически: карта тем, динамика балла, активность ученика между уроками. Будет приходить родителю в мессенджер по его предпочтению."
      bullets={[
        {
          title: "Карта тем — зелёный, жёлтый, красный",
          body:
            "Родитель будет видеть, какие темы у ребёнка закрыты, какие в работе, какие «красная зона». Привязка к номерам заданий ЕГЭ и ОГЭ — родитель без физического образования поймёт без ваших комментариев.",
        },
        {
          title: "Динамика за недели и месяцы",
          body:
            "Было 65 баллов — стало 74 за шесть недель. Темп +1,5 балла в неделю. Прогноз на экзамен: 80–85 при текущем режиме. Цифры, которые закроют вопрос «а работают ли наши деньги».",
        },
        {
          title: "Telegram, email или push",
          body:
            "Родитель получит отчёт в том мессенджере, где он живёт. Вы не напишете ни одного сообщения вручную.",
        },
      ]}
      inlineCTA={{
        label: "Узнай первым в канале Егора →",
        href: "https://t.me/sokrat_rep",
        onClick: () => trackTutorLandingGoal("tutor_landing_tg_channel_click"),
      }}
      videoPlaceholderText="Отчёт родителю"
      videoPlaceholderCaption="Концепт — функция в разработке"
      videoSrc={undefined}
      videoSlot={<Tour3ConceptMockup />}
      zigzag="text-left"
    />
  );
}
