# AgentsPlugin: package the goal tooling as a Claude Code plugin marketplace

Goal: put the user-level goal tooling into one private git repo that Claude Code installs as plugins, so every machine and project gets the same skills, launcher, progress bar and global rules from GitHub.

- **Repo:** `git@github.com:alexgvozden/AgentsPlugin.git` (private, empty; SSH works as `alexgvozden`, checked Nov 6, 2026)
- **Local checkout:** `C:\Users\User\Code\AgentsPlugin` (this folder)
- **Branch:** `main`; one commit per step, pushed at the end of each phase
- **Git identity:** Aleksandar Gvozden <alex.gvozden@gmail.com> (global git config)

## What goes in

| Source (today) | Goes to | Notes |
|---|---|---|
| `~/.claude/skills/goal-prompt/` (`SKILL.md`, `test-matrix.md`) | `plugins/goal-prompt/skills/goal-prompt/` | `.bak-*` files stay out |
| `~/.claude/skills/goal-prompt-3rdparty/` | `plugins/goal-prompt/skills/goal-prompt-3rdparty/` | launcher paths changed to the plugin's own path |
| `~/.claude/bin/ext-build.ps1`, `ext-build.test.ps1` | `plugins/goal-prompt/scripts/` | `scripts/`, not `bin/` (Facts) |
| `~/.claude/ext-build.json` | `plugins/goal-prompt/ext-build.default.json` | user override stays in `~/.claude/ext-build.json` |
| `~/.claude/mods/goal-progress/` | `plugins/goal-progress/` | version 0.9.1 → 0.10.0 (engine label) |
| `~/.claude/CLAUDE.md` (12 lines) | `rules/CLAUDE.global.md` | not a plugin part (see Facts) |

**Never in the repo:** `~/.claude/secrets/` (the DPAPI Fireworks key), any `*.key`, run logs, `.claude/goal-prompt/` run folders, `.bak-*` files.

## Layout

```
.claude-plugin/marketplace.json     marketplace "agents-plugin": goal-prompt, goal-progress
plugins/goal-prompt/.claude-plugin/plugin.json
plugins/goal-prompt/skills/goal-prompt/{SKILL.md,test-matrix.md}
plugins/goal-prompt/skills/goal-prompt-3rdparty/{SKILL.md,test-matrix.md}
plugins/goal-prompt/scripts/{ext-build.ps1,ext-build.test.ps1}
plugins/goal-prompt/ext-build.default.json
plugins/goal-progress/...           (the mod as it is)
rules/CLAUDE.global.md
scripts/install.ps1                 marketplace add + install, global rules link, old copies to backup
README.md, .gitignore
```

## Facts

Checked Nov 6, 2026 against code.claude.com/docs (skills, plugins/components, plugins/manifest-reference, plugins/loading, memory, plugin-marketplaces, plugins/host-marketplace, plugins/mods/create).

- **Skill names:** a plugin skill is always `/goal-prompt:goal-prompt` and `/goal-prompt:goal-prompt-3rdparty`. With `name:` in its frontmatter (both have it) the bare `/goal-prompt` also works unless another command or skill uses that name, so the old user-level copies must go (S6). (docs: skills, "How a skill gets its command name")
- **Paths in a skill:** `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SKILL_DIR}` are replaced inline in SKILL.md text (forward slashes on Windows); they are not shell variables. Write `${CLAUDE_PLUGIN_ROOT}/scripts/ext-build.ps1`. A top-level `bin/` is put on PATH, but claude.ai and Cowork refuse plugins with one, so the launcher lives in `scripts/`. (docs: plugins/components)
- **Updates:** each version installs to a new `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`; never write state there. The user config (`~/.claude/ext-build.json`) and the key (`~/.claude/secrets/fireworks.key`) stay outside the plugin; the launcher reads the user config first, then `ext-build.default.json` in the plugin. (docs: plugins/loading)
- **Global rules:** a plugin cannot ship CLAUDE.md (not loaded; `validate` warns). `~/.claude/CLAUDE.md` imports `@C:/Users/User/Code/AgentsPlugin/rules/CLAUDE.global.md` from this fixed checkout (not the plugin cache, whose path changes per version); user-scope imports need no approval. (docs: memory)
- **Manifests:** `marketplace.json` needs `name`, `owner.name`, `plugins[{name, source}]`; `source` like `./plugins/goal-prompt`, no `..`. `plugin.json` needs `name` (kebab-case; `claude-`, `anthropic-`, `cc-plugin-` prefixes reserved). Set `version` only in `plugin.json`. Entry name = manifest name. (docs: plugin-marketplaces, manifest-reference)
- **Private repo install:** Claude Code uses the machine's git with SSH first (works here), no token of its own. CLI: `claude plugin marketplace add alexgvozden/AgentsPlugin`, `claude plugin install goal-prompt@agents-plugin`, `claude plugin update ...`. Auto-update is off until turned on in `/plugin` → Marketplaces. (docs: plugins/host-marketplace)
- **The mod:** installs like any plugin; `hooks/hooks.json` keeps `"modules": ["./register.tsx"]`, imports stay inside the plugin. A GitHub install is a versioned copy, so bump `version` to ship changes. Two enabled copies with the same name load only one hooks module, so the `local-mods` copy is uninstalled (S6). (docs: plugins/mods/create, plugins/loading)
- Checks: `claude plugin validate <dir>`, `claude plugin test <dir>` (goal-progress: 12 tests), `ext-build.test.ps1` (29 checks), `ext-build.ps1 -Check` (one real Fireworks call, about $0.01).

## Who does what

| Who | What |
|---|---|
| You | Created the empty private repo (done). Sign off at the two gates. Open a new Claude Code session after phase 2 to check the skills and bar. |
| Claude | Everything else: repo, files, path changes, tests, commits, pushes, install, moving old copies to a backup folder. |

## Phase 1: build the repo (gate: you look at the repo on GitHub)
Status: todo

### S1. Repo skeleton
Status: done 2026-11-06
`git init -b main`, remote `origin` = the repo above (already created and empty), `.gitignore` (secrets, `*.key`, logs, `.claude/goal-prompt/`, `.claude/goal-progress.json`, `.claude/settings.local.json`, `node_modules`, `*.bak*`), `README.md` (what it is, install, the Fireworks key note: `ext-build.ps1 -SetKey`, never committed), `.claude-plugin/marketplace.json` (name `agents-plugin`, owner Aleksandar Gvozden) listing both plugins, no versions in it.
Acceptance: `git status` clean after the commit; `claude plugin validate .` passes for the marketplace.

### S2. goal-progress plugin
Status: done 2026-11-06
Copy `~/.claude/mods/goal-progress/` into `plugins/goal-progress/` (its own `marketplace.json` dropped; the root one lists it), version 0.10.0.
Acceptance: `claude plugin test plugins/goal-progress` 12 pass; `claude plugin validate plugins/goal-progress` passes.

### S3. goal-prompt plugin
Status: todo
Copy both skills and the launcher as in "What goes in"; `plugin.json` (name `goal-prompt`, version 1.0.0, author Aleksandar Gvozden). In `goal-prompt-3rdparty/SKILL.md` replace `~/.claude/bin/ext-build.ps1` with `${CLAUDE_PLUGIN_ROOT}/scripts/ext-build.ps1` (Facts). The launcher looks for config in `~/.claude/ext-build.json`, then `ext-build.default.json` in the plugin; add that to its self-test.
Acceptance: `ext-build.test.ps1` passes (29 + new config check); `claude plugin validate plugins/goal-prompt` passes; `grep -r "~/.claude/bin" plugins/` finds nothing; `claude --plugin-dir plugins/goal-prompt -p "list your skills"` names both skills.

### S4. Global rules
Status: done 2026-11-06
`rules/CLAUDE.global.md` = the current `~/.claude/CLAUDE.md` text.
Acceptance: the file matches `~/.claude/CLAUDE.md` byte for byte (`fc /b` or `cmp`).

### S5. Secret check, then push
Status: todo
Search the tree and the staged files for key material (`fw_`, `-----BEGIN`, long base64/DPAPI blobs, `ANTHROPIC_AUTH_TOKEN=`), check `git ls-files` against the "Never in the repo" list, then push `main`.
Acceptance: the search prints no hits; `git ls-files` printed; `git push -u origin main` succeeds; `git status` clean.

## Phase 2: switch this machine to the plugins (gate: you confirm in a new session)
Status: todo

### S6. Install script
Status: todo
`scripts/install.ps1`: `claude plugin marketplace add alexgvozden/AgentsPlugin`, `claude plugin install goal-prompt@agents-plugin` and `goal-progress@agents-plugin`; if `~/.claude/CLAUDE.md` does not import `rules/CLAUDE.global.md`, replace its body with the import (old file to backup first); move the old user-level copies (`~/.claude/skills/goal-prompt`, `~/.claude/skills/goal-prompt-3rdparty`, `~/.claude/bin/ext-build*`, `~/.claude/mods/goal-progress`, the `local-mods` marketplace entry and `goal-progress@local-mods` in `~/.claude/settings.json`) to `~/.claude/backup-<date>/`, never deleting. Leaves `ext-build.json`, `secrets/` and the `.bak-*` files alone. Safe to run twice.
Acceptance: `-WhatIf` run prints every action; a real run prints done for each; a second run changes nothing.

### S7. Run it here and check
Status: todo
Run the install script on this machine, then: `claude plugin list` shows both plugins enabled; `ext-build.ps1 -Check` from the plugin path prints OK; `~/.claude/settings.json` no longer names `local-mods`. Push.
Acceptance: those three outputs printed; phase marked `shown`; you open a new session and confirm `/goal-prompt` and `/goal-prompt-3rdparty` (or their namespaced names) are listed and the progress bar loads.

## Open questions (with defaults)
1. If the bare `/goal-prompt-3rdparty` does not work after install, use `/goal-prompt:goal-prompt-3rdparty` (default) and say so in the README.

## Later
- Ship the status line scripts (`~/.claude/hooks/statusline.js`, `subagent-statusline.js`) too.
- A second machine: run `scripts/install.ps1` there, then `ext-build.ps1 -SetKey`.

## How this plan is run

1. **Status** is the `Status:` line on each step and on each phase: a step sets its own mark (`done <date>` or `blocked: <reason>`) in its own commit; the main thread sets a phase's mark (`shown <date>` at a gate, `done <date>` after the sign-off) at its close and rewrites "Where the run stands" at each landing. No other list is kept. This section and the status lines are committed with S1 (the repo does not exist before it).
2. **Scope is the plan.** Build each step's acceptance as written, nothing more. A real gap is an open question in "Open questions" with a default; ideas go to "Later".
3. **Order.** Steps run one after another in this checkout on `main` (all are small; no worktrees). S2, S3 and S4 touch different folders and may run side by side, up to 3. The main thread assigns names when a step starts.
4. **A step** is built by a fresh Fireworks builder (`~/.claude/bin/ext-build.ps1 -Brief <brief> -Cwd C:\Users\User\Code\AgentsPlugin -Step <id> -LogDir .claude/goal-prompt/20261106-plugin/logs`, model `accounts/fireworks/models/deepseek-v4p1-flash`, started as a background shell job), except S5, which is kept on Claude at Opus medium. The brief is pointers, in `.claude/goal-prompt/20261106-plugin/briefs/<step>.md`: this file with the step's line range and this section's range, and the source paths from "What goes in". The builder reads by range only (Read with offset and limit, Grep with a limit), makes its first edit within about 20 tool calls, writes only the tests the plan names, runs the step's own checks once, sets its status mark and commits.
5. **Handoff.** At about 100 tool calls a builder stops at a safe point (committed, nothing half written) and returns "HANDOFF" with a note of at most 15 lines in its report: done (commits), left, what fails (command and first error lines), files with line ranges, next action. The next builder starts from the note and `git log`, and makes its first change within about 10 tool calls. A failed step's report is the same note, and a fresh Opus high subagent continues the step (never restarted, no other step in its place). A Fireworks HANDOFF (exit 3) goes to a fresh Fireworks builder with the note; a Fireworks failure (exit 1) goes to Opus high; a setup error (exit 2) stops the run and is reported to the user.
6. **Landing:** the step's own acceptance checks, then its commit on `main`; pushes happen only in S5 and S7. After a fix only the failed check runs again.
7. **Phase close:** every step of the phase marked; once: `claude plugin validate .`, `claude plugin test plugins/goal-progress`, `plugins/goal-prompt/scripts/ext-build.test.ps1` (phase 2 also the install script's second run); one review of the phase's diff at Opus high (it touches secrets and `~/.claude`; findings fixed or deferred with a reason); the phase marked `shown`; `git status` clean.
8. **Model and effort:** planning and reviews at Opus high; building on Fireworks `accounts/fireworks/models/deepseek-v4p1-flash` (S5 at Opus medium); a failed step at Opus high; mechanical work at Sonnet. A builder report is at most 20 lines; longer output goes to `.claude/goal-prompt/20261106-plugin/logs/`, and Fireworks runs also log one line each to `logs/ext-runs.jsonl`.
9. **Feedback during the run.** The main thread first writes the user's note on work in progress into this plan, in the user's words. A change to a step not yet landed goes into that step's acceptance; anything else becomes a fix step of the current phase (`fix <n>`, with its `Status:` line). Then it is routed like any step: to Fireworks, or to Opus medium if it belongs to S5. If a Fireworks builder of that step is still running, it finishes first. Feedback on a step that a Fireworks builder built but has not landed resumes that builder (`-Resume <session id>` from `logs/ext-runs.jsonl`) with a brief of the feedback lines. Once the step has landed, the feedback becomes a new fix step with a fresh builder. A note that changes scope or a decision is confirmed with the user before it is written.

## Where the run stands
2026-11-06: builders on Fireworks `accounts/fireworks/models/deepseek-v4p1-flash`; S5 stays on Opus medium.
Phase 1: S1 done (6df43c7). S2 done (cfd2b22, 12 tests pass, validate passed). S4 done (a1b6a38, byte-identical). S2's status mark landed in S4's commit a1b6a38 (parallel staging of PLAN.md); content correct, noted for the phase review. Running: S3 (S3-prompt-fw1). Next: S5 at Opus medium.
