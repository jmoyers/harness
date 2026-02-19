# Harness

Harness is a terminal-native workspace for running multiple coding-agent threads in parallel, without losing project context.

It is built for people who want to move faster than a single chat window: implementation, review, and follow-up work can run side by side in one keyboard-first interface.

## What matters most

- Parallel threads across `codex`, `claude`, `cursor`, `terminal`, and `critique`.
- One command palette (`ctrl+p` / `cmd+p`) to jump threads, run actions, and control workflow quickly.
- Long-running work survives reconnects through a detached gateway.
- Gateway control is resilient: lifecycle operations are lock-serialized per session, and missing stale records can be recovered automatically.
- Fast left-rail navigation with automatic, readable thread titles.
- Built-in GitHub actions (`Open GitHub`, `Show My Open Pull Requests`, `Open PR`, `Create PR`) from inside Harness.

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

For restart/load diagnostics, use a named session with a non-default gateway port so you do not disrupt your active workspace gateway.

## Typical workflow

1. Open Harness in your repository.
2. Start separate threads for implementation and review.
3. Use `ctrl+p` / `cmd+p` to switch context and run project actions.
4. Open or create a PR from the same workspace.

## User details

- Thread-scoped command palette (`[+ thread]`) can launch/install supported agent CLIs per project.
- Critique review actions are available from the global palette and run in a terminal thread.
- `ctrl+g` opens the project’s critique thread (or creates one if needed).
- `ctrl` and `cmd` shortcut chords are mirrored in both directions when your terminal/OS does not reserve the combination.
- Theme selection is built in (`Set a Theme`) with OpenCode-compatible presets and live preview.
- API keys can be set directly from `ctrl+p` / `cmd+p` (`Set Anthropic API Key`, `Set OpenAI API Key`), with overwrite warning and paste-friendly entry.
- `Create PR` uses either `GITHUB_TOKEN` or an authenticated `gh` CLI session.

## Configuration

Runtime behavior is controlled by `harness.config.jsonc`.

When upgrading from a workspace-local `.harness`, Harness automatically migrates legacy config into the global config location if that global config is still uninitialized (missing, empty, or default template), then removes stale local `.harness` folders once migration targets are confirmed.

Common customizations:

- Set install commands for `codex`, `claude`, `cursor`, and `critique`.
- Configure critique launch defaults.
- Customize keybindings.
- Choose a theme preset or custom OpenCode-compatible theme file.

## License

MIT (`LICENSE`)
