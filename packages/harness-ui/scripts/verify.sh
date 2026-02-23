#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src"
MAX_LOC=1000
FAIL=0

echo "=== harness-ui v3 verification ==="
echo ""

# 1. LOC check
echo "--- LOC check (max $MAX_LOC per file) ---"
while IFS= read -r -d '' file; do
  lines=$(wc -l < "$file")
  rel="${file#$ROOT/}"
  if [ "$lines" -gt "$MAX_LOC" ]; then
    echo "FAIL: $rel ($lines lines > $MAX_LOC)"
    FAIL=1
  else
    echo "  ok: $rel ($lines)"
  fi
done < <(find "$SRC" -name '*.ts' -not -path '*/node_modules/*' -print0 | sort -z)

echo ""

# 2. No 'any' in strict TypeScript
echo "--- No 'any' type usage ---"
ANY_COUNT=$(grep -rn ': any' "$SRC" --include='*.ts' | grep -v '// eslint-disable' | grep -v 'test' || true)
if [ -n "$ANY_COUNT" ]; then
  echo "FAIL: Found 'any' usage:"
  echo "$ANY_COUNT"
  FAIL=1
else
  echo "  ok: no 'any' found"
fi

echo ""

# 3. No harness-app imports (packages/harness-ui must not import src/*)
echo "--- No app-layer imports ---"
APP_IMPORTS=$(grep -rn "from '.*src/" "$SRC" --include='*.ts' | grep -v 'harness-ui/src' || true)
if [ -n "$APP_IMPORTS" ]; then
  echo "FAIL: harness-ui imports app-layer code:"
  echo "$APP_IMPORTS"
  FAIL=1
else
  echo "  ok: no app-layer imports"
fi

echo ""

# 4. Run tests
echo "--- Tests ---"
cd "$ROOT/../.."
V3_TESTS=$(find test/unit/ui -name 'ui-color.test.ts' -o -name 'ui-cell-buffer.test.ts' -o -name 'ui-widget.test.ts' -o -name 'ui-flex-layout.test.ts' -o -name 'ui-renderer.test.ts' -o -name 'ui-reactive.test.ts' -o -name 'ui-message.test.ts' -o -name 'ui-input-parse.test.ts' -o -name 'ui-focus.test.ts' -o -name 'ui-keybinding.test.ts' -o -name 'ui-theme.test.ts' -o -name 'ui-pilot.test.ts' -o -name 'ui-vte.test.ts' -o -name 'ui-frame-buffer.test.ts' -o -name 'ui-app-lifecycle.test.ts' | sort)
E2E_TESTS=$(find test -path '*/e2e/*.e2e.test.ts' 2>/dev/null | sort)
ALL_V3="$V3_TESTS $E2E_TESTS"
ALL_V3=$(echo "$ALL_V3" | xargs)
if [ -n "$ALL_V3" ]; then
  bun test $ALL_V3 2>&1 | tail -5
else
  echo "  no v3 tests found"
fi

echo ""

if [ "$FAIL" -eq 1 ]; then
  echo "=== VERIFICATION FAILED ==="
  exit 1
else
  echo "=== VERIFICATION PASSED ==="
fi
