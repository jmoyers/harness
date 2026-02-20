#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
repo_root="$(cd -P -- "${repo_root}" && pwd -P)"
script_root="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

if [[ "${repo_root}" != "${script_root}" ]]; then
  exit 0
fi

hooks_dir="${repo_root}/.githooks"
pre_commit_hook="${hooks_dir}/pre-commit"

if [[ ! -f "${pre_commit_hook}" ]]; then
  echo "[hooks] missing pre-commit hook at ${pre_commit_hook}" >&2
  exit 1
fi

chmod +x "${pre_commit_hook}"
git -C "${repo_root}" config --local core.hooksPath .githooks
