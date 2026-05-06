# Screencast Edit Spec — TEMPLATE

**Use this template для каждого нового screencast** (Tour #2 Конструктор / Tour #3 Отчёт / Freemium / etc.)

## Workflow

1. Скопируй этот template как `screencast-edit-spec-tour-N.md`
2. Заполни SOURCE path + Segments + Overlays
3. Запусти: `bash scripts/edit-screencast.sh path/to/spec.md path/to/output.mp4`
4. Проверь результат → подложи в `public/marketing/tutor-landing/`

---

## SOURCE: /sessions/clever-magical-ritchie/mnt/uploads/Скринкаст 2.mp4

## FONT: /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf

<!--
SOURCE = absolute path к raw screencast (uploaded или local)
FONT = path к Cyrillic-ready bold font; default DejaVu Sans Bold OK для русского

В sandbox файлы из uploads/ доступны по пути:
  /sessions/<session>/mnt/uploads/<filename>
В Mac/Linux:
  /Users/.../path/to/raw.mp4
-->

---

## Segments

Каждый сегмент = (start_sec_в_source, end_sec_в_source, speed_multiplier).

**Правила пейсинга:**
- **Main beats** (ключевые value props, первое явление функции) — speed 1.0× (не ускорять, visitor должен прочитать UI)
- **Transitions / navigation** — speed 1.5-2.5× (visitor не должен читать промежуточные states)
- **Idle / loading / mouse-traveling** — cut entirely (не включать в spec)
- **Total target длина:** 15-35 сек (Tour #1 flagship — до 35; остальные — 15-20)

| seg | source_start | source_end | speed |
|-----|--------------|------------|-------|
| 1   | 0            | 6          | 2.0   |
| 2   | 8            | 16         | 1.6   |
| 3   | 18           | 26         | 1.0   |
| 4   | 30           | 40         | 1.5   |

<!--
Примеры скоростей:
- 1.0×: показываем UI, ученик/репетитор читает текст, ключевая reveal
- 1.5×: фокусированный clicking sequence (5-7 клик-actions без чтения)
- 2.0×: navigation, scroll, mouse перемещения
- 2.5×: open dialogs, page transitions

Выходная длина = sum((end - start) / speed) per segment
Пример: (6/2) + (8/1.6) + (8/1) + (10/1.5) = 3 + 5 + 8 + 6.7 = 22.7 sec
-->

---

## Overlays

Text overlays на key моментах timeline **финального видео** (не source).

**Правила:**
- Каждый overlay должен быть видим **минимум 2 сек** (visitor успел прочесть)
- Между overlays — gap **минимум 0.5 сек** (visitor успел перевести взгляд)
- Не overlap'ать overlays (пересекающиеся `enable='between(t,...)'` — рендерится оба сразу)
- Tone of voice: glance-readable, max 5-7 слов
- bg color: `slate` (default — slate-900 70%), `green` (socrat-green-700 85% — для main wins / closing), `ochre` (socrat-ochre-500 85% — для action triggers)

| from_t | to_t | text                              | bg     |
|--------|------|-----------------------------------|--------|
| 0.3    | 2.7  | AI-проверка ДЗ — за минуты        | slate  |
| 3.5    | 7.5  | Кликаешь на ученицу               | slate  |
| 8.5    | 11.5 | AI пишет фидбек                   | slate  |
| 12.5   | 16   | В твоём стиле — отправляешь       | slate  |
| 18     | 22   | 20 работ за 40 минут              | green  |

<!--
Доступные backgrounds:
- slate (default): полупрозрачный тёмно-slate, для primary readability
- green: socrat-green-700, для wins / outcomes / closing CTA
- ochre: socrat-ochre-500, для action / discount / urgency

Position: всегда нижняя треть экрана, центрированный horizontal
Font size: 44 px (default — fits ~50 chars per line)
-->

---

## Output spec (auto-applied by script)

- Format: MP4 H.264
- Resolution: 1920×{auto} (preserves source aspect ratio)
- Audio: stripped (`-an`)
- Bitrate: ~500 kbps (CRF 22)
- Faststart: yes (web optimization)
- Size target: ≤ 2 MB для landing autoplay

---

## Example: tour-1-ai-check.mp4 (как был сделан 2026-04-26)

### SOURCE: /sessions/.../uploads/Скринкаст 1.mp4
### FONT: /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf

### Segments

| seg | source_start | source_end | speed |
|-----|--------------|------------|-------|
| 1   | 12           | 18         | 2.0   |
| 2   | 28           | 36         | 1.6   |
| 3   | 33           | 40         | 1.0   |
| 4   | 60           | 68         | 2.0   |
| 5   | 80           | 87         | 1.0   |
| 6   | 104          | 114        | 2.5   |

### Overlays

| from_t | to_t | text                                       | bg     |
|--------|------|--------------------------------------------|--------|
| 0.3    | 2.7  | AI-проверка ДЗ — видишь, кто справился     | slate  |
| 3.5    | 7.5  | Кликаешь на ученицу — видишь её диалог     | slate  |
| 8.5    | 10.7 | AI проверяет краткие ответы                | slate  |
| 12     | 14.7 | AI говорит, что исправить                  | slate  |
| 15.5   | 18.5 | И рукописные тоже                          | green  |
| 19.5   | 21.5 | AI читает формулы и графики                | slate  |
| 23.7   | 25.5 | И пишет фидбек в твоём стиле               | slate  |
| 26.7   | 29.7 | 20 работ за 40 минут вместо 3 часов        | green  |

**Result:** 30.08 sec, 1920×898, 1.84 MB, 8 overlays.

---

## Tips для подготовки spec.md

1. **Просмотри raw screencast** в любом player'е, отметь timecodes ключевых моментов
2. **Идентифицируй 2-3 main beats** — кадры где repeать должен задержаться (1.0× speed)
3. **Между beats — transitions** (1.5-2.5× speed)
4. **Cut idle время** (loading, mouse traveling) — не включать в Segments
5. **Overlays — minimal** — 4-7 штук на видео, по 2-3 сек каждый
6. **Closing overlay = outcome** («20 работ за 40 минут», «5 минут вместо часа», «Бесплатно навсегда»)

---

## Reusing для других tours

Для каждого tour создай свой spec по этому template:

- `screencast-edit-spec-tour-1.md` — AI-проверка ДЗ ✅ done 2026-04-26
- `screencast-edit-spec-tour-2.md` — Конструктор ДЗ (после raw записи)
- `screencast-edit-spec-tour-3.md` — Отчёт родителю (после raw записи)
- `screencast-edit-spec-freemium.md` — Оплаты + расписание (после raw записи)

Pipeline:
```
raw.mp4 → spec.md (manual write) → edit-screencast.sh → final.mp4 → public/marketing/tutor-landing/
```
