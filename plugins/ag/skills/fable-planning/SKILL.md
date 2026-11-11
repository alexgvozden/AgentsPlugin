---
name: fable-planning
description: "Turn Fable planning on or off for the current project. With it on, goal runs (the goal-prompt skills), /ag:design and /ag:plan send their planning work (design plans, new and updated plans, splitting or re-planning a large step, a builder's design question, each phase's plan) to subagents on Fable 5.2 at high effort instead of Opus 5.5 high. Ordinary chats, the coordinating main thread, building, UI parts, reviews and failed steps are not changed. Default off. Per project, stored as \"fablePlanning\" in the project's .claude/ag.json. Use only when the user asks for /ag:fable-planning on, off or status."
argument-hint: "on | off | status"
disable-model-invocation: true
---

# Fable planning

Input: `$ARGUMENTS`: `on`, `off` or `status`. Empty means `status`. Anything else: say the three choices and stop.

What it changes: one key, `"fablePlanning": true`, in the project's `.claude/ag.json` (personal, not committed), and nothing else. The project's model is not changed, so ordinary chats in the project are not affected.

- **on**: the goal-prompt skills write into each new goal's plan that planning work goes to a fresh `ag:fable-planner` subagent, pinned to Fable 5.2 (`claude-fable-5-2`) at high effort, `/ag:design` makes its design plan and `/ag:plan` makes or updates a plan the same way.
- **off** (the default): the key is removed (the file too, if nothing else is in it). Planning stays on Opus 5.5 high.

## Steps

1. Run, from the project root:
   `powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/fable-planning.ps1" <on|off|status> -ProjectDir "<project root>"`
   (macOS and Linux: `pwsh -File ...`). Exit 2 means a bad argument or an `ag.json` that is not valid JSON; show its line and stop.
2. Tell the user in two or three lines: the new state and the file. It applies to the next goal made with a goal-prompt skill, the next `/ag:design` and the next `/ag:plan`. A goal made before the change keeps what its plan says; to switch it, run the goal-prompt skill again for that plan. The goal's coordinating session stays on whatever model it runs on (Opus by default); to put that on Fable too, run `/model claude-fable-5-2` before pasting the goal.
3. If `.claude/ag.json` is not ignored by git (`git check-ignore -q .claude/ag.json` fails), say so in one line; do not change `.gitignore` unless asked.
