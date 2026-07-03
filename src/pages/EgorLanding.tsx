import { useEffect } from "react";
import sokratLogo from "@/assets/sokrat-logo.png";

// Промо-лендинг под QR визитки/буклета Егора Блинова (конференция в Иваново).
// Публичный роут /egor. UTM/промо пробрасываются в регистрацию; визиты считает
// глобальная Яндекс.Метрика сайта. Контент можно дорабатывать — URL не меняем.
const REG_URL =
  "/register-tutor?ref=egor&promo=BLINOV_20&utm_source=egor&utm_campaign=ivanovo";

export default function EgorLanding() {
  useEffect(() => {
    document.title = "Сократ AI для репетиторов — приглашение Егора Блинова";
  }, []);

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
        .egor-lp .hint{text-align:center;color:var(--muted);font-size:12px;margin:0 0 18px}
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
      `}</style>
      <div className="wrap">
        <div className="top">
          <img src={sokratLogo} alt="Сократ AI" />
          <div>
            <b>Сократ AI</b>
            <span>для репетиторов · рекомендует Егор Блинов</span>
          </div>
        </div>

        <h1>Меньше рутины.<br />Больше преподавания.</h1>
        <p className="sub">
          AI проверяет ДЗ и пробники — даже рукописные. Ученик думает сам, а не
          списывает у ChatGPT.
        </p>

        <div className="promo">
          <div>По промокоду</div>
          <div className="code">БЛИНОВ_20</div>
          <div className="small">7 дней бесплатно без карты + −20% на первые полгода</div>
        </div>

        <a className="cta" href={REG_URL}>Начать бесплатно →</a>
        <p className="hint">промокод <b>БЛИНОВ_20</b> введите при регистрации</p>

        <div>
          <div className="val">
            <span className="dot">●</span>
            <div>
              <b>Второй взгляд</b>
              <span>AI проверяет рукописные ДЗ и пробники по критериям ФИПИ и ловит ошибки, на которых замылен глаз.</span>
            </div>
          </div>
          <div className="val">
            <span className="dot">●</span>
            <div>
              <b>Ученик думает сам</b>
              <span>Сократический метод: AI ведёт наводящими вопросами, а не выдаёт готовый ответ.</span>
            </div>
          </div>
          <div className="val">
            <span className="dot">●</span>
            <div>
              <b>Рабочее место в одном</b>
              <span>Расписание, банк заданий, учёт оплат, отчёты родителям. Расписание и оплаты — бесплатно.</span>
            </div>
          </div>
        </div>

        <img className="shot" src="/egor-cabinet.png" alt="Экран Сократ AI: прогресс по ученикам" loading="lazy" />
        <p className="cap">реальный экран кабинета Сократ AI</p>

        <div className="egor">
          <b>Егор Блинов</b>
          <div className="role">репетитор физики · выпускник МФТИ · дважды 100-балльник ЕГЭ · создатель Сократ AI</div>
          <div className="stat">Ведёт 40+ учеников в Сократ AI · освободил ~8 часов в неделю</div>
        </div>

        <div className="quote">
          «Сравнивала известные платформы — больше всех понравился Сократ AI: оплатила сразу на полгода вперёд.»
          <div className="who">— Елена Иванова, репетитор физики</div>
        </div>

        <a className="cta alt" href={REG_URL}>Попробовать 7 дней бесплатно</a>
        <p className="foot">
          <b>Инструмент репетитора. От репетитора.</b>
          <br />sokratai.ru
        </p>
      </div>
    </div>
  );
}
