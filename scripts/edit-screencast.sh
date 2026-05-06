#!/usr/bin/env bash
#
# edit-screencast.sh — reusable ffmpeg pipeline для landing-grade screencasts
#
# Usage: ./edit-screencast.sh <spec-file.md> <output.mp4>
#
# Spec file format — см. docs/delivery/features/tutor-landing/screencast-edit-spec-template.md
#
# Зависимости:
#   - ffmpeg 4.4+ (Linux: apt install ffmpeg; Mac: brew install ffmpeg)
#   - DejaVu Sans Bold (Cyrillic-ready, обычно уже установлен)
#
# Цикл работы:
#   1. Записать raw screencast (любым средством — QuickTime, OBS, ScreenStudio)
#   2. Скопировать spec template, заполнить timecodes + overlays
#   3. ./edit-screencast.sh spec.md output.mp4
#   4. Проверить результат → подложить в public/marketing/tutor-landing/
#

set -euo pipefail

SPEC_FILE="${1:?Usage: $0 <spec-file.md> <output.mp4>}"
OUTPUT="${2:?Usage: $0 <spec-file.md> <output.mp4>}"

if [[ ! -f "$SPEC_FILE" ]]; then
  echo "ERROR: spec file not found: $SPEC_FILE" >&2
  exit 1
fi

# ============================================================
# 1. Парсинг spec.md
# ============================================================
# Spec format (см. template):
#
#   SOURCE: /path/to/raw.mp4
#   FONT: /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
#
#   ## Segments
#   | seg | source_start | source_end | speed |
#   |-----|--------------|------------|-------|
#   | 1   | 12           | 18         | 2.0   |
#   ...
#
#   ## Overlays
#   | from_t | to_t | text                              | bg     |
#   |--------|------|-----------------------------------|--------|
#   | 0.3    | 2.7  | AI-проверка ДЗ                    | slate  |
#   ...
#

SOURCE=$(awk '/^#*[[:space:]]*SOURCE:/ {sub(/^#*[[:space:]]*SOURCE:[[:space:]]*/, ""); print; exit}' "$SPEC_FILE")
FONT=$(awk '/^#*[[:space:]]*FONT:/ {sub(/^#*[[:space:]]*FONT:[[:space:]]*/, ""); print; exit}' "$SPEC_FILE")

[[ -z "$FONT" ]] && FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

if [[ ! -f "$SOURCE" ]]; then
  echo "ERROR: source video not found: $SOURCE" >&2
  exit 1
fi

if [[ ! -f "$FONT" ]]; then
  echo "ERROR: font file not found: $FONT" >&2
  echo "Try: apt install fonts-dejavu (Linux) or brew install --cask font-dejavu (Mac)" >&2
  exit 1
fi

echo "Source: $SOURCE"
echo "Font: $FONT"
echo "Output: $OUTPUT"

# ============================================================
# 2. Извлечь segments (cuts + speed)
# ============================================================
SEGMENTS=$(awk '
  /^## Segments/ { in_seg=1; next }
  /^## / && !/^## Segments/ { in_seg=0 }
  in_seg && /^\| *[0-9]/ {
    gsub(/[ \t]/, "")
    n = split($0, f, "|")
    print f[3] "," f[4] "," f[5]
  }
' "$SPEC_FILE")

if [[ -z "$SEGMENTS" ]]; then
  echo "ERROR: no segments found in spec" >&2
  exit 1
fi

# Build filter_complex string for cuts
FILTER_PARTS=""
SEG_LABELS=""
i=0
while IFS=, read -r START END SPEED; do
  [[ -z "$START" || -z "$END" || -z "$SPEED" ]] && continue
  i=$((i+1))
  LABEL="v${i}"
  FILTER_PARTS+="[0:v]trim=start=${START}:end=${END},setpts=(PTS-STARTPTS)/${SPEED},scale=1920:-2[${LABEL}];"
  SEG_LABELS+="[${LABEL}]"
done <<< "$SEGMENTS"

CONCAT_FILTER="${FILTER_PARTS}${SEG_LABELS}concat=n=${i}:v=1:a=0[vout]"

INTER="${OUTPUT%.mp4}.intermediate.mp4"

echo ""
echo "Step 1/2: cuts + speed → ${INTER}"
ffmpeg -y -hide_banner -loglevel warning -i "$SOURCE" \
  -filter_complex "$CONCAT_FILTER" \
  -map "[vout]" -an -c:v libx264 -preset fast -crf 23 -movflags +faststart \
  "$INTER"

INTER_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INTER")
echo "Intermediate duration: ${INTER_DUR}s"

# ============================================================
# 3. Извлечь overlays + применить drawtext
# ============================================================
OVERLAYS=$(awk '
  /^## Overlays/ { in_ov=1; next }
  /^## / && !/^## Overlays/ { in_ov=0 }
  in_ov && /^\| *[0-9]/ {
    n = split($0, f, "|")
    # Trim each field
    for (j=1;j<=n;j++) { gsub(/^ +| +$/, "", f[j]) }
    # Output: from_t|to_t|text|bg
    printf "%s\037%s\037%s\037%s\n", f[2], f[3], f[4], f[5]
  }
' "$SPEC_FILE")

OVERLAY_DIR=$(mktemp -d)
trap "rm -rf $OVERLAY_DIR" EXIT

DRAWTEXT_FILTERS=""
o=0
while IFS=$'\037' read -r FROM_T TO_T TEXT BG; do
  [[ -z "$FROM_T" || -z "$TO_T" || -z "$TEXT" ]] && continue
  o=$((o+1))
  TXT_FILE="$OVERLAY_DIR/o${o}.txt"
  printf '%s' "$TEXT" > "$TXT_FILE"

  # Background color: slate (default), green, ochre
  case "$BG" in
    green) BG_COLOR="0x1B6B4AD9" ;;  # socrat-green-700, 85% opacity
    ochre) BG_COLOR="0xE8913AD9" ;;  # socrat-ochre-500, 85% opacity
    *)     BG_COLOR="0x0F172AB3" ;;  # slate-900, 70% opacity (default)
  esac

  [[ -n "$DRAWTEXT_FILTERS" ]] && DRAWTEXT_FILTERS+=","
  DRAWTEXT_FILTERS+="drawtext=fontfile=${FONT}:textfile=${TXT_FILE}:fontcolor=white:fontsize=44:x=(w-text_w)/2:y=h-160:enable='between(t,${FROM_T},${TO_T})':box=1:boxcolor=${BG_COLOR}:boxborderw=18"
done <<< "$OVERLAYS"

echo ""
echo "Step 2/2: ${o} overlays → ${OUTPUT}"

if [[ -z "$DRAWTEXT_FILTERS" ]]; then
  echo "WARNING: no overlays defined; copying intermediate"
  cp "$INTER" "$OUTPUT"
else
  ffmpeg -y -hide_banner -loglevel warning -i "$INTER" \
    -vf "$DRAWTEXT_FILTERS" \
    -an -c:v libx264 -preset medium -crf 22 -movflags +faststart \
    "$OUTPUT"
fi

# ============================================================
# 4. Cleanup + report
# ============================================================
rm -f "$INTER"

FINAL_SIZE=$(du -h "$OUTPUT" | cut -f1)
FINAL_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUTPUT")

echo ""
echo "=========================================="
echo "Done: $OUTPUT"
echo "Duration: ${FINAL_DUR}s"
echo "Size: ${FINAL_SIZE}"
echo "Segments: ${i}"
echo "Overlays: ${o}"
echo "=========================================="
