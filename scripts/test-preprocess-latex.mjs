#!/usr/bin/env node
// preprocessLatex: формулы столбиком vs втягивание в предложение.
//
// Репорт Ульяны (химия, 2026-08-04): «чтобы был не строчка а столбик, после
// знака доллар нужно ставить точку. Это мне Егор подсказал. Не очень красиво
// но норм». Приём расползался между репетиторами как фольклор.
//
// Корень: два глобальных регэкспа через `\n` втягивали формулу в предложение
// без разбора и склеивали ЛЮБЫЕ две формулы на соседних строках.
//
// Главный риск правки — сломать физику, ради которой правила и писались,
// поэтому её кейс залочен явно; плюс залочен уже написанный контент с точками.
//
// Run: node scripts/test-preprocess-latex.mjs (или npm test — секция 28)

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

function bundleTs(relPath) {
  const entry = fileURLToPath(new URL(`../${relPath}`, import.meta.url));
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    alias: { "@": srcDir },
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64")
  );
}

const { preprocessLatex: pre } = await bundleTs("src/components/kb/ui/preprocessLatex.ts");

const lines = (s) => s.split("\n").filter((l) => l.trim().length > 0).length;

test("РЕГРЕСС-ЗАМОК: одиночная формула по-прежнему втягивается в предложение", () => {
  // Ровно тот кейс, ради которого правила писались (физика).
  assert.equal(
    pre("С крыши высотой\n$$H = 45$$\nметров"),
    "С крыши высотой $H = 45$ метров",
  );
  assert.equal(
    pre("Скорость равна\n$v = 10$\nм/с"),
    "Скорость равна $v = 10$ м/с",
  );
});

test("химия: два уравнения подряд встают СТОЛБИКОМ (без точек)", () => {
  const src = "$\\ce{Fe + S -> FeS}$\n$\\ce{Zn + 2HCl -> ZnCl2 + H2}$";
  const out = pre(src);
  assert.equal(lines(out), 2, `ожидали 2 строки, получили:\n${out}`);
  assert.ok(out.includes("\n"), "перенос между формулами сохранён");
});

test("химия: три уравнения — три строки", () => {
  const src = [
    "$\\ce{Fe + S -> FeS}$",
    "$\\ce{2Na + Cl2 -> 2NaCl}$",
    "$\\ce{CaO + H2O -> Ca(OH)2}$",
  ].join("\n");
  assert.equal(lines(pre(src)), 3);
});

test("СОВМЕСТИМОСТЬ: уже написанный контент с точками остаётся столбиком", () => {
  // Её текущие задачи в БД. После правки они не должны «поехать».
  const src = "$\\ce{Fe + S -> FeS}$.\n$\\ce{2Na + Cl2 -> 2NaCl}$.";
  assert.equal(lines(pre(src)), 2, "точки больше не нужны, но и не мешают");
});

test("блочные $$…$$ на соседних строках тоже столбиком", () => {
  // normalizeBlockPairs демотит короткие $$…$$ в инлайн — раньше они после
  // этого склеивались в строчку, и получить столбик было нельзя ВООБЩЕ.
  const src = "$$\\ce{Fe + S -> FeS}$$\n$$\\ce{2Na + Cl2 -> 2NaCl}$$";
  assert.equal(lines(pre(src)), 2);
});

test("пустая строка между формулами не склеивает их", () => {
  const src = "$\\ce{Fe + S -> FeS}$\n\n$\\ce{2Na + Cl2 -> 2NaCl}$";
  const out = pre(src);
  assert.equal(lines(out), 2);
});

test("список с уравнениями не схлопывается в строчку", () => {
  // Цепочка превращений: «1) …», «2) …» / «а) …», «б) …».
  const src = "1) горение: $\\ce{S + O2 -> SO2}$\n2) окисление: $\\ce{2SO2 + O2 -> 2SO3}$";
  assert.equal(lines(pre(src)), 2, "пункты списка остаются отдельными строками");
  const cyr = "а) $\\ce{S + O2 -> SO2}$\nб) $\\ce{2SO2 + O2 -> 2SO3}$";
  assert.equal(lines(pre(cyr)), 2, "кириллические метки тоже");
  const dash = "- $\\ce{S + O2 -> SO2}$\n- $\\ce{2SO2 + O2 -> 2SO3}$";
  assert.equal(lines(pre(dash)), 2, "маркеры-дефисы тоже");
});

test("прозаический перенос вокруг формулы всё ещё склеивается", () => {
  // Не список и не две формулы → прежнее поведение.
  assert.equal(
    pre("подставим\n$x = 2$\nв уравнение"),
    "подставим $x = 2$ в уравнение",
  );
});

test("идемпотентность: pre(pre(x)) === pre(x)", () => {
  // ProblemChatMessage вызывает preprocessLatex и передаёт результат в
  // MathText, который зовёт его ещё раз — двойной прогон обязан быть no-op.
  const samples = [
    "С крыши высотой\n$$H = 45$$\nметров",
    "$\\ce{Fe + S -> FeS}$\n$\\ce{Zn + 2HCl -> ZnCl2}$",
    "1) $\\ce{S + O2 -> SO2}$\n2) $\\ce{2SO2 + O2 -> 2SO3}$",
    "текст без формул\nвторая строка",
  ];
  for (const s of samples) {
    const once = pre(s);
    assert.equal(pre(once), once, `не идемпотентно для: ${JSON.stringify(s)}`);
  }
});

test("прочие преобразования не задеты", () => {
  assert.equal(pre("\\(x\\)"), "$x$", "инлайн \\(…\\)");
  assert.equal(pre("\\textfrac{1}{2}"), "\\frac{1}{2}");
  // Соседние блочные пары не сливаются (готча из истории файла).
  const long = "A".repeat(50);
  const out = pre(`$$${long}$$ Y $$${long}$$`);
  assert.ok(out.includes(`$$${long}$$`), "длинные блоки остались блоками");
  assert.ok(!out.includes("$Y$"), "закрывающий+открывающий не слились в пару");
});

test("текст без формул не трогается вовсе", () => {
  const src = "Первая строка\nВторая строка\n\nТретья";
  assert.equal(pre(src), src);
});
