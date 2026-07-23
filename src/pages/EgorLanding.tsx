import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import sokratLogo from "@/assets/sokrat-logo.png";
import { capturePromoFromUrl } from "@/lib/promoCapture";
import {
  SOKRAT_COMMUNITY_TELEGRAM_URL,
  SOKRAT_COMMUNITY_VK_URL,
} from "@/lib/tutorPlanCopy";

// Промо-лендинг под QR визитки/буклета Егора Блинова (конференция в Иваново).
// Публичный роут /egor. UTM/промо пробрасываются в регистрацию; визиты считает
// глобальная Яндекс.Метрика сайта. Контент можно дорабатывать — URL не меняем.
const REG_URL =
  "/register-tutor?ref=egor&promo=BLINOV_20&utm_source=egor&utm_campaign=ivanovo";

export default function EgorLanding() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    document.title = "Сократ AI для репетиторов — приглашение Егора Блинова";
  }, []);

  // Belt-and-suspenders: если QR/реклама привели на /egor с ?ref/?promo/?utm —
  // закрепляем сразу (основной захват — на /register-tutor). Идемпотентно.
  useEffect(() => {
    capturePromoFromUrl(searchParams);
  }, [searchParams]);

  return (
    <div className="egor-lp">
      <style>{`
        .egor-lp{--ink:#1E293B;--green:#1B6B4A;--greendk:#14543A;--bg:#F8FAFC;--muted:#64748B;--lt:#EAF6EF;--amber:#B45309;--border:#E2E8F0;background:var(--bg);color:var(--ink);min-height:100vh;font-family:'Golos Text',system-ui,-apple-system,sans-serif;line-height:1.45}
        .egor-lp .wrap{max-width:460px;margin:0 auto;padding:22px 18px 48px}
        .egor-lp .top{display:flex;align-items:center;gap:10px;margin-bottom:6px}
        .egor-lp .top img{width:42px;height:42px;border-radius:50%}
        .egor-lp .top b{font-size:19px;display:block;color:var(--ink)}
        .egor-lp .top span{color:var(--muted);font-size:12px}
        .egor-lp h1{font-size:27px;line-height:1.15;margin:18px 0 8px;color:var(--ink)}
        .egor-lp .sub{color:var(--muted);font-size:15px;margin:0 0 18px}
        .egor-lp .promo{background:var(--green);color:#fff;border-radius:14px;padding:16px 18px;margin:16px 0}
        .egor-lp .promo .code{font-size:23px;font-weight:800;letter-spacing:.5px}
        .egor-lp .promo .small{opacity:.92;font-size:13px;margin-top:4px}
        .egor-lp .cta{display:block;text-align:center;background:var(--amber);color:#fff;text-decoration:none;font-weight:700;font-size:17px;padding:15px;border-radius:12px;margin:6px 0 4px}
        .egor-lp .cta.alt{background:var(--ink)}
        .egor-lp .hint{text-align:center;color:var(--muted);font-size:12px;margin:0 0 6px}
        .egor-lp .subs{color:var(--greendk);font-size:13px;font-weight:600;margin:0 0 16px}
        .egor-lp .trust{text-align:center;color:var(--muted);font-size:12px;margin:0 0 18px}
        .egor-lp .val{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}
        .egor-lp .val .dot{color:var(--green);font-weight:800}
        .egor-lp .val b{display:block;color:var(--ink)}
        .egor-lp .val span{color:var(--muted);font-size:13px}
        .egor-lp .shot{width:100%;border:1px solid var(--border);border-radius:10px;margin:16px 0 6px;display:block}
        .egor-lp .cap{color:var(--muted);font-size:12px;text-align:center;margin:0 0 20px}
        .egor-lp .egor{background:#fff;border:1px solid var(--border);border-radius:14px;padding:16px;margin:16px 0}
        .egor-lp .egor b{font-size:16px}
        .egor-lp .egor .role{color:var(--muted);font-size:13px;margin:2px 0 8px}
        .egor-lp .egor .stat{color:var(--greendk);font-weight:600;font-size:13px}
        .egor-lp .quote{background:var(--lt);border-radius:12px;padding:14px 16px;margin:16px 0;font-size:14px}
        .egor-lp .quote .who{color:var(--muted);font-size:12px;margin-top:6px}
        .egor-lp .foot{text-align:center;color:var(--muted);font-size:13px;margin-top:22px}
        .egor-lp .foot b{color:var(--greendk)}
        .egor-lp .community{background:#fff;border:1px solid var(--border);border-radius:14px;padding:16px;margin:18px 0 0}
        .egor-lp .community b{display:block;font-size:15px;color:var(--ink)}
        .egor-lp .community p{color:var(--muted);font-size:13px;margin:2px 0 12px}
        .egor-lp .community .links{display:flex;flex-wrap:wrap;gap:8px}
        .egor-lp .community .links a{flex:1 1 160px;text-align:center;text-decoration:none;font-weight:600;font-size:14px;padding:12px;border-radius:10px;border:1px solid var(--border);color:var(--ink);background:#fff;touch-action:manipulation}
        .egor-lp .community .links a.tg{border-color:#0088cc;color:#0088cc}
        /* ─── Адаптив. База выше = мобильная (аудитория QR — телефоны), ниже —
           планшет и десктоп: на широком экране лента в 460px читалась как
           «сломано». Два брейкпоинта, а не один: на 768–999px колонки вышли бы
           по ~340px (h1 рвался бы на 5 строк, скриншот превращался в марку) —
           поэтому там просто более широкая одна колонка, а сетка включается
           с 1000px. Safari 15 (rule 80): только grid/media — без :has и dvh. ─── */
        @media (min-width:768px){
          .egor-lp .wrap{max-width:620px;padding:32px 24px 60px}
          .egor-lp h1{font-size:34px;margin:16px 0 10px}
          .egor-lp .sub{font-size:17px}
          .egor-lp .subs{font-size:14px}
          /* CTA во всю ширину 620px читался бы как баннер, а не как кнопка */
          .egor-lp .cta{max-width:420px;margin:8px auto 4px}
        }
        @media (min-width:1000px){
          .egor-lp .wrap{max-width:1040px;padding:40px 28px 64px}
          /* align-items:center — правая колонка (скриншот) вдвое ниже левой,
             при start снизу зияла бы дыра в ~380px */
          .egor-lp .hero{display:grid;grid-template-columns:1fr 1fr;gap:36px;align-items:center}
          .egor-lp h1{font-size:42px}
          .egor-lp .cta{max-width:none;margin:8px 0 4px}
          .egor-lp .shot{margin:0 0 6px}
          .egor-lp .vals{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:36px 0 6px}
          .egor-lp .val{border-bottom:none;background:#fff;border:1px solid var(--border);border-radius:12px;padding:16px}
          .egor-lp .proof{display:grid;grid-template-columns:1.1fr 1fr;gap:16px;align-items:start;margin:22px 0}
          .egor-lp .proof > *{margin:0}
          .egor-lp .cta.alt{max-width:420px;margin-left:auto;margin-right:auto}
          .egor-lp .community{max-width:640px;margin-left:auto;margin-right:auto}
        }
      `}</style>
      <div className="wrap">
        {/* Hero. На мобиле (база) — обычный поток: обещание → промо → CTA →
            экран → буллеты. На ≥768px CSS раскладывает его в две колонки
            (текст слева, скриншот справа) — иначе на десктопе страница читалась
            как узкая лента посреди пустого экрана. */}
        <div className="hero">
          <div className="hero-main">
            <div className="top">
              <img src={sokratLogo} alt="Сократ AI" />
              <div>
                <b>Сократ AI</b>
                <span>для репетиторов · рекомендует Егор Блинов</span>
              </div>
            </div>

            {/* Заголовок = Big Job репетитора (рост), а не «экономия времени» —
                синхронно с прод-лендингом sokratai.ru. Мультипредметно: в зале у
                Егора физики, математики, химики и гуманитарии (решение владельца). */}
            <h1>Ведите в 2 раза больше учеников — без ночной проверки ДЗ</h1>
            <p className="sub">
              Сократ проверяет рукописные домашки по критериям ФИПИ и ведёт
              ученика вопросами, пока вас нет рядом. Вы подтверждаете балл — за
              минуты, а не за вечер.
            </p>
            <p className="subs">
              Физика · Математика · Химия · Обществознание · Русский · Языки — ЕГЭ и ОГЭ
            </p>

            <div className="promo">
              <div>По промокоду</div>
              <div className="code">БЛИНОВ_20</div>
              <div className="small">
                7 дней бесплатно, без карты → 200 ₽ за первый месяц → −20% на месяцы 2–6
              </div>
            </div>

            <a className="cta" href={REG_URL}>Начать бесплатно →</a>
            {/* Промокод подхватывается из ссылки автоматически (promoCapture →
                signUp-метаданные → profiles.promo_code). Поля ввода промокода в
                регистрации НЕТ и не будет — цену задаёт только сервер (anti-tamper,
                rule 99), поэтому копия НЕ должна просить «ввести промокод». */}
            <p className="hint">промокод <b>БЛИНОВ_20</b> уже в ссылке — вводить ничего не нужно</p>
            {/* Снятие трёх главных страхов профи разом: деньги, «заменит меня», «AI ошибётся». */}
            <p className="trust">
              Без карты · отмена в один клик · финальное слово по баллу всегда за вами
            </p>
          </div>

          <div className="hero-media">
            <img className="shot" src="/egor-cabinet.png" alt="Экран Сократ AI: прогресс по ученикам" loading="lazy" />
            <p className="cap">реальный экран кабинета Сократ AI</p>
          </div>
        </div>

        <div className="vals">
          <div className="val">
            <span className="dot">●</span>
            <div>
              <b>Проверка ДЗ: 3 часа → 40 минут</b>
              <span>Тетрадные решения по физике и математике, задачи по химии, сочинения по русскому, эссе по обществознанию. AI читает рукопись, находит ошибки и пишет черновик разбора — балл подтверждаете вы.</span>
            </div>
          </div>
          <div className="val">
            <span className="dot">●</span>
            <div>
              <b>Ученик думает сам, а не списывает</b>
              <span>Застрял — Сократ ведёт наводящими вопросами и не выдаёт готовый ответ. ChatGPT даёт списать; здесь ученик доходит сам.</span>
            </div>
          </div>
          <div className="val">
            <span className="dot">●</span>
            <div>
              <b>Рабочее место в одном</b>
              <span>Расписание, база задач по ФИПИ, учёт оплат, отчёты родителям. Расписание и оплаты — бесплатно навсегда.</span>
            </div>
          </div>
        </div>

        {/* Пруфы: на мобиле друг под другом, на ≥768px — в две колонки. */}
        <div className="proof">
          {/* Цифры синхронны с прод-лендингом sokratai.ru (~10 ч, ×2 учеников) —
              расхождение между визиткой и сайтом било бы по доверию. */}
          <div className="egor">
            <b>Егор Блинов</b>
            <div className="role">преподаватель МФТИ · дважды 100-балльник ЕГЭ · 10 лет репетиторства · создатель Сократ AI</div>
            <div className="stat">Освободил ~10 часов в неделю на проверке ДЗ, учёте оплат и отчётах родителям</div>
          </div>

          {/* Конкретная история вместо абстрактного «сравнивала платформы» —
              она же снимает страх «AI ошибётся» лучше любого заверения. */}
          <div className="quote">
            «Я проверила — вроде всё верно. Сократ поставил 1 из 2 — и оказался прав.»
            <div className="who">— Елена Иванова, репетитор физики · ведёт в 2 раза больше учеников с Сократом</div>
          </div>
        </div>

        <a className="cta alt" href={REG_URL}>Попробовать 7 дней бесплатно</a>

        {/* Сообщество — вторичный блок ПОСЛЕ обоих CTA (не отбирает конверсию,
            rule 90: один primary). Ссылки из констант tutorPlanCopy — инлайн-
            хардкод запрещён; это ЧАТ-сообщество, не «канал Егора». */}
        <div className="community">
          <b>Есть вопросы? Загляните в сообщество</b>
          <p>
            Репетиторы, прямая линия с командой Сократа и анонсы — можно
            спросить до регистрации.
          </p>
          <div className="links">
            <a
              className="tg"
              href={SOKRAT_COMMUNITY_TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Чат в Telegram
            </a>
            <a
              href={SOKRAT_COMMUNITY_VK_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Чат в VK
            </a>
          </div>
        </div>

        <p className="foot">
          <b>Инструмент репетитора. От репетитора.</b>
          <br />sokratai.ru
        </p>
      </div>
    </div>
  );
}
