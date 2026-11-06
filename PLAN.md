# AgentsPlugin: package the goal tooling as a Claude Code plugin marketplace

Goal: put the user-level goal tooling into one private git repo that Claude Code installs as plugins, so every machine and project gets the same skills, launcher, progress bar and global rules from GitHub.

- **Repo:** `git@github.com:alexgvozden/AgentsPlugin.git` (private, empty; SSH works as `alexgvozden`, checked Nov 6, 2026)
- **Local checkout:** `C:\Users\User\Code\AgentsPlugin` (this folder)
- **Branch:** `main`; one commit per step, pushed at the end of each phase
- **Git identity:** Aleksandar Gvozden <alex.gvozden@gmail.com> (global git config)

## What goes in

| Source (today) | Goes to | Notes |
|---|---|---|
| `~/.claude/skills/goal-prompt/` (`SKILL.md`, `test-matrix.md`) | `plugins/ag/skills/goal-prompt/` | `.bak-*` files stay out |
| `~/.claude/skills/goal-prompt-3rdparty/` | `plugins/ag/skills/goal-prompt-3rdparty/` (fix 9) | launcher paths changed to the plugin's own path |
| `~/.claude/bin/ext-build.ps1`, `ext-build.test.ps1` | `plugins/ag/scripts/` (fix 9) | `scripts/`, not `bin/` (Facts) |
| `~/.claude/ext-build.json` | `plugins/ag/ext-build.default.json` (fix 11) | user override stays in `~/.claude/ext-build.json` |
| `~/.claude/mods/goal-progress/` | `plugins/ag/` (hooks, types; fix 11) | version 0.9.1 → 0.10.0 (engine label) |
| `~/.claude/CLAUDE.md` (12 lines) | `rules/CLAUDE.global.md` | not a plugin part (see Facts) |

**Never in the repo:** `~/.claude/secrets/` (the DPAPI Fireworks key), any `*.key`, run logs, `.claude/goal-prompt/` run folders, `.bak-*` files.

## Layout

```
.claude-plugin/marketplace.json     marketplace "agents-plugin": one plugin, ag (fix 11)
plugins/ag/.claude-plugin/plugin.json
plugins/ag/skills/goal-prompt/{SKILL.md,test-matrix.md}             /ag:goal-prompt
plugins/ag/skills/goal-prompt-3rdparty/{SKILL.md,test-matrix.md}    /ag:goal-prompt-3rdparty
plugins/ag/scripts/{ext-build.ps1,ext-build.test.ps1}
plugins/ag/ext-build.default.json
plugins/ag/hooks/, types/, goal-progress.md   the goal-progress mod, /ag:goal-progress
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
Status: done 2026-11-06
The user at the gate, Nov 6, 2026: "please push and than let's switch to plugin than improve the code and push and update install": one extra push of fix 1-5 at the gate, then sign-off; Phase 2, then Phase 3.

### S1. Repo skeleton
Status: done 2026-11-06
`git init -b main`, remote `origin` = the repo above (already created and empty), `.gitignore` (secrets, `*.key`, logs, `.claude/goal-prompt/`, `.claude/goal-progress.json`, `.claude/settings.local.json`, `node_modules`, `*.bak*`), `README.md` (what it is, install, the Fireworks key note: `ext-build.ps1 -SetKey`, never committed), `.claude-plugin/marketplace.json` (name `agents-plugin`, owner Aleksandar Gvozden) listing both plugins, no versions in it.
Acceptance: `git status` clean after the commit; `claude plugin validate .` passes for the marketplace.

### S2. goal-progress plugin
Status: done 2026-11-06
Copy `~/.claude/mods/goal-progress/` into `plugins/goal-progress/` (its own `marketplace.json` dropped; the root one lists it), version 0.10.0.
Acceptance: `claude plugin test plugins/goal-progress` 12 pass; `claude plugin validate plugins/goal-progress` passes.

### S3. goal-prompt plugin
Status: done 2026-11-06
Copy both skills and the launcher as in "What goes in"; `plugin.json` (name `goal-prompt`, version 1.0.0, author Aleksandar Gvozden). In `goal-prompt-3rdparty/SKILL.md` replace `~/.claude/bin/ext-build.ps1` with `${CLAUDE_PLUGIN_ROOT}/scripts/ext-build.ps1` (Facts). The launcher looks for config in `~/.claude/ext-build.json`, then `ext-build.default.json` in the plugin; add that to its self-test.
Acceptance: `ext-build.test.ps1` passes (29 + new config check); `claude plugin validate plugins/goal-prompt` passes; `grep -r "~/.claude/bin" plugins/` finds nothing; `claude --plugin-dir plugins/goal-prompt -p "list your skills"` names both skills.

### S4. Global rules
Status: done 2026-11-06
`rules/CLAUDE.global.md` = the current `~/.claude/CLAUDE.md` text.
Acceptance: the file matches `~/.claude/CLAUDE.md` byte for byte (`fc /b` or `cmp`).

### S5. Secret check, then push
Status: done 2026-11-06
Search the tree and the staged files for key material (`fw_`, `-----BEGIN`, long base64/DPAPI blobs, `ANTHROPIC_AUTH_TOKEN=`), check `git ls-files` against the "Never in the repo" list, then push `main`.
Acceptance: the search prints no hits; `git ls-files` printed; `git push -u origin main` succeeds; `git status` clean.

### fix 1. README says what you get
Status: done 2026-11-06
The user, Nov 6, 2026: "also please update readme to explain what you get". `README.md`: what each plugin gives you once installed (the two skills and how to call them, the `ext-build.ps1` launcher and its config/key, the progress band, `/goal-progress` and the Goal tasks pane, the global rules import), kept short.
Acceptance: README names every part listed above; `claude plugin validate .` passes.

### fix 2. Progress pane loses the tasks
Status: done 2026-11-06
The user, Nov 6, 2026: "also very often I loose tasks" (screenshot: the Goal tasks pane shows "No goal progress yet: .claude/goal-progress.json is missing." while the file exists). In `plugins/goal-progress/hooks/register.tsx` (`PLACES`, `readFile`, `refresh`, lines 31-69): find the file from the project folder even after the session's working directory moves, and keep the last good state when a read comes back empty or fails, as a half-written file already does.
Acceptance: one unit test for the keep-last-good-state rule; `claude plugin test plugins/goal-progress` all pass (12 + new); `claude plugin validate plugins/goal-progress` passes.

### fix 3. Goals name the launcher by a path that works
Status: done 2026-11-06
From the phase 1 review (P1-review-opus, medium and low): goals made by `goal-prompt-3rdparty` name only a bare `ext-build.ps1` (`plugins/goal-prompt/skills/goal-prompt-3rdparty/SKILL.md` lines 59 and 125), which a running goal cannot find once the user-level copy is gone; and lines 3 and 13 say the default model comes from `~/.claude/ext-build.json` only. Write the launcher as the full path the skill sees (open question 2), and add "else `ext-build.default.json` in the plugin" to lines 3 and 13.
Acceptance: `grep -n "ext-build.ps1" plugins/goal-prompt/skills/goal-prompt-3rdparty/SKILL.md` shows no bare launcher in the goal and runner templates; `claude plugin validate plugins/goal-prompt` passes.

### fix 4. goal-prompt-3rdparty: copy is written on Opus, never on Fireworks
Status: done 2026-11-06
The user, Nov 6, 2026: "for content writing please update goal-promt-3rdparrty to use opus high for writing end user facing copy and medium for technical copy and not to use fireworks for it". In `plugins/goal-prompt/skills/goal-prompt-3rdparty/SKILL.md`: a step (or the part of a step) that writes end-user-facing copy (UI text, emails, marketing pages, README and help for end users) runs at Opus high; technical copy (developer docs, code comments, API docs, plan and brief text) at Opus medium; neither goes to Fireworks. The rule appears where the skill says what stays on Claude (principle 7, about line 23), in the runner's step and model rules (about lines 59-64) and in the goal template (about line 125), keeping the goal under 4,000 characters; `test-matrix.md` gets one row for it if it lists the other model rules.
Acceptance: the three places name the copy rule; the goal template stays under 4,000 characters; `claude plugin validate plugins/goal-prompt` passes.

### fix 5. README: models, examples and screenshots
Status: done 2026-11-06
The user, Nov 6, 2026: "explain fully in readme what models are used when and also give examples and some screenshots for tasks panel etc". `README.md`: a "Which model does what" section covering both skills and the global rules (planning, reviews, UI, development, Fireworks builders, failed steps raised to high, browser testing, copy per fix 4); examples (making a goal from a plan, a run's progress file, a builder's report line); screenshots of the progress band, the Goal tasks pane and `/goal-progress` output, made from the mod's real rendering of an example progress file (open question 3), stored in `docs/images/` with the example file in `docs/examples/`.
Acceptance: README has the models section, the examples and at least three images that open; no image shows anything outside the demo (no real paths with secrets, no other windows); `claude plugin validate .` passes.

## Phase 2: switch this machine to the plugins (gate: you confirm in a new session)
Status: todo

### S6. Install script
Status: done 2026-11-06
`scripts/install.ps1`: `claude plugin marketplace add alexgvozden/AgentsPlugin`, `claude plugin install goal-prompt@agents-plugin` and `goal-progress@agents-plugin`; if `~/.claude/CLAUDE.md` does not import `rules/CLAUDE.global.md`, replace its body with the import (old file to backup first); move the old user-level copies (`~/.claude/skills/goal-prompt`, `~/.claude/skills/goal-prompt-3rdparty`, `~/.claude/bin/ext-build*`, `~/.claude/mods/goal-progress`, the `local-mods` marketplace entry and `goal-progress@local-mods` in `~/.claude/settings.json`) to `~/.claude/backup-<date>/`, never deleting. Leaves `ext-build.json`, `secrets/` and the `.bak-*` files alone. Safe to run twice.
Acceptance: `-WhatIf` run prints every action; a real run prints done for each; a second run changes nothing.

### S7. Run it here and check
Status: done 2026-11-06
Run the install script on this machine, then: `claude plugin list` shows both plugins enabled; `ext-build.ps1 -Check` from the plugin path prints OK; `~/.claude/settings.json` no longer names `local-mods`. Push.
Acceptance: those three outputs printed; phase marked `shown`; you open a new session and confirm `/goal-prompt` and `/goal-prompt-3rdparty` (or their namespaced names) are listed and the progress bar loads.

### fix 6. README: the commands are namespaced
Status: done 2026-11-06
The user, Nov 6, 2026, after the switch: "I dont' see /goal-prompt command". A fresh session (Claude Code 2.1.295) lists only `goal-prompt:goal-prompt` and `goal-prompt:goal-prompt-3rdparty`; the bare names are not offered, so open question 1's default applies. `README.md`: name the commands as `/goal-prompt:goal-prompt` and `/goal-prompt:goal-prompt-3rdparty` everywhere, drop the claim that the bare names work, and say a session opened before the install needs a restart. End-user copy, Opus high.
Acceptance: `grep -n "bare" README.md` finds no claim that the bare names work; every command example uses the namespaced name; `claude plugin validate .` passes.

### fix 7. README: the bare command names
Status: done 2026-11-06
The user, Nov 6, 2026: "no it doen'st work and I don't want this namign at all , I want /goal-prompt and /goal-promt-3rdparty or minimu /goal-prompt:3rdparty". Checked the same day in fresh sessions: `/goal-prompt` and `/goal-prompt-3rdparty` load the plugin skills (so fix 6 was wrong to drop them); `/goal-prompt:3rdparty` does not exist. `README.md`: name the commands `/goal-prompt` and `/goal-prompt-3rdparty` everywhere, with one line that the plugin's long names (`/goal-prompt:goal-prompt`, `/goal-prompt:goal-prompt-3rdparty`) also work and that a session opened before the install needs a restart. End-user copy, Opus high.
Acceptance: every command example in README uses the bare name; the long names appear once as the alternative; `claude plugin validate .` passes.

### fix 8. install.ps1: config folder and reruns
Status: done 2026-11-06
From the phase 2 review (P2-review-opus). `scripts/install.ps1`: set `CLAUDE_CONFIG_DIR` only for the script's own `claude` calls and restore it after (no leak into the caller's shell), and stop if an inherited value points somewhere other than `-ClaudeHome` (medium, lines 44-46); take backups only when a later action will change something, so a rerun on another day changes nothing (low, 102-108); when the backup target already exists add a time suffix instead of failing or nesting, and never overwrite CLAUDE.md without a copy (low, 94-99 and 223-227); decide "already installed" from `claude plugin list --json`, not from settings.json (low, 141-160). Deferred with reason: stderr from `claude` aborting under a captured stderr (a rerun recovers) and `$HOME` vs USERPROFILE (equal here; S8 handles paths on every OS).
Acceptance: against a temp home, as in S6: `-WhatIf`, a real run, a second run (all `skip:`), and a run with the date faked to tomorrow (all `skip:`, no new backup folder); after a `-ClaudeHome` run, `CLAUDE_CONFIG_DIR` in the calling shell is unchanged; a second real run on this machine prints all `skip:`.

### fix 9. Two plugins, so both commands are bare
Status: done 2026-11-06
The user, Nov 6, 2026, in a new session: "I don't need /goal-prompt:goal-prompt please remove also still don't see the commands you are mentioning , thus this is failing you need to fix or tell me what to do" and "/goal-prompt-3rdparty not working /goal-prompt working /goal-prompt:goal-prompt not workign and I don't need it". What works in the user's session is a plugin whose one skill has the plugin's own name (`goal-prompt`); the docs (skills, "How a skill gets its command name") promise nothing more, and `claude -p` tests do not show the interactive menu. So: split into two plugins in the same marketplace. `plugins/goal-prompt/` keeps only the `goal-prompt` skill (version 1.1.0). New `plugins/goal-prompt-3rdparty/` (`plugin.json` name `goal-prompt-3rdparty`, version 1.0.0, author Aleksandar Gvozden) gets `skills/goal-prompt-3rdparty/{SKILL.md,test-matrix.md}`, `scripts/{ext-build.ps1,ext-build.test.ps1}` and `ext-build.default.json`, moved with `git mv`; its `${CLAUDE_PLUGIN_ROOT}/scripts/ext-build.ps1` paths stay right. Root `marketplace.json` lists three plugins. `scripts/install.ps1` also installs `goal-prompt-3rdparty@agents-plugin`, and refreshes the marketplace and updates installed agents-plugin plugins when a newer version is out (prints `skip:` when current). "you need to fix" covers one push and the reinstall here (the plugins install from GitHub).
Acceptance: `claude plugin validate .` and `claude plugin validate plugins/goal-prompt-3rdparty` pass; `ext-build.test.ps1` passes from its new folder (31); `grep -rn "plugins/goal-prompt/scripts" plugins scripts` finds nothing; after the push and install here, `claude plugin list` shows goal-prompt 1.1.0, goal-prompt-3rdparty 1.0.0 and goal-progress enabled; `-Check` from the installed goal-prompt-3rdparty folder prints OK; a second install run prints only `skip:`; the user sees `/goal-prompt` and `/goal-prompt-3rdparty` in a new session.

### fix 10. README for the two plugins
Status: done 2026-11-06
After fix 9: `README.md` lists three plugins, the launcher path `plugins/goal-prompt-3rdparty/scripts/ext-build.ps1` (key setup, examples), the commands `/goal-prompt` and `/goal-prompt-3rdparty` only (the long names no longer mentioned, at the user's request). End-user copy, Opus high.
Acceptance: `grep -n "goal-prompt:goal-prompt\|plugins/goal-prompt/scripts" README.md` finds nothing; `claude plugin validate .` passes.

### fix 11. One plugin `ag` with the commands under it
Status: done 2026-11-06
The user, Nov 6, 2026, with a screenshot of the menu (`/goal-prompt:goal-prompt (goal-prompt)`, `/goal-prompt-3rdparty:goal-prompt-3rdparty (goal-prompt-3rdparty)`): "I see what happens with commands if they are plugins , they show as [screenshot] let's fix this with one plugin install and subcommands, I am ok with it but we need to update it again pleae, I am ok with ag:goal-prompt ag:goal-prompt-3rdparty and ag:goal-progress and ag:design". So: one plugin `plugins/ag/` (`plugin.json` name `ag`, version 1.0.0, author Aleksandar Gvozden, `types` from the mod) holding `skills/goal-prompt/`, `skills/goal-prompt-3rdparty/`, `scripts/{ext-build.ps1,ext-build.test.ps1}`, `ext-build.default.json`, and the goal-progress mod (`hooks/`, `types/`, its README as `goal-progress.md`), moved with `git mv`; `plugins/goal-prompt`, `plugins/goal-prompt-3rdparty`, `plugins/goal-progress` are gone. The mod's command shows as `/ag:goal-progress` (check the mods docs for how a registered command is named; register it so the menu shows `ag:goal-progress`). Root `marketplace.json` lists only `ag`. Skill text that names `/goal-progress` says `/ag:goal-progress`. `scripts/install.ps1`: uninstall `goal-prompt`, `goal-prompt-3rdparty` and `goal-progress` `@agents-plugin` when installed (two copies of the mod must never load), then install `ag@agents-plugin`; keep the local-mods, backup, CLAUDE.md, update and do/done/skip behaviour. "we need to update it again" covers one push and the reinstall here.
Acceptance: `claude plugin validate .` and `claude plugin validate plugins/ag` pass; `claude plugin test plugins/ag` (13 pass); `ext-build.test.ps1` from `plugins/ag/scripts/` (31 pass); `grep -rn "plugins/goal-prompt\|plugins/goal-progress" plugins scripts` finds nothing; after the push and install here, `claude plugin list` shows only `ag@agents-plugin` from this marketplace, enabled; `-Check` from the installed ag folder prints OK; a second install run prints only `skip:`; the user sees `/ag:goal-prompt`, `/ag:goal-prompt-3rdparty`, `/ag:goal-progress` and the progress bar in a new session.

### fix 12. README for the `ag` plugin
Status: done 2026-11-06
After fix 11: `README.md` describes one plugin `ag` and its commands `/ag:goal-prompt`, `/ag:goal-prompt-3rdparty`, `/ag:goal-progress` (and `/ag:design` once Phase 3 adds it); in `plugins/ag/goal-progress.md` the old `local-mods` install lines become the `ag` install; the install `claude plugin install ag@agents-plugin` or `scripts/install.ps1`, the launcher path `plugins/ag/scripts/ext-build.ps1`. End-user copy, Opus high.
Acceptance: `grep -n "goal-prompt@\|goal-progress@\|plugins/goal-prompt\|plugins/goal-progress" README.md` finds nothing; every command named is an `/ag:` command; `claude plugin validate .` passes.

### fix 13. `/ag:goal-progress` and the bar names the waiting phase
Status: done 2026-11-06
The user, Nov 6, 2026, with a screenshot (menu: `/ag:goal-prompt`, `/ag:goal-prompt-3rdparty`, `/goal-progress`; band: "67% P3 Design images and keys on every OS" while Phase 2 waits for sign-off): "goal progress is not showing up good, 2 are showing". Two faults: the mod registers its command as bare `goal-progress` (`plugins/ag/hooks/register.tsx` lines 188 and 226), so it is not under `ag`; and `current()` (`plugins/ag/hooks/progress.ts` lines 258-265) skips `waiting` and `shown` tasks, so at a gate the band names the next phase. Fix: the command shows as `/ag:goal-progress` (per the mods docs on command names; if a `:` is not allowed in a registered name, say so and stop); `current()` returns, in order, the first `doing`, `waiting`, `blocked`, then (when the goal's status is `waiting`) the last `shown` task, then the first `todo`. ag version 1.0.1; push and reinstall here so the user sees it.
Acceptance: one unit test for the gate case (a `shown` task and a later `todo`, goal `waiting`: current is the `shown` one); `claude plugin test plugins/ag` all pass (14); `claude plugin validate plugins/ag` passes with no gating warning; after the push and install, `claude plugin list` shows ag 1.0.1; the user sees `/ag:goal-progress` and the band names Phase 2 while it waits.

## Phase 3: design images and keys on every OS (gate: you run the design command in a new session and review its folder)
Status: todo
The user, Nov 6, 2026: "can you add to goals and planning to also accept gemini and open AI api key to generate desig images as part of goal exeuction in same way as 3rd party and add also design command that ca nbe run any time, I will provide API keys in prompt similar as fireworks". Answers the same day: a new Phase 3; keys set up the same way as Fireworks (never in chat); "separate deisgn plugin that expecct a plan / descirption to come and plan a design btw make sure all commands use proper folder structures etc in the projects it's run so user can review it - same way deisgn will be used as part of the goals commadns"; "the goal should use design anytime UI is involved for new pages if it's minor change skip design step"; "btw key setup should be possible both on mac and windows and linux".

### S8. Keys on Windows, macOS and Linux
Status: todo
One key store used by every launcher: `-SetKey <fireworks|gemini|openai>` and `-Check <provider>`; Windows DPAPI as today, macOS Keychain (`security`), Linux `secret-tool` when present, else a file only the user can read (open question 4). The launchers run under Windows PowerShell 5.1 and PowerShell 7 (`pwsh`) on macOS and Linux. Opus medium (secrets). The Fireworks key already stored on this machine keeps working.
Acceptance: `ext-build.test.ps1` passes (all existing checks plus one per OS branch, with the OS store mocked); no key is printed or logged; `ext-build.ps1 -Check` still prints OK here.

### S9. Image launcher
Status: todo
`plugins/ag/scripts/design-image.ps1` (fix 11: one plugin `ag`): makes images from a prompt with Gemini or OpenAI (`-Provider`, `-Model`, `-Out`, `-Count`), keys from S8, models and defaults in `~/.claude/design.json` then `design.default.json` in the plugin; writes each image with a sidecar `.md` (prompt, provider, model, time); `-DryRun`; exit codes as `ext-build.ps1`. Built on Fireworks.
Acceptance: `design-image.test.ps1` passes (no real API call: request shape, config order, file and sidecar names, missing key exits 2); `-Check gemini` and `-Check openai` each print OK once the user has set the key.

### S10. design skill `ag:design`
Status: todo
`plugins/ag/skills/design/` (the user moved design into the `ag` plugin as `ag:design`, fix 11; ag version 1.1.0): takes a plan path or a description, plans the design (pages, states, components, copy), then makes the images with S9, all in the project under `design/<yyyymmdd>-<slug>/` (`brief.md`, `design-plan.md`, `images/`, `review.md` for the user's notes) so the user can review it (open question 5). Skill text at Opus medium (technical copy); the design plan itself is made at Opus high when the skill runs.
Acceptance: `claude plugin validate plugins/ag` passes; `claude --plugin-dir plugins/ag -p "list your skills"` names `ag:design`; a dry run on a two-line description writes the folder with `brief.md` and `design-plan.md` and the `-DryRun` image commands.

### S11. Goals use design for new pages
Status: todo
In both goal-prompt skills: a step that adds a new page or screen gets a design step first (the design skill, Opus high), whose folder the UI builder then works from and the user can review; a minor UI change skips it; with no image key set, the design step writes the plan without images. Both skills name the project folders they write (`design/...` committed for review; `.claude/goal-prompt/<run>/` git-ignored for briefs and logs). Opus medium (technical copy). Versions: goal-prompt 1.1.0.
Acceptance: both SKILL.md files name the design step, the new-page rule and the folders; the goal templates stay under 4,000 characters; `claude plugin validate plugins/ag` passes.

### S12. Install and README with design
Status: todo
`scripts/install.ps1` updates `ag` to the version with design; README: key setup on Windows, macOS and Linux for the three providers, `/ag:design` and its folder, an example. README at Opus high (end-user copy); the script on Fireworks.
Acceptance: `install.ps1 -WhatIf` names `ag@agents-plugin`; README names the three providers and the three OSes; `claude plugin validate .` passes.

### S13. Push and run it here
Status: todo
Run the install script here, `-Check` for each provider whose key is set, push `main`.
Acceptance: `claude plugin list` shows `ag@agents-plugin` enabled at the new version; the `-Check` lines printed; `git push` succeeds; `git status` clean.

## Open questions (with defaults)
1. If the bare `/goal-prompt-3rdparty` does not work after install, use `/goal-prompt:goal-prompt-3rdparty` (default) and say so in the README. Checked again Nov 6, 2026 in fresh sessions: the bare `/goal-prompt` and `/goal-prompt-3rdparty` work; the long names work too (fix 7).
2. How does a goal made by `goal-prompt-3rdparty` find the launcher after the user-level copy is gone? Default: the skill writes `${CLAUDE_PLUGIN_ROOT}/scripts/ext-build.ps1` into the goal and the runner, which the skill text shows as the full path of the installed version; after a plugin update, make the goal again (fix 3).
3. How are the screenshots made? Default: render the mod's band, pane and `/goal-progress` output from `docs/examples/goal-progress.json` with the mod's own components (the mod test or render tools), and turn that output into images; never capture the user's screen. If no render route works, a terminal window that shows only a demo session.
4. Key store on Linux without `secret-tool`? Default: `~/.claude/secrets/<provider>.key` readable only by the user (mode 600), and `-SetKey` says it is not encrypted.
5. Folder layout in a project? Default: design work in `design/<yyyymmdd>-<slug>/` (committed, for review); goal runs keep `.claude/goal-prompt/<yyyymmdd>-<slug>/` (git-ignored: briefs, logs) and `.claude/goal-progress.json`; each skill says which folders it writes.
6. Pushes: Phase 3 pushes in S13 only (like S5 and S7).

## Later
- Ship the status line scripts (`~/.claude/hooks/statusline.js`, `subagent-statusline.js`) too.
- A second machine: run `scripts/install.ps1` there, then `ext-build.ps1 -SetKey`.

## How this plan is run

1. **Status** is the `Status:` line on each step and on each phase: a step sets its own mark (`done <date>` or `blocked: <reason>`) in its own commit; the main thread sets a phase's mark (`shown <date>` at a gate, `done <date>` after the sign-off) at its close and rewrites "Where the run stands" at each landing. No other list is kept. This section and the status lines are committed with S1 (the repo does not exist before it).
2. **Scope is the plan.** Build each step's acceptance as written, nothing more. A real gap is an open question in "Open questions" with a default; ideas go to "Later".
3. **Order.** Steps run one after another in this checkout on `main` (all are small; no worktrees). S2, S3 and S4 touch different folders and may run side by side, up to 3. The main thread assigns names when a step starts.
4. **A step** is built by a fresh Fireworks builder (`~/.claude/bin/ext-build.ps1` until S7 moves it, then `plugins/goal-prompt/scripts/ext-build.ps1` in this checkout, and `plugins/goal-prompt-3rdparty/scripts/ext-build.ps1` after fix 9, `plugins/ag/scripts/ext-build.ps1` after fix 11; `-Brief <brief> -Cwd C:\Users\User\Code\AgentsPlugin -Step <id> -LogDir .claude/goal-prompt/20261106-plugin/logs`, model `accounts/fireworks/models/deepseek-v4p1-flash`, started as a background shell job), except S5, which is kept on Claude at Opus medium. The brief is pointers, in `.claude/goal-prompt/20261106-plugin/briefs/<step>.md`: this file with the step's line range and this section's range, and the source paths from "What goes in". The builder reads by range only (Read with offset and limit, Grep with a limit), makes its first edit within about 20 tool calls, writes only the tests the plan names, runs the step's own checks once, sets its status mark and commits.
5. **Handoff.** At about 100 tool calls a builder stops at a safe point (committed, nothing half written) and returns "HANDOFF" with a note of at most 15 lines in its report: done (commits), left, what fails (command and first error lines), files with line ranges, next action. The next builder starts from the note and `git log`, and makes its first change within about 10 tool calls. A failed step's report is the same note, and a fresh Opus high subagent continues the step (never restarted, no other step in its place). A Fireworks HANDOFF (exit 3) goes to a fresh Fireworks builder with the note; a Fireworks failure (exit 1) goes to Opus high; a setup error (exit 2) stops the run and is reported to the user.
6. **Landing:** the step's own acceptance checks, then its commit on `main`; pushes happen only in S5 and S7. After a fix only the failed check runs again.
7. **Phase close:** every step of the phase marked; once: `claude plugin validate .`, `claude plugin test plugins/ag`, `plugins/ag/scripts/ext-build.test.ps1` (phase 2 also the install script's second run); one review of the phase's diff at Opus high (it touches secrets and `~/.claude`; findings fixed or deferred with a reason); the phase marked `shown`; `git status` clean.
8. **Model and effort:** planning and reviews at Opus high; copy is never written on Fireworks (the user, Nov 6, 2026): end-user-facing copy at Opus high, technical copy at Opus medium; building on Fireworks `accounts/fireworks/models/deepseek-v4p1-flash` (S5 at Opus medium); a failed step at Opus high; mechanical work at Sonnet. A builder report is at most 20 lines; longer output goes to `.claude/goal-prompt/20261106-plugin/logs/`, and Fireworks runs also log one line each to `logs/ext-runs.jsonl`.
9. **Feedback during the run.** The main thread first writes the user's note on work in progress into this plan, in the user's words. A change to a step not yet landed goes into that step's acceptance; anything else becomes a fix step of the current phase (`fix <n>`, with its `Status:` line). Then it is routed like any step: to Fireworks, or to Opus medium if it belongs to S5. If a Fireworks builder of that step is still running, it finishes first. Feedback on a step that a Fireworks builder built but has not landed resumes that builder (`-Resume <session id>` from `logs/ext-runs.jsonl`) with a brief of the feedback lines. Once the step has landed, the feedback becomes a new fix step with a fresh builder. A note that changes scope or a decision is confirmed with the user before it is written.

## Where the run stands
2026-11-06: builders on Fireworks `accounts/fireworks/models/deepseek-v4p1-flash` (launcher `plugins/ag/scripts/ext-build.ps1`); S5 on Opus medium; copy on Opus (rule 8).
Phase 1 done (4e15b7b). Phase 2 reopened for fix 13 (fix13-progress-fw1: `/ag:goal-progress`, the bar at a gate). Before that it was shown, waiting for the user's check in a new session: `/ag:goal-prompt`, `/ag:goal-prompt-3rdparty`, `/ag:goal-progress`, the progress bar. Done: S6, S7, fix 6-12; fix 11 (13abdd3) pushed and installed here (only `ag@agents-plugin` 1.0.0, `-Check` OK, install rerun all `skip:`); fix 12 (01813db, README and goal-progress.md for `ag`) local until S13's push. Phase close: suites passed (validate, 13 tests, ext-build 31); review findings fixed (fix 8) or deferred.
Next after sign-off: Phase 2 done, then Phase 3 (S8; design as `/ag:design`).
