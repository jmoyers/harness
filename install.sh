#!/usr/bin/env bash
set -euo pipefail

BUN_INSTALL_URL="https://bun.sh/install"
RUSTUP_INSTALL_URL="https://sh.rustup.rs"
MIN_BUN_VERSION="1.3.9"
HARNESS_PACKAGE="@jmoyers/harness@latest"

DRY_RUN=false
SKIP_HARNESS_INSTALL=false
FORCE_HARNESS_INSTALL=false

usage() {
  cat <<'EOF'
usage: install.sh [--dry-run] [--skip-harness-install] [--force-harness-install] [--package <pkg>] [--help]

Bootstraps a machine for Harness by ensuring:
- Bun (>= 1.3.9)
- Rust toolchain (cargo + rustc)
- optional global Harness install (`bun add -g --trust @jmoyers/harness@latest`)

Flags:
  --dry-run                Print actions without executing them.
  --skip-harness-install   Only install prerequisites (Bun + Rust).
  --force-harness-install  Reinstall/upgrade Harness even if already present.
  --package <pkg>          Override package spec (default: @jmoyers/harness@latest).
  --help                   Show this help text.
EOF
}

log() {
  echo "[harness-install] $*"
}

fail() {
  echo "[harness-install] error: $*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

path_prepend_once() {
  local path_segment="$1"
  case ":${PATH}:" in
    *":${path_segment}:"*) ;;
    *)
      export PATH="${path_segment}:${PATH}"
      ;;
  esac
}

run_cmd() {
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] $*"
    return
  fi
  "$@"
}

run_sh() {
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] $*"
    return
  fi
  sh -c "$*"
}

is_root() {
  [[ "$(id -u)" == "0" ]]
}

run_as_root() {
  if is_root; then
    run_cmd "$@"
    return
  fi
  if command_exists sudo; then
    run_cmd sudo "$@"
    return
  fi
  fail "need root privileges to run: $* (install sudo or run as root)"
}

ensure_curl() {
  if command_exists curl; then
    log "curl already installed."
    return
  fi

  log "curl not found; attempting package-manager install."
  if command_exists apt-get; then
    run_as_root apt-get update
    run_as_root apt-get install -y curl ca-certificates
    return
  fi
  if command_exists dnf; then
    run_as_root dnf install -y curl ca-certificates
    return
  fi
  if command_exists yum; then
    run_as_root yum install -y curl ca-certificates
    return
  fi
  if command_exists pacman; then
    run_as_root pacman -Sy --noconfirm curl ca-certificates
    return
  fi
  if command_exists zypper; then
    run_as_root zypper --non-interactive install curl ca-certificates
    return
  fi
  if command_exists brew; then
    run_cmd brew install curl
    return
  fi

  fail "curl is required but no supported package manager was detected"
}

ensure_bun_archiver_tools() {
  local needs_unzip=false
  local needs_xz=false
  if ! command_exists unzip; then
    needs_unzip=true
  fi
  if ! command_exists xz; then
    needs_xz=true
  fi
  if [[ "$needs_unzip" == "false" && "$needs_xz" == "false" ]]; then
    log "bun installer archiver dependencies already installed."
    return
  fi

  log "installing bun installer archiver dependencies."
  if command_exists apt-get; then
    run_as_root apt-get update
    run_as_root apt-get install -y unzip xz-utils
    return
  fi
  if command_exists dnf; then
    run_as_root dnf install -y unzip xz
    return
  fi
  if command_exists yum; then
    run_as_root yum install -y unzip xz
    return
  fi
  if command_exists pacman; then
    run_as_root pacman -Sy --noconfirm unzip xz
    return
  fi
  if command_exists zypper; then
    run_as_root zypper --non-interactive install unzip xz
    return
  fi
  if command_exists brew; then
    run_cmd brew install unzip xz
    return
  fi

  fail "bun installer requires unzip/xz but no supported package manager was detected"
}

normalize_semver() {
  local version="${1#v}"
  version="${version%%-*}"
  echo "$version"
}

semver_gte() {
  local lhs rhs
  local lmajor lminor lpatch rmajor rminor rpatch
  lhs="$(normalize_semver "$1")"
  rhs="$(normalize_semver "$2")"

  IFS='.' read -r lmajor lminor lpatch <<<"$lhs"
  IFS='.' read -r rmajor rminor rpatch <<<"$rhs"

  lmajor="${lmajor:-0}"
  lminor="${lminor:-0}"
  lpatch="${lpatch:-0}"
  rmajor="${rmajor:-0}"
  rminor="${rminor:-0}"
  rpatch="${rpatch:-0}"

  if ((lmajor > rmajor)); then
    return 0
  fi
  if ((lmajor < rmajor)); then
    return 1
  fi
  if ((lminor > rminor)); then
    return 0
  fi
  if ((lminor < rminor)); then
    return 1
  fi
  if ((lpatch >= rpatch)); then
    return 0
  fi
  return 1
}

refresh_bun_path() {
  local bun_home="${BUN_INSTALL:-$HOME/.bun}"
  path_prepend_once "${bun_home}/bin"
}

source_cargo_env_if_present() {
  local env_path="$HOME/.cargo/env"
  if [[ -f "$env_path" ]]; then
    # shellcheck disable=SC1090
    source "$env_path"
  fi
}

refresh_rust_path() {
  path_prepend_once "$HOME/.cargo/bin"
  if [[ "${HARNESS_INSTALL_INCLUDE_SYSTEM_RUST_PATH:-1}" != "0" ]]; then
    path_prepend_once "/usr/local/cargo/bin"
  fi
}

ensure_bun() {
  refresh_bun_path
  if command_exists bun; then
    local bun_version
    bun_version="$(bun --version)"
    if semver_gte "$bun_version" "$MIN_BUN_VERSION"; then
      log "Bun ${bun_version} already installed."
      return
    fi
    log "Bun ${bun_version} is older than required ${MIN_BUN_VERSION}; upgrading."
  else
    log "Bun not found; installing."
  fi

  ensure_curl
  ensure_bun_archiver_tools
  run_sh "curl -fsSL ${BUN_INSTALL_URL} | bash"
  refresh_bun_path
  if [[ "$DRY_RUN" == "true" ]]; then
    return
  fi
  if ! command_exists bun; then
    fail "Bun installation completed but bun was not found in PATH"
  fi
  local installed_version
  installed_version="$(bun --version)"
  if ! semver_gte "$installed_version" "$MIN_BUN_VERSION"; then
    fail "installed Bun version ${installed_version} is below required ${MIN_BUN_VERSION}"
  fi
  log "Bun ${installed_version} ready."
}

ensure_rust() {
  refresh_rust_path
  source_cargo_env_if_present
  if command_exists cargo && command_exists rustc; then
    log "Rust toolchain already installed."
    return
  fi

  log "Rust toolchain not found; installing."
  ensure_curl
  run_sh "curl --proto '=https' --tlsv1.2 -sSf ${RUSTUP_INSTALL_URL} | sh -s -- -y"
  source_cargo_env_if_present
  refresh_rust_path
  if [[ "$DRY_RUN" == "true" ]]; then
    return
  fi
  if ! command_exists cargo || ! command_exists rustc; then
    fail "Rust installation completed but cargo/rustc were not found in PATH"
  fi
  log "Rust toolchain ready."
}

install_harness() {
  if [[ "$SKIP_HARNESS_INSTALL" == "true" ]]; then
    log "Skipping Harness package install by request."
    return
  fi

  if command_exists harness && [[ "$FORCE_HARNESS_INSTALL" != "true" ]]; then
    log "Harness is already installed at $(command -v harness); skipping package install."
    return
  fi

  log "Installing ${HARNESS_PACKAGE} globally with Bun."
  run_cmd bun add -g --trust "$HARNESS_PACKAGE"
  if [[ "$DRY_RUN" == "true" ]]; then
    return
  fi
  if ! command_exists harness; then
    fail "Harness install reported success but harness command is not available in PATH"
  fi
  log "Harness install complete."
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --dry-run)
        DRY_RUN=true
        ;;
      --skip-harness-install)
        SKIP_HARNESS_INSTALL=true
        ;;
      --force-harness-install)
        FORCE_HARNESS_INSTALL=true
        ;;
      --package)
        shift
        if (($# == 0)); then
          fail "missing value for --package"
        fi
        HARNESS_PACKAGE="$1"
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        fail "unknown argument: $1"
        ;;
    esac
    shift
  done
}

main() {
  parse_args "$@"
  ensure_bun
  ensure_rust
  install_harness
  log "done."
}

main "$@"
