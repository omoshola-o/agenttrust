#!/usr/bin/env bash
# AgentTrust installer
# Usage: curl -fsSL https://raw.githubusercontent.com/omoshola-o/agenttrust/main/scripts/install.sh | bash
#
# Options (via env vars):
#   AGENTTRUST_VERSION  — specific version tag (default: latest)
#   AGENTTRUST_DIR      — install location (default: ~/.agenttrust/bin)

set -euo pipefail

# ── Config ───────────────────────────────────────────────────
REPO="omoshola-o/agenttrust"
INSTALL_DIR="${AGENTTRUST_DIR:-$HOME/.agenttrust/bin}"
MIN_NODE_VERSION=22

# ── Colors ───────────────────────────────────────────────────
bold="\033[1m"
green="\033[32m"
yellow="\033[33m"
red="\033[31m"
reset="\033[0m"

info()  { printf "${bold}${green}==>${reset} ${bold}%s${reset}\n" "$*"; }
warn()  { printf "${bold}${yellow}warning:${reset} %s\n" "$*"; }
error() { printf "${bold}${red}error:${reset} %s\n" "$*" >&2; }
die()   { error "$@"; exit 1; }

# ── Detect platform ──────────────────────────────────────────
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux*)  os="linux" ;;
    Darwin*) os="macos" ;;
    *)       die "Unsupported OS: $os. AgentTrust supports Linux and macOS." ;;
  esac

  case "$arch" in
    x86_64|amd64)  arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)             die "Unsupported architecture: $arch" ;;
  esac

  echo "${os}-${arch}"
}

# ── Check Node.js ────────────────────────────────────────────
check_node() {
  if ! command -v node &>/dev/null; then
    die "Node.js is required but not found. Install Node.js >= ${MIN_NODE_VERSION} first.
  https://nodejs.org/en/download"
  fi

  local node_version
  node_version="$(node -v | sed 's/^v//' | cut -d. -f1)"

  if [ "$node_version" -lt "$MIN_NODE_VERSION" ]; then
    die "Node.js >= ${MIN_NODE_VERSION} required (found v$(node -v | sed 's/^v//'))
  https://nodejs.org/en/download"
  fi
}

# ── Check npm ────────────────────────────────────────────────
check_npm() {
  if ! command -v npm &>/dev/null; then
    die "npm is required but not found. It ships with Node.js.
  https://nodejs.org/en/download"
  fi
}

# ── Install via npm (global) ────────────────────────────────
install_npm_global() {
  local version_flag=""
  if [ -n "${AGENTTRUST_VERSION:-}" ]; then
    version_flag="@${AGENTTRUST_VERSION}"
  fi

  info "Installing agenttrust${version_flag} via npm..."

  if npm install -g "agenttrust${version_flag}"; then
    return 0
  fi

  # If global install fails (permissions), try with npx advice
  warn "Global npm install failed. Trying alternative..."
  return 1
}

# ── Install via npm (local prefix) ──────────────────────────
install_npm_local() {
  local version_flag=""
  if [ -n "${AGENTTRUST_VERSION:-}" ]; then
    version_flag="@${AGENTTRUST_VERSION}"
  fi

  info "Installing to ${INSTALL_DIR}..."
  mkdir -p "$INSTALL_DIR"

  npm install --prefix "$INSTALL_DIR" "agenttrust${version_flag}" 2>/dev/null

  # Create symlink to the bin
  local bin_path="$INSTALL_DIR/node_modules/.bin/agenttrust"
  local link_path="$INSTALL_DIR/agenttrust"

  if [ -f "$bin_path" ]; then
    ln -sf "$bin_path" "$link_path"
    chmod +x "$link_path"
  else
    die "Installation succeeded but binary not found at $bin_path"
  fi
}

# ── Add to PATH ──────────────────────────────────────────────
ensure_path() {
  if [[ ":$PATH:" == *":${INSTALL_DIR}:"* ]]; then
    return 0
  fi

  local shell_name
  shell_name="$(basename "$SHELL")"
  local rc_file

  case "$shell_name" in
    zsh)  rc_file="$HOME/.zshrc" ;;
    bash) rc_file="$HOME/.bashrc" ;;
    fish) rc_file="$HOME/.config/fish/config.fish" ;;
    *)    rc_file="$HOME/.profile" ;;
  esac

  local path_line="export PATH=\"${INSTALL_DIR}:\$PATH\""
  if [ "$shell_name" = "fish" ]; then
    path_line="set -gx PATH ${INSTALL_DIR} \$PATH"
  fi

  if [ -f "$rc_file" ] && grep -q "agenttrust" "$rc_file" 2>/dev/null; then
    return 0
  fi

  printf "\n# AgentTrust\n%s\n" "$path_line" >> "$rc_file"
  warn "Added ${INSTALL_DIR} to PATH in ${rc_file}"
  warn "Run 'source ${rc_file}' or restart your terminal."
}

# ── Verify installation ─────────────────────────────────────
verify_install() {
  local agenttrust_bin

  # Check global first
  if command -v agenttrust &>/dev/null; then
    agenttrust_bin="$(command -v agenttrust)"
  elif [ -x "${INSTALL_DIR}/agenttrust" ]; then
    agenttrust_bin="${INSTALL_DIR}/agenttrust"
  else
    die "Installation completed but 'agenttrust' binary not found."
  fi

  local version
  version="$("$agenttrust_bin" --version 2>/dev/null || echo "unknown")"

  echo ""
  info "AgentTrust ${version} installed successfully!"
  echo ""
  printf "  ${bold}Location:${reset}  %s\n" "$agenttrust_bin"
  printf "  ${bold}Node.js:${reset}   %s\n" "$(node -v)"
  echo ""
  printf "  ${bold}Get started:${reset}\n"
  echo "    agenttrust init          # Initialize in your workspace"
  echo "    agenttrust status        # Dashboard overview"
  echo "    agenttrust doctor        # Health check"
  echo ""
  printf "  ${bold}Documentation:${reset}\n"
  echo "    https://github.com/${REPO}"
  echo ""
}

# ── Main ─────────────────────────────────────────────────────
main() {
  echo ""
  printf "${bold}AgentTrust Installer${reset}\n"
  printf "Trust & audit layer for AI agents\n\n"

  local platform
  platform="$(detect_platform)"
  info "Detected platform: ${platform}"

  check_node
  info "Node.js $(node -v) found"

  check_npm
  info "npm $(npm -v) found"

  # Try global install first, fall back to local
  if install_npm_global; then
    verify_install
  else
    install_npm_local
    ensure_path
    verify_install
  fi
}

main "$@"
