# Rules for every project

## Models and reasoning effort

Set by Alex on 16 October 2026. These rules count as the user's explicit instruction to set `model` and `effort` on the Agent tool.

- **Reasoning and planning: Opus 5.5 at high effort.** The main thread runs at Opus 5.5 high (`model` and `modelSettings` in `~/.claude/settings.json`). Planning, architecture, product and design decisions, safety and money rules, and briefs stay there or go to a subagent with `model: "opus"` and `effort: "high"`.
- **Fable planning in goal runs, per project (default off).** Set by Alex on 10 November 2026. `/ag:fable-planning on` writes `"fablePlanning": true` into the project's `.claude/ag.json`; `off` removes it. It applies only to goal runs made by the goal-prompt skills, `/ag:design` and `/ag:plan`: with it on, their planning work (design plans, new and updated plans, splitting or re-planning a large step, a builder's design question, each phase's plan) goes to the plugin's `ag:fable-planner` subagent (`subagent_type: "ag:fable-planner"`, no `model` parameter), which is pinned to Fable 5.2 (`claude-fable-5-2`) at high effort; the `fable` alias alone may resolve to another Fable version. With it off, the planning those skills hand to a subagent goes to `ag:opus-planner`, pinned to Opus 5.5 (`claude-opus-5-5`) at high effort. Ordinary chats, the main thread, briefs, development, UI parts, failed steps, reviews and browser tests stay as written here.
- **Development: Opus 5.5 at medium effort.** A subagent that writes or changes code by an agreed plan gets `model: "opus"` and `effort: "medium"`.
- **When an issue arises, switch to high.** A medium subagent that fails, returns a problem it could not solve, breaks tests it cannot fix in one more try, or reports a design question: the retry or the fix goes to a fresh subagent at `effort: "high"`, with the first one's report as its starting note. Say in the progress note that the step was raised to high and why.
- **Reviews of a larger scope: high.** A review of a whole batch, phase, branch or many files, or of anything touching security, money or personal data, runs at `effort: "high"`. A review of one small change may run at medium.
- **Browser testing through Claude in Chrome: Sonnet 5.5 where possible.** Clicking through pages, filling forms, taking screenshots and reading the console with the `mcp__claude-in-chrome__*` tools goes to a subagent with `model: "sonnet"`. It reports what it saw (paths of screenshots, console errors, what failed) in a short report; judging whether that is right, and fixing it, follows the rules above. If a Sonnet subagent cannot get through a page after two or three tries, stop it and take the step at Opus.
- A project's own rules or memory may add cheaper choices for simple, mechanical work (running a test suite, merging lists after a rebase). When in doubt between two levels, take the higher.

## Reports

Set by Alex on 10 November 2026: "most things please do HTML reports instead of md".

- A report made for Alex to read is a self-contained HTML file, not Markdown. This covers run summaries, judgements, reviews, research, comparisons and test results. It uses inline CSS, no outside scripts or fonts, readable tables, and it reads well on a phone. Open it in the browser (see "Previews and reviews") and, where the `SendUserFile` tool exists, also send it with `display: "render"`.
- Markdown stays for files the repository or tools read: plans, docs, briefs, READMEs, CHANGELOGs, release notes, memory and notes for agents.
- When a script writes a report, have it write the HTML. It may also write a `.md` or `.json` copy if another tool needs one.

## Previews and reviews

Set by Alex on 14 November 2026: "always for any preview and review that involves images or HTML open the images on PC or HTML in browser so I can review … easy is to always provide review HTML that I can reive and provide answer in chat".

- Paths and `[image]` lines in the chat cannot be clicked open. So whenever Alex is to look at images (screenshots, mockups, design images, charts), HTML pages or pages of a running app, put them on one review page and open it in the browser: `powershell -NoProfile -ExecutionPolicy Bypass -File $HOME/.claude/ag/review-page.ps1 -Title "<what>" "<path or URL>|<caption>" ...` (macOS and Linux: `pwsh -File`). For what to look at in each item, desktop and phone shots side by side, before and after, options to pick from, wording tables and numbered questions, write a small JSON spec to the system temp folder and add `-Spec <file>`; the script's header shows the format (samples: `docs/review-samples/` in the AgentsPlugin repository). The page is written to the temp folder, so `git status` stays clean; images are embedded; HTML files and URLs also open in their own tabs.
- In the chat give the page's path, the numbered list and the questions, and ask for answers by number in the chat ("1 ok, 2: …"). The page's answer bar does this for Alex: clicks on each item and "Copy answer" give lines such as `1 ok`, `2: note` and `3 B`, pasted into the chat; read them the same way. Never leave only file paths or `[image]` lines.
- A single HTML file to look at (a report, a mockup page) is opened directly: `Start-Process <file>` on Windows, `open` on macOS, `xdg-open` on Linux.
- Frontend work too, in any chat or run, not only designs: after building or changing a page or screen, take screenshots of it (the widths the project uses, or 1440 and 390) before asking Alex to review it, and put them with the running app's URL on one review page. Never ask "please check the page" with only a URL or file paths.
- A subagent that takes screenshots reports their paths; the main thread makes the page and asks.
