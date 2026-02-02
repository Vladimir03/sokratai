import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="bg-slate-900 text-white py-16 px-4">
      <div className="container mx-auto text-center">
        {/* Logo and Name */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <svg className="w-16 h-16" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M 15 25 Q 15 15 25 15 L 45 15 Q 55 15 55 25 L 55 40 Q 55 50 45 50 L 30 50 L 20 60 L 20 50 Q 15 50 15 40 Z"
              fill="#10b981"
              opacity="0.9"
            />
            <text
              x="35"
              y="37"
              fontFamily="Manrope, sans-serif"
              fontSize="20"
              fontWeight="bold"
              fill="white"
              textAnchor="middle"
            >
              ?
            </text>

            <path
              d="M 45 55 Q 45 45 55 45 L 75 45 Q 85 45 85 55 L 85 70 Q 85 80 75 80 L 60 80 L 80 90 L 60 90 Q 45 90 45 80 Z"
              fill="white"
              opacity="0.95"
            />
            <text
              x="65"
              y="67"
              fontFamily="Manrope, sans-serif"
              fontSize="20"
              fontWeight="bold"
              fill="#2d3561"
              textAnchor="middle"
            >
              💡
            </text>
          </svg>
          <div className="text-3xl font-bold">Сократ</div>
        </div>

        <p className="text-lg mb-8 max-w-2xl mx-auto">
          ИИ-помощник, который помогает думать и понимать, а не списывать!
        </p>

        {/* Contacts */}
        <div className="mb-8 space-y-2">
          <p className="text-lg">
            🌐{" "}
            <a href="https://sokratai.ru" className="text-accent hover:text-accent/80 transition-colors">
              sokratai.ru
            </a>
          </p>
          <p className="text-lg">
            📱{" "}
            <a href="https://t.me/sokratai_ru_bot" className="text-accent hover:text-accent/80 transition-colors">
              Telegram: @sokratai_ru_bot
            </a>
          </p>
          <p className="text-lg">
            📧{" "}
            <a href="mailto:sokratai@yandex.ru" className="text-accent hover:text-accent/80 transition-colors">
              sokratai@yandex.ru
            </a>
          </p>
        </div>

        {/* Brand Story */}
        <p className="text-sm italic opacity-75 max-w-3xl mx-auto mb-2">
          Мы верим, что каждый может понять математику, физику и информатику, если задавать правильные вопросы. Наш ИИ
          использует сократовский метод: через вопросы-подсказки ты сам приходишь к ответу, а значит — по-настоящему
          понимаешь материал. Не списывание, а настоящее обучение!
        </p>

        <p className="text-sm italic opacity-75 max-w-3xl mx-auto mb-6">
          "Хорошие учителя дают новые знания, а великие – учат мыслить по-новому" (с)
        </p>

        {/* For Tutors */}
        <div className="mb-8 py-6 border-t border-white/10">
          <p className="text-sm text-white/60 mb-3">Вы репетитор?</p>
          <div className="flex justify-center gap-4">
            <Link 
              to="/register-tutor" 
              className="text-accent hover:text-accent/80 transition-colors font-medium"
            >
              Войти
            </Link>
            <span className="text-white/30">|</span>
            <Link 
              to="/register-tutor" 
              className="text-accent hover:text-accent/80 transition-colors font-medium"
            >
              Зарегистрироваться
            </Link>
          </div>
        </div>

        {/* Legal Links */}
        <div className="flex flex-wrap justify-center gap-4 mb-6 text-sm">
          <Link to="/requisites" className="text-accent hover:text-accent/80 transition-colors">
            Реквизиты
          </Link>
          <span className="opacity-40">|</span>
          <Link to="/offer" className="text-accent hover:text-accent/80 transition-colors">
            Публичная оферта
          </Link>
          <span className="opacity-40">|</span>
          <Link to="/privacy-policy" className="text-accent hover:text-accent/80 transition-colors">
            Политика конфиденциальности
          </Link>
        </div>

        <div className="border-t border-white/20 pt-6">
          <p className="text-sm opacity-60">© 2025 Сократ. Все права защищены.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
