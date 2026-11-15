# Changelog

What changed in the `ag` plugin, newest first. The steps named in brackets are
in [PLAN.md](PLAN.md).

## 1.14.0 - 2026-11-15

Pin which upstream provider serves the OpenRouter builders.

- `/ag:3rdparty-provider openrouter <slug,...>` (e.g. `wafer/mxfp4` or
  `deepinfra/fp8,deepseek`) stores `providers.openrouter.routing` as
  `{"only":[...]}`: only those providers or endpoints serve the builders; with a list
  OpenRouter picks among them. `cheapest`, `fastest` and `quickest-start` sort every
  provider by price, throughput or latency; `auto` removes the pin; no second word keeps it.
- Slugs are checked against the model's public endpoints list: an unknown one is saved
  with a warning listing the valid tags; offline the check is skipped. Status shows the
  routing and each pinned endpoint's price and quantization.
- `ext-build.ps1` sends the routing as `CLAUDE_CODE_EXTRA_BODY={"provider":...}` in the
  builder's environment only, on OpenRouter runs; a parent value never leaks into a
  builder, and an inherited `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` is dropped when a pin
  is set. `-DryRun` and `-Check` show it, and `logs/ext-runs.jsonl` records it.
- README: "OpenRouter: choosing the upstream provider".

## 1.13.0 - 2026-11-15

OpenRouter as a second provider for the third-party builders, next to Fireworks.

- `/ag:3rdparty-provider fireworks|openrouter|status` picks the provider. It writes
  `"provider"` into `~/.claude/ext-build.json` (created if missing; an old flat file
  is moved into `"providers"`, other keys kept) and says whether that provider's key
  is set.
- The OpenRouter key is set like the Fireworks one, in your own terminal:
  `ag-key.ps1 set openrouter` (also `check` and `where`).
- The default OpenRouter model is `deepseek/deepseek-v4.1-flash-1017` (DeepSeek V4.1
  Flash); any other OpenRouter id works with `model=<id>`.
- `ext-build.json` now holds one entry per provider under `"providers"`; the user file is
  laid over the plugin default key by key. Old flat files keep working as the provider
  they name. `ext-build.ps1` takes `-Provider` to override it for one run.
- Builder rules, the `Built-by:` trailer, the run log and the progress band name the
  provider (`fw:<model>` or `or:<model>`, both in the third-party tone).
- `goal-prompt-3rdparty` and `/ag:plan` speak of the chosen provider instead of Fireworks.

## 1.12.2 - 2026-11-15

Goal runs no longer loop after a compaction or a pause in your own words.

- The "met when" condition of all four goal skills counts only what is shown since
  the conversation's latest summary: a phase finished before a compaction needs no
  evidence again, and none finished means none needed. Before, a run that compacted
  (or was resumed and paused at once) could never show its earlier landing lines,
  so the /goal checker blocked every stop until Claude Code's 9-block cap.
- After a compaction the runner prints the plan's marks, "Where the run stands" and
  `git log --oneline -15` again, so the evidence is back in view.
- A message asking the run to wait or stop in any words ("I am adding a tag, then I
  will ask you to continue") is a pause: the run writes the words into "Where the run
  stands", sets progress "waiting" and ends. Before, only "pause" or a declined
  question counted.
- The hand-over check and the tests name both. The runners were tightened to stay
  within 3,800 characters (3rdparty: 3,795).

## 1.12.1 - 2026-11-15

- README: a Plan pages guide: where plans live, reading a plan (contents, folds,
  search, links), the solution design and its diagrams, answering on the page and
  what happens to the answers, and the plan-page.mjs commands, with screenshots.

## 1.12.0 - 2026-11-15

Plans you read as a page, each in a folder of its own.

- New `plugins/ag/scripts/plan-page.mjs` renders a plan's `plan.md` into
  `plan.html` beside it: goal, phases and steps with status chips, open
  questions with option buttons, the Feedback list, search, a comment box on
  every item, and the answer bar with **Copy answer** from the ideas pages. Every
  part opens and closes (**Open all** and **Close all**; the page remembers
  them), done steps start closed and so do all steps in a plan of more than 15,
  and a contents list stays beside the plan on a wide screen.
- New `plugins/ag/scripts/mermaid-svg.mjs` draws Mermaid `flowchart` and
  `sequenceDiagram` blocks as SVG inside the page, with no outside script; other
  kinds show their source. Images in a plan (`![…](…)`) show as figures. Its commands are `folder`, `render [--strict]`, `open [--id]`,
  `record --from` and `refs`. `--strict` warns on duplicate ids, steps without
  a status and questions without an id or a default.
- `/ag:plan` puts a new plan in `plans/<yyyymmdd>-<slug>/plan.md` (or in
  `.planning/` or `docs/plans/` if the project uses them), renders and opens its
  page, and asks the main questions in the chat. Pasted answer lines (`PLAN ok`,
  `PLAN changes: …`, `Q1 B`, `1.2: …`) are recorded in the plan, answers under
  their question and the rest in a Feedback section, then acted on and closed
  with `— done <date>: …` or `— no change: …`. A loose plan in a plans folder
  moves into a folder of its own on its next update; a root `PLAN.md` and plans
  with "How this plan is run" stay put. The format is shown in
  `skills/plan/plan.example.md`.
- A new plan for a feature has a Solution design section where the work needs
  one: architecture, high-level design (components, data, APIs, key flows),
  screens with their states and design images, and the technical
  implementation. Updates keep it in step with the plan.
- `/ag:plan` asks every open question that has options, in several rounds of at
  most 4 when there are more.
- The goal skills also look for `plans/**/plan.md`; both planner agents render
  the page after writing a plan for `/ag:plan`.

## 1.11.0 - 2026-11-15

An ideas list per project, from a rough line to researched facts.

- New `plugins/ag/scripts/ideas.mjs`, which keeps `ideas/ideas.json` and renders
  `ideas/ideas.html` and each idea's `research.html`. Its commands are `add`,
  `render [--strict]`, `open [--id] [--research]`, `record`, `resolve`, `list`,
  `status` and `link`. Windows drops `#AGPL-IDEA-003` when it opens a file, so `open`
  goes through a small redirect page in the temp folder. Ideas belong to the
  project: without `--dir` the folder is `ideas/` at the git root (else the
  current folder), and the script refuses to use the home folder. It writes
  `ideas/.gitignore` to keep `*/data/` (raw research data) out of git. Each list
  has a project code of 4 or 5 letters (`--code`, else made from the project's
  name: AgentsPlugin is `AGPL`), and every id and folder carries it
  (`AGPL-IDEA-003`), so ideas of two projects never share an id. `IDEA-003` and
  `3` still work as references; another project's code is refused.
- `/ag:ideas [id]` renders the list and opens it. You can filter by status and
  search. Each card shows the id, status, description, target, first-look SWOT
  and RAID, questions with a recommended option, comments, and a link to the
  research page with its verdict.
- `/ag:idea <words>` adds an idea: id, title, description, the words as typed,
  kind (builds on the project, or something new), target, first-look SWOT and
  RAID, and 3 to 6 questions. It opens the list at the idea and asks the main
  questions in the chat. `/ag:idea AGPL-IDEA-003 <words>` adds a comment or changes
  the idea. Pasted answer lines are recorded: `AGPL-IDEA-003: comment`,
  `AGPL-IDEA-003 Q2 B: note`, `AGPL-IDEA-003 decision park: why` (park and drop set the
  status) and `AGPL-IDEA-003 RQ1: text`.
- `/ag:idea-research <id>` runs four Opus high subagents in parallel:
  - the current state, the target, the gap between them, and the value;
  - demand and traffic from DataForSEO (at most 8 calls, a dollar budget, cost
    noted, raw answers kept);
  - what people say, from Reddit RSS through `fetch-reddit.mjs`, the web, and
    Claude in Chrome on Sonnet as the fallback;
  - competitors and the market.

  Research answers "should we do it?" and plans nothing. How to build it is
  left to `/ag:plan` after a go. The page has no build steps or task
  estimates, only one rough size (small, medium or large), and
  `render --strict` warns if a `path` or efforts appear.
  The results go into `research.json`, which `render --strict` checks: every
  claim cites a source, web sources have a date, risks have likelihood and
  impact, quotes have 20 words or fewer, and there are no user handles. An Opus
  high subagent checks the facts, Playwright checks the page at 1440 and 390,
  and the review page shows both. The research page has a verdict, the
  summary, value, now, target, gap, demand with trends, voices, competitors, SWOT,
  RAID, facts, cheap tests, numbered sources, the method, and a Decide bar with
  Copy answer.
- Tests: `node --test plugins/ag/tests/ideas.test.mjs` (17 tests).

## 1.10.0 - 2026-11-14

The first review pages were a grid of small cards with scroll bars inside them,
and a zoom that opened in the same small square. Every review page is now built
from one template.

- New `plugins/ag/templates/review/review.html`, a self-contained page that
  renders from a JSON spec put into its data block.
  - Items are stacked full width, with no scroll boxes inside the cards; a tall
    screenshot shows its top first and opens to its full length.
  - Clicking an image opens a full-screen viewer: Fit, Width and 100%, drag to
    move, and ← → between images.
  - Desktop and phone screenshots sit side by side, the phone in a phone frame,
    with an All, Desktop and Phone filter.
  - Before and after works as a slider or side by side.
  - Pick-one options have pros, cons and a Recommended badge.
  - Wording tables show where, was and now.
  - It has links, an "Open the app" button, numbered questions with options and
    a recommended one, and light and dark mode.
- An answer bar: clicking ✓ Looks good, ✎ Change, an option or a question's
  answer collects numbered lines (`1 ok`, `2: note`, `3 B: note`). **Copy
  answer** puts them on the clipboard to paste into the chat. Answers stay in
  localStorage, so a reload keeps them.
- `review-page.ps1` puts the spec into the template.
  - Spec v2 fields: `summary`, `notes`, `app`, and per item `tags`, `shots`
    (with `device`), `compare`, `options`, `copy`, `links`, `note`, `files`
    and `answer: "none"`.
  - Older specs and `path|caption` arguments still work.
  - An image under 600 pixels wide goes in a phone frame.
  - `</` and `<!--` are escaped, so no spec text can break the page.
  - Self-test: `review-page.test.ps1` (43 checks).
- Samples in `docs/review-samples/` (desktop only, desktop and phone, before and
  after, pick one), built from a made-up app by `build-samples.mjs`. The README
  shows them in screenshots under "Review pages".
- Global rules, "Previews and reviews": the spec's new parts, the samples, and
  the lines that Copy answer gives.

## 1.9.4 - 2026-11-14

Found on the findajobandrelocate run: after a fix the run printed its screenshots
as `[image] docs\review\revamp\fix14-hub-1440.png` lines, which cannot be
clicked open in Claude Code, so the user had to ask each time to see them.

- New `plugins/ag/scripts/review-page.ps1`: puts images, HTML files and URLs on
  one numbered page with what to look at and the questions, and opens it in the
  browser (HTML files and URLs in their own tabs too). Images are embedded, so
  the page stands alone and reads on a phone; the page goes to the system temp
  folder, so `git status` stays clean. `-Spec` takes a JSON spec, `-Link` links
  images by relative path, `-NoOpen` only writes. Self-test:
  `review-page.test.ps1` (27 checks).
- `scripts/install.ps1` writes `~/.claude/ag/review-page.ps1`, an entry point
  that runs the newest installed `ag` that has the script, else the checkout,
  so rules and plan files can call it by a path that never changes.
- Goal skills, rule 7: anything the run shows the user to look at, at a gate,
  after a fix, or when a UI part has built or changed a screen and asks for a
  review, goes on one review page opened in the browser, numbered as the
  questions; never only file paths or `[image]` lines. Principle 6: the UI
  part's screenshots and the running app's URL go on that page. The runners are
  unchanged.
- `/ag:design` writes `review.html` (images linked, the checklist as questions)
  next to `review.md` and opens it; called from a goal it only writes it.
- Global rules (`rules/CLAUDE.global.md`): a new "Previews and reviews" section
  for every chat, frontend work included: after building or changing a page,
  take screenshots and show them with the app's URL on a review page before
  asking for a review. HTML reports are opened in the browser.
- The skills' text tests check the new rule 7 and design wording.

## 1.9.3 - 2026-11-14

Found on the findajobandrelocate run: the user declined a gate's AskUserQuestion
twice with no text. That was neither an answer nor "pause", so none of the
runner's three "met when" ends could hold; the Stop hook blocked every stop and
the run asked the same questions again in a loop.

- A question declined or dismissed with no text is now a pause, a met end: the
  run sets progress "waiting", rewrites "Where the run stands" and ends, and it
  never asks the same question again. A decline with text is the answer. The
  runner's met condition, its Phases line, rule 7, the principle, the checks
  before handing over, the description, the output note and the README say so
  in all four goal skills.
- New tests on the skills' text, `node --test plugins/ag/tests/skills.test.mjs`:
  each runner fits 3,800 characters; its "met when" names every way a run can
  end (all done, a pause answered, a question declined with no text, blocked);
  every question has an end for a decline and is never asked again; no runner
  ends the turn to wait or says to paste again after each gate; the four skills
  share one met condition and one gate rule. They fail on 1.9.2 (13 of 21).
  Until now the only tests covered the band's model, so nothing read the text
  the skills hand out.

## 1.9.2 - 2026-11-13

- A goal is pasted once. The four goal skills no longer end the run at a
  sign-off and tell the user to paste the same goal again. At a gate the run
  sends a short summary and asks with AskUserQuestion (approved; approved with
  notes or answers; changes; pause), waits for the answer inside the run, writes
  it into the plan and goes on. A step only the user can move does not stop the
  run either: the steps that do not wait on it go on, then it asks the same way.
- The runner's "met when" now has three ends only: all done, paused by the
  user's answer, or blocked. Pasting the same goal again resumes after a pause,
  a block or in a new session. Rule 7 of "How this plan is run", the checks
  before handing over, the output note and the README say the same.

## 1.9.1 - 2026-11-13

Found on the marketing run: for 1.5 hours it planned phase PG and built PG1 in a
worktree, in two parts, while the band said "updated 2h ago, may be behind" and
the pane showed PG1 "not started".

- "updated ... ago" and the pane's footer no longer read only the progress
  file's `updated`. They show the last time anything moved: the file's
  `updated`, its newest `log` time or `running` start, or later when the session
  saw the file, the plan or its subagents change. "may be behind" shows only
  when the goal runs, no subagent is running and nothing moved for 15 minutes.
- A step a live subagent or a `running` job works on reads in progress (and its
  phase too) while the plan still says `todo`: a step built in a worktree or in
  parts marks itself only when it lands on main. The subagent's description
  names the step ("PG1 UI part 2: screens and shots"), or the job's `step` does.
- A `running` job written as `{step, what, started}` is read instead of dropped.
- The four goal skills' "How this plan is run" rule 1 and progress-file notes:
  `updated` and a `log` line when a step or part starts, a subagent ends and at
  each commit; builder descriptions start with the step id; `running` jobs name
  their `step`.
- Six new tests.

## 1.9.0 - 2026-11-12

- Long jobs follow one checklist, `skills/plan/long-jobs.md`, used by
  `/ag:plan` (new rule 6), the four goal skills (a new principle, rule 3 of "How
  this plan is run", the progress file, and a check before handing over) and both
  planner agents. It covers crawling, API fetches, imports, backfills and model
  or LLM runs over many items:
  - Fetching is kept apart from processing. Raw responses are kept untouched,
    and processing reads only from them, so a new algorithm or a fix reruns
    over the stored data without fetching again. Output records the version
    that made it, and paid calls are cached by their input.
  - A per-item work list with idempotent writes lets a rerun resume, and
    `--only-failed` and `--reprocess` redo only what is needed.
  - A sample batch of 20 to 50 items is checked against the step's acceptance
    before the full run. Batches then take 5 to 15 minutes, each printing a
    line of results. The full run goes to the background and shows as a `job`
    in the tasks pane.
  - Jobs retry with backoff and stop themselves when too many items fail.
    Crawling follows robots.txt, rate limits and conditional requests.
    Database backfills go by key range.
  - No job runs over about 20 minutes without printed results. A plan step
    with a long job lists its stages, sample batch, batch size, expected time,
    error budget, and its resume, retry and reprocess commands.
- `/ag:plan` proposes `/ag:goal-prompt-3rdparty` as the goal skill for a new
  plan; `/ag:goal-prompt`, `-haiku` and `-sonnet` are listed as alternatives.

## 1.8.0 - 2026-11-11

- Planning is pinned to exact models. New plugin agents `ag:fable-planner`
  (`claude-fable-5-2`, high effort) and `ag:opus-planner` (`claude-opus-5-5`,
  high). With fable planning on, the goal skills, `/ag:design` and `/ag:plan`
  hand planning to `ag:fable-planner` with no `model` parameter, so it runs on
  Fable 5.2 and not whatever the `fable` alias points to.
- The Goal tasks pane shows the plan in three levels, in plan order: phases
  (epics), steps (stories or tasks) and a step's parts (subtasks: `4.1a`,
  `4.1-ui`, or a heading one level deeper with its own `Status:` line). It reads
  more plan formats: ids with a colon, a space or a dash after them (`UXB1:`,
  `4.1 Title`, `fix 1 Title`), letter ids (`UXB`, `T5`), `- **Status:**` bullets,
  and tracker cells with a part's status (`todo, 6.4a done`). A heading with no
  `Status:` line no longer takes the last one's mark.
- New status `needs-you` ("needs you"), from plan marks such as `waiting for you:
  <what>`; `shown` now reads "to approve". A "Needs you" card lists both, and a
  line of counts by status heads the pane. Status words such as `running`,
  `built`, `released` or `on hold` read as in progress, done, deployed and
  waiting instead of not started.
- The plan's titles win over the progress file's, so a step never shows without
  a title; step rows are laid out to the pane's width and no longer wrap.
- A flat progress file from an older run (one task per step, `P4-review`,
  `phase7`) is grouped under the plan's phases and steps.
- New command `/ag:refresh-tasks [plan] [check]`, with the script
  `scripts/refresh-tasks.ts` (Node 22.6+): shows the tree and what is out of
  date, sets the plan's status marks from git, and rewrites the progress file in
  the nested form (a `.bak` copy is kept).
- The goal skills and `/ag:plan`: steps the user must do are marked `waiting for
  you: <what>`, a step's parts are sub-steps with their own marks, and the
  progress file never gets a task per plan step.

## 1.7.0 - 2026-11-10

- New command `/ag:plan`: makes a new plan or updates an existing one. The
  planning runs on Fable 5.2 high when fable planning is on for the project
  (`.claude/ag.json`), else Opus 5.5 high, in a subagent if the session is on
  another model. An update keeps the plan's format and tracking place and never
  changes finished steps; in a plan set up by a goal skill, new steps get `todo`
  marks and the builder that skill's rule 4 gives them (Opus, Haiku, Sonnet or
  Fireworks), and rule 8 follows the current fable planning setting. It runs
  only when called as `/ag:plan`.

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
