#!/bin/bash
# Upload knowledge base to Supabase Storage for RAG bot.
#
# Prerequisites:
#   1. Create a storage bucket "rag-knowledge-base" in Supabase Dashboard → Storage
#      - Set it as PRIVATE (no public access)
#   2. Run parse_telegram.py to generate knowledge_base.txt
#   3. Set env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
#
# Usage:
#   ./scripts/upload-rag-kb.sh /path/to/knowledge_base.txt

set -euo pipefail

KB_FILE="${1:?Usage: $0 <path-to-knowledge_base.txt>}"
BUCKET="rag-knowledge-base"
OBJECT="knowledge_base.txt"

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "Error: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

echo "Uploading ${KB_FILE} to ${BUCKET}/${OBJECT}..."

curl -s -X POST \
  "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${OBJECT}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: text/plain; charset=utf-8" \
  -H "x-upsert: true" \
  --data-binary "@${KB_FILE}"

echo ""
echo "Done! Knowledge base uploaded."
echo "Size: $(wc -c < "${KB_FILE}") bytes"
