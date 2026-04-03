import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="bg-slate-900 text-white py-16 px-4">
      <div className="container mx-auto text-center">
        {/* Logo and Name */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <svg className="w-16 h-16" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="50" className="fill-accent" />
            <path d="M18 22 Q18 14 26 14 L48 14 Q56 14 56 22 L56 38 Q56 46 48 46 L34 46 L24 54 L24 46 Q18 46 18 38 Z" fill="white"/>
            <text x="37" y="37" fontFamily="Georgia, serif" fontSize="22" fontWeight="bold" className="fill-accent" textAnchor="middle">?</text>
            <path d="M54 38 C62 42 66 48 64 56" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.7"/>
            <path d="M60 54 L64 57 L67 52" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
            <path d="M42 56 Q42 48 50 48 L74 48 Q82 48 82 56 L82 72 Q82 80 74 80 L60 80 L70 88 L50 80 Q42 80 42 72 Z" fill="white"/>
            <circle cx="62" cy="56" r="8" fill="none" stroke="#E8913A" strokeWidth="2"/>
            <path d="M59 56 C60 51 64 51 65 56" fill="none" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="59" y1="63" x2="65" y2="63" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="60" y1="65.5" x2="64" y2="65.5" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="62" y1="44" x2="62" y2="41" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="71" y1="50" x2="74" y2="48" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="53" y1="50" x2="50" y2="48" stroke="#E8913A" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <div className="text-3xl font-bold">Сократ AI</div>
        </div>

        <p className="text-lg mb-8 max-w-2xl mx-auto">
          AI-помощник, который помогает думать и понимать, а не списывать!
        </p>

        {/* Contacts */}
        <div className="mb-8 space-y-2">
          <p className="text-lg">
            <a href="https://sokratai.ru" className="text-accent hover:text-accent/80 transition-colors">
              sokratai.ru
            </a>
          </p>
          <p className="text-lg">
            <a href="https://t.me/sokratai_ru_bot" className="text-accent hover:text-accent/80 transition-colors">
              Telegram: @sokratai_ru_bot
            </a>
          </p>
          <p className="text-lg">
            <a href="mailto:sokratai@yandex.ru" className="text-accent hover:text-accent/80 transition-colors">
              sokratai@yandex.ru
            </a>
          </p>
        </div>

        {/* Brand Story */}
        <p className="text-sm italic opacity-75 max-w-3xl mx-auto mb-2">
          Мы верим, что каждый может понять любой школьный предмет, если задавать правильные вопросы. Наш AI
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
              to="/tutor/login" 
              className="text-accent hover:text-accent/80 transition-colors font-medium"
            >
              Войти
            </Link>
            <span className="text-white/30">|</span>
            <Link 
              to="/tutor/login" 
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
          <p className="text-sm opacity-60">© 2025 Сократ AI. Все права защищены.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
