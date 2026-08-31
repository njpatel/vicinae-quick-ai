# vicinae-quick-ai

Raycast-style **Quick AI** for the [Vicinae](https://vicinae.com) launcher, backed by
any OpenAI-compatible server. Type a question into the launcher, get a streaming
answer, keep the conversation going.

![icon](icon.png)

## Features

- **Ask AI** — streaming chat in the launcher. The sidebar lists recent
  conversations (select one to continue it); answers render full-width in the
  pane with the question shown as a quiet blockquote. Scroll stays pinned to
  the bottom while streaming.
- **Fallback-first** — designed to be a root-search fallback: type anything,
  hit Enter, get an answer. Every launch starts a fresh chat by default
  (configurable continue-window).
- **Ask AI about Selection / Clipboard** — seeds the conversation with the
  selected text, clipboard text, a copied file, or a clipboard **image**
  (sent as vision input).
- **Attachments** — attach images (vision) or text files (inlined as context)
  from the clipboard (Ctrl+Shift+V) or a file picker (Ctrl+Shift+F).
- **Select AI Model** — live model list from the server's `/models`.
- **AI Presets** — system prompt + model bundles; set one as default.
- **AI Commands** — Raycast-style prompts over the current selection
  (Fix Spelling, Improve Writing, Translate…, plus custom ones with
  `{selection}` / `{clipboard}` / `{argument name="X"}` placeholders).
  Primary action pastes the result over the still-active selection.
- **Quick AI History** — browse, continue, delete past conversations.

## Setup

```sh
npm install
npx vici build        # builds straight into ~/.local/share/vicinae/extensions/
```

Configuration precedence (all optional in preferences):

1. Extension preferences: base URL, API key, model.
2. Fallback: `src/config.ts` reads my local
   [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) setup
   (`~/codex-pooled/config.toml` for the base URL and default model, and the
   `CLIPROXY_API_KEY` env assignment in `~/.bashrc` for the token). **Edit
   `pooledConfig()` for your own machine** or just fill in the preferences.

To make it the default action when typing in root search, add the commands to
`fallbacks` in `~/.config/vicinae/settings.json`:

```json
"fallbacks": [
  "@njpatel/quick-ai:ask",
  "@njpatel/quick-ai:ask-selection",
  "@njpatel/quick-ai:ask-clipboard"
]
```

Requires `wl-clipboard` (primary-selection fallback and clipboard images).

## Development

`./test-rig.sh` runs a fully isolated Vicinae instance under a **headless sway
compositor** — separate XDG dirs, its own server, virtual keyboard, and
screenshots — so you can develop and test without touching your real launcher.
See the script header for the details (and the traps it works around).

## Implementation notes

Constraints discovered the hard way, encoded in the code comments:

- The List detail pane is the only surface that combines markdown with a live
  text input; the list column can't be hidden (65/35 split is hardcoded), so
  it's used as the conversation switcher.
- The markdown view only keeps scroll pinned to the bottom while each update
  is a strict prefix-extension of the previous document — the answer pane is
  therefore append-only, and conversations are "revealed" in two frames so
  resumed chats land scrolled to the newest answer.
- Vicinae's `getSelectedText` only catches fresh selections; `wl-paste
  --primary` is the fallback.

## License

MIT
