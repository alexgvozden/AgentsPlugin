# AgentsPlugin

A private Claude Code plugin marketplace that packages the goal tooling so every
machine and project gets the same skills, launcher, progress bar and global rules.

Marketplace name: `agents-plugin`. It lists two plugins:

- **goal-prompt** — the `goal-prompt` and `goal-prompt-3rdparty` skills, the
  `ext-build` launcher scripts and the default `ext-build.json`.
- **goal-progress** — the goal progress bar mod.

## What you get

**Two skills.** `/goal-prompt` turns a plan file into one ready-to-paste
`/goal` that carries out that plan, with light checks and printed evidence. It
pauses only at sign-offs the plan asks for; re-run the same goal to continue.
`/goal-prompt-3rdparty` does the same, but the function builders run on
a Fireworks model through `ext-build.ps1`. Both take `[plan file or step range]`.
The long names `/goal-prompt:goal-prompt` and `/goal-prompt:goal-prompt-3rdparty`
also work. A Claude Code session opened before the install needs a restart to see
them; type `/goal` to find them.

**The ext-build launcher.** `plugins/goal-prompt/scripts/ext-build.ps1` runs one
headless builder on a Fireworks model (`-Brief`, `-Cwd`, `-Step`, `-LogDir`). It
reads the user config `~/.claude/ext-build.json` first, then the plugin's
`ext-build.default.json`. `-SetKey` stores the API key (DPAPI), `-Check` tests it,
`-DryRun` shows the command without calling. Exit 0 ok, 3 HANDOFF, 1 failed,
2 setup error.

**The progress band and the tasks pane.** The goal-progress mod shows one line per
running job above the prompt — a bar, the current step, and the jobs running now —
read from `.claude/goal-progress.json` in the project. `/goal-progress open` (or the
`[ Tasks ▸ ]` button) opens the Goal tasks pane: the goal, status chips, a "Running
now" card, and a timeline of every task and its steps.

**Global rules.** `rules/CLAUDE.global.md` holds the shared rules;
`~/.claude/CLAUDE.md` imports it from this checkout, so a plugin update cannot
change it.

## Which model does what

The global rules apply in every project. Both skills follow them and add the rows
marked with the skill's name. Opus and Sonnet mean Opus 5.5 and Sonnet 5.5.

| Who or what | Model and effort | When |
| --- | --- | --- |
| Main thread: planning, architecture, product and design decisions, safety and money rules, briefs | Opus, high | Always (global rules) |
| Development: a subagent that writes code by an agreed plan | Opus, medium | Global rules; `goal-prompt` function parts |
| UI part of a screen step: design, components, layout, screenshots | Opus, high | Both skills. The UI is built first; the function is wired in after, without changing the design |
| Function builders (`goal-prompt-3rdparty`) | Fireworks, default `accounts/fireworks/models/deepseek-v4p1-flash` | Each function step, through `ext-build.ps1` as a background job. `model=<id>` or `defaultModel` in `~/.claude/ext-build.json` picks another model |
| Steps kept on Claude (`goal-prompt-3rdparty`) | Opus, medium | Steps that touch security, money, personal data or a shared-database migration, unless you move them |
| End-user copy (`goal-prompt-3rdparty`): UI text, emails, marketing pages, README and help | Opus, high | Never on Fireworks |
| Technical copy (`goal-prompt-3rdparty`): developer docs, code comments, API docs, plan and brief text | Opus, medium | Never on Fireworks |
| A failed step | Opus, high | A builder fails, cannot fix its tests in one more try, or raises a design question. A fresh subagent continues the same step from the first one's report; it is never restarted |
| Fireworks builder that hands off (exit 3) | Fireworks | A fresh Fireworks builder takes over from the handoff note |
| Fireworks builder that fails (exit 1) | Opus, high | Never another Fireworks try |
| Reviews of a phase, branch or many files, or of security, money or personal data | Opus, high | At each phase close. A review of one small change may run at medium |
| Browser testing through Claude in Chrome | Sonnet | It reports what it saw; Opus judges and fixes. After two or three failed tries, the step moves to Opus |
| Mechanical work: running a test suite, merging lists | Sonnet | Where a project or skill allows it. When in doubt, take the higher level |

The skill writes these rules into each plan's "How this plan is run", so a run
keeps to them after the chat is gone.

## Examples

**Make a goal from a plan.** In Claude Code, in the project:

```text
/goal-prompt-3rdparty PLAN.md
```

The skill reads the plan, adds a `Status:` line to each step and prints one
`/goal`. Paste that `/goal` to start the run. If it pauses at a
sign-off, paste the same `/goal` again to go on. Add `model=<id>` to use another
Fireworks model for this plan.

**The progress file.** The goal keeps `.claude/goal-progress.json` up to date as
it works. [`docs/examples/goal-progress.json`](docs/examples/goal-progress.json)
is a made-up run: two phases, steps with `engine` labels, a build and a test job
running, and a short log. Copy it to `.claude/goal-progress.json` in any project
to see the band and the pane.

**A builder's report.** Each Fireworks builder prints a summary line first, then
its report (at most 20 lines) and the path of its full log:

```text
ext-build: S1 · accounts/fireworks/models/deepseek-v4p1-flash · 15 turns · 412.3k in (380.1k cached) / 9.8k out · 6m10s · ok
```

## Screenshots

These are drawn from the example file by the mod's own code: its band, its pane
and its `/goal-progress` command, run under `claude plugin test` and laid out as
a terminal would. To draw them again, run `node docs/render-screenshots.mjs`.

![The progress band](docs/images/goal-progress-band.svg)

The band above the prompt: the bar, the job running now with its model, and the
Tasks button.

![The Goal tasks pane](docs/images/goal-tasks-pane.svg)

The Goal tasks pane: what is running, the latest updates, and each phase with its
steps, models and tokens.

![The /goal-progress output](docs/images/goal-progress-command.svg)

The `/goal-progress` output: every task and step as a plain list.

## Install

```sh
claude plugin marketplace add alexgvozden/AgentsPlugin
claude plugin install goal-prompt@agents-plugin
claude plugin install goal-progress@agents-plugin
```

Update later with:

```sh
claude plugin update goal-prompt@agents-plugin
```

Auto-update is off until it is turned on in `/plugin` → Marketplaces.

## Fireworks key

`ext-build.ps1` needs a Fireworks API key to run. Set it once per machine with:

```powershell
plugins/goal-prompt/scripts/ext-build.ps1 -SetKey
```

The key is stored by DPAPI in `~/.claude/secrets/` and is **never committed** to
this repo. The `.gitignore` keeps secrets, keys, logs and local run state out.
