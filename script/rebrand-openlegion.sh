#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

rename_if_exists() {
  local src=$1 dst=$2
  if [ -e "$src" ] && [ ! -e "$dst" ]; then
    mv "$src" "$dst"
  fi
}

if [ "${REBRAND_SKIP_RENAME:-}" != "1" ]; then
  echo "==> Renaming directories and files..."
  rename_if_exists packages/openlegion packages/openlegion
  rename_if_exists .openlegion .openlegion
  rename_if_exists nix/openlegion.nix nix/openlegion.nix
  rename_if_exists .github/workflows/openlegion.yml .github/workflows/openlegion.yml
  rename_if_exists packages/openlegion/bin/openlegion packages/openlegion/bin/openlegion
  rename_if_exists packages/core/src/util/openlegion-process.ts packages/core/src/util/openlegion-process.ts
  rename_if_exists packages/core/src/plugin/provider/openlegion.ts packages/core/src/plugin/provider/openlegion.ts
  rename_if_exists packages/core/test/plugin/provider-openlegion.test.ts packages/core/test/plugin/provider-openlegion.test.ts
  rename_if_exists packages/ui/src/theme/themes/openlegion.json packages/ui/src/theme/themes/openlegion.json
  rename_if_exists packages/openlegion/src/cli/cmd/tui/context/theme/openlegion.json packages/openlegion/src/cli/cmd/tui/context/theme/openlegion.json
  rename_if_exists .openlegion/openlegion.jsonc .openlegion/openlegion.jsonc
  rename_if_exists specs/storage/remove-openlegion-db.md specs/storage/remove-openlegion-db.md
  rename_if_exists packages/openlegion/src/skill/prompt/customize-openlegion.md packages/openlegion/src/skill/prompt/customize-openlegion.md
  for f in packages/ui/src/assets/icons/provider/openlegion*.svg; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    rename_if_exists "$f" "$(dirname "$f")/${base//openlegion/openlegion}"
  done
  for f in packages/console/app/src/asset/brand/openlegion-* packages/console/app/src/asset/lander/openlegion-*; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    dir=$(dirname "$f")
    rename_if_exists "$f" "$dir/${base//openlegion/openlegion}"
  done
fi

echo "==> Replacing text across repository..."

export LC_ALL=C

while IFS= read -r -d '' file; do
  # Skip git objects and dependencies
  case "$file" in
    */.git/*|*/node_modules/*|*/dist/*|*/out/*|*/.turbo/*) continue ;;
  esac
  if file -b --mime-encoding "$file" 2>/dev/null | grep -q binary; then
    continue
  fi
  if ! grep -qE 'openlegion|OpenLegion|OPENCODE|@openlegion-ai' "$file" 2>/dev/null; then
    continue
  fi
  perl -i -pe '
    s/@openlegion-ai/@openlegion-ai/g;
    s/OPENLEGION_/OPENLEGION_/g;
    s/OpenLegion/OpenLegion/g;
    s/openlegion-ai/openlegion-ai/g;
    s|openlegion\.ai|openlegion.dev|g;
    s|dorman/OpenLegion|dorman/OpenLegion|g;
    s|packages/openlegion|packages/openlegion|g;
    s|\.openlegion|\.openlegion|g;
    s|openlegion:|openlegion:|g;
    s|openlegion\.global\.dat|openlegion.global.dat|g;
    s|openlegion\.jsonc|openlegion.jsonc|g;
    s|openlegion\.json\b|openlegion.json|g;
    s|openlegion-go|openlegion-go|g;
    s|remove-openlegion-db|remove-openlegion-db|g;
    s|customize-openlegion|customize-openlegion|g;
    s|provider-openlegion|provider-openlegion|g;
    s|openlegion-process|openlegion-process|g;
    s|nix/openlegion\.nix|nix/openlegion.nix|g;
    s|workflows/openlegion\.yml|workflows/openlegion.yml|g;
    s|\bopencode\b|openlegion|g;
  ' "$file"
done < <(find . -type f \
  ! -path './.git/*' \
  ! -path './node_modules/*' \
  ! -path './packages/*/node_modules/*' \
  ! -path './packages/*/dist/*' \
  ! -path './packages/*/out/*' \
  ! -path './bun.lock' \
  -print0)

echo "==> Rebrand script finished."
