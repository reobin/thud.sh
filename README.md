# thud.sh

A tiny tmux HUD for keeping agent work visible.

`thud` shows your tmux sessions, windows, panes, and agent status in one terminal view. Leave it open as a monitor, or invoke it for quick actions like jumping to the next pane that needs attention.

<img width="3840" height="2160" alt="screenshot-2026-05-30_13-15-03" src="https://github.com/user-attachments/assets/a77dc7bb-da24-4c0a-8871-64ad5d77ccda" />

## Install

Requirements:

- [tmux](https://github.com/tmux/tmux/wiki/Installing)
- [Bun](https://bun.sh/docs/installation)

Install with your package manager:

npm:

```sh
npm install -g thud.sh
```

Bun:

```sh
bun add -g thud.sh
```

pnpm:

```sh
pnpm add -g thud.sh
```

## Usage

```sh
thud
```

The app is keyboard-first and explains itself. Press `?` for shortcuts or `Ctrl+P` for commands.

Useful entry points:

```sh
thud jump
thud --mode=popup
thud help
thud version
```

Example tmux bindings:

```tmux
bind-key J run-shell 'thud jump "#{pane_id}"'
bind-key T display-popup -E -w 90% -h 90% 'thud --mode=popup'
```

## OpenCode status integration

To show OpenCode pane status in `thud`:

```sh
opencode plugin thud.sh
```

## Codex status integration

To show Codex CLI pane status in `thud`, add hooks to `~/.codex/config.toml`:

```toml
[hooks]
SessionStart = [{ hooks = [{ type = "command", command = "thud-codex-status" }] }]
UserPromptSubmit = [{ hooks = [{ type = "command", command = "thud-codex-status" }] }]
PreToolUse = [{ hooks = [{ type = "command", command = "thud-codex-status" }] }]
PermissionRequest = [{ hooks = [{ type = "command", command = "thud-codex-status" }] }]
PostToolUse = [{ hooks = [{ type = "command", command = "thud-codex-status" }] }]
Stop = [{ hooks = [{ type = "command", command = "thud-codex-status" }] }]
```

`PermissionRequest` is required for approval prompts to show as `waiting`. Codex
does not currently expose the same hook coverage for all interactive
`request_user_input` questions, so those prompts may still appear as `running`
until Codex emits a hook for that state.

## Development

```sh
bun install
bun run start
bun test
bun run build
```
