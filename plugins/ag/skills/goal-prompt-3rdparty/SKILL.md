---
name: goal-prompt-3rdparty
description: "Same as goal-prompt, but the function builders run on a Fireworks AI model (default in ~/.claude/ext-build.json, else ext-build.default.json in the plugin, or model=<id>) through ${CLAUDE_PLUGIN_ROOT}/scripts/ext-build.ps1, while planning, UI parts, reviews and failed steps stay on Opus. Use only when the user asks for goal-prompt-3rdparty, a Fireworks/third-party goal, or cheaper builders on Fireworks. Turns an implementation plan into ONE ready-to-paste /goal that carries out exactly that plan, with light, fast checks and printed evidence. The plan stays the only list: each step's status is marked in the plan file itself, in the step's own commit; no goals file, handoff file, packet copies or parallel task lists. The goal pauses only at sign-offs the plan requires (re-run the same goal to continue) and fits the 4,000-character limit. The run invents no scope; tests stay light (the step's own tests, lint, typecheck, screenshots), full suites once per phase and never as a gate; parallel work only for steps on different files; builders get pointers, not copies; a failed step is continued at high effort, never restarted. The goal-progress bar reads the plan's marks and the session's subagents; a tiny .claude/goal-progress.json adds status, notes and other jobs. Also converts a plan already set up by goal-prompt."
argument-hint: "[plan file or step range] [model=<fireworks model, e.g. deepseek-v4p1-flash-1017>] (a plan already run by goal-prompt is converted)"
---

# Goal prompt generator (third-party builders)

A copy of `goal-prompt` with one change: the work an Opus medium builder would do goes to a headless Claude Code running on Fireworks (principle 7). Everything else is the same; when `goal-prompt` changes, carry the change here too.

Always produce **one** `/goal` that completes the whole plan (or the step range given). Never offer several goals and never ask whether the user wants one or many. The goal stops only at a **gate**, a sign-off the plan itself requires; to continue, the user pastes the same goal again and it resumes at the first step whose status mark is not "done".

Input: `$ARGUMENTS` (a plan path, a step range, or a short description, and optionally `model=<id>`). If empty, find the plan (step 1). The model is `model=` if given, else `defaultModel` in `~/.claude/ext-build.json`, else `defaultModel` in the plugin's `ext-build.default.json`; a bare name gets `accounts/fireworks/models/` in front, a full `accounts/...` path is used as is.

## Principles (Alex, Oct 19, 2026: "keep plan up to date and mark things done in actual plan files, not some parallel list ... maybe something simple")

1. **The plan is the only list.** Status lives in the plan file: each step carries a mark, `todo`, `done <date>` or `blocked: <reason>`, and each phase or gate `todo`, `shown <date>` (built, waiting for the sign-off) or `done <date>` (signed off). If the plan has a tracker table, its status column is the place; otherwise each step gets one `Status:` line, added once in the setup commit. A step sets its own mark in its own commit, so the mark lands with the code. The plan also holds one short **"Where the run stands"** paragraph (what is landed but not released, what is built and waiting to land, what is next), rewritten in place at each landing; it replaces any handoff file. Nothing else keeps a list: no goals file, no handoff file, no per-step progress file, no copies of plan text or code in files. Open questions and "later" ideas go into the plan's own sections (add one if missing).
2. **Follow the plan, invent nothing.** The run builds exactly the plan's steps and their acceptance: no feature, hardening, refactor, tooling, document, test kind or step the plan does not name, and no step widened because something nearby could be better. Unclear means the smallest reading that meets the acceptance; a real gap is an open question in the plan with a default, and the run goes on with the default.
3. **Light, fast checks.** A step is checked by lint, typecheck and its own tests (the ones it writes or changes and the ones beside the files it changes), plus screenshots of the screens it changes. Whole suites and device-level end-to-end runs happen once per phase, after it, never as a gate. A fix reruns only the check that failed. The user can choose heavier testing in step 3.
4. **Move in straight lines.** Steps run side by side only when they touch different files and modules. The main thread hands out unique names (migrations, ids) before steps start and fixes small things itself (a renamed label in a test, a one-file conflict). No polling loops; long scripts run from a copy so they can be edited.
5. **A failed step continues, it is not restarted.** A builder that cannot fix its tests in one more try, hits a problem it cannot solve or raises a design question stops and reports with a handoff note; a fresh subagent at Opus high continues the same step in the same worktree and branch, starting from the failing check. No other step starts in its place. Only if the high subagent fails too is the step marked `blocked: <what is missing>`.
6. **UI is designed and built apart from its function** (the user, Nov 4, 2026: "always design and make ui separately with Opus 5.5 high and than impelment functionality with medium"). A step that adds or changes a screen is split in two: first a UI part at Opus high that designs the screen (compact, the user's way of working first: typeahead and inline controls over long lists, no row per item where a field will do), builds its components and layout with placeholder data or the existing read, and takes screenshots it looks at critically; then a function part at Opus medium that wires the data, the actions and the tests into that UI without changing its design. A screen the user rejects goes back to an Opus high UI part. A step that adds a new page or screen gets a **design step** first: the design skill (`/ag:design <plan path> <the step's line range>`) at Opus high writes `design/<yyyymmdd>-<slug>/`, which the UI part then works from and the user can review. A minor change to an existing screen skips the design step. A missing image key is told to the user while the goal is made (step 3), and the goal carries their choice: the other image provider, the design plan without images (`dry-run`), or no design step. The run does not ask again.
7. **Function builders run on Fireworks** (the user, Nov 6, 2026: "happy to use fireworks with claude and only when I use goal-prompt-3rdparty"). A step's function part is built by `ext-build.ps1` on the chosen Fireworks model, started by the main thread as a background shell job, with no Opus subagent in between. These stay on Claude: planning, briefs, landing, the UI part of a screen step, phase reviews, a failed step (continued at Opus high, as principle 5), and steps that touch security, money, personal data or a shared-database migration (Opus medium) unless the user moves them in step 3, and copy, never on Fireworks (the user, Nov 6, 2026: "for content writing please update goal-promt-3rdparrty to use opus high for writing end user facing copy and medium for technical copy and not to use fireworks for it"): a step, or the part of one, that writes end-user-facing copy (UI text, emails, marketing pages, README and help for end users) runs at Opus high; technical copy (developer docs, code comments, API docs, plan and brief text) at Opus medium. A Fireworks HANDOFF (tool-call limit, nothing failing) goes to a fresh Fireworks builder with the note; a Fireworks failure goes to Opus high, never to another Fireworks try. Without the Fireworks key, the user may choose builders on Claude at Opus medium, as goal-prompt does (step 3).

## Facts about the Fireworks builder

Set up Nov 6, 2026; check `ext-build.ps1 -DryRun` if old.

- `powershell -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/ext-build.ps1 -Brief <file> -Cwd <worktree> -Step <id> -LogDir <run folder>/logs [-Model <id>]` (macOS and Linux: `pwsh -File ...`) runs `claude -p` in the worktree with the Fireworks endpoint and key in that process only; the key is kept in the store per OS: Windows a DPAPI file `~/.claude/secrets/fireworks.key`, macOS the Keychain, Linux `secret-tool` or a mode-600 file (`ext-build.ps1 -SetKey` in the user's own window; `-Check` tests it). Exit 0 ok, 3 HANDOFF, 1 failed, 2 setup error (stop and tell the user).
- The builder starts fresh: it sees the brief file, the worktree's `CLAUDE.md`/`AGENTS.md`, user hooks and skills, and nothing of this conversation. The brief is pointers, as for Opus builders, written to `<run folder>/briefs/<step>.md`. It cannot spawn subagents, and every model alias points at the Fireworks model.
- Its stdout is at most ~22 lines: a summary line (`ext-build: <step> · <model> · turns · tokens · time · ok|HANDOFF|failed`), its report, the log path. The full transcript goes to `<run folder>/logs/`, and one line per run to `logs/ext-runs.jsonl` (model, tokens, cached tokens, turns, time, session id). Cost is tracked in tokens; the Fireworks dashboard has the money. `maxBudgetUsd` (25) is only a runaway guard: Claude Code prices the run as if it were Anthropic, far above the Fireworks bill.
- Its commits end with `Built-by: fireworks/<model>`, so `git log --grep "Built-by: fireworks"` lists its work.

## Facts about /goal

- `/goal <condition>` sets a session goal; after every turn a small model checks the condition and Claude keeps working until it is met, impossible, or a turn fails.
- **At most 4,000 characters.** Keep the runner at most 3,800, aim for 2,500.
- **The checker sees only the conversation.** Every "done" criterion is evidence Claude prints: a command with its exit code or summary line, a test count, screenshot paths, a `git status` line, the plan's status lines (a grep).
- **Every place the run may stop is a met condition.** The checker grades only the condition as written; a pause written beside it ("Done when every row is done; until then, when only the user's rows are left, ... stop") is never met, so each stop is blocked, Claude answers "waiting" again and again, and Claude Code ends the turn only after 9 blocked stops (Oct 22, 2026, the live-test run). So the condition lists every allowed end as one of its "met when" outcomes: all done; at a gate, shown and asked; waiting on rows only the user can do, printed; blocked, explained. Never "until then ... stop", never a stop the condition does not name.
- Several turns without tool calls stop the loop. Subagents keep the main transcript short. A goal does not change permissions.
- A tool call the user rejects may already be running (a landing script finished on its own after its call was rejected, Oct 19, 2026): after a rejection, check `git log` and the worktrees before assuming nothing happened.

## Facts about context

Checked Oct 11, 2026 (code.claude.com docs: env-vars, context-window, sub-agents, goal); check again if old.

- Every turn re-reads the whole conversation. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (1 to 100) sets the auto-compaction point, also for subagents; it needs a new session. Claude cannot read its own context use. `<N>`: 30 on a 1M window, 50 on a 200k window; the user's number wins.
- A brief that lists whole documents makes a subagent read them whole (Oct 12, 2026: 150k to 300k tokens before the first edit). Measured Oct 19, 2026 over 31 builders: of their tool output 66% was printing code files in the shell and 12% the Read tool, against 7% test output; a builder taking over after a handoff spent 21 to 50 calls re-learning before its first edit. So a brief is **pointers** (a file and its line range), reading in the shell is refused by a hook, large steps are split before they start, and handoffs come earlier with a note. Raising the compaction point is not a fix: later compaction makes each late call dearer and hides the cause.
- After a compaction the conversation opens with a summary; the run finds its place again from the plan's status marks and "Where the run stands", `git log --oneline -15` and `git worktree list`, nothing else.

## How this plan is run (the section written into the plan)

```markdown
## How this plan is run

1. **Status** is the mark on each step <in the tracker table / on its `Status:` line> and on each phase: a step sets its own mark in its own commit; the main thread sets a phase's mark at its close and rewrites "Where the run stands" at each landing. No other list is kept.
2. **Scope is the plan.** Build each step's acceptance as written, nothing more. A real gap is an open question in <questions section> with a default; ideas go to <later section>.
3. **Order.** <Steps that touch different files may run side by side, up to <2 or 3>, each in its own worktree or branch; steps that share a module, the schema, a shared map or a page run one after another.> A large step (schema, module and screen together, or sized L) is split by the main thread into two or three parts at natural seams before it starts, each with its share of the acceptance, built one after another in the same worktree. The main thread assigns unique names when a step starts.
4. **A step** is built by a fresh Fireworks builder (`${CLAUDE_PLUGIN_ROOT}/scripts/ext-build.ps1`, model `<model id>`), except <steps kept on Claude: UI parts at Opus high; <step ids> at Opus medium> and copy (end-user copy at Opus high, technical copy at Opus medium), from a brief of pointers in `<run folder>/briefs/<step>.md`: this file with the step's line range and this section's range, and `path:lines` of the code it builds on (the functions it adapts, the models it names, the files it names, one test of the kind it writes as the pattern). It reads by range only (Read with offset and limit, Grep with a limit; <a hook refuses printing source or plan files in the shell>), makes its first edit within about 20 tool calls, writes only the tests the plan names (otherwise at most one integration test per real flow and unit tests for pure logic), runs lint, typecheck and those test files once, sets its status mark and commits.
5. **Handoff.** At about <100 on 1M, 35 on 200k> tool calls a builder stops at a safe point (committed, nothing half written) and returns "HANDOFF" with a note of at most 15 lines in its report: done (commits), left, what fails (command and first error lines), files with line ranges, next action. The next builder starts from the note and the branch's log and makes its first change within about 10 tool calls. A failed step's report is the same note, and a fresh Opus high subagent continues the step (never restarted, no other step in its place). A Fireworks HANDOFF (exit 3) goes to a fresh Fireworks builder with the note; a Fireworks failure (exit 1) goes to Opus high.
6. **Landing:** rebase on the latest main, lint, typecheck, the step's own test files, merge, push if the rules say so; nothing else, in under 10 minutes. After a fix only the failed check runs again. Never commit on main while a landing runs.
7. **Phase close:** every step of the phase marked; the whole suite once<, plus end-to-end on <devices> if chosen>; one review of the phase's diff at Opus high (findings fixed or deferred with a reason); <the release>; the phase marked `shown` (gate) or `done`; `git status` clean.
8. **Model and effort:** planning, design (a new page or screen first gets `/ag:design <this file> <the step's line range>< provider=<p> or dry-run, as chosen for the key>`, whose `design/<yyyymmdd>-<slug>/` folder the UI part works from; a minor change to an existing screen skips it< (or, if chosen: "new pages get no design step")>), the UI part of a screen step and larger reviews at Opus high; building function on Fireworks `<model id>` (steps kept on Claude at Opus medium); copy never on Fireworks: end-user-facing copy at Opus high, technical copy at Opus medium; a failed step at Opus high; browser checks and mechanical work at Sonnet.< With fable planning on (`.claude/ag.json`): planning work goes to a fresh subagent with `model: "fable"`, `effort: "high"`, which writes its result into this file and reports in at most 10 lines: splitting or re-planning a large step, answering a builder's design question (the step then continues as rule 5 says), the plan for each phase as it starts, and the design plan (`/ag:design` hands that to Fable itself). The main thread still coordinates and writes the briefs.> A builder report is at most 20 lines; longer output goes to `<run folder>/logs/`, Fireworks runs also to `logs/ext-runs.jsonl`.
9. **Feedback during the run.** The user's note on work in progress is first written into this plan by the main thread, in the user's words: a change to a step not yet landed goes into that step's acceptance; anything else becomes a fix step of the current phase (`fix <n>`, with its status mark). Then it is routed like any step: design or UI feedback to an Opus high UI part; function feedback to Fireworks, except steps kept on Claude. If a Fireworks builder of that step is still running, it finishes first. Feedback on a step a Fireworks builder built and that has not landed resumes that builder (`-Resume <session id>` from `logs/ext-runs.jsonl`) with a brief of the feedback lines; once landed, it is a new fix step with a fresh builder. A note that changes scope or a decision is confirmed with the user before it is written.
```

## Steps

### 0. Converting a run made by goal-prompt

If the plan already has a "How this plan is run" section (a run set up by `/goal-prompt`, running or paused), convert it instead of starting over. It keeps the plan, its status marks, "Where the run stands", the run folder, the hook and the progress history; it changes only who builds.

1. Read the plan's "How this plan is run", its status marks and "Where the run stands", `.claude/goal-progress.json`, `git worktree list` and `git log --oneline -15`. Ask the user whether a run is going on now; if it is, the conversion waits until the builders running now finish (never stop a builder halfway).
2. Check the Fireworks key with `-Where` as in step 3; if it is not set, tell the user with the set line, and they choose to set it (check again) or to keep the run on Claude (no conversion). Then run `ext-build.ps1 -Check -Model <model>`; if it fails, stop and tell the user.
3. Ask question 5 of step 3 (steps kept on Claude) for the steps not yet done; the earlier answers (testing, devices, limits, git) stay as they are.
4. In the plan, in one commit: rewrite rules 4, 5 and 8 of "How this plan is run" and add rule 9, all from the template above; add a line to "Where the run stands": "<date>: builders moved to Fireworks <model id>; steps done before this were built on Claude." Status marks are not touched. A step in progress keeps its Claude builder until it lands; its next fix or handoff follows the new rules.
5. Add `briefs/` to the run folder; in `.claude/goal-progress.json` add `engine` to the current phase's steps (the ones done get the engine that built them, `opus-medium` or `opus-high`, from their commits) and append a log line "Builders now on Fireworks <model>".
6. Write the new runner (step 6) and run the checks in step 7. Output: the conversion commit, the new runner with its character count, and "Paste this goal in place of the old one; it continues from the first step not marked done."

A plan with no "How this plan is run" goes through steps 1 to 8 as usual.

### 1. Read the plan

- Use the path in `$ARGUMENTS`, else look for `PLAN.md`, `.planning/**`, `docs/**/plan*.md`, `*.plan.md`, or the plan in this conversation. If none or several, ask.
- Note the steps (ids, titles, acceptance), the phases and gates (sign-offs the plan requires), the files and modules each step touches (principle 4), and **where status already lives** (a tracker table, checkboxes, status lines). Use that place; add one only if there is none.
- Read `CLAUDE.md` / `AGENTS.md` for rules and commands.
- **Fable planning:** read `.claude/ag.json` in the project root. If it has `"fablePlanning": true`, fable planning is on: fill in the Fable parts of rule 8 and of the runner's Work line. If the file or the key is missing, or it is `false`, it is off: leave those parts out. It is set with `/ag:fable-planning on|off`.
- **The plan holds the research.** If the plan is thin or the user asks for a plan too, research now and write the facts into the plan (API facts with URL and date, exact commands, the tooling to extend, the inputs to keep). Do not add scope while doing it.

### 2. See what can be checked here

Without installing anything: project type; test tooling (`package.json` scripts, Playwright, Vitest/Jest, pytest, go/cargo test, Gradle, xcodebuild, Flutter); machine support (OS, simulators; iOS needs macOS); the context window and whether `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is set (read only). See [test-matrix.md](test-matrix.md) for screen sizes.

### 3. Ask the user (one round, at most four questions)

AskUserQuestion, or plain text with lettered options, only what the rules have not settled:

1. **Testing during the build:** "Light (Recommended): lint, typecheck, each step's own tests and screenshots; full suites once per phase" / "Full: also the whole suite and end-to-end on every device at each phase close" / "Minimal: lint, typecheck and screenshots only".
2. **Screens / devices** for screenshots (and end-to-end if Full).
3. **Limits** (multi-select): paid APIs, production deploys, shared-database migrations, other outward actions the plan mentions. Unticked ones become "stop before X and tell the user".
4. **Git**, only if the project rules don't say.
5. **Steps kept on Claude** (only if the plan has steps touching security, money, personal data or a shared-database migration): "Keep <those step ids> on Opus medium (Recommended)" / "All function work on Fireworks".

**Keys** (in the same round, on top of the questions above). Check each key the goal will use; `-Where` makes no API call and never prints the key. On macOS and Linux use `pwsh -File` in place of `powershell -NoProfile -ExecutionPolicy Bypass -File`.

- **Fireworks**, always:
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/ext-build.ps1 -Where fireworks
  ```
- **The image key**, only if the plan has a design step:
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/design-image.ps1 -Where [<provider the plan names>]
  ```
  Without a provider it checks the default one (Gemini unless `~/.claude/design.json` says otherwise). If it is not set, check the other provider the same way.

The last line ends with `<provider> key: set` or `<provider> key: not set`. For each key not set, tell the user (shown for Fireworks; for an image key say "for the design images" and name it):

> The Fireworks key for the builders is not set. To set it, run this in your own terminal, not in this chat:
> `powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.claude\ag\ag-key.ps1 set fireworks`
> (macOS and Linux: `pwsh -File ~/.claude/ag/ag-key.ps1 set fireworks`)

and ask:

- **Fireworks:** "I've set it; check again" / "Build on Claude: builders at Opus medium, as goal-prompt does". With Claude builders, write goal-prompt's "How this plan is run" and runner (`${CLAUDE_PLUGIN_ROOT}/skills/goal-prompt/SKILL.md`) in place of this skill's, and say so in the output.
- **Image key:** "I've set it; check again" / "Use <the other provider>; its key is set" (only if it is) / "Design plan without images" / "No design step". The choice goes into the runner's design clause (step 6): `provider=<the other one>`, `dry-run`, or no design step.

After "check again", run `-Where` again; if the key is still not set, ask again. The goal carries the choices, so the run does not ask again. Write no goal (setup commit or runner) until the user has chosen. Never ask for a key in chat; if the user pastes one, do not use, repeat or store it, and give them the set line.

With the Fireworks key set, run `ext-build.ps1 -Check -Model <model>`. If it fails, stop and tell the user (the model id is wrong or the key is refused); never fall back to Opus silently.

### 4. Write into the plan (one setup commit, if the project commits plans)

- The status marks where missing (principle 1), a mark per phase and gate, and an empty "Where the run stands" paragraph.
- The section "How this plan is run" above, filled in.
- Nothing else: no goals file, no copied text.

### 5. The run folder, the hook and the progress file

- **Folders a run writes** in the project: `design/<yyyymmdd>-<slug>/` (committed, for the user's review; one per design step); `.claude/goal-prompt/<run-id>/` (git-ignored: briefs, logs); `.claude/goal-progress.json` (git-ignored). Nothing else.
- **Run folder** `.claude/goal-prompt/<run-id>/`, added to `.gitignore`; check that lint, typecheck, the test runners and the deploy packaging skip it (most skip `.claude/`). It holds only what must run: a landing script if the project has none, the reading hook, `briefs/` (one pointer brief per Fireworks step, written when the step starts), `logs/`. Never the system temp folder (the OS may clear it). Never `git clean -x` in that checkout.
- **Reading hook** (any plan run by several builders): a PreToolUse hook on the shell tools, wired in `.claude/settings.local.json` (git-ignored), that refuses `cat`, `sed -n`, `head`, `tail`, `awk` and `Get-Content` on source and plan files inside a step's worktree, pointing to Read with a range and Grep with a limit; piped command output and logs stay allowed. Test it on a few commands.
- **Pointers** come from the main thread's Grep; for a large plan a small script in the run folder may print them (the step's line range, the rows that name it, `path:lines` of the code to reuse). It prints; it never writes copies.
- **`.claude/goal-progress.json`** (git-ignored, for the goal-progress bar): `{goal, plan, status: running|waiting|blocked|done, note, updated, tasks: [], running: [], log: []}`, written when the run starts, with `plan` naming the plan file; the band shows nothing without it, and `tasks` must be a list. **Tasks are not kept by hand:** the band reads every phase and step, with its title and mark, from the plan named by `plan`, again whenever the plan's text changes, so a step's mark shows as soon as its commit writes it. `done <date>`, `shown <date>`, `blocked: <reason>`, `todo` and `doing` map to the band's statuses; a phase with steps started and no mark of its own reads `doing`; the plan wins where the file differs. A task entry `{id, title, status, note?, steps?}` is written only to carry a short `note` the plan has no place for ("0.8.8 · Oct 19"). The band's statuses are `todo|doing|done|deployed|shown|waiting|blocked|skipped` (`todo` = not started, `doing` = in progress, `done` = built and on main but not released, `deployed` = its release is live, `shown` = at a gate, waiting for the user's sign-off). **`running: [{kind, title, since, note?}]`** is what is going on right now outside the marks. The band adds the session's subagents that are pending or running by itself, from start to end, and each `ext-build.ps1` run adds its own `build` job when it starts and removes it when it ends, so builders and reviews are never written there. The main thread adds only the jobs that are neither, such as a deploy or a test suite (`kind` `deploy` or `tests`; `since` an ISO time), when one starts, and removes it when it ends, writing `updated` each time, so the band never shows a finished job as running; empty when nothing runs. **`log: [{at, text}]`**, oldest first, the last ~10 kept: each update the run gives the user in chat ("Release 0.9.6 is deploying", "S3 review running at high effort", "fix list: …") gets one line there at the same time, so the Goal tasks pane shows what the chat shows. The main thread writes `status`, `note`, `log` and those other jobs in a plain chat just as in a `/goal` run. A fix a review finds shows as a step once it is in the plan as `fix <n>` with its own `Status:` line. **Engine:** a launcher job carries `fw:<short model>` (e.g. `fw:deepseek-v4p1-flash`) and a subagent its model, so the bar shows which work runs on Fireworks and which on Claude; a task entry's step may carry `engine` (`fw:<short model>`, `opus-medium`, `opus-high` or `sonnet`), the one that built it last.

### 6. Write the runner

Fill the `<>`; at most 3,800 characters.

```
/goal Carry out <plan path> exactly as written, by its "How this plan is run" and <CLAUDE.md or project rules>. Build only what the plan's steps name; add no scope. The plan is the only list: start from its "Where the run stands" and the first step whose status mark isn't "done"; each step sets its mark in its own commit, and "Where the run stands" is rewritten at each landing; keep no other list.
Phases: when every step of a phase is done, close it by "How this plan is run" (rule 7), print "<phase>: done" with a one-line evidence summary, set its mark in the plan (commit), and set .claude/goal-progress.json's status (the band reads the plan's marks, subagents and launcher runs itself; its running list holds only other jobs, like a deploy or a suite, from start to end). If the phase has a gate, mark it "shown", print "<phase>: shown", ask the user to sign off, set progress "waiting" and stop; else go on.
Work: the main thread plans the order, splits large steps, gives unique names, briefs with pointers (the step's line range, the rules' range, path:lines of the code to reuse), lands and closes phases;< if fable planning is on: re-planning or splitting a large step, a builder's design question and each phase's plan go to a fresh Fable high subagent (model "fable");> each step's function is built by ${CLAUDE_PLUGIN_ROOT}/scripts/ext-build.ps1 on Fireworks <model id> (brief file in <run folder>/briefs, background shell job, logs to <run folder>/logs), except <step ids> at Opus medium and the UI part of a screen step, designed and built first at Opus high (a new page first gets /ag:design <plan> <its lines>< provider=<p> or dry-run, as chosen for the key> at <Opus, or Fable if fable planning is on> high, its design/ folder committed for review; a minor screen change skips it< (or, if chosen: "new pages get no design step")>); copy never goes to Fireworks: end-user copy at Opus high, technical copy at Opus medium. A builder hands off at about <100> tool calls with a short note; exit 3 (HANDOFF) goes to a fresh Fireworks builder with it. A step whose builder fails (exit 1, tests it cannot fix, a problem it cannot solve) is never restarted and no new step starts in its place: a fresh Opus high subagent continues it in its worktree from the note. Exit 2: stop, progress "blocked", tell the user. User feedback mid-run: write it into the plan first, then route it (rule 9). Checks stay light: lint, typecheck and each step's own tests at a landing; the whole suite once at the phase close, never a gate; a fix reruns only what failed. Parallel only for steps on different files. After a compaction, read "Where the run stands", the status marks, git log and git worktree list.
The goal is met (the run ends or pauses) when ALL of these are shown in this conversation:
1. Each phase finished here printed "<phase>: done" or "<phase>: shown" with its evidence.
2. The plan's phase marks are printed (a grep of them).
3. One of: every phase is done and progress is "done"; or the last phase is "shown", the user has been asked to sign off, and progress is "waiting"; <if the plan has rows only the user can do: or every open row waits on the user (their tasks, keys, sign-offs, or a step that waits on them), those rows are printed, and progress is "waiting";> or a phase is marked "blocked: <reason>", progress is "blocked", and the reason is explained. A pause is resumed by the user's next note or by pasting this same goal again.
Rules: never skip or reorder phases; never add scope; never delete or weaken tests; no --no-verify; <global limits>. If a phase can't be finished, mark it "blocked: <reason>" in the plan and set progress "blocked".
```

### 7. Check before handing over

1. The runner is at most 3,800 characters (`wc -m` on a scratch file).
2. Every "done" item names printed evidence, and every place the runner tells Claude to stop (gate, waiting on the user's rows, blocked) is one of the "met when" outcomes; no "until then ... stop" wording.
3. Every command exists in this project.
4. Every gate in the plan is a phase mark; no phase crosses one.
5. **One list:** status lives only in the plan (its marks and "Where the run stands"); no goals file, handoff file, packet or code copies, or per-step progress list was made.
6. **No invented scope** and **no heavy per-step checks** (whole suites and end-to-end only at the phase close, as chosen).
7. The parallel rule names which steps may run side by side, judged by the files they touch; large steps are marked for splitting.
8. Every step that adds a new page or screen has a design step (`/ag:design`, Opus high, or Fable high with fable planning on) before its UI part, unless the user chose none for a missing image key; minor screen changes have none. The keys were checked with `-Where`, and the runner carries the user's choice for a missing one. The run folder is `.claude/goal-prompt/<run-id>/`, git-ignored, holding only what must run; the hook is wired and tested if used. Fable planning matches `.claude/ag.json`: when on, rule 8 and the runner send planning to Fable high; when off, neither names Fable.
9. The project's writing rules hold (no em dashes if forbidden, language).
10. `ext-build.ps1 -Check` passed for the chosen model (or, with no Fireworks key, the user chose builders on Claude and the goal is goal-prompt's); the runner names the model id, the steps kept on Claude, and the exit 1/2/3 routes; `briefs/` is in the git-ignored run folder.

### 8. Output

- The setup commit (status marks, "Where the run stands" and "How this plan is run") and, if used, the run folder and hook.
- The runner in one fenced block starting with `/goal `, with its character count; below it the phases with their marks and "After each gate, paste the same goal again to continue."
- One line each: the testing level chosen, what is not checked and why, and limits that will stop the run.
- One line: fable planning on or off for this project (`/ag:fable-planning on|off` changes it for the next goal made).
- One line: the Fireworks model and the `-Check` result (or "no Fireworks key: builders on Claude at Opus medium"), the steps kept on Claude, and "see who built what: `<run folder>/logs/ext-runs.jsonl`, `git log --grep 'Built-by: fireworks'`, and the engine label in the goal-progress bar".
- **Context setting:** if `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is set, say its value; if not, give `{ "env": { "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "<N>" } }` for `.claude/settings.local.json` or `~/.claude/settings.json`, say it needs a new session, and write it only if the user says yes.

Do not start implementing the plan. This skill only marks the plan, writes its run section, sets up the run folder and writes the runner.
