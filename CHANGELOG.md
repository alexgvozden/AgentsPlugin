# Changelog

What changed in the `ag` plugin, newest first. The steps named in brackets are
in [PLAN.md](PLAN.md).

## 1.6.0 - 2026-11-10

- New command `/ag:fable-planning on|off|status`, per project, default off. It
  writes `"fablePlanning": true` into the project's `.claude/ag.json`; `off`
  removes the key. Only goal runs and `/ag:design` read it: with it on, the four
  goal skills write into the plan's rule 8 and the runner that planning work
  (splitting or re-planning a large step, a builder's design question, each
  phase's plan) goes to a fresh Fable 5.2 high subagent, and `/ag:design` makes
  its design plan on Fable 5.2 high. Ordinary chats, the coordinating session,
  building, UI parts, reviews and failed steps are unchanged. Script
  `scripts/fable-planning.ps1` with its self-test `fable-planning.test.ps1`.
- Docs: new page
  [docs/benchmark.md](docs/benchmark.md): one real `/ag:goal-prompt-3rdparty`
  run, with charts of who did which tasks, tokens, cost per model, DeepSeek vs.
  Opus ratios and the Opus fixes. The README has a short Benchmark section with
  two of the charts and a link. (fix 31)

## 1.5.0 - 2026-11-09

- New skill `/ag:reddit-product-ideas`, moved here from findajobandrelocate.com
  so it works in every project. It finds what a site's audience asks on Reddit
  (RSS and the public JSON, Claude in Chrome as the fallback) and elsewhere,
  compares it with what the site already says, and proposes strategic, UX/UI and
  content changes with counted evidence and real links, in an interactive HTML
  report. Each project keeps its own config in `.claude/product-ideas/`:
  `sources.json` (subreddits, searches, filters), `codebook.json` (themes and
  their labels, fields, job ads, kind rules, gate labels) and `project.md` (site,
  audience, files to read, where the run goes, rules every proposal keeps). With
  no config the skill drafts the three files from `templates/` and waits for
  approval. The scripts hold no project words; with the findajobandrelocate.com
  config they plan and write the same output as before.

## 1.4.1 - 2026-11-08

- Fireworks builders now default to `deepseek-v4p1-flash-1017` (DeepSeek V4.1
  Flash 1017, Fireworks' 17 October 2026 update of V4.1 Flash, same price) in
  `ext-build.default.json` and the README. `model=deepseek-v4p1-flash` still
  picks the earlier model. (fix 30)

## 1.4.0 - 2026-11-08

- New skill `/ag:goal-prompt-sonnet`: the same goal as `/ag:goal-prompt-haiku`,
  with Sonnet in Haiku's place. Well-described, clear coding steps are built by
  Sonnet subagents on Claude. Planning, design, UI parts, copy, reviews and failed
  steps stay on Opus. It needs no extra key and no launcher. A Sonnet builder that
  hands off is followed by a fresh one; one that fails is followed by Opus high.
  The band shows a running Sonnet builder with its model. The README lists the
  skill, adds its row to "Which model does what", and says when to pick which of
  the four goal skills. (fix 28)
- `/ag:goal-prompt-haiku` is picked on "Haiku builders" instead of "cheaper
  builders on Claude", which now fits Sonnet too. (fix 29)

## 1.3.0 - 2026-11-07

- New skill `/ag:goal-prompt-haiku`: the same goal as `/ag:goal-prompt`, but
  well-described, clear coding steps are built by Haiku subagents on Claude.
  Planning, design, UI parts, copy, reviews and failed steps stay on Opus. It
  needs no extra key and no launcher. A Haiku builder that hands off is followed
  by a fresh one; one that fails is followed by Opus high. The band shows a running
  Haiku builder with its model. (S17)
- The README lists the new skill, adds its row to "Which model does what", and
  says when to pick which of the three goal skills. (S18)

## 1.2.1 - 2026-11-07

- Before a goal is written, `/ag:goal-prompt` and `/ag:goal-prompt-3rdparty`
  check the keys the goal will use and tell you which are missing, with the
  `ag-key.ps1 set <provider>` line to run in your own terminal. You set the key
  or choose to go on without it, and the goal carries that choice, so the run
  does not ask again. (fix 22)
- `/ag:design`, run by you, does the same before it makes images: set the key,
  or go on with the design plan and no images. After a dry run it gives the
  same `ag-key.ps1 set` line, and the plan's own rules carry your choice too.
  (fix 22, fix 24)

## 1.2.0 - 2026-11-07

- The progress band follows the work by itself. It reads the step and phase
  marks from the plan, and shows the session's subagents under "Running" while
  they work, so you no longer wait for the progress file to be written.
  (S14, fix 19)
- A Fireworks build from `ext-build.ps1` shows under "Running" while it runs and
  leaves when it ends, on Windows, macOS and Linux. (S15, fix 20)
- The goal skills no longer keep the band's tasks by hand; the README and
  `goal-progress.md` say what the band reads and when it moves. (fix 18, fix 21)

## 1.1.2 - 2026-11-06

- One key command that works from any folder:
  `~/.claude/ag/ag-key.ps1 set|check|where <fireworks|gemini|openai>`, written
  by the install script. `where` tells you where your key is stored and whether
  it is set, without printing it. (fix 17)

## 1.1.1 - 2026-11-06

- Launcher fixes from the Phase 3 review: `claude` is found on macOS and Linux,
  image requests are sent as UTF-8, the API's own error text reaches you with the
  key masked, key files are kept private on Linux, and `~/.claude/design.json`
  can override a single setting. (fix 16)
- README: macOS and Linux need PowerShell 7, with Microsoft's install links; every
  script command works from any folder. (fix 15)

## 1.1.0 - 2026-11-06

- `/ag:design`: plans a UI design from a plan or a short description and makes
  its images with Gemini or OpenAI, in a `design/<yyyymmdd>-<slug>/` folder you
  can review. (S9, S10)
- Goals run a design step first for a new page or screen, and skip it for a minor
  UI change. (S11)
- Keys for Fireworks, Gemini and OpenAI are set up the same way on Windows, macOS
  and Linux, and are never asked for in chat. (S8, S12)

## 1.0.2 - 2026-11-06

- The progress command is `/goal-progress` again; a plugin command cannot carry
  the `ag:` prefix. (fix 14)

## 1.0.1 - 2026-11-06

- At a sign-off the band names the phase that is waiting for you, not the next
  one. (fix 13)

## 1.0.0 - 2026-11-06

- One plugin, `ag`, with `/ag:goal-prompt`, `/ag:goal-prompt-3rdparty` and the
  progress bar. The install script removes the older separate plugins, so the bar
  never loads twice. (fix 11, fix 12)

## Before 1.0.0

Three separate plugins, `goal-prompt`, `goal-prompt-3rdparty` and
`goal-progress` (S2, S3, fix 1 to fix 10), until fix 11 merged them into `ag`.
