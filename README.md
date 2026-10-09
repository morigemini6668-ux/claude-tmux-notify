# claude-tmux-notify

A Claude Code plugin that shows a macOS notification when Claude finishes a turn.
Clicking the notification brings your terminal to the front and, when Claude runs
inside tmux, switches to the exact session, window and pane it came from.

- Title: `Claude · <folder> — 작업 완료` (or 오류로 종료 / 거절됨)
- Body: the first part of Claude's final answer
- Quiet for subagents and for turns you interrupted
- Each pane keeps one notification: a newer one replaces the older

## Requirements

- macOS
- [terminal-notifier](https://github.com/julienXX/terminal-notifier) for clickable notifications:

  ```sh
  brew install terminal-notifier
  ```

  Then allow notifications for **terminal-notifier** in System Settings → Notifications.
  Without it the plugin falls back to a plain `osascript` notification (no click action).
- tmux is optional: outside tmux a click just brings the terminal forward.

## Install

At a Claude Code prompt:

```
/plugin install tmux-notify --marketplace morigemini6668-ux/claude-tmux-notify
```

Answer `y` to add the marketplace, then pick a scope (user scope applies it to every session).

## Options

Set them on install, or later from `/config` under `tmux-notify`.

| Option | Default | What it does |
| --- | --- | --- |
| `sound` | `Glass` | A sound name from `/System/Library/Sounds` or `~/Library/Sounds` (Hero, Ping, Submarine, Funk, ...), or `none` for silence |
| `terminalApp` | `com.mitchellh.ghostty` | Bundle id of the app brought forward on click: `com.googlecode.iterm2`, `com.apple.Terminal`, `net.kovidgoyal.kitty`, `com.github.wez.wezterm`, ... |
| `previewLength` | `120` | How many characters of the answer the notification shows |

Preview a sound with `afplay /System/Library/Sounds/Hero.aiff`.
Find an app's bundle id with `osascript -e 'id of app "iTerm"'`.

## Development

```sh
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT
