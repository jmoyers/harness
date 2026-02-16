#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
usage: scripts/migrate-to-bun.sh [--no-clean-node-modules] [--skip-build-ptyd] [--help]

Migrates a pulled checkout to the canonical Bun workflow by:
- removing legacy lockfiles
- optionally removing node_modules
- installing with bun.lock in frozen mode
- optionally rebuilding native PTY helper
EOF
}

clean_node_modules=true
build_ptyd=true

while (($# > 0)); do
  case "$1" in
    --no-clean-node-modules)
      clean_node_modules=false
      ;;
    --skip-build-ptyd)
      build_ptyd=false
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [[ ! -f package.json ]]; then
  echo "error: run this script from repository root" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "error: Bun is required but was not found in PATH." >&2
  echo "install Bun: https://bun.sh/docs/installation" >&2
  exit 1
fi

echo "bun version: $(bun --version)"
echo "note: existing SQLite runtime state under .harness/*.sqlite is preserved"

removed_lockfiles=()
for lockfile in package-lock.json pnpm-lock.yaml yarn.lock npm-shrinkwrap.json; do
  if [[ -f "$lockfile" ]]; then
    rm -f "$lockfile"
    removed_lockfiles+=("$lockfile")
  fi
done

if ((${#removed_lockfiles[@]} > 0)); then
  echo "removed legacy lockfiles: ${removed_lockfiles[*]}"
else
  echo "no legacy lockfiles found in repository root"
fi

if [[ -f .npmrc || -f .yarnrc || -f .yarnrc.yml || -f pnpm-workspace.yaml ]]; then
  echo "note: legacy package-manager config files detected; review whether they are still needed."
fi

if [[ "$clean_node_modules" == true && -d node_modules ]]; then
  echo "removing node_modules for a clean install"
  rm -rf node_modules
fi

echo "installing dependencies from bun.lock (frozen)"
bun install --frozen-lockfile

if [[ "$build_ptyd" == true ]]; then
  echo "building native PTY helper"
  bun run build:ptyd
fi

echo "migration complete"
echo "next recommended step: bun run verify"
