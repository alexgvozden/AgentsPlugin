# AgentsPlugin

A private Claude Code plugin marketplace that packages the goal tooling so every
machine and project gets the same skills, launcher, progress bar and global rules.

Marketplace name: `agents-plugin`. It lists two plugins:

- **goal-prompt** — the `goal-prompt` and `goal-prompt-3rdparty` skills, the
  `ext-build` launcher scripts and the default `ext-build.json`.
- **goal-progress** — the goal progress bar mod.

## What you get

**Two skills.** `/goal-prompt:goal-prompt` turns a plan file into one ready-to-paste
`/goal` that carries out that plan, with light checks and printed evidence. It
pauses only at sign-offs the plan asks for; re-run the same goal to continue.
`/goal-prompt:goal-prompt-3rdparty` does the same, but the function builders run on
a Fireworks model through `ext-build.ps1`. Both have a `name:` in their frontmatter,
so the bare `/goal-prompt` and `/goal-prompt-3rdparty` also work unless another
command or skill takes that name. Both take `[plan file or step range]`.

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
