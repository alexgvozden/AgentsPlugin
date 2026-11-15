---
name: 3rdparty-provider
description: "Pick the provider the third-party builders (goal-prompt-3rdparty, ext-build.ps1) run on: Fireworks or OpenRouter, optionally pinning which upstream OpenRouter provider serves the model (a provider list, cheapest, fastest, quickest-start or auto), or show the current one with its default model, routing, config file and whether its key is set. Stored as \"provider\" (and providers.openrouter.routing) in ~/.claude/ext-build.json; an old flat Fireworks file is moved into the \"providers\" form with its settings kept. Never asks for a key in chat. Use only when the user asks for /ag:3rdparty-provider fireworks, openrouter or status."
argument-hint: "fireworks | openrouter [<provider,...>|cheapest|fastest|quickest-start|auto] | status"
disable-model-invocation: true
---

# Third-party builder provider

Input: `$ARGUMENTS`: `fireworks`, `openrouter` or `status`, and after `openrouter` an optional route. Empty means `status`. Anything else: say the choices and stop.

What it changes: `"provider"` in `~/.claude/ext-build.json` (created when missing), and with a route `providers.openrouter.routing`. A file in the old flat form (`baseUrl`, `keyFile`, `defaultModel`, `modelPrefix` at the top) is first moved under `"providers": { "fireworks": { ... } }`; every other key is kept. `status` changes nothing.

Routing (OpenRouter only) picks which upstream provider serves the model; the launcher sends it with each request through `CLAUDE_CODE_EXTRA_BODY`:
- `wafer/mxfp4` or `deepinfra/fp8,deepseek`: only these providers or endpoints, never another; OpenRouter picks among a list and moves on when one fails, so a single pinned provider that is down fails the build. This rules out fp4 or keeps the code with a trusted provider.
- `cheapest`, `fastest`, `quickest-start`: every provider, sorted by price, throughput or latency.
- `auto`: remove the routing; OpenRouter picks. No route: the routing stays as it is.

## Steps

1. Run:
   `powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/3rdparty-provider.ps1" <fireworks|openrouter|status> [<route>]`
   (macOS and Linux: `pwsh -File ...`). Exit 2 means a bad argument (also a route with fireworks or status, or a slug that is not lower-case letters, digits, `-`, `_`, `.` and `/`) or an `ext-build.json` that is not valid JSON or names an unknown provider; show its line and stop.
2. Tell the user in two or three lines: the provider, its default model, the routing (with the pinned endpoints' price and quantization if it printed them) and the config file. It applies to the next ext-build run, also the builders of a goal that is already running (the launcher reads the file on each run), unless that goal's runner pins a model id of the other provider (`model=` in the goal); then run the goal-prompt-3rdparty skill again for that plan.
3. If the script warns that the model has no endpoint for a slug, show the valid tags it printed; the route was saved anyway, so offer to run it again with a valid one. If it says the provider check was skipped (offline), say so. After a new route, suggest trying it with one short call in the user's terminal: `powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.claude\ag\ag-key.ps1 check openrouter`; the OpenRouter activity page shows which provider served each request.
4. If the script says the key is not set, give its `ag-key.ps1 set <provider>` line to run in the user's own terminal. Never ask for the key or accept it in the chat.
