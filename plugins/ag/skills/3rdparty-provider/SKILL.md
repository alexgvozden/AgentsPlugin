---
name: 3rdparty-provider
description: "Pick the provider the third-party builders (goal-prompt-3rdparty, ext-build.ps1) run on: Fireworks or OpenRouter, or show the current one with its default model, config file and whether its key is set. Stored as \"provider\" in ~/.claude/ext-build.json; an old flat Fireworks file is moved into the \"providers\" form with its settings kept. Never asks for a key in chat. Use only when the user asks for /ag:3rdparty-provider fireworks, openrouter or status."
argument-hint: "fireworks | openrouter | status"
disable-model-invocation: true
---

# Third-party builder provider

Input: `$ARGUMENTS`: `fireworks`, `openrouter` or `status`. Empty means `status`. Anything else: say the three choices and stop.

What it changes: one key, `"provider"`, in `~/.claude/ext-build.json` (created when missing). A file in the old flat form (`baseUrl`, `keyFile`, `defaultModel`, `modelPrefix` at the top) is first moved under `"providers": { "fireworks": { ... } }`; every other key is kept. `status` changes nothing.

## Steps

1. Run:
   `powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/3rdparty-provider.ps1" <fireworks|openrouter|status>`
   (macOS and Linux: `pwsh -File ...`). Exit 2 means a bad argument or an `ext-build.json` that is not valid JSON or names an unknown provider; show its line and stop.
2. Tell the user in two or three lines: the provider, its default model and the config file. It applies to the next ext-build run, also the builders of a goal that is already running (the launcher reads the file on each run), unless that goal's runner pins a model id of the other provider (`model=` in the goal); then run the goal-prompt-3rdparty skill again for that plan.
3. If the script says the key is not set, give its `ag-key.ps1 set <provider>` line to run in the user's own terminal. Never ask for the key or accept it in the chat.
