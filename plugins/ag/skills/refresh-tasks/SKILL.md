---
name: refresh-tasks
description: "Refresh the Goal tasks pane for the current project: read the plan named in .claude/goal-progress.json (or a plan path given), show its phases (epics), steps (stories) and parts (subtasks) with their status (not started, in progress, done, deployed, to approve, needs you, waiting, blocked), list what is out of date (status marks behind the git history, steps without a mark, phases finished but not closed, flat or unknown entries in the progress file, stale running jobs), bring the plan's status marks up to date from git, and rewrite .claude/goal-progress.json in the clean nested form (a .bak copy is kept). Changes only status marks in the plan, never its steps. Run only when the user types /ag:refresh-tasks; when they say the tasks pane is wrong, flat or out of date, suggest it."
argument-hint: "[plan path] [check]"
disable-model-invocation: true
---

# Refresh tasks

Input: `$ARGUMENTS`: optionally a plan path (else the `plan` in `.claude/goal-progress.json`, else `PLAN.md`), and `check` to only report, writing nothing.

The pane reads the plan's status marks and `.claude/goal-progress.json` (format: `${CLAUDE_PLUGIN_ROOT}/goal-progress.md`). This skill makes both current. It changes **only status marks** in the plan (a tracker cell or a `Status:` line), never a step's text, and adds no steps.

## Steps

1. **Read the state.** From the project root (the git root; for a worktree, the main checkout), run:
   `node --experimental-strip-types --no-warnings "${CLAUDE_PLUGIN_ROOT}/scripts/refresh-tasks.ts" --root "<project root>" [--plan "<plan path>"]`
   It prints the tree (epic › story › subtask, each with its status) and its findings, and writes nothing. It needs Node 22.6 or newer; if `node` is older or missing, say so and stop.
2. **Is a run going on?** If the progress file's `status` is `running` and `updated` is under 15 minutes old, or a goal or its builders are running in this session, a run owns the plan: do not edit the plan (step 3 is skipped; mention it), and in step 4 write only if the user asked for it.
3. **Bring the plan's marks up to date** (skip with `check`). For each finding about a mark:
   - A step marked `todo` (or with no mark) whose work is on the main branch (`git log --oneline --grep "<id>"` and the files the step names): mark `done <date of that commit>`. Work on a branch not yet merged: `doing`.
   - A step the user must do (their setup, a key, a decision) that the run has reached: `waiting for you: <what>`.
   - A phase whose steps are all `done` (or `skipped`) but still `todo` or `doing`: `done <date>`, or `shown <date>` if it is a gate the user has not signed off.
   - A released step or phase (a deploy or release commit or tag covering it): `deployed <date>`, where the plan already uses `deployed`; otherwise leave `done`.
   - Never change a mark from `done`, `shown` or `deployed` back to an earlier one; if git disagrees, list it for the user instead.
   - Write each mark in the plan's own place and form (the tracker cell, the `Status:` line, `- **Status:**` bullet), keeping its date style. If the plan is tracked by git, commit just these lines: `plan: refresh status marks`.
   Items in the progress file that the plan does not have (a phase review, an e2e run) are not added to the plan; the script keeps them under their phase or at the end.
4. **Rewrite the progress file** (skip with `check`): run the same command with `--write`. It keeps the goal, plan, status, note and the last 10 log lines, drops running jobs older than 3 hours, rewrites `tasks` nested by the plan's ids with only what the plan lacks (notes, tokens, engines, file-only items), and keeps the old file as a dated `.bak` copy next to it, keeping the `updated` time and any other keys. If there is no progress file, it writes none.
5. **Tell the user** in at most eight lines: the plan; counts by status (done, deployed, in progress, needs you, to approve, waiting, not started); what needs them now (the items that read `needs you` or `to approve`); the marks changed (ids, old → new) and the commit; what was dropped or regrouped in the progress file. The pane picks the changes up by itself; `/goal-progress open` shows it.
