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

echo ""
echo "=== Smoke Test Complete ==="
