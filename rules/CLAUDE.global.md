# Rules for every project

## Models and reasoning effort

Set by Alex on 16 October 2026. These rules count as the user's explicit instruction to set `model` and `effort` on the Agent tool.

- **Reasoning and planning: Opus 5.5 at high effort.** The main thread runs at Opus 5.5 high (`model` and `modelSettings` in `~/.claude/settings.json`). Planning, architecture, product and design decisions, safety and money rules, and briefs stay there or go to a subagent with `model: "opus"` and `effort: "high"`.
- **Development: Opus 5.5 at medium effort.** A subagent that writes or changes code by an agreed plan gets `model: "opus"` and `effort: "medium"`.
- **When an issue arises, switch to high.** A medium subagent that fails, returns a problem it could not solve, breaks tests it cannot fix in one more try, or reports a design question: the retry or the fix goes to a fresh subagent at `effort: "high"`, with the first one's report as its starting note. Say in the progress note that the step was raised to high and why.
- **Reviews of a larger scope: high.** A review of a whole batch, phase, branch or many files, or of anything touching security, money or personal data, runs at `effort: "high"`. A review of one small change may run at medium.
- **Browser testing through Claude in Chrome: Sonnet 5.5 where possible.** Clicking through pages, filling forms, taking screenshots and reading the console with the `mcp__claude-in-chrome__*` tools goes to a subagent with `model: "sonnet"`. It reports what it saw (paths of screenshots, console errors, what failed) in a short report; judging whether that is right, and fixing it, follows the rules above. If a Sonnet subagent cannot get through a page after two or three tries, stop it and take the step at Opus.
- A project's own rules or memory may add cheaper choices for simple, mechanical work (running a test suite, merging lists after a rebase). When in doubt between two levels, take the higher.
