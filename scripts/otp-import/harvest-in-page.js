/* Харвестер Online Test Pad — исполняется В СТРАНИЦЕ кабинета репетитора
 * (app.onlinetestpad.com), под уже открытой сессией владельца аккаунта.
 *
 * Логин/пароль здесь не фигурируют и НИКОГДА не должны сюда попадать:
 * репозиторий публичный. Вход выполняет человек, скрипт работает в готовой сессии.
 *
 * Почему DOM, а не API: у /api/tests/{uid}/load короткоживущий токен, который
 * нам не нужен — редактор и так отрисовывает всё, включая ПРАВИЛЬНЫЙ ответ
 * (у выбора он размечен классом icon-chk-checked, у пропусков лежит в value).
 *
 * Почему iframe: страницы того же origin грузятся без навигации основной
 * вкладки, поэтому накопленный результат не теряется между тестами.
 *
 * Применение:
 *   1) открыть https://app.onlinetestpad.com/tests (залогиненным);
 *   2) вставить этот файл в консоль;
 *   3) await __otp.run([...uids]);           // можно частями
 *   4) __otp.download();                     // выгрузит harvest.json
 *   5) положить файл в scripts/otp-import/out/ и запустить transform.mjs
 */
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Текст элемента с сохранением переносов; sup/sub → LaTeX (innerText их теряет). */
  const clean = (el) => {
    if (!el) return '';
    const c = el.cloneNode(true);
    // Цифровой маркер пропуска «(1)» в верхнем индексе — НЕ формула. Обернуть его
    // в ^{} значит испортить русский текст («сия^{(1)}т»). LaTeX — только для
    // действительно математического содержимого.
    const plainIndex = (s) => /^[\d\s().,;–-]+$/.test(s.textContent.trim());
    c.querySelectorAll('sup').forEach((s) => s.replaceWith(plainIndex(s) ? s.textContent : '^{' + s.textContent.trim() + '}'));
    c.querySelectorAll('sub').forEach((s) => s.replaceWith(plainIndex(s) ? s.textContent : '_{' + s.textContent.trim() + '}'));
    c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    c.querySelectorAll('p,div').forEach((p) => p.append('\n'));
    return (c.textContent || '')
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ')
      .split('\n').map((s) => s.trim())
      .filter((s, i, a) => !(s === '' && a[i - 1] === ''))
      .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  /**
   * MATCH (соответствие). У OTP ДВЕ вёрстки этого типа: табличная
   * (`table.matching-tbl` со строками) и drag-drop (`lst1 drop-list` /
   * `lst2 drag-list` без таблиц). Общее у обеих: в левом списке у каждой
   * позиции есть `<select>`, чьё ВЫБРАННОЕ значение и есть верный ответ,
   * а в правом лежат варианты «ключ + текст».
   *
   * Ответ собирается как правые ключи по порядку левых позиций («19453768») —
   * ровно формат чекеров пробников (`gradeOrdered`).
   */
  const LEFT_LABELS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И'];
  const cleanInline = (el) => {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('select, option, input, button').forEach((e) => e.remove());
    c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    return (c.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  };
  const parseMatch = (host) => {
    const lst1 = host.querySelector('div.lst1');
    const lst2 = host.querySelector('div.lst2');
    if (!lst1 || !lst2) return null;
    const selects = Array.from(lst1.querySelectorAll('select'));
    if (!selects.length) return null;
    const left = selects.map((s, i) => {
      const row = s.closest('tr') || s.closest('.item') || s.parentElement;
      return { key: LEFT_LABELS[i] ?? String(i + 1), text: cleanInline(row) };
    });
    const answer = selects.map((s) => {
      const opt = Array.from(s.options).find((o) => o.value === s.value);
      return opt ? opt.text.trim() : '';
    }).join('');
    let rightNodes = Array.from(lst2.querySelectorAll('tr'));
    if (!rightNodes.length) rightNodes = Array.from(lst2.children).filter((n) => cleanInline(n));
    const right = rightNodes.map((n, i) => {
      const t = cleanInline(n);
      const m = t.match(/^(\d+)[).\s]\s*(.*)$/);
      return m ? { key: m[1], text: m[2] } : { key: String(i + 1), text: t };
    }).filter((r) => r.text);
    return { left, right, answer };
  };

  /** Четыре типа вопросов OTP, встреченные в базе Дианы. */
  const parseDoc = (doc) => {
    const out = [];
    Array.from(doc.querySelectorAll('div.qcontainer')).forEach((b) => {
      const rb = b.querySelector('test-question-view-rbchk');   // выбор варианта(ов)
      const fib = b.querySelector('test-question-view-fib');    // вставка пропусков
      const txt = b.querySelector('test-question-view-txt');    // строковый ответ
      const match = b.querySelector('test-question-view-match'); // соответствие
      const bare = clean(b);
      if (!rb && !fib && !txt && !match) {
        // Отдельный блок «Комментарий:» относится к предыдущему вопросу.
        if (/^Комментарий:/.test(bare) && out.length) {
          out[out.length - 1].solution = bare.replace(/^Комментарий:\s*/, '').trim();
        }
        return;
      }
      const qc = b.cloneNode(true);
      qc.querySelectorAll(
        'test-question-view-rbchk, test-question-view-fib, test-question-view-txt, test-question-view-match, input, textarea, button, label',
      ).forEach((e) => e.remove());
      const outerText = clean(qc)
        .replace(/^\d+\n\d+\s+из\s+\d+\n?/, '')
        .replace(/\nКомментарий:\s*$/, '').trim();
      // ⚠️ У FIB и TXT условие лежит ВНУТРИ самого элемента (пропуски инлайн),
      // поэтому вырезаем только поля ввода, а не весь элемент. Первая версия
      // сносила элемент целиком — 210 задач из 557 получались «пустой вопрос
      // + ответ», и проверка ответа этого не ловила.
      // Пропуск обозначен либо цифрой в <sup> («Всё сия(1)т»), либо ничем —
      // тогда сам инпут И ЕСТЬ пропуск, и его надо заменить на «..», иначе
      // слово склеивается («пятачк» вместо «пятач..к») и задача нечитаема.
      const innerOf = (host) => {
        const c2 = host.cloneNode(true);
        const hasMarkers = Array.from(host.querySelectorAll('sup')).some((s) => /\d/.test(s.textContent));
        c2.querySelectorAll('input, textarea').forEach((e) => e.replaceWith(hasMarkers ? '' : '..'));
        c2.querySelectorAll('button, label').forEach((e) => e.remove());
        return clean(c2).replace(/\n?Ответ:\s*$/, '').trim();
      };

      if (rb) {
        const items = Array.from(rb.querySelectorAll('.item'));
        out.push({
          type: 'choice',
          // чекбокс = несколько верных, радио = один
          kind: rb.querySelector('label.otp-checkbox') ? 'multi_choice' : 'single_choice',
          text: outerText,
          options: items.map((it, i) => ({ key: String(i + 1), text: clean(it.querySelector('test-question-ans-text')) })),
          answer: items
            .map((it, i) => ({ i, ok: !!it.querySelector('i.icon-chk-checked, i.icon-rb-checked') }))
            .filter((x) => x.ok).map((x) => String(x.i + 1)).join(''),
          solution: null,
        });
      } else if (fib) {
        // Последнее поле — итоговый ответ («1237»), предыдущие — буквы в пропусках.
        const vals = Array.from(fib.querySelectorAll('input[type=text]')).map((i) => i.value);
        out.push({
          type: 'fib',
          text: [outerText, innerOf(fib)].filter(Boolean).join('\n\n'),
          blanks: vals,
          answer: vals[vals.length - 1] ?? '',
          solution: null,
        });
      } else if (match) {
        const parsed = parseMatch(match);
        out.push({
          type: 'match',
          // ⚠️ Только outerText: сами списки уже уехали в left/right. Если
          // добавить innerOf(match), условие продублирует их текстом вперемешку
          // с номерами селектов («12попл...вушки»), и ученик увидит список дважды.
          text: outerText,
          left: parsed ? parsed.left : [],
          right: parsed ? parsed.right : [],
          answer: parsed ? parsed.answer : '',
          solution: null,
        });
      } else {
        const v = txt.querySelector('input[type=text], textarea');
        out.push({
          type: 'text',
          text: [outerText, innerOf(txt)].filter(Boolean).join('\n\n'),
          answer: v ? v.value : '',
          solution: null,
        });
      }
    });
    return out;
  };

  const harvestOne = async (uid, waitMs = 12000) => {
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:-9999px;width:1200px;height:900px';
    fr.src = `/tests/${uid}/questions`;
    document.body.appendChild(fr);
    const t0 = Date.now();
    try {
      while (Date.now() - t0 < waitMs) {
        await sleep(400);
        const d = fr.contentDocument;
        if (d && d.querySelectorAll('div.qcontainer').length > 0) { await sleep(700); break; }
      }
      const d = fr.contentDocument;
      if (!d || !d.querySelectorAll('div.qcontainer').length) return { uid, error: 'не отрисовалось' };
      return { uid, title: d.title.replace(/ - Online Test Pad$/, ''), questions: parseDoc(d) };
    } finally { fr.remove(); }
  };

  const store = new Map();
  window.__otp = {
    parseDoc,
    harvestOne,
    /** Прогнать список uid. concurrency>3 подвешивает рендерер — не поднимать. */
    async run(uids, concurrency = 3) {
      const queue = uids.filter((u) => !store.has(u));
      let i = 0;
      const worker = async () => {
        while (i < queue.length) {
          const uid = queue[i++];
          try { store.set(uid, await harvestOne(uid)); }
          catch (e) { store.set(uid, { uid, error: String(e && e.message || e) }); }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
      const all = [...store.values()];
      return {
        done: all.length,
        failed: all.filter((r) => r.error).map((r) => r.uid),
        tasks: all.reduce((n, r) => n + (r.questions ? r.questions.length : 0), 0),
      };
    },
    data: () => [...store.values()],
    /** Выгрузить как файл — данные не проходят через переписку. */
    download() {
      const blob = new Blob([JSON.stringify([...store.values()], null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'harvest.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
  };
  return 'ready: __otp.run([...uids]) → __otp.download()';
})();
