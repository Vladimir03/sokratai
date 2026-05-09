/* global React, SIcon, SButton, SChip, SInlineMath, SFormulaBlock, HOMEWORK_DATA */
// Problem-with-AI-chat — Socratic homework solving surface.
// Three layouts: mobile (chat-prominent), tablet (split), desktop (split).

const { useState, useEffect, useRef } = React;

// Mock chat thread — Socratic flow on Колебания и волны task
const PROBLEM_CONTEXT = {
  hw: HOMEWORK_DATA[0], // Изменение энергии и начало колебаний
  taskNo: 3, taskTotal: 9, taskScore: 2, taskScoreMax: 2,
  body: "Маленький шарик массы 0,2 кг, подвешенный на пружине жёсткостью 50 Н/м, отклоняют от положения равновесия на 4 см и отпускают без начальной скорости.",
  question: "Найдите максимальную скорость шарика во время колебаний.",
  formula: String.raw`E = \frac{kx^2}{2} = \frac{mv_{max}^2}{2}`,
  given: [
  { sym: "m", val: "0{,}2", unit: "кг" },
  { sym: "k", val: "50", unit: "Н/м" },
  { sym: "x", val: "0{,}04", unit: "м" }],

  find: "v_{max}"
};

const CHAT_THREAD = [
{ who: "system", text: "Сократ AI помогает наводящими вопросами — без готовых ответов" },
{ who: "ai", kicker: "Сократ", text: "Привет, Артём! Давай разберёмся вместе. Шарик отвели в сторону и отпустили — какая энергия у него в этот момент? Подумай: он движется или покоится?" },
{ who: "user", text: "Он покоится. Значит кинетической нет, есть только потенциальная" },
{ who: "ai", kicker: "Сократ", text: "Точно. Запомнил формулу потенциальной энергии для пружины — энергии деформации? Она зависит от двух величин." },
{ who: "user", text: "От жёсткости и квадрата отклонения" },
{ who: "ai", kicker: "Сократ", text: "Идеально. А теперь представь шарик в момент, когда он проходит положение равновесия. Что у него с потенциальной энергией?", attachment: { kind: "quote", text: "положение равновесия → x = 0" } },
{ who: "user", text: "Она равна нулю" },
{ who: "ai", kicker: "Сократ", text: "Куда же тогда «делась» вся энергия? Закон сохранения энергии подскажет." },
{ who: "user", text: "Перешла в кинетическую. И тогда скорость как раз максимальная!" },
{ who: "typing" }];


// ─── Avatar ────────────────────────────────────────────────
function SokratAvatar({ size = 32 }) {
  return (
    <span className="ch-avatar" style={{ width: size, height: size }}>
      <span className="ch-avatar__inner">
        <svg viewBox="0 0 32 32" width={size * 0.62} height={size * 0.62} fill="none">
          <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="11" cy="14" r="2" fill="currentColor" />
          <circle cx="21" cy="14" r="2" fill="currentColor" />
          <path d="M11 21c1.5 1.5 3 2 5 2s3.5-.5 5-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    </span>);

}

// ─── Typing indicator ─────────────────────────────────────
function TypingDots() {
  return (
    <span className="ch-typing">
      <span /><span /><span />
    </span>);

}

// ─── Single message bubble ────────────────────────────────
function ChatMessage({ msg, big }) {
  if (msg.who === "system") {
    return <div className="ch-system">{msg.text}</div>;
  }
  if (msg.who === "typing") {
    return (
      <div className="ch-msg ch-msg--ai ch-msg--typing">
        <SokratAvatar size={32} />
        <div className="ch-msg__col">
          <div className="ch-msg__kicker">Сократ <span className="ch-msg__sub">думает над подсказкой…</span></div>
          <div className="ch-msg__bubble ch-msg__bubble--ai">
            <TypingDots />
          </div>
        </div>
      </div>);

  }
  if (msg.who === "ai") {
    return (
      <div className={"ch-msg ch-msg--ai" + (big ? " ch-msg--big" : "")}>
        <SokratAvatar size={32} />
        <div className="ch-msg__col">
          <div className="ch-msg__kicker">{msg.kicker || "Сократ"}</div>
          {msg.attachment && msg.attachment.kind === "quote" &&
          <div className="ch-msg__quote">
              <SIcon name="quote" size={12} strokeWidth={2} />
              <span>{msg.attachment.text}</span>
            </div>
          }
          <div className="ch-msg__bubble ch-msg__bubble--ai">{msg.text}</div>
        </div>
      </div>);

  }
  // user
  return (
    <div className="ch-msg ch-msg--user">
      <div className="ch-msg__bubble ch-msg__bubble--user">{msg.text}</div>
    </div>);

}

// ─── Problem context card (sticky/peek) ────────────────────
function ProblemContext({ collapsed, onToggle, compact }) {
  const p = PROBLEM_CONTEXT;
  return (
    <div className={"pc" + (collapsed ? " pc--collapsed" : "") + (compact ? " pc--compact" : "")}>
      <div className="pc__steps">
        {Array.from({ length: p.taskTotal }).map((_, i) => {
          const done = i < p.taskNo - 1;
          const cur = i === p.taskNo - 1;
          return (
            <div key={i} className={"pc__step" + (done ? " pc__step--done" : "") + (cur ? " pc__step--cur" : "")}>
              {done ? <SIcon name="check" size={12} strokeWidth={3} /> : i + 1}
            </div>);

        })}
      </div>
      <div className="pc__head">
        <div className="pc__head-l">
          <span className="pc__taskno">Задача {p.taskNo} из {p.taskTotal}</span>
          <span className="pc__score">{p.taskScore} / {p.taskScoreMax} баллов</span>
        </div>
        <button className="pc__toggle" onClick={onToggle}>
          {collapsed ? "Показать задачу" : "Свернуть"}
          <SIcon name={collapsed ? "chevron-down" : "chevron-up"} size={14} strokeWidth={2} />
        </button>
      </div>
      {!collapsed &&
      <>
          <p className="pc__body">{p.body}</p>
          <p className="pc__question">{p.question}</p>
          <div className="pc__given">
            <div className="pc__given-block">
              <div className="pc__given-label">Дано</div>
              <div className="pc__given-list">
                {p.given.map((g) =>
              <div key={g.sym} className="pc__given-row">
                    <SInlineMath tex={g.sym} />
                    <span>=</span>
                    <SInlineMath tex={g.val} />
                    <span className="pc__given-unit">{g.unit}</span>
                  </div>
              )}
              </div>
            </div>
            <div className="pc__given-block pc__given-block--find">
              <div className="pc__given-label">Найти</div>
              <SInlineMath tex={p.find + " - ?"} />
            </div>
          </div>
          <div className="pc__warn">
            <SIcon name="info" size={14} strokeWidth={2} />
            <span>Это задача с развёрнутым решением — покажи ход рассуждений.</span>
          </div>
        </>
      }
    </div>);

}

// ─── Composer (tablet/desktop — quick-actions row + Сдать решение) ─
function Composer({ value, onChange, onSubmit, big, onOpenSubmit }) {
  return (
    <div className={"ch-composer" + (big ? " ch-composer--big" : "")}>
      <div className="ch-composer__quick">
        <button className="ch-composer__quick-btn"><SIcon name="lightbulb" size={14} strokeWidth={2} />Подсказка <span className="ch-composer__quick-count">1/3</span></button>
        <button className="ch-composer__quick-btn"><SIcon name="sigma" size={14} strokeWidth={2} />Формула</button>
        <button className="ch-composer__quick-btn"><SIcon name="help-circle" size={14} strokeWidth={2} />Не понял</button>
        <button className="ch-composer__quick-btn ch-composer__quick-btn--next" onClick={onOpenSubmit}><SIcon name="check-circle-2" size={14} strokeWidth={2} />Сдать решение</button>
      </div>
      <div className="ch-composer__row">
        <button className="ch-composer__attach" aria-label="Прикрепить фото">
          <SIcon name="paperclip" size={20} strokeWidth={1.75} />
        </button>
        <input className="ch-composer__input" placeholder="Напиши шаг рассуждения или задай вопрос…" value={value} onChange={(e) => onChange(e.target.value)} />
        <button className="ch-composer__mic" aria-label="Голосом"><SIcon name="mic" size={20} strokeWidth={1.75} /></button>
        <button className="ch-composer__send" onClick={onSubmit}>
          <SIcon name="arrow-up" size={18} strokeWidth={2.5} />
        </button>
      </div>
    </div>);

}

// ─── ComposerMobile (chat input + "Сдать решение" CTA → opens SubmitSheet) ─
function ComposerMobile({ draft, setDraft, onSubmit, onOpenSubmit, draftCount }) {
  return (
    <div className="ch-composer-m">
      <button className="ch-composer-m__cta" onClick={onOpenSubmit}>
        <span className="ch-composer-m__cta-icon"><SIcon name="check-circle-2" size={18} strokeWidth={2}/></span>
        <span className="ch-composer-m__cta-body">
          <span className="ch-composer-m__cta-title">Сдать решение задачи</span>
          <span className="ch-composer-m__cta-meta">{draftCount > 0 ? `Черновик · ${draftCount} ${draftCount === 1 ? "элемент" : draftCount < 5 ? "элемента" : "элементов"}` : "Ответ + фото решения от руки"}</span>
        </span>
        <SIcon name="chevron-up" size={16} strokeWidth={2}/>
      </button>
      <div className="ch-composer-m__row">
        <button className="ch-composer-m__icon" aria-label="Прикрепить фото"><SIcon name="paperclip" size={18} strokeWidth={1.75}/></button>
        <input className="ch-composer-m__input" placeholder="Спроси Сократа о шаге…" value={draft} onChange={(e) => setDraft(e.target.value)}/>
        <button className="ch-composer-m__icon" aria-label="Голосом"><SIcon name="mic" size={18} strokeWidth={1.75}/></button>
        <button className="ch-composer-m__send" onClick={onSubmit} aria-label="Отправить"><SIcon name="arrow-up" size={16} strokeWidth={2.5}/></button>
      </div>
    </div>);

}

// ─── SubmitCTA — sticky bar with primary action that opens SubmitSheet ─
function SubmitCTA({ onOpenSubmit, draftCount, savedAt }) {
  return (
    <div className="subm-cta">
      <div className="subm-cta__meta">
        <span className="subm-cta__title">Готов сдать решение?</span>
        <span className="subm-cta__sub">{draftCount > 0 ? `Черновик · ${draftCount} ${draftCount === 1 ? "элемент" : draftCount < 5 ? "элемента" : "элементов"} · ${savedAt}` : "Числовой ответ + фото решения от руки"}</span>
      </div>
      <button className="subm-cta__btn" onClick={onOpenSubmit}>
        <SIcon name="check-circle-2" size={18} strokeWidth={2}/>Сдать решение задачи
        <SIcon name="chevron-up" size={14} strokeWidth={2}/>
      </button>
    </div>);
}

// ─── SubmitSheet — bottom sheet for full submission (mobile + tablet/desktop) ──
// Shape: { numeric, unit, text, photos: [{id,name}], voice }
function SubmitSheet({ open, onClose, taskKind = "extended", unit = "м/с", state, onSubmit, value, onChange, savedAt }) {
  if (!open) return null;
  const v = value;
  const set = (patch) => onChange({ ...v, ...patch });
  const requirePhoto = taskKind === "extended" || taskKind === "proof";
  const showText = taskKind !== "numeric";
  const ready = (taskKind === "numeric" ? !!v.numeric.trim() : (!!v.numeric.trim() && v.photos.length > 0));

  return (
    <div className="subm-scrim" onClick={onClose}>
      <div className="subm-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="subm-sheet__grab" />
        <div className="subm-sheet__head">
          <div>
            <div className="subm-sheet__title">Сдать задачу 3 из 9</div>
            <div className="subm-sheet__sub">Изменение энергии и начало колебаний · 0 / 2 баллов</div>
          </div>
          <button className="subm-sheet__close" onClick={onClose} aria-label="Закрыть"><SIcon name="x" size={20}/></button>
        </div>

        <div className="subm-sheet__body">
          {/* Task kind hint */}
          <div className="subm-hint">
            <SIcon name="info" size={14} strokeWidth={2}/>
            <span>{taskKind === "extended" ? "Развёрнутое решение: нужны и ответ, и фото с ходом решения. Без хода — 0 баллов." : taskKind === "numeric" ? "Достаточно числового ответа." : "Доказательство — нужны фото с подробным выводом."}</span>
          </div>

          {/* 1. Numeric */}
          {taskKind !== "proof" && (
            <div className="subm-block">
              <div className="subm-block__label"><span className="subm-block__num">1</span>Числовой ответ <span className="subm-required">обязательно</span></div>
              <div className="subm-numeric">
                <input className="subm-numeric__input" inputMode="decimal" placeholder="например, 1,4" value={v.numeric} onChange={(e) => set({ numeric: e.target.value })}/>
                <span className="subm-numeric__unit">{unit}</span>
              </div>
            </div>
          )}

          {/* 2. Photos — multi-page */}
          {requirePhoto && (
            <div className="subm-block">
              <div className="subm-block__label"><span className="subm-block__num">2</span>Фото решения от руки <span className="subm-required">обязательно</span></div>
              <PhotoStrip photos={v.photos} onAdd={(p) => set({ photos: [...v.photos, p] })} onRemove={(id) => set({ photos: v.photos.filter((p) => p.id !== id) })}/>
              <div className="subm-photo-tips">Можно несколько страниц — добавляй по одной. ИИ распознаёт формулы и проверит ход решения.</div>
            </div>
          )}

          {/* 3. Optional text reasoning */}
          {showText && (
            <div className="subm-block">
              <div className="subm-block__label"><span className="subm-block__num">{requirePhoto ? 3 : 2}</span>Дополнить текстом <span className="subm-optional">по желанию</span></div>
              <textarea className="subm-textarea" rows={3} placeholder="Если хочешь — поясни ход решения текстом" value={v.text} onChange={(e) => set({ text: e.target.value })}/>
            </div>
          )}

          {/* 4. Voice */}
          <div className="subm-block">
            <div className="subm-block__label"><span className="subm-block__num">{requirePhoto && showText ? 4 : (requirePhoto || showText ? 3 : 2)}</span>Голосом <span className="subm-optional">по желанию</span></div>
            <VoiceRecorder voice={v.voice} onRecord={(rec) => set({ voice: rec })} onClear={() => set({ voice: null })}/>
          </div>
        </div>

        {/* Footer: autosave + submit */}
        <div className="subm-sheet__foot">
          <span className="subm-saved"><SIcon name="cloud-check" size={14} strokeWidth={2}/>{savedAt}</span>
          <button className="subm-sheet__cta" disabled={!ready} onClick={onSubmit}>
            <SIcon name="send" size={16} strokeWidth={2}/>Отправить на проверку
          </button>
        </div>
      </div>

      {/* Result/loading overlay sits on top of the sheet */}
      {state && state !== "idle" && <SubmitResult state={state} onClose={onClose} onRetry={() => set({ ...v })}/>}
    </div>);

}

// ─── PhotoStrip (multi-page upload with reorder + delete) ──
function PhotoStrip({ photos, onAdd, onRemove }) {
  const fileRef = useRef(null);
  const handleFiles = (files) => {
    Array.from(files).forEach((f, i) => {
      const id = Date.now() + "-" + i;
      onAdd({ id, name: `Стр. ${photos.length + i + 1}`, src: URL.createObjectURL(f) });
    });
  };
  return (
    <div className="subm-photos">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)}/>
      <div className="subm-photos__strip">
        {photos.map((p, i) => (
          <div key={p.id} className="subm-photo">
            <div className="subm-photo__thumb">{p.src ? <img src={p.src} alt=""/> : <SIcon name="image" size={20}/>}</div>
            <div className="subm-photo__page">{i + 1}</div>
            <button className="subm-photo__del" onClick={() => onRemove(p.id)} aria-label="Удалить"><SIcon name="x" size={12} strokeWidth={2.5}/></button>
            <div className="subm-photo__name">{p.name}</div>
          </div>
        ))}
        <button className="subm-photo subm-photo--add" onClick={() => fileRef.current?.click()}>
          <SIcon name="camera" size={22} strokeWidth={1.75}/>
          <span>{photos.length ? "Ещё страница" : "Сфотографировать"}</span>
        </button>
      </div>
      {photos.length > 0 && (
        <div className="subm-photos__actions">
          <button className="subm-photos__action" onClick={() => fileRef.current?.click()}><SIcon name="camera" size={14} strokeWidth={2}/>Камера</button>
          <button className="subm-photos__action" onClick={() => fileRef.current?.click()}><SIcon name="image" size={14} strokeWidth={2}/>Из галереи</button>
        </div>
      )}
    </div>);

}

// ─── VoiceRecorder (mocked UI) ─────────────────────────────
function VoiceRecorder({ voice, onRecord, onClear }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  if (voice) {
    return (
      <div className="subm-voice subm-voice--has">
        <button className="subm-voice__play" aria-label="Прослушать"><SIcon name="play" size={14} strokeWidth={2.5}/></button>
        <div className="subm-voice__wave">
          {Array.from({ length: 22 }).map((_, i) => <span key={i} style={{ height: `${20 + Math.sin(i * 0.7) * 12 + 6}%` }}/>)}
        </div>
        <span className="subm-voice__time">0:{String(voice.seconds).padStart(2,"0")}</span>
        <button className="subm-voice__del" onClick={onClear} aria-label="Удалить"><SIcon name="trash-2" size={14}/></button>
      </div>);
  }
  return (
    <button className={"subm-voice" + (recording ? " subm-voice--rec" : "")} onClick={() => {
      if (recording) { setRecording(false); onRecord({ seconds }); }
      else { setSeconds(0); setRecording(true); }
    }}>
      <span className="subm-voice__dot"/>
      <SIcon name={recording ? "square" : "mic"} size={16} strokeWidth={2}/>
      <span>{recording ? `Запись… 0:${String(seconds).padStart(2,"0")} · нажми чтобы остановить` : "Записать голосовое объяснение"}</span>
    </button>);
}

// ─── SubmitResult — loading + verdict states ──────────────
function SubmitResult({ state, onClose, onRetry }) {
  return (
    <div className="subm-result">
      {state === "checking" && (
        <div className="subm-result__card subm-result__card--loading">
          <div className="subm-result__spinner"><SokratAvatar size={56}/></div>
          <div className="subm-result__title">Сократ проверяет твоё решение…</div>
          <div className="subm-result__sub">Распознаём фото, сверяем шаги и формулы. Обычно 5–15 секунд.</div>
          <div className="subm-result__steps">
            <span className="subm-result__step subm-result__step--done"><SIcon name="check" size={12} strokeWidth={3}/>Загружаем фото</span>
            <span className="subm-result__step subm-result__step--done"><SIcon name="check" size={12} strokeWidth={3}/>OCR · формулы</span>
            <span className="subm-result__step subm-result__step--cur"><span className="subm-result__step-dot"/>Проверка хода решения</span>
            <span className="subm-result__step">Подведение итогов</span>
          </div>
        </div>
      )}
      {state === "correct" && (
        <div className="subm-result__card subm-result__card--correct">
          <div className="subm-result__icon"><SIcon name="check-circle-2" size={48} strokeWidth={2}/></div>
          <div className="subm-result__title">Правильно! 2 / 2 баллов</div>
          <div className="subm-result__sub">Отлично — всё сошлось, ход решения чёткий.</div>
          <div className="subm-result__xp">+12 XP · streak 7 🔥</div>
          <div className="subm-result__cta">
            <button className="subm-btn subm-btn--ghost" onClick={onClose}>Остаться на задаче</button>
            <button className="subm-btn subm-btn--primary"><SIcon name="arrow-right" size={16} strokeWidth={2}/>Следующая задача</button>
          </div>
        </div>
      )}
      {state === "no-work" && (
        <div className="subm-result__card subm-result__card--warn">
          <div className="subm-result__icon"><SIcon name="alert-triangle" size={48} strokeWidth={2}/></div>
          <div className="subm-result__title">Ответ верный, но нужен ход решения</div>
          <div className="subm-result__sub">На фото только число — без рассуждений. На ЕГЭ за это поставят <b>0 баллов</b>. Перепиши и сфотографируй заново — с формулами и пояснениями.</div>
          <div className="subm-result__cta">
            <button className="subm-btn subm-btn--primary" onClick={onRetry}><SIcon name="camera" size={16} strokeWidth={2}/>Переснять решение</button>
          </div>
        </div>
      )}
      {state === "step-error" && (
        <div className="subm-result__card subm-result__card--err">
          <div className="subm-result__icon"><SIcon name="circle-help" size={48} strokeWidth={2}/></div>
          <div className="subm-result__title">Почти — споткнулся в шаге 3</div>
          <div className="subm-result__sub">Закон сохранения записан верно, но при подстановке потерялась двойка. Сократ задаст наводящий вопрос — давай разберёмся.</div>
          <div className="subm-result__highlight">
            <div className="subm-result__highlight-label">Шаг 3 на твоём фото</div>
            <div className="subm-result__highlight-frag">kx² / 2 = mv²</div>
          </div>
          <div className="subm-result__cta">
            <button className="subm-btn subm-btn--ghost" onClick={onClose}>Закрыть</button>
            <button className="subm-btn subm-btn--primary" onClick={onClose}><SIcon name="message-square" size={16} strokeWidth={2}/>Обсудить с Сократом</button>
          </div>
        </div>
      )}
    </div>);
}

// ─── Mobile layout ────────────────────────────────────────
function ProblemMobile() {
  const [collapsed, setCollapsed] = useState(true);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("chat");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitState, setSubmitState] = useState("idle");
  const [answerVal, setAnswerVal] = useState({ numeric: "", text: "", photos: [], voice: null });
  const draftCount = (answerVal.numeric ? 1 : 0) + answerVal.photos.length + (answerVal.text ? 1 : 0) + (answerVal.voice ? 1 : 0);
  const submit = () => {
    setSubmitState("checking");
    setTimeout(() => setSubmitState("step-error"), 2400);
  };
  return (
    <div className="problem-mobile">
      <div className="problem-mobile__top">
        <button className="problem-mobile__back"><SIcon name="chevron-left" size={22} strokeWidth={2} /></button>
        <div className="problem-mobile__top-title">
          <div className="problem-mobile__top-eyebrow">Задача 3 / 9 · {PROBLEM_CONTEXT.hw.subject}</div>
          <div className="problem-mobile__top-name">{PROBLEM_CONTEXT.hw.title}</div>
        </div>
      </div>
      <ProblemContext collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} compact />
      <div className="problem-mobile__chat">
        {CHAT_THREAD.map((m, i) => <ChatMessage key={i} msg={m} />)}
      </div>
      <ComposerMobile draft={draft} setDraft={setDraft} onSubmit={() => setDraft("")} onOpenSubmit={() => setSubmitOpen(true)} draftCount={draftCount}/>
      <SubmitSheet
        open={submitOpen}
        onClose={() => { setSubmitOpen(false); setSubmitState("idle"); }}
        taskKind="extended" unit="м/с"
        state={submitState}
        value={answerVal} onChange={setAnswerVal}
        savedAt="Черновик сохранён · 12 сек назад"
        onSubmit={submit}/>
    </div>);

}

// ─── Tablet split ─────────────────────────────────────────
function ProblemTablet() {
  const [draft, setDraft] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitState, setSubmitState] = useState("idle");
  const [answerVal, setAnswerVal] = useState({ numeric: "", text: "", photos: [], voice: null });
  const draftCount = (answerVal.numeric ? 1 : 0) + answerVal.photos.length + (answerVal.text ? 1 : 0) + (answerVal.voice ? 1 : 0);
  const submit = () => { setSubmitState("checking"); setTimeout(() => setSubmitState("step-error"), 2400); };
  return (
    <div className="problem-split problem-split--tablet">
      <div className="problem-split__left">
        <div className="problem-split__top">
          <button className="problem-split__back"><SIcon name="chevron-left" size={20} strokeWidth={2} />Все задачи ДЗ</button>
          <span className="problem-split__crumbs">{PROBLEM_CONTEXT.hw.subject} · {PROBLEM_CONTEXT.hw.title}</span>
        </div>
        <div className="problem-split__problem">
          <ProblemContext collapsed={false} onToggle={() => {}} />
        </div>
        <SubmitCTA onOpenSubmit={() => setSubmitOpen(true)} draftCount={draftCount} savedAt="сохранено"/>
      </div>
      <div className="problem-split__right">
        <div className="problem-split__chat-head">
          <SokratAvatar size={28} />
          <div>
            <div className="problem-split__chat-name">Сократ</div>
            <div className="problem-split__chat-sub">наводит на решение, не подсказывает ответ</div>
          </div>
        </div>
        <div className="problem-split__chat">
          {CHAT_THREAD.map((m, i) => <ChatMessage key={i} msg={m} big />)}
        </div>
        <Composer value={draft} onChange={setDraft} onSubmit={() => setDraft("")} big onOpenSubmit={() => setSubmitOpen(true)} />
      </div>
      <SubmitSheet
        open={submitOpen}
        onClose={() => { setSubmitOpen(false); setSubmitState("idle"); }}
        taskKind="extended" unit="м/с"
        state={submitState}
        value={answerVal} onChange={setAnswerVal}
        savedAt="Черновик сохранён · 12 сек назад"
        onSubmit={submit}/>
    </div>);

}

// ─── Desktop split ────────────────────────────────────────
function ProblemDesktop() {
  const [draft, setDraft] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitState, setSubmitState] = useState("idle");
  const [answerVal, setAnswerVal] = useState({ numeric: "", text: "", photos: [], voice: null });
  const draftCount = (answerVal.numeric ? 1 : 0) + answerVal.photos.length + (answerVal.text ? 1 : 0) + (answerVal.voice ? 1 : 0);
  const submit = () => { setSubmitState("checking"); setTimeout(() => setSubmitState("step-error"), 2400); };
  return (
    <div className="problem-split problem-split--desktop">
      <div className="problem-split__left">
        <div className="problem-split__top">
          <button className="problem-split__back"><SIcon name="chevron-left" size={20} strokeWidth={2} />Все задачи ДЗ</button>
          <span className="problem-split__crumbs">{PROBLEM_CONTEXT.hw.subject} · {PROBLEM_CONTEXT.hw.title}</span>
          <div className="problem-split__top-r">
            <span className="problem-split__top-meta"><SIcon name="clock-3" size={14} strokeWidth={2} />15 мин в сессии</span>
            <span className="problem-split__top-meta"><SIcon name="award" size={14} strokeWidth={2} />+12 XP</span>
          </div>
        </div>
        <div className="problem-split__problem">
          <ProblemContext collapsed={false} onToggle={() => {}} />
          <div className="problem-split__hints">
            <div className="problem-split__hints-head">
              <SIcon name="lightbulb" size={16} strokeWidth={2} />
              Подсказки
              <span className="problem-split__hints-count">1 из 3 открыто</span>
            </div>
            <div className="problem-split__hint">
              <span className="problem-split__hint-num">1</span>
              <div>Запиши закон сохранения энергии: вся потенциальная энергия пружины перейдёт в кинетическую.</div>
            </div>
            <button className="problem-split__hint-locked">
              <span className="problem-split__hint-num problem-split__hint-num--locked">2</span>
              <span>Открыть подсказку 2 из 3</span>
              <SIcon name="lock" size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
        <SubmitCTA onOpenSubmit={() => setSubmitOpen(true)} draftCount={draftCount} savedAt="сохранено"/>
      </div>
      <div className="problem-split__right">
        <div className="problem-split__chat-head">
          <SokratAvatar size={32} />
          <div>
            <div className="problem-split__chat-name">Сократ <span className="problem-split__chat-badge">AI</span></div>
            <div className="problem-split__chat-sub">наводит на решение, не подсказывает ответ</div>
          </div>
        </div>
        <div className="problem-split__chat">
          {CHAT_THREAD.map((m, i) => <ChatMessage key={i} msg={m} big />)}
        </div>
        <Composer value={draft} onChange={setDraft} onSubmit={() => setDraft("")} big onOpenSubmit={() => setSubmitOpen(true)} />
      </div>
      <SubmitSheet
        open={submitOpen}
        onClose={() => { setSubmitOpen(false); setSubmitState("idle"); }}
        taskKind="extended" unit="м/с"
        state={submitState}
        value={answerVal} onChange={setAnswerVal}
        savedAt="Черновик сохранён · 12 сек назад"
        onSubmit={submit}/>
    </div>);

}

Object.assign(window, { ProblemMobile, ProblemTablet, ProblemDesktop, SokratAvatar, SubmitSheet, PhotoStrip, VoiceRecorder, SubmitResult, SubmitCTA });