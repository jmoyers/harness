# Harness

Harness is a terminal-native workspace for running multiple coding-agent threads in parallel, without losing project context.

It is built for people who want to move faster than a single chat window: implementation, review, and follow-up work can run side by side in one keyboard-first interface.

## What matters most

- Parallel threads across `codex`, `claude`, `cursor`, `terminal`, and `critique`.
- One command palette (`ctrl+p` / `cmd+p`) to jump threads, run actions, and control workflow quickly.
- Command palette project actions can open the active project directory directly in installed local tools (`iTerm2`, `Ghostty`, `Zed`, `Cursor`, `VSCode`, `Warp`, `Finder`) and copy its path.
- Built-in update flow (`Update Harness`) and startup `What's New` modal with one-click update and quick links to full GitHub notes.
- Built-in diff subcommand (`harness diff`) with interactive pager-by-default UX, explicit scrollback output mode (`--no-pager`), syntax-aware rendering, and rpc/json event modes for automation.
- Long-running work survives reconnects through a detached gateway.
- Gateway control is resilient: lifecycle operations are lock-serialized per session, and missing stale records can be recovered automatically.
- Fast left-rail navigation across `Home`, `Tasks`, repositories, projects, and threads with automatic, readable thread titles.
- Built-in GitHub actions (`Open GitHub`, `Show My Open Pull Requests`, `Open PR`, `Create PR`) from inside Harness.
- Built-in Linear import action to create a Harness task directly from a selected Linear issue URL.

## Demo

![Harness multi-thread recording](assets/harness.gif)

## Quick start

Prerequisites:

- Bun `1.3.9+`
- At least one agent CLI (`codex`, `claude`, `cursor`, or `critique`)

Install and run:

```bash
# Bootstrap install
curl -fsSL https://raw.githubusercontent.com/jmoyers/harness/main/install.sh | bash

# Or run directly (no global install)
bunx @jmoyers/harness@latest

# Or install globally
bun add -g --trust @jmoyers/harness
harness
```

Use a named session when you want isolated state:

```bash
harness --session my-session
```

Named sessions automatically fall back to an available gateway port when the preferred port is already occupied. For deterministic restart/load diagnostics, you can still set an explicit non-default gateway port.

Standalone diff viewer (phase 1):

```bash
harness diff --help
```

## Typical workflow

1. Open Harness in your repository.
2. Start separate threads for implementation and review.
3. Use `ctrl+p` / `cmd+p` to switch context and run project actions.
4. Open or create a PR from the same workspace.

## User details

- Thread-scoped command palette (`[+ thread]`) can launch/install supported agent CLIs per project.
- Critique review actions are available from the global palette and run in a terminal thread.
- `ctrl+g` opens the project’s critique thread (or creates one if needed).
- `ctrl` and `cmd` shortcut chords are distinct; configure both explicitly when you want cross-platform parity.
- In terminal threads, most `ctrl`-only readline chords (for example `ctrl+r`, `ctrl+w`, `ctrl+u`, `ctrl+a`, `ctrl+e`, `ctrl+p`, `ctrl+n`) pass through to the shell; `ctrl+j/k` remain reserved for thread navigation.
- Theme selection is built in (`Set a Theme`) with OpenCode-compatible presets and live preview.
- API keys can be set directly from `ctrl+p` / `cmd+p` (`Set Anthropic API Key`, `Set OpenAI API Key`, `Set Linear API Key`), with overwrite warning and paste-friendly entry.
- OAuth login is available from CLI (`harness auth login github`, `harness auth login linear`) with `harness auth status|refresh|logout` for lifecycle control.
- Gateway maintenance supports named-session garbage collection: `harness gateway gc` prunes named session runtime directories older than 7 days (skips live sessions).
- Select a Linear issue URL in the terminal, then run `Create Task from Linear Ticket URL` from `ctrl+p` / `cmd+p` to import it into the task list.
- `Show What's New` opens release highlights (first lines only); if notes are empty it falls back to a simple version-available notice with links.
- `Update Harness` (aliases: `update`, `upgrade`) runs `harness update` in a terminal thread.
- `Create PR` uses `GITHUB_TOKEN` first, then `HARNESS_GITHUB_OAUTH_ACCESS_TOKEN`, and still falls back to an authenticated `gh` CLI session when needed.

## Configuration

Runtime behavior is controlled by `harness.config.jsonc`.

When upgrading from a workspace-local `.harness`, Harness automatically migrates legacy config into the global config location if that global config is still uninitialized (missing, empty, or default template), then removes stale local `.harness` folders once migration targets are confirmed.

Common customizations:

- Set `gateway.host` to bind/connect the gateway on a custom host/IP.
- Set install commands for `codex`, `claude`, `cursor`, and `critique`.
- Configure critique launch defaults.
- Customize keybindings.
- Override command palette project `Open in X` targets/detection/launch commands via `mux.openIn.targets`.
- Choose a theme preset or custom OpenCode-compatible theme file.

## License

MIT (`LICENSE`)
