# goal-progress

Shows the progress of a `/goal` (yellow "waiting" at a gate for your sign-off) above the prompt, with one line for each job running right now:

    A1 track 1 ██████████░░░░░░░░░░ 2/4 (50%) running   [ Tasks ▸ ] [ Hide ]
    Now: A1.3 Offer review v2 · e2e on iPhone 15 · updated 40s ago
    ▸ deploy Release 0.9.4, Google Ads by sign-in · 4m
    ▸ tests  Integration suite for 0.9.3 · 22m
    ▸ build  E2.10 Your site, part two · 41m

The band reads four things:

- **The plan** named by the file's `plan` (`PLAN.md` when it names none): its phases (epics), steps (stories) and parts of steps (subtasks), nested by heading depth, in the plan's order, each with its title and its mark (a `Status:` line or `- **Status:**` bullet under its heading, or the status cell of a tracker table, including cells like `done Nov 9 (4a7db1d)`). Ids may be `P4`, `4.1`, `4.1a`, `3.3-ui`, `UXB6`, `fix 12` or `T5`. The plan is the skeleton: its titles and marks win over the file's.
- **The session's subagents** that are starting or running, each as a running line.
- **The launcher's job**: each `ext-build.ps1` run adds its own `build` line to the file when it starts and removes it when it ends.
- **`.claude/goal-progress.json`** in the project, for the goal's status, note and log, and for any other job (a deploy, a test suite). Without this file the band shows nothing.

It looks every second, so it moves when the plan's text changes (a step's commit sets its mark), when a subagent starts or ends, when a launcher run starts or ends, and when the file is written. The times and "updated ... ago" move every 30 seconds. A half-written file or plan keeps the last good state. From inside a git worktree at .claude/worktrees/<id>, the main checkout's file and plan are read. "updated ... ago" is the last time anything moved: the file's own `updated`, its newest `log` time or `running` start, or later when this session saw the file, the plan or its subagents change (a step marked in the plan, a subagent started or ended, a job's line written). It turns yellow ("may be behind") only when the goal runs, no subagent of the session is running, and nothing moved for 15 minutes. After a restart or a reload the first read counts from the file's times. A step a live subagent or a `running` job names (the subagent's description starting with the step id, "PG1 part 2: screens", or the job's `step`) reads in progress, and its phase too, while the plan still says `todo`: a step built in a worktree or in parts marks itself only when it lands on main. A `running` job may be written as `{step, what, started}` as well as `{kind, title, since}`.

`[ Tasks ▸ ]` (or `/goal-progress open`) opens the "Goal tasks" pane: the goal; one line counting the stories by status (done, deployed, in progress, needs you, to approve, waiting, blocked, not started); a yellow "Needs you" card listing everything, at any level, that waits on you (a `needs-you` item, or a `shown` one to approve); a "Running now" card; a "Latest" card; and the phases in plan order. The band's "Now:" names the current phase and step (`P6 › 6.4 …`). Esc at an empty prompt closes it.

An open phase lists its steps in plan order, each row with its status, and a step's parts under it, indented with `└` and dimmed. Each row is cut to the pane's width. The current phase is open; a click on any task with steps opens or closes it, `a` opens or closes all, and the arrows scroll while the pane has the keyboard. The last column of a step table shows the tokens in a short form (`850`, `9.5k`, `240k`, `1.2M`), dim, after the note; a task row ends with its own, and `/goal-progress` adds ` · 240k tokens`. The pane asks for the width its tables need, up to the terminal less 40 columns for the transcript. A "Latest" card shows the last five lines of `log`, newest first.

`/goal-progress` lists the three levels (phase, step, part) with their status, and what is running; `/goal-progress hide` and `/goal-progress show` toggle the band.

File format (written by the goal, in a plain chat as in a `/goal` run; see the goal-prompt skill):

    { "goal": "...", "plan": "path", "status": "running|waiting|blocked|done", "note": "short status",
      "updated": "ISO time",
      "running": [{ "kind": "deploy|tests|build|review|job|...", "title": "Release 0.9.4", "since": "ISO time", "note": "optional" }],
      "log": [{ "at": "ISO time", "text": "Release 0.9.6 is deploying" }],
      "tasks": [{ "id": "S3", "title": "...", "status": "<status>", "note": "0.9.0 · Oct 19", "tokens": 240000,
                  "steps": [{ "id": "E9.15", "title": "...", "status": "<status>", "note": "0.9.0", "tokens": 12000,
                              "steps": [{ "id": "E9.15a", "status": "<status>" }] }] }] }

`engine` (optional, on a running job or a step) names the model doing it, e.g. `opus-high`, `opus-medium`, `sonnet` or `fw:glm-5p3-flash`; it shows as a label beside the title (`build  S3 Wire search API [fw:glm-5p3-flash] · 4m`), dim blue for Fireworks (`fw:`) and dim grey for Claude.

A status is one of `todo` (not started), `doing` (in progress), `done` (built and on main, not released), `deployed` (its release is live), `shown` ("to approve": built and shown, waiting for your sign-off; it and `deployed` count as done), `needs-you` (waiting on something only you can do: a key, a setup step, a decision), `waiting`, `blocked`, `skipped` (left out of the total). Common other words are read too: `running`, `in progress`, `wip` → in progress; `complete`, `built`, `merged`, `landed` → done; `released`, `live`, `shipped` → deployed; `to approve`, `in review`, `awaiting approval` → to approve; ✅ → done, ⏳ or 🔄 → in progress; `waiting for you` → needs you; `waiting` or `blocked` with a reason about you, a sign-off or an approval → needs you. A word the band doesn't know in the plan leaves the file's status in place (and `/ag:refresh-tasks` lists it); in the file it reads as `todo`. `tasks` may be `[]`: the band fills in phases, steps and parts from the plan, so an entry is written only to add what the plan has no place for (a note, tokens, an engine, a job the plan doesn't list), keyed by the plan's ids and nested as the plan nests them; an id found at any level is matched, and an item the plan lacks shows under its phase (`P4-review`, `phase6-gate`) or at the end. `/ag:refresh-tasks` checks the file against the plan, lists what is out of date, and with `--write` rewrites it in this form (keeping a dated `.bak` copy, the `updated` time and any other keys). `note`, `tokens`, `steps` and `running` are optional. `tokens` is the tokens a task or step used, a number of zero or more (anything else is dropped); a task with none of its own shows the sum of its steps' tokens. `running` holds what is going on now outside the steps' marks and is not a subagent or a launcher run (the band finds those itself): a deploy, a test suite; the goal adds a job when it starts and removes it when it ends. A job with no title is dropped; one with no kind reads as `other`. `log` holds the updates the goal also gives in chat, oldest first, each a string or `{ at, text }`.

Install (user scope, all projects):

    claude plugin marketplace add alexgvozden/AgentsPlugin
    claude plugin install ag@agents-plugin --scope user
