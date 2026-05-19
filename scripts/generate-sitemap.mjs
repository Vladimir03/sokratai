// Runs before `vite dev` and `vite build` (predev/prebuild hooks).
// Writes public/sitemap.xml with public, indexable routes only.
// Private routes (/tutor/*, /student/*, /admin, /chat, /p/*, etc.) are excluded.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const BASE_URL = "https://sokratai.ru";
const today = new Date().toISOString().slice(0, 10);

const entries = [
  { path: "/", changefreq: "weekly", priority: "1.0", lastmod: today },
  { path: "/students", changefreq: "weekly", priority: "0.9", lastmod: today },
  { path: "/register-tutor", changefreq: "monthly", priority: "0.8", lastmod: today },
  { path: "/signup", changefreq: "monthly", priority: "0.7", lastmod: today },
  { path: "/login", changefreq: "monthly", priority: "0.5", lastmod: today },
  { path: "/tutor/login", changefreq: "monthly", priority: "0.5", lastmod: today },
  { path: "/offer", changefreq: "yearly", priority: "0.3", lastmod: today },
  { path: "/privacy-policy", changefreq: "yearly", priority: "0.3", lastmod: today },
  { path: "/requisites", changefreq: "yearly", priority: "0.3", lastmod: today },
];

function buildSitemap(items) {
  const urls = items.map((e) =>
    [
      "  <url>",
      `    <loc>${BASE_URL}${e.path}</loc>`,
      e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
      e.priority ? `    <priority>${e.priority}</priority>` : null,
      "  </url>",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
    "",
  ].join("\n");
}

const outPath = resolve("public/sitemap.xml");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, buildSitemap(entries));
console.log(`[sitemap] wrote ${entries.length} entries → ${outPath}`);