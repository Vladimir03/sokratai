#!/bin/bash
# Upload KB task graphs to Supabase Storage bucket 'kb-attachments'
# Run from project root after generating SVGs in kb-graphs/
#
# Prerequisites:
# - supabase CLI installed and linked to project
# - kb-attachments bucket exists (created in kb_knowledge_base migration)
#
# Usage: bash scripts/upload-kb-graphs.sh

set -euo pipefail

BUCKET="kb-attachments"
PREFIX="demidova2025"
SRC_DIR="kb-graphs"

if [ ! -d "$SRC_DIR" ]; then
  echo "Error: $SRC_DIR directory not found. Run generate_kb_graphs.py first."
  exit 1
fi

echo "Uploading SVGs to Supabase Storage: $BUCKET/$PREFIX/"

for svg in "$SRC_DIR"/z1_*.svg; do
  filename=$(basename "$svg")
  echo "  Uploading $filename..."
  npx supabase storage cp "$svg" "sb://$BUCKET/$PREFIX/$filename" --content-type "image/svg+xml"
done

echo ""
echo "Done! $( ls -1 "$SRC_DIR"/z1_*.svg | wc -l ) files uploaded."
echo ""
echo "Verify: npx supabase storage ls sb://$BUCKET/$PREFIX/"
