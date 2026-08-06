import { describe, expect, it } from "vitest";

import {
  capHistoryWindow,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_MESSAGES,
  messageTextLength,
} from "./history_window.ts";

const msg = (content: unknown, role = "user") => ({ role, content });
const text = (chars: number, ch = "a") => ch.repeat(chars);

describe("messageTextLength", () => {
  it("считает строку", () => {
    expect(messageTextLength("привет")).toBe(6);
  });

  it("суммирует текстовые части multimodal-контента", () => {
    expect(messageTextLength([
      { type: "text", text: "abc" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      { type: "text", text: "de" },
    ])).toBe(5);
  });

  it("картинка не даёт длины (её бюджет — MAX_IMAGE_BYTES)", () => {
    expect(messageTextLength([{ type: "image_url", image_url: { url: text(10_000) } }])).toBe(0);
  });

  it("не падает на мусоре", () => {
    expect(messageTextLength(null)).toBe(0);
    expect(messageTextLength(undefined)).toBe(0);
    expect(messageTextLength(42)).toBe(0);
    expect(messageTextLength([null, 1, { text: 7 }])).toBe(0);
  });
});

describe("capHistoryWindow", () => {
  it("живой трафик (15 сообщений) проходит НЕТРОНУТЫМ", () => {
    // Главное свойство: гард — страховка, а не изменение поведения. Все три
    // клиента шлют ≤15 сообщений, и на них он не должен срабатывать никогда.
    const messages = Array.from({ length: 15 }, (_, i) => msg(text(300, String(i % 10))));
    const out = capHistoryWindow(messages);
    expect(out.dropped).toBe(0);
    expect(out.messages).toBe(messages);
  });

  it("пустой и одиночный массив не трогает", () => {
    expect(capHistoryWindow([])).toEqual({ messages: [], dropped: 0 });
    const one = [msg("вопрос")];
    expect(capHistoryWindow(one)).toEqual({ messages: one, dropped: 0 });
  });

  it("режет по числу сообщений, оставляя САМЫЕ СВЕЖИЕ", () => {
    const messages = Array.from({ length: 100 }, (_, i) => msg(`m${i}`));
    const out = capHistoryWindow(messages);
    expect(out.messages).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(out.dropped).toBe(70);
    expect((out.messages[0] as { content: string }).content).toBe("m70");
    expect((out.messages.at(-1) as { content: string }).content).toBe("m99");
  });

  it("режет по бюджету символов с самых старых", () => {
    // 10 сообщений по 10k символов = 100k > 60k.
    const messages = Array.from({ length: 10 }, (_, i) => msg(text(10_000, String(i))));
    const out = capHistoryWindow(messages);
    expect(out.dropped).toBeGreaterThan(0);
    const kept = out.messages.reduce(
      (sum, m) => sum + messageTextLength((m as { content: unknown }).content),
      0,
    );
    expect(kept).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    // Последнее сообщение — на месте.
    expect((out.messages.at(-1) as { content: string }).content[0]).toBe("9");
  });

  it("ПОСЛЕДНЕЕ сообщение не выбрасывается никогда — даже если одно больше бюджета", () => {
    // Иначе модель получила бы пустой запрос и ответила «на пустоту».
    const huge = msg(text(MAX_HISTORY_CHARS * 3));
    const out = capHistoryWindow([msg("старое"), huge]);
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toBe(huge);
    expect(out.dropped).toBe(1);
  });

  it("оба потолка применяются вместе", () => {
    const messages = Array.from({ length: 200 }, () => msg(text(5_000)));
    const out = capHistoryWindow(messages);
    expect(out.messages.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    const kept = out.messages.reduce(
      (sum, m) => sum + messageTextLength((m as { content: unknown }).content),
      0,
    );
    expect(kept).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
  });

  it("не мутирует входной массив", () => {
    const messages = Array.from({ length: 100 }, (_, i) => msg(`m${i}`));
    capHistoryWindow(messages);
    expect(messages).toHaveLength(100);
    expect((messages[0] as { content: string }).content).toBe("m0");
  });

  it("multimodal-сообщения переживают обрезку целиком", () => {
    const multimodal = msg([
      { type: "text", text: "решение на фото" },
      { type: "image_url", image_url: { url: "storage://x" } },
    ]);
    const messages = [...Array.from({ length: 60 }, (_, i) => msg(`m${i}`)), multimodal];
    const out = capHistoryWindow(messages);
    expect(out.messages.at(-1)).toBe(multimodal);
  });
});
