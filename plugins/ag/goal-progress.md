# goal-progress

Shows the progress of a `/goal` (yellow "waiting" at a gate for your sign-off) above the prompt, read from `.claude/goal-progress.json` in the project, with one line for each job running right now:

    A1 track 1 ██████████░░░░░░░░░░ 2/4 (50%) running   [ Tasks ▸ ] [ Hide ]
    Now: A1.3 Offer review v2 · e2e on iPhone 15 · updated 40s ago
    ▸ deploy Release 0.9.4, Google Ads by sign-in · 4m
    ▸ tests  Integration suite for 0.9.3 · 22m
    ▸ build  E2.10 Your site, part two · 41m

The file is read every 3 seconds; the times and "updated ... ago" move every 30 seconds. A half-written file keeps the last good state. From inside a git worktree at .claude/worktrees/<id>, the main checkout's file is read. "updated ... ago" turns yellow ("may be behind") when the goal runs and the file is 15 minutes old or more.

`[ Tasks ▸ ]` (or `/goal-progress open`) opens the "Goal tasks" pane: the goal, chips with the count of each status, a "Running now" card, and a timeline with one node per task (done, shown and waiting for your Approve, in progress, blocked, waiting, skipped, to do). The current task shows a bar of its steps and a card with the last done step, the steps in progress, the waiting ones and the next ones. Esc at an empty prompt closes it.

An open task lists every step with a status column (deployed, done, shown, in progress, blocked, waiting, not started), in that order. The current task is open; a click on any task with steps opens or closes it, `a` opens or closes all, and the arrows scroll while the pane has the keyboard. The last column of a step table shows the tokens in a short form (`850`, `9.5k`, `240k`, `1.2M`), dim, after the note; a task row ends with its own, and `/goal-progress` adds ` · 240k tokens`. The pane asks for the width its tables need, up to the terminal less 40 columns for the transcript. A "Latest" card shows the last five lines of `log`, newest first.

`/goal-progress` lists every task with its steps indented under it, and what is running; `/goal-progress hide` and `/goal-progress show` toggle the band.

File format (written by the goal; see the goal-prompt skill):

    { "goal": "...", "plan": "path", "status": "running|waiting|blocked|done", "note": "short status",
      "updated": "ISO time",
      "running": [{ "kind": "deploy|tests|build|review|...", "title": "Release 0.9.4", "since": "ISO time", "note": "optional" }],
      "log": [{ "at": "ISO time", "text": "Release 0.9.6 is deploying" }],
      "tasks": [{ "id": "S3", "title": "...", "status": "<status>", "note": "0.9.0 · Oct 19", "tokens": 240000,
                  "steps": [{ "id": "E9.15", "title": "...", "status": "<status>", "note": "0.9.0", "tokens": 12000 }] }] }

`engine` (optional, on a running job or a step) names the model doing it, e.g. `opus-high`, `opus-medium`, `sonnet` or `fw:glm-5p3-flash`; it shows as a label beside the title (`build  S3 Wire search API [fw:glm-5p3-flash] · 4m`), dim blue for Fireworks (`fw:`) and dim grey for Claude.

A task or step status is one of `todo` (not started), `doing` (in progress), `done` (built and on main, not released), `deployed` (its release is live), `shown` (built and shown, waiting for your sign-off; it and `deployed` count as done), `waiting`, `blocked`, `skipped` (left out of the total). An unknown status reads as `todo`. `note`, `tokens`, `steps` and `running` are optional. `tokens` is the tokens a task or step used, a number of zero or more (anything else is dropped); a task with none of its own shows the sum of its steps' tokens. `running` holds what is going on now outside the steps' marks: a deploy, a test suite, each builder; the goal adds a job when it starts and removes it when it ends. A job with no title is dropped; one with no kind reads as `other`. `log` holds the updates the goal also gives in chat, oldest first, each a string or `{ at, text }`.

Install (user scope, all projects):

    claude plugin marketplace add alexgvozden/AgentsPlugin
    claude plugin install ag@agents-plugin --scope user
