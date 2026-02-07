#!/bin/bash
# Smoke test: проверяет, что билд успешен и ключевые чанки существуют
# Запуск: bash scripts/smoke-test.sh

set -e

echo "=== SokratAI Smoke Test ==="
echo ""

# 1. Проверяем билд
echo "1. Building project..."
npm run build 2>&1

if [ $? -ne 0 ]; then
  echo "❌ BUILD FAILED"
  exit 1
fi
echo "✅ Build successful"
echo ""

# 2. Проверяем, что основные чанки существуют
echo "2. Checking chunks..."
DIST="dist/assets"

# Проверяем что framer-motion НЕ попал в основной бандл
echo "   Checking framer-motion isolation..."
MAIN_JS=$(ls $DIST/index-*.js 2>/dev/null | head -1)
if [ -n "$MAIN_JS" ] && grep -q "framer-motion" "$MAIN_JS" 2>/dev/null; then
  echo "   ⚠️  WARNING: framer-motion found in main bundle!"
else
  echo "   ✅ framer-motion is NOT in main bundle"
fi

# Проверяем наличие отдельного animations чанка
if ls $DIST/animations-*.js 1>/dev/null 2>&1; then
  ANIM_SIZE=$(wc -c < $(ls $DIST/animations-*.js | head -1))
  echo "   ✅ animations chunk exists ($(($ANIM_SIZE / 1024))KB)"
else
  echo "   ℹ️  No separate animations chunk (framer-motion may be tree-shaken or inlined)"
fi

# Проверяем что react-vendor существует
if ls $DIST/react-vendor-*.js 1>/dev/null 2>&1; then
  echo "   ✅ react-vendor chunk exists"
else
  echo "   ⚠️  WARNING: react-vendor chunk missing"
fi

echo ""

# 3. Проверяем размеры ключевых чанков
echo "3. Chunk sizes:"
for chunk in $DIST/*.js; do
  SIZE=$(wc -c < "$chunk")
  SIZE_KB=$(($SIZE / 1024))
  NAME=$(basename "$chunk")

  # Предупреждаем о больших чанках (>500KB)
  if [ $SIZE_KB -gt 500 ]; then
    echo "   ⚠️  $NAME: ${SIZE_KB}KB (LARGE!)"
  elif [ $SIZE_KB -gt 200 ]; then
    echo "   📦 $NAME: ${SIZE_KB}KB"
  fi
done

echo ""

# 4. Проверяем TypeScript ошибки
echo "4. Checking TypeScript..."
npx tsc --noEmit 2>&1
if [ $? -ne 0 ]; then
  echo "⚠️  TypeScript errors found (non-blocking)"
else
  echo "✅ No TypeScript errors"
fi

# 5. Проверяем кросс-браузерную совместимость (Safari/iOS)
echo "5. Cross-browser compatibility checks..."
COMPAT_WARNINGS=0

# Проверяем 100vh (ломает iOS Safari)
VH_FILES=$(grep -rn "100vh" src/ --include="*.tsx" --include="*.ts" --include="*.css" -l 2>/dev/null || true)
if [ -n "$VH_FILES" ]; then
  echo "   ⚠️  100vh found (breaks iOS Safari). Use 100dvh or -webkit-fill-available:"
  echo "$VH_FILES" | while read f; do echo "      - $f"; done
  COMPAT_WARNINGS=$((COMPAT_WARNINGS + 1))
fi

# Проверяем Date парсинг без ISO формата (ломает Safari)
DATE_SPACE=$(grep -rn 'new Date("[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\} ' src/ --include="*.tsx" --include="*.ts" -l 2>/dev/null || true)
if [ -n "$DATE_SPACE" ]; then
  echo "   ⚠️  Date parsing with space separator (breaks Safari). Use ISO format with T:"
  echo "$DATE_SPACE" | while read f; do echo "      - $f"; done
  COMPAT_WARNINGS=$((COMPAT_WARNINGS + 1))
fi

# Проверяем RegExp lookbehind (не работает в Safari < 16.4)
LOOKBEHIND=$(grep -rn '(?<=' src/ --include="*.tsx" --include="*.ts" -l 2>/dev/null || true)
if [ -n "$LOOKBEHIND" ]; then
  echo "   ⚠️  RegExp lookbehind found (Safari < 16.4). Use capturing groups instead:"
  echo "$LOOKBEHIND" | while read f; do echo "      - $f"; done
  COMPAT_WARNINGS=$((COMPAT_WARNINGS + 1))
fi

# Проверяем structuredClone (Safari < 15.4)
SCLONE=$(grep -rn 'structuredClone(' src/ --include="*.tsx" --include="*.ts" -l 2>/dev/null || true)
if [ -n "$SCLONE" ]; then
  echo "   ⚠️  structuredClone() found (Safari < 15.4). Use JSON.parse(JSON.stringify()) or lodash:"
  echo "$SCLONE" | while read f; do echo "      - $f"; done
  COMPAT_WARNINGS=$((COMPAT_WARNINGS + 1))
fi

# Проверяем .at() на массивах (Safari < 15.4)
DOT_AT=$(grep -rn '\.at(-' src/ --include="*.tsx" --include="*.ts" -l 2>/dev/null || true)
if [ -n "$DOT_AT" ]; then
  echo "   ⚠️  .at() found (Safari < 15.4). Use bracket notation:"
  echo "$DOT_AT" | while read f; do echo "      - $f"; done
  COMPAT_WARNINGS=$((COMPAT_WARNINGS + 1))
fi

# Проверяем маленький font-size на input (Safari iOS зумит)
SMALL_INPUT=$(grep -rn 'text-xs\|text-\[1[0-3]px\]\|font-size:\s*1[0-3]px' src/ --include="*.tsx" --include="*.ts" -l 2>/dev/null | xargs grep -l '<input\|<textarea\|<select\|<Input\|<Textarea\|<Select' 2>/dev/null || true)
if [ -n "$SMALL_INPUT" ]; then
  echo "   ⚠️  Small font-size on inputs found (Safari iOS auto-zooms < 16px):"
  echo "$SMALL_INPUT" | while read f; do echo "      - $f"; done
  COMPAT_WARNINGS=$((COMPAT_WARNINGS + 1))
fi

if [ $COMPAT_WARNINGS -eq 0 ]; then
  echo "   ✅ No cross-browser issues detected"
else
  echo "   ⚠️  $COMPAT_WARNINGS compatibility warning(s) found (non-blocking)"
fi

echo ""
echo "=== Smoke Test Complete ==="
