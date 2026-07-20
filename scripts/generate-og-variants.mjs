// dist/index.html → dist/invite-og.html: студенческий OG для путей /invite/* и
// /c/* (запрос №47, Елена: превью пригласительной ссылки в соцсетях показывало
// репетиторский лендинг «инструмент репетитора… 200 ₽» и пугало ученика).
//
// nginx на VPS отдаёт этот файл для location ^~ /invite/ и ^~ /c/ (rule 95,
// секция «OG-варианты») — боты соцсетей читают студенческие метатеги, а браузер
// грузит тот же SPA (asset-пути в dist абсолютные /assets/*, редиректов нет).
// Тексты зеркалят supabase/functions/invite-preview (generic, без имени
// репетитора — надёжность > персонализация, rule 96 #11a).
//
// Fail-loud: маркер не найден (кто-то переделал OG-блок index.html) → exit 1 —
// деплой падает видимо, а не тихо возит репетиторскую цену школьникам.
// Запускается как npm postbuild (прецедент: prebuild → generate-sitemap.mjs).
import { readFileSync, writeFileSync } from "node:fs";

const TITLE = "Тебя пригласили в Сократ AI";
const DESC =
  "Твой репетитор подключил тебя к Сократ AI — AI-помощнику для домашки. Открой, чтобы начать.";
const IMG = "https://sokratai.ru/sokrat-logo.png";

let html;
try {
  html = readFileSync("dist/index.html", "utf8");
} catch (e) {
  console.error(`[og-variants] cannot read dist/index.html: ${e.message}`);
  process.exit(1);
}

let failed = false;
const swap = (re, to, label) => {
  if (!re.test(html)) {
    console.error(`[og-variants] marker missing: ${label}`);
    failed = true;
    return;
  }
  html = html.replace(re, to);
};

swap(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`, "title");
swap(
  /<meta name="description" content="[^"]*"/,
  `<meta name="description" content="${DESC}"`,
  "description",
);
swap(
  /<meta property="og:title" content="[^"]*"/,
  `<meta property="og:title" content="${TITLE}"`,
  "og:title",
);
swap(
  /<meta property="og:description" content="[^"]*"/,
  `<meta property="og:description" content="${DESC}"`,
  "og:description",
);
swap(
  /<meta property="og:image" content="[^"]*"/,
  `<meta property="og:image" content="${IMG}"`,
  "og:image",
);
swap(
  /<meta name="twitter:card" content="[^"]*"/,
  `<meta name="twitter:card" content="summary"`,
  "twitter:card",
);
swap(
  /<meta name="twitter:title" content="[^"]*"/,
  `<meta name="twitter:title" content="${TITLE}"`,
  "twitter:title",
);
swap(
  /<meta name="twitter:description" content="[^"]*"/,
  `<meta name="twitter:description" content="${DESC}"`,
  "twitter:description",
);
swap(
  /<meta name="twitter:image" content="[^"]*"/,
  `<meta name="twitter:image" content="${IMG}"`,
  "twitter:image",
);
// Приглашения — множество персональных путей, не лендинг: noindex вместо canonical.
swap(
  /<link rel="canonical"[^>]*\/>\s*/,
  `<meta name="robots" content="noindex">\n    `,
  "canonical",
);
// og:url — canonical object-ID по OGP (ревью 5.6 P2 #1): оставить корневой —
// платформы склеили бы все приглашения с кэшем главной (старое репетиторское
// превью). Точный per-path URL в статический файл не вписать → УДАЛЯЕМ тег,
// скрейпер возьмёт request-URL.
swap(/<meta property="og:url" content="[^"]*"\s*\/>\s*/, "", "og:url");

if (failed) process.exit(1);

writeFileSync("dist/invite-og.html", html);
console.log("[og-variants] dist/invite-og.html written");
