---
name: plan
description: "Make a new implementation plan or update an existing one, with the planning done on the right model: Fable 5.2 high when fable planning is on for the project (.claude/ag.json has \"fablePlanning\": true, set with /ag:fable-planning on), else Opus 5.5 high. A new plan has steps with ids, files, acceptance and tests, phases and gates, and status marks, ready for a goal-prompt skill. An update keeps the plan's own format and tracking place; in a plan set up by a goal-prompt skill it also keeps that skill's way of running: new steps get `todo` marks where status already lives and the builder its \"How this plan is run\" rules give them (Opus, Haiku, Sonnet or Fireworks), and rule 8 matches the current fable planning setting. Plans only; builds nothing. Use only when the user asks for /ag:plan."
argument-hint: "[plan path to update] [what to add or change] | <what the new plan is for>"
disable-model-invocation: true
---

# Plan

Input: `$ARGUMENTS`: a plan path (to update it), optionally followed by what to add or change; or a description of what a new plan is for. If empty, look for a plan as goal-prompt does (`PLAN.md`, `.planning/**`, `docs/**/plan*.md`, `*.plan.md`, or the plan in this conversation) and ask what to plan or change; if none is found, ask what the new plan is for.

This skill writes one file: the plan. No code, no run folder, no goal.

## Rules

1. **The planning model.** Read `.claude/ag.json` in the project root (the git root if there is one). If it has `"fablePlanning": true`, the planning runs on **Fable 5.2 high**; if the file or the key is missing, or it is `false`, on **Opus 5.5 high**. If this session is not on that model at high effort, hand step 2 to a fresh subagent with `model: "fable"` (or `"opus"`), `effort: "high"`, giving it this file's path (`${CLAUDE_PLUGIN_ROOT}/skills/plan/SKILL.md`), the plan path and the input; it reads the plan and the code by range, writes the plan file and reports in at most 10 lines (steps added or changed, open questions, research facts written). The main thread then does steps 3 and 4.
2. **Plan only what was asked.** No extra features, hardening, refactors, tooling or tests beyond what the input needs. A real gap is an open question with a default; ideas go to a "Later" section.
3. **The plan is the only list.** Status lives in the plan: each step carries `todo`, `done <date>` or `blocked: <reason>`; each phase or gate `todo`, `shown <date>` or `done <date>`. No other task list, notes file or copy.
4. **Done work stays as it is.** Never change a step marked `done` or a phase marked `shown` or `done`; a change to finished work is a new step. Steps already started (a branch or commits for them) change only if the user asks.
5. **The plan holds the research.** Facts the steps need (API facts with URL and date, exact commands, the code to extend with `path:lines`, the inputs to keep) go into the plan, not into chat.

## Steps

### 1. Read

- The input; `CLAUDE.md` / `AGENTS.md` for rules and commands; `.claude/ag.json` (rule 1).
- **Updating:** the plan's steps (ids, titles, acceptance, files), phases and gates, **where status lives** (a tracker table, `Status:` lines, checkboxes) and its "Where the run stands" paragraph. If it has a **"How this plan is run"** section, a goal-prompt skill set it up; tell which one by rule 4:
  - "a fresh subagent (Opus medium)": **goal-prompt**.
  - "<ids> on Haiku": **goal-prompt-haiku**; "<ids> on Sonnet": **goal-prompt-sonnet**.
  - "a fresh Fireworks builder": **goal-prompt-3rdparty**; note its steps kept on Claude.
- The code the change touches, by range only (Read with offset and limit, Grep with a limit).

### 2. Plan (on the model of rule 1)

**A new plan** goes where the project keeps plans (an existing `PLAN.md`, `.planning/` or `docs/` plans folder), else `.planning/<yyyymmdd>-<slug>.md` (`<slug>`: 2-5 lowercase words). It has:
- **Goal:** one short paragraph, in the user's words where possible.
- **Context:** the research facts (rule 5).
- **Phases** in order, each with a `Status: todo` line; a phase that needs the user's sign-off before the next starts is a **gate** (say so in its title).
- **Steps** in each phase: an id (`1.1`, `1.2`, ...), a title, the files and modules it touches, its acceptance (checks a builder can run: commands, tests by name, a screenshot of a named screen), size S, M or L, and `Status: todo`. A screen step names its UI part and its function part; a new page or screen says it gets a design first.
- **Open questions** (each with a default) and **Later**.
- An empty **Where the run stands** paragraph.
- No "How this plan is run": a goal-prompt skill writes that when the plan is run.

**An update** keeps the plan's format, headings, id scheme and wording style:
- New steps go into the first phase not yet `done` or `shown` that they belong to, or a new phase at the end; each gets `todo` in the place status already lives (a tracker row, a `Status:` line or a checkbox, as the other steps have it), and the same fields as the plan's other steps.
- Changed steps (rule 4) keep their ids; removed steps not yet started are deleted, not marked.
- If the plan names a builder or model on each step, new steps get one too, by the rules below.
- "Where the run stands" gets one line: `Plan updated <date> with /ag:plan: <steps added or changed>.`

**An update of a plan with "How this plan is run"** also keeps that skill's way of running:
- **Who builds a new step** follows rule 4 of the section, judged as the skill that wrote it judges:
  - goal-prompt: nothing to add; building runs at Opus medium, UI parts at Opus high.
  - goal-prompt-haiku / -sonnet: a new step goes on that skill's list in rule 4 when it passes the test in the skill's principle 7 (the plan names its files, its functions or behaviour and its checks; no open design question, no UI design; no security, money, personal data or shared-database migration). Copy, UI parts, design and reviews never go on Haiku or Sonnet.
  - goal-prompt-3rdparty: a new step's function part goes to the Fireworks builder, except steps touching security, money, personal data or a shared-database migration, which join the steps kept on Claude (Opus medium), unless the section says all function work runs on Fireworks; UI parts at Opus high and copy on Claude, as rule 4 says.
  - A new page or screen gets a design step first (`/ag:design`, rule 8), unless the section says new pages get no design step.
- **Rule 8** matches `.claude/ag.json` now: with fable planning on it has the Fable clause (planning work to a fresh subagent with `model: "fable"`, `effort: "high"`; copy the wording from rule 8 in `${CLAUDE_PLUGIN_ROOT}/skills/<that goal skill>/SKILL.md`); with it off, it has no Fable clause.
- Nothing else in the section changes.

### 3. Check

- Every new or changed step has an id, files, acceptance it can be checked by, and a status mark in the plan's tracking place; no done step or finished phase changed; nothing planned beyond the input.
- In a plan with "How this plan is run": each new step's builder follows its rule 4, and rule 8 names Fable only if fable planning is on.
- Fix what fails; do not report it as done.

### 4. Commit and tell the user

- **Commit:** a plan with "How this plan is run" that git tracks is committed alone, as the goal skills' setup commit is: `plan: <summary>`. Otherwise do not commit unless the user asks.
- **Tell the user** in at most eight lines: the plan path; steps added or changed (ids); open questions; the model the planning ran on (Fable 5.2 high or Opus 5.5 high, and why); and what to do next:
  - A new plan, or one without "How this plan is run": run `/ag:goal-prompt <path>` (or `-haiku`, `-sonnet`, `-3rdparty`) to make its goal.
  - A plan with "How this plan is run": paste the same goal again; it continues at the first step not `done`. If rule 4's step lists (Haiku, Sonnet, or kept on Claude) or rule 8's Fable clause changed, the goal's runner names them too, so run the same goal skill on the plan again for a fresh runner.
