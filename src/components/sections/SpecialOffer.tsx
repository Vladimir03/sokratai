import { telegramLinks } from "@/utils/telegramLinks";

const SpecialOffer = () => {
  return (
    <a
      href={telegramLinks.headerTry}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-accent text-white py-5 px-4 text-center font-bold text-base md:text-lg hover:bg-accent/90 transition-colors"
    >
      Только для первых 100 пользователей: цена 699₽/месяц навсегда! Осталось мест: 70/100 → Попробовать в Telegram
    </a>
  );
};

export default SpecialOffer;
