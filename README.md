# AgentsPlugin

A private Claude Code plugin marketplace that packages the goal tooling so every
machine and project gets the same skills, launcher, progress bar and global rules.

Marketplace name: `agents-plugin`. It lists two plugins:

- **goal-prompt** — the `goal-prompt` and `goal-prompt-3rdparty` skills, the
  `ext-build` launcher scripts and the default `ext-build.json`.
- **goal-progress** — the goal progress bar mod.

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

The global rules live in `rules/CLAUDE.global.md` and are imported by
`~/.claude/CLAUDE.md` from this checkout.

## Fireworks key

`ext-build.ps1` needs a Fireworks API key to run. Set it once per machine with:

```powershell
plugins/goal-prompt/scripts/ext-build.ps1 -SetKey
```

The key is stored by DPAPI in `~/.claude/secrets/` and is **never committed** to
this repo. The `.gitignore` keeps secrets, keys, logs and local run state out.
