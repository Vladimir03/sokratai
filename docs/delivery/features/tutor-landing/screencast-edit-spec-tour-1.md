# Tour #1 — AI-проверка ДЗ + сократовский диалог

**Status:** EDITED v3 2026-04-26 (после Vladimir review v2)
**Source:** Скринкаст Егора (116 sec raw, 7.5 MB, 2200×1030)
**Output:** `public/marketing/tutor-landing/tour-1-ai-check.mp4` (32.08 sec, 2.4 MB, 1920×1030)

**v3 fixes:**
- ✅ Overlay «И пишет фидбек в твоём стиле» теперь **над AI textual response** («Молодец!»), не над handwritten work
- ✅ Чёрная полоса справа удалена через `crop=1920:1030:0:0` (source имел 280px right padding)
- ✅ Output 1920×1030 (native, без letterbox)
- ✅ Narrative arc: handwritten reveal → AI находит ошибку → AI хвалит за исправление

## SOURCE: /sessions/clever-magical-ritchie/mnt/uploads/Скринкаст 1.mp4

## FONT: /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf

---

## Segments (v3 — corrected after Vladimir review)

| seg | source_start | source_end | speed | output | content |
|-----|--------------|------------|-------|--------|---------|
| 1   | 12           | 18         | 2.0   | 3 sec  | Heatmap результатов «Ученики и задачи» |
| 2   | 28           | 36         | 1.6   | 5 sec  | Drill-down на ученицу Злату |
| 3   | 33           | 40         | 1.0   | 7 sec  | Q&A краткий ответ: «13» → ошибка → «23» → верно |
| 4   | 64           | 68         | 1.0   | 4 sec  | Handwritten zoom — фото тетради visible |
| 5   | 76           | 82         | 1.0   | 6 sec  | AI находит ошибку в рукописи («Под корнем отношение q/m...») |
| 6   | 95           | 99         | 1.0   | 4 sec  | AI хвалит за исправление («Все верно... Молодец!») |
| 7   | 104          | 113        | 3.0   | 3 sec  | Возврат в heatmap — общий итог |

**Output duration:** 3 + 5 + 7 + 4 + 6 + 4 + 3 = **32 sec** ✓

**Source coverage kept:** 6 + 8 + 7 + 4 + 6 + 4 + 9 = 44 sec / 116 sec = **38%** of original (compressed 3.6×)

**Crop applied:** `crop=1920:1030:0:0` на каждый segment — убирает 280px чёрного с правой стороны source 2200×1030.

---

## Overlays

| from_t | to_t | text                                       | bg     | over segment |
|--------|------|--------------------------------------------|--------|--------------|
| 0.3    | 2.7  | AI-проверка ДЗ — видишь, кто справился     | slate  | 1 (heatmap)  |
| 3.5    | 7.5  | Кликаешь на ученицу — видишь её диалог     | slate  | 2 (drill)    |
| 8.5    | 10.7 | AI проверяет краткие ответы                | slate  | 3 (Q&A)      |
| 12     | 14.7 | AI говорит, что исправить                  | slate  | 3 (Q&A)      |
| 15.5   | 18.5 | И рукописные тоже                          | green  | 4 (handwritten reveal) |
| 19.5   | 22.5 | AI читает формулы и графики                | slate  | 5 (AI находит ошибку) |
| 25     | 27.5 | И пишет фидбек в твоём стиле               | slate  | 6 (AI «Молодец!») |
| 29.3   | 31.7 | 20 работ за 40 минут вместо 3 часов        | green  | 7 (closing)  |

**8 overlays** distributed across 32-sec timeline. 2 «outcome» overlays (sec 15.5 + 29.3) с green backdrop — signal wins.

**v3 important shift:** «И пишет фидбек в твоём стиле» теперь sec 25-27.5 (на segment 6 — AI textual response «Молодец!»), не sec 23.7-25.5 (как было в v2 — над handwritten itself). Vladimir's feedback addressed.

---

## Run command (для voспроизведения)

```bash
bash scripts/edit-screencast.sh \
  docs/delivery/features/tutor-landing/screencast-edit-spec-tour-1.md \
  public/marketing/tutor-landing/tour-1-ai-check.mp4
```

---

## Editing notes

**Что было в raw 116 sec:**
1. sec 0-12 — список ДЗ в кабинете (cut, не используем)
2. sec 12-28 — heatmap результатов с учениками + scrolling (segment 1: 12-18 = 6 sec at 2× = 3 sec)
3. sec 28-48 — drill-down на Злату + чтение thread'а с короткими ответами «13», «23» + AI-feedback (segments 2-3: 28-40 = 12 sec)
4. sec 48-72 — открытие условия задачи в учебнике + переход на handwritten (segment 4: 60-68 = 8 sec at 2× = 4 sec)
5. sec 72-100 — фото тетради + AI-feedback на рукопись (segment 5: 80-87 = 7 sec at 1×)
6. sec 100-116 — return в heatmap (segment 6: 104-114 = 10 sec at 2.5× = 4 sec)

**Cuts removed:**
- sec 0-12 (тематический список — не value)
- sec 18-28 (long scroll heatmap — speed-up didn't work, cut entirely)
- sec 40-60 (long pause reading условие — cut)
- sec 68-80 (slow handwritten panning — cut, jump to clean tablet shot)
- sec 87-104 (long static handwritten feedback view — cut)
- sec 114-116 (closing static — cut)

Final: 6 segments, 8 overlays, 30 sec polished video.

---

## Known limitations V1

- ❌ Cursor highlight отсутствует (deferred V2 — Егор re-records через ScreenStudio)
- ❌ Zoom-in на ключевые UI states (e.g. AI feedback text) не сделано (manual в CapCut V2)
- ✅ Cuts + speed + text overlays = 80% landing-grade quality at 5 minutes work

V2 polish: ~30 минут manual работы в CapCut Desktop добавит cursor effects + zoom-in на 2-3 ключевые reveals.
