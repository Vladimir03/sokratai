import { Clock } from "lucide-react";

import ProductTour from "./ProductTour";
import Tour2Video from "./Tour2Video";

export default function ProductTour2() {
  return (
    <ProductTour
      id="product-tour"
      badge={{ Icon: Clock, label: "За 5 минут вместо 40" }}
      headline={<>ДЗ из базы за пять минут</>}
      lede="Банк задач с привязкой к ФИПИ + ваш архив + AI-генерация похожих. Выдача ученикам — одной кнопкой."
      bullets={[
        {
          title: "База + ваш архив из PDF",
          body:
            "Задачи из открытых банков с тегами: тема, номер ЕГЭ/ОГЭ, сложность. Свои материалы грузите как есть — Сократ распознаёт до 60 страниц PDF разом.",
        },
        {
          title: "Похожие задачи одним кликом",
          body:
            "Удачная задача → 3 варианта с той же сутью, но другими числами.",
        },
        {
          title: "Дойдёт до каждого",
          body:
            "Telegram, email, web, push — Сократ сам выберет канал, который у ученика открывается.",
        },
      ]}
      videoPlaceholderText="Конструктор ДЗ"
      videoPlaceholderCaption="Видео 20 сек — добавится после записи"
      videoSrc={undefined}
      videoSlot={<Tour2Video />}
      zigzag="text-right"
      backgroundSurface
    />
  );
}
