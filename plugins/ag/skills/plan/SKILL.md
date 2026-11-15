---
name: plan
description: "Make a new implementation plan or update an existing one, with the planning done on the right model: Fable 5.2 high when fable planning is on for the project (.claude/ag.json has \"fablePlanning\": true, set with /ag:fable-planning on), else Opus 5.5 high. Each plan has a folder of its own in the project (plans/<yyyymmdd>-<slug>/): plan.md is the source the goal runs read and mark, plan.html is the page the user reads, made from it, with every phase, step and question, a comment box on each and a Copy answer bar like the ideas pages; it opens in the browser, the main questions are asked in the chat, and pasted answer lines (PLAN ok, Q1 B, 1.2: comment) are recorded in the plan and acted on. A new plan has steps with ids, files, acceptance and tests, phases and gates, and status marks, ready for a goal-prompt skill (goal-prompt-3rdparty proposed by default); long jobs are planned in batches with early results, checkpoints and kept raw data, never as one long run. An update keeps the plan's own format and tracking place; in a plan set up by a goal-prompt skill it also keeps that skill's way of running: new steps get `todo` marks where status already lives and the builder its \"How this plan is run\" rules give them (Opus, Haiku, Sonnet or Fireworks), and rule 8 matches the current fable planning setting. Plans only; builds nothing. Use only when the user asks for /ag:plan or pastes answer lines from a plan page."
argument-hint: "[plan path to update] [what to add or change] | <what the new plan is for> | <pasted answer lines>"
disable-model-invocation: true
---

# Plan

Input: `$ARGUMENTS` is one of:

- **A plan path** (to update it), optionally followed by what to add or change.
- **A description** of what a new plan is for.
- **Answer lines** pasted from a plan page's **Copy answer**: a first line `Plan: <path>`, then lines such as `PLAN ok`, `PLAN changes: …`, `Q1 B`, `Q2: …`, `1.2: …`, `P1: …`, `Context: …`. Go to "Answer lines".

If it is empty, look for a plan as goal-prompt does (`plans/**/plan.md`, `PLAN.md`, `.planning/**`, `docs/**/plan*.md`, `*.plan.md`, or the plan in this conversation) and ask what to plan or change; if none is found, ask what the new plan is for.

The page script is `${CLAUDE_PLUGIN_ROOT}/scripts/plan-page.mjs` (call it `PAGE` below); run it from the project root. This skill writes the plan and its page only: no code, no run folder, no goal.

## Rules

1. **The planning model.** Read `.claude/ag.json` in the project root (the git root if there is one). If it has `"fablePlanning": true`, the planning runs on **Fable 5.2 high**; if the file or the key is missing, or it is `false`, on **Opus 5.5 high**. If this session is not on that model at high effort, hand step 2 to a fresh `ag:fable-planner` subagent (or `ag:opus-planner`), called with that `subagent_type` and no `model` parameter, so it runs pinned on Fable 5.2 (`claude-fable-5-2`) or Opus 5.5 (`claude-opus-5-5`) at high effort, giving it this file's path (`${CLAUDE_PLUGIN_ROOT}/skills/plan/SKILL.md`) and `${CLAUDE_PLUGIN_ROOT}/skills/plan/long-jobs.md`, the plan path and the input (with any recorded answers and open Feedback lines to act on); it reads the plan and the code by range, writes the plan file, runs `node PAGE render <plan> --strict` and fixes its warnings, and reports in at most 10 lines (steps added or changed, open questions, research facts written). The main thread then does steps 3 and 4.
2. **Plan only what was asked.** No extra features, hardening, refactors, tooling or tests beyond what the input needs. A real gap is an open question with a default; ideas go to a "Later" section.
3. **The plan is the only list.** Status lives in the plan: each step carries `todo`, `done <date>`, `waiting for you: <what>` (only the user can move it) or `blocked: <reason>`; each phase or gate `todo`, `shown <date>` or `done <date>`. No other task list, notes file or copy. The user's comments live in the plan too, in its "Feedback" section. `plan.html` is not a copy: it is made from the plan by `PAGE render` and never written or edited by hand.
4. **Done work stays as it is.** Never change a step marked `done` or a phase marked `shown` or `done`; a change to finished work is a new step. Steps already started (a branch or commits for them) change only if the user asks.
5. **The plan holds the research.** Facts the steps need (API facts with URL and date, exact commands, the code to extend with `path:lines`, the inputs to keep) go into the plan, not into chat.
6. **Long jobs run in batches, with results early** (the user, Nov 12, 2026: "never allow planning for 2 hours runs without results and always try to process reasonable amount of batches and see results, not to have to restart all from scratch if something fails, and keep already loaded data"). No step is planned as one long run with nothing to look at. A long job (crawling, API fetches, imports, backfills, a model or LLM run over many items) follows `${CLAUDE_PLUGIN_ROOT}/skills/plan/long-jobs.md`: stages, with fetched raw data kept untouched and processing reading only from it, so a new algorithm or a fix reruns over it without fetching again; a per-item work list with idempotent writes, so a rerun resumes and `--only-failed` or `--reprocess` redo only what is needed; a sample batch of 20 to 50 items checked against the step's acceptance before the full run, then batches of 5 to 15 minutes, each printing a line of results; retries with backoff and an error budget that stops the job; polite, rate-limited crawling; the full run in the background with its log and a `running` entry. No job runs over about 20 minutes without printed results. Where fetching and processing are both large they are separate steps.
7. **A folder for each plan** (the user, Nov 15, 2026: "each plan and feature should store in project files separate folder for each plan"). A new plan is `plans/<yyyymmdd>-<slug>/plan.md` at the project root, or inside `.planning/` or `docs/plans/` if the project already keeps plans there; `node PAGE folder <2-5 words>` prints the path (a taken folder gets `-2`). The folder holds the plan, its page and the files that belong to this plan alone (research notes too long for the plan, sample inputs, the user's attachments); designs stay in `design/` (`/ag:design`) and the plan links them. A loose plan file in a plans folder (`.planning/<name>.md`, `docs/plans/<name>.md`) without "How this plan is run" is moved into a folder of its own on its next update (`git mv` if git tracks it, to `<that plans folder>/<name>/plan.md`); a root `PLAN.md`, and a plan with "How this plan is run" (its pasted goal names the path), stay where they are unless the user asks. A plan that stays loose has its page beside it as `<name>.html`.
8. **The user reads the page, not the Markdown.** After every change to a plan: `node PAGE render <plan> --strict` (fix every warning), then `node PAGE open <plan>` (`--id <ref>` opens it at a step, phase or question). In the chat give the page's path; never ask the user to read the plan file.

## Steps

### 1. Read

- The input; `CLAUDE.md` / `AGENTS.md` for rules and commands; `.claude/ag.json` (rule 1).
- **Updating:** the plan's steps (ids, titles, acceptance, files), phases and gates, **where status lives** (a tracker table, `Status:` lines, checkboxes), its "Where the run stands" paragraph, its open questions with any answers under them, and its **open Feedback lines** (ending `— open`): these are part of the input. If it has a **"How this plan is run"** section, a goal-prompt skill set it up; tell which one by rule 4:
  - "a fresh subagent (Opus medium)": **goal-prompt**.
  - "<ids> on Haiku": **goal-prompt-haiku**; "<ids> on Sonnet": **goal-prompt-sonnet**.
  - "a fresh Fireworks builder" or "a fresh OpenRouter builder": **goal-prompt-3rdparty**; note its steps kept on Claude.
- The code the change touches, by range only (Read with offset and limit, Grep with a limit).

### 2. Plan (on the model of rule 1)

**A new plan** goes in its own folder (rule 7), in the format of `${CLAUDE_PLUGIN_ROOT}/skills/plan/plan.example.md`. It has:
- A `# <title>` heading: what the plan delivers, in a few plain words.
- **Goal:** one short paragraph, in the user's words where possible.
- **Context:** the research facts (rule 5).
- **Solution design**, where the work needs one (a new feature, more than one module, a new page, data or an API; a small fix skips it): `## Solution design` with a short overview, then only the subsections that apply, as `###` headings:
  - **Architecture:** the parts and how they connect, as a ` ```mermaid ` `flowchart` (the page draws flowcharts and sequence diagrams; other kinds show as their source).
  - **High-level design:** components and what each owns, the data model, the APIs, and the key flows as a `sequenceDiagram`.
  - **Screens (UX and UI):** each screen with its states (empty, loading, error) and what the user does on it; design images from `/ag:design` as `![<what it shows>](<path relative to the plan>)`.
  - **Technical implementation:** the approach, libraries and versions, alternatives turned down and why, risks, security, performance.
  - A heading made only of capitals and digits (`UX`, `HLD`, `API`) is read as a step id; write it in words, as above. Steps name the design subsections they build on (`- Design: High-level design`).
- **Phases** in order, as `## Phase <n>: <title>`, each with a `Status: todo` line; a phase that needs the user's sign-off before the next starts is a **gate** (say so in its title).
- **Steps** in each phase, as headings one level below the phase: an id (`1.1`, `1.2`, ...), a title, the files and modules it touches, its acceptance (checks a builder can run: commands, tests by name, a screenshot of a named screen), size S, M or L, and `Status: todo`. A step with separate parts lists them as sub-steps one heading level deeper, ids `<id>a`, `<id>b` (or `<id>-ui`, `<id>-fn`), each with its own `Status: todo`; a step the user must do (their setup, a key, a decision) says so and is marked `waiting for you: <what>` once it is reached. A screen step names its UI part and its function part; a new page or screen says it gets a design first. A step with a long job (rule 6) has what section 9 of `${CLAUDE_PLUGIN_ROOT}/skills/plan/long-jobs.md` lists; its acceptance is checked on the sample batch before the full run and again on the full data.
- **Open questions:** each a list item with an id, `- **Q1.** <question>`, and where the answer is a choice, its options below it as `  - A. …`, `  - B. …` (2 to 4), one marked `(recommended)`; a question without options says `Default: <what the plan does>`. The default is what the plan does if the user says nothing.
- **Later**, and an empty **Where the run stands** paragraph.
- No "How this plan is run": a goal-prompt skill writes that when the plan is run. No "Feedback" section: `PAGE record` makes it.

**An update** keeps the plan's format, headings, id scheme and wording style:
- New steps go into the first phase not yet `done` or `shown` that they belong to, or a new phase at the end; each gets `todo` in the place status already lives (a tracker row, a `Status:` line or a checkbox, as the other steps have it), and the same fields as the plan's other steps.
- Changed steps (rule 4) keep their ids; removed steps not yet started are deleted, not marked.
- If the plan names a builder or model on each step, new steps get one too, by the rules below.
- An answered question: the plan follows the answer (its steps change to match), the answer line stays under the question, and a question fully settled moves into Context as a decision (`Decided <date>: …`). Open questions without ids get them (`**Q<n>.**`).
- Each open Feedback line is acted on: change the plan as it asks (rule 4 holds: a change to a done step becomes a new step), then end the line `— done <date>: <what changed, step ids>` in place of `— open`, or `— no change: <why>` when it asks for something the plan should not do (rule 2) or that needs the user's call (then it also becomes an open question).
- The Solution design stays and changes with the steps: a new or changed step that alters a part, the data, an API or a screen updates its subsection and diagram; a plan without one gets it when an update adds a new feature or page.
- "Where the run stands" gets one line: `Plan updated <date> with /ag:plan: <steps added or changed>.`

**An update of a plan with "How this plan is run"** also keeps that skill's way of running:
- **Who builds a new step** follows rule 4 of the section, judged as the skill that wrote it judges:
  - goal-prompt: nothing to add; building runs at Opus medium, UI parts at Opus high.
  - goal-prompt-haiku / -sonnet: a new step goes on that skill's list in rule 4 when it passes the test in the skill's principle 7 (the plan names its files, its functions or behaviour and its checks; no open design question, no UI design; no security, money, personal data or shared-database migration). Copy, UI parts, design and reviews never go on Haiku or Sonnet.
  - goal-prompt-3rdparty: a new step's function part goes to the third-party builder (Fireworks or OpenRouter, as the section names), except steps touching security, money, personal data or a shared-database migration, which join the steps kept on Claude (Opus medium), unless the section says all function work runs on the third-party provider; UI parts at Opus high and copy on Claude, as rule 4 says.
  - A new page or screen gets a design step first (`/ag:design`, rule 8), unless the section says new pages get no design step.
- **Rule 8** matches `.claude/ag.json` now: with fable planning on it has the Fable clause (planning work to a fresh `ag:fable-planner` subagent, Fable 5.2 high; copy the wording from rule 8 in `${CLAUDE_PLUGIN_ROOT}/skills/<that goal skill>/SKILL.md`); with it off, it has no Fable clause.
- Nothing else in the section changes.

### 3. Check

- Every new or changed step has an id, files, acceptance it can be checked by, and a status mark in the plan's tracking place; no done step or finished phase changed; nothing planned beyond the input.
- No step is a long job without what section 9 of `${CLAUDE_PLUGIN_ROOT}/skills/plan/long-jobs.md` lists (rule 6): stages with the raw data kept, a per-item work list, a checked sample batch, batch size and expected time, error budget, rate limits and cost cap where it fetches or pays, and the resume, `--only-failed` and `--reprocess` commands; none runs over about 20 minutes without printed results. In an update, an unstarted step that breaks this is fixed too; a started one is listed as an open question.
- In a plan with "How this plan is run": each new step's builder follows its rule 4, and rule 8 names Fable only if fable planning is on.
- No Feedback line acted on is still `— open`.
- `node PAGE render <plan> --strict` prints no warning (duplicate ids, a step without status, a question without an id or a default).
- Fix what fails; do not report it as done.

### 4. Show, ask and tell the user

- **Show:** `node PAGE open <plan>` (rule 8).
- **Ask** with AskUserQuestion: every open question that has options, the most important first, each with its recommended option first and "(Recommended)" after its label; labels of at most 5 words. One call takes at most 4 questions, so with more make several calls one after another, each after the answers to the last are recorded. In the same message say the page is open and that comments on any step, the questions without options and the call on the whole plan (**Looks good** or **Needs changes**) can be given on the page and pasted back with **Copy answer**. With no question that has options, skip the tool and just say this. If the user declines the question, stop there: the plan is saved and the page is open.
- **Record the answers:** write them as answer lines (`Plan: <path>`, then `Q1 A`, `Q2: their words` for "Other") to a temp file and run `node PAGE record --from <file>`; then follow "Answer lines" from "act on them".
- **Commit:** a plan with "How this plan is run" that git tracks is committed alone, with its page and its folder's files, as the goal skills' setup commit is: `plan: <summary>`. Otherwise do not commit unless the user asks.
- **Tell the user** in at most eight lines: the page's path (and the plan file's); steps added or changed (ids); open questions left; the model the planning ran on (Fable 5.2 high or Opus 5.5 high, and why); and what to do next:
  - A new plan, or one without "How this plan is run": run `/ag:goal-prompt-3rdparty <plan path>` to make its goal (the default: function parts on Fireworks or OpenRouter, picked with `/ag:3rdparty-provider`; planning, UI and reviews on Opus); `/ag:goal-prompt`, `-haiku` or `-sonnet` are the alternatives (all on Opus, or clear steps on Haiku or Sonnet).
  - A plan with "How this plan is run": paste the same goal again; it continues at the first step not `done`. If rule 4's step lists (Haiku, Sonnet, or kept on Claude) or rule 8's Fable clause changed, the goal's runner names them too, so run the same goal skill on the plan again for a fresh runner.

## Answer lines

Lines pasted from a plan page. Save them, exactly as pasted, to a temp file and run `node PAGE record --from <file>` (the `Plan:` line names the plan; without it, give the plan path before `--from`). It records:

| Line | Recorded as |
|---|---|
| `Q2 B`, `Q2 B: note`, `Q2: text` | an answer under question Q2 in "Open questions": `**Answer <date>:** B (<option>); note` |
| `PLAN ok` | a Feedback line, nothing to do |
| `PLAN changes: text`, `PLAN: text` | a Feedback line `— open`: a change to the whole plan |
| `1.2: text`, `P1: text`, `Context: text` | a Feedback line `— open` on that step, phase or section |

It prints what it recorded and any line it did not understand; ask about those lines rather than guessing.

Then **act on them**: if anything is open (an answer that changes the plan, a Feedback line `— open`), do steps 1 to 3 as an update with these as the input (rule 1 decides who plans), then render and open the page at the first changed step (`--id`). If all were `PLAN ok` or answers that match the defaults, just render and open. Reply as in step 4, saying what each line changed.
