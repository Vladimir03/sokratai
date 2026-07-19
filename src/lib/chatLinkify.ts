// Линкификация URL в чате репетитор↔ученик (запрос Елены 2026-07-13:
// «ссылка получилась некликабельной»).
//
// ЕДИНСТВЕННЫЙ источник URL-детекта для чат-поверхностей. Правила:
//   • БЕЗ lookbehind (rule 80, Safari < 16.4 — smoke-check-enforced);
//   • детектим: явный http(s)://, www.*, и БЕЗ протокола — только наш домен
//     sokratai.ru/… (общий bare-domain дал бы ложные срабатывания — решение
//     владельца);
//   • граница слова проверяется КОДОМ (символ перед матчем), не регэкспом;
//   • трейлинг-пунктуация (точка в конце предложения и т.п.) не входит в ссылку.
//
// НЕ трогает guided-ДЗ чат и AI-чат ученика (ReactMarkdown-поверхности) —
// скоуп зафиксирован владельцем: только «Чаты».

const URL_CANDIDATE_RE = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+|sokratai\.ru(?:\/[^\s<>]*)?)/gi;

/** Символ ПЕРЕД матчем, при котором матч НЕ ссылка (кусок слова/домена/email). */
const BAD_BOUNDARY_BEFORE_RE = /[\p{L}\p{N}.@/-]/u;

/** Трейлинг-пунктуация, которая почти наверняка часть предложения, не URL. */
const TRAILING_PUNCT_RE = /[.,!?;:'"»›\]]+$/;
/** HTML-entity хвосты для escaped-варианта («url&quot;» / «url&#39;»). */
const TRAILING_ENTITY_RE = /(?:&quot;|&#39;|&amp;)$/;
/**
 * Bidi-control символы (RLO и семейство): визуально маскируют адрес
 * («ревью 5.6 р.3 #3») — кандидат с ними ссылкой НЕ становится.
 */
const BIDI_CONTROL_RE = /[‪-‮⁦-⁩]/;

interface UrlMatch {
  start: number;
  end: number; // exclusive, после трима
  raw: string; // текст ссылки как в сообщении (после трима)
  href: string; // валидированный href (протокол дополнен)
  internal: boolean; // наш домен → same-tab
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

function trimTrailing(raw: string, escapedEntities: boolean): string {
  let out = raw;
  // Итеративно: «url).» → «url)» → «url». Закрывающая скобка отрезается по
  // БАЛАНСУ пар (ревью 5.6 р.3 #6): «(https://a.ru/x(b))» — обе «)» его.
  for (;;) {
    const before = out;
    if (escapedEntities) out = out.replace(TRAILING_ENTITY_RE, '');
    out = out.replace(TRAILING_PUNCT_RE, '');
    while (out.endsWith(')') && countChar(out, ')') > countChar(out, '(')) {
      out = out.slice(0, -1);
    }
    if (out === before) break;
  }
  return out;
}

function buildHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/**
 * Единственная точка валидации кандидата (ревью 5.6 р.3 #3): парсим ОДИН раз;
 * userinfo-трюк «https://sokratai.ru@evil.example» (hostname = evil) и
 * bidi-маскировка адреса ссылкой не становятся. null = оставить текстом.
 */
function validateCandidate(raw: string): { href: string; internal: boolean } | null {
  if (BIDI_CONTROL_RE.test(raw)) return null;
  const href = buildHref(raw);
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  return { href, internal: host === 'sokratai.ru' || host === 'www.sokratai.ru' };
}

function extractUrlMatches(text: string, escapedEntities: boolean): UrlMatch[] {
  const matches: UrlMatch[] = [];
  URL_CANDIDATE_RE.lastIndex = 0; // /g statefulness
  let m: RegExpExecArray | null;
  while ((m = URL_CANDIDATE_RE.exec(text)) !== null) {
    const start = m.index;
    const prev = start > 0 ? text[start - 1] : '';
    // Граница слова кодом (без lookbehind): «api.sokratai.ru» без протокола не
    // должен матчиться с середины, «слово.ru» — тем более.
    if (prev && BAD_BOUNDARY_BEFORE_RE.test(prev)) continue;
    const raw = trimTrailing(m[0], escapedEntities);
    // Санити: у ссылки должен остаться host с точкой и хоть что-то после схемы.
    if (raw.length < 8 && !raw.startsWith('www.') && !raw.startsWith('sokratai.ru')) continue;
    if (!raw.includes('.')) continue;
    const validated = validateCandidate(raw);
    if (!validated) continue;
    matches.push({ start, end: start + raw.length, raw, ...validated });
  }
  return matches;
}

export interface ChatLinkPart {
  kind: 'link';
  text: string;
  href: string;
  internal: boolean;
}
export interface ChatTextPart {
  kind: 'text';
  text: string;
}
export type ChatMessagePart = ChatLinkPart | ChatTextPart;

/** Разбивка сырого текста сообщения на текст/ссылки (React-потребитель, без innerHTML). */
export function splitTextToLinkParts(text: string): ChatMessagePart[] {
  const matches = extractUrlMatches(text, false);
  if (matches.length === 0) return [{ kind: 'text', text }];
  const parts: ChatMessagePart[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) {
      parts.push({ kind: 'text', text: text.slice(cursor, match.start) });
    }
    parts.push({ kind: 'link', text: match.raw, href: match.href, internal: match.internal });
    cursor = match.end;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}

/** Быстрый детект «в тексте есть ссылка» (гейт fast-path MathText). */
export function containsChatUrl(text: string): boolean {
  return extractUrlMatches(text, false).length > 0;
}

// touch-manipulation — анти-300ms-delay на iOS (rule 80). 44px hit-area для
// INLINE-ссылок в тексте сообщения намеренно НЕ делаем (сломала бы типографику;
// Telegram/WhatsApp рендерят inline-ссылки высотой строки — индустриальная норма).
const LINK_CLASS = 'text-accent underline underline-offset-2 break-all touch-manipulation';

/**
 * Линкификация УЖЕ escapeHtml-нутого текста (HTML-путь MathText, ответы
 * СократAI). Кавычки экранированы ДО нас → инъекция в href невозможна;
 * `&amp;` внутри href браузер декодирует обратно в `&` — URL корректен.
 * `lineBreakToken` — плейсхолдер переносов MathText: линкуем построчно, иначе
 * `_` плейсхолдера засосало бы в URL-класс символов.
 */
export function linkifyEscapedHtml(escaped: string, lineBreakToken?: string): string {
  const lines = lineBreakToken ? escaped.split(lineBreakToken) : [escaped];
  const linkified = lines.map((line) => {
    const matches = extractUrlMatches(line, true);
    if (matches.length === 0) return line;
    let out = '';
    let cursor = 0;
    for (const match of matches) {
      out += line.slice(cursor, match.start);
      const external = match.internal
        ? ''
        : ' target="_blank" rel="noopener noreferrer nofollow"';
      out += `<a href="${match.href}" class="${LINK_CLASS}"${external}>${match.raw}</a>`;
      cursor = match.end;
    }
    out += line.slice(cursor);
    return out;
  });
  return lineBreakToken ? linkified.join(lineBreakToken) : linkified[0];
}
