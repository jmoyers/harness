#!/usr/bin/env bash
set -euo pipefail

RUSTUP_INSTALL_URL="https://sh.rustup.rs"

add_cargo_to_path() {
  export PATH="$HOME/.cargo/bin:$PATH"
}

source_cargo_env_if_present() {
  local env_path="$HOME/.cargo/env"
  if [[ -f "$env_path" ]]; then
    # shellcheck disable=SC1090
    source "$env_path"
  fi
}

have_cargo() {
  command -v cargo >/dev/null 2>&1
}

print_rust_required_message() {
  cat <<'EOF' >&2
error: Rust toolchain is required to build the native PTY helper.

Install Rust manually:
  https://www.rust-lang.org/tools/install

Or allow automatic install (default behavior):
  bun install

To disable automatic install and fail fast:
  HARNESS_AUTO_INSTALL_RUST=0 bun install
EOF
}

install_rustup_noninteractive() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "error: curl is required to auto-install Rust with rustup." >&2
    print_rust_required_message
    exit 1
  fi
  echo "installing Rust toolchain via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf "$RUSTUP_INSTALL_URL" | sh -s -- -y
}

ensure_rust_toolchain() {
  add_cargo_to_path
  source_cargo_env_if_present
  if have_cargo; then
    return
  fi

  # Default to automatic rustup install for non-interactive setup flows.
  if [[ "${HARNESS_AUTO_INSTALL_RUST:-1}" == "0" ]]; then
    print_rust_required_message
    exit 1
  fi
  install_rustup_noninteractive

  source_cargo_env_if_present
  add_cargo_to_path
  if ! have_cargo; then
    echo "error: Rust installation completed but cargo was not found in PATH." >&2
    print_rust_required_message
    exit 1
  fi
}

ensure_rust_toolchain
cargo build --manifest-path native/ptyd/Cargo.toml --release
mkdir -p bin
cp native/ptyd/target/release/ptyd bin/ptyd
