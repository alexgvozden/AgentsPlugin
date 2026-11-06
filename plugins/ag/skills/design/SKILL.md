---
name: design
description: "Plan a UI design from a plan or a short description and make its images with Gemini or OpenAI, all in the project under design/<yyyymmdd>-<slug>/ (brief.md, design-plan.md, prompts/, images/, review.md), committed so the user can review it. The design plan (pages, states, components, copy, one image prompt per page or state) is made at Opus high. Images come from design-image.ps1; with dry-run or without an image key it records the -DryRun commands instead. Never asks for or accepts a key in chat. Use when the user asks for /ag:design, a design, mockups or design images for a page or feature, or when a goal step adds a new page."
argument-hint: "<plan path [lines] | short description> [provider=gemini|openai] [count=<n>] [dry-run]"
---

# Design

Input: `$ARGUMENTS`: a plan path (optionally with a line range or step) or a short description, and optionally `provider=gemini|openai`, `count=<n>` (images per prompt, default 1) and `dry-run`. If empty, ask for a description or plan path (never for a key).

Folders this skill writes, in the current project only: `design/<yyyymmdd>-<slug>/` with `brief.md`, `design-plan.md`, `prompts/`, `images/` and `review.md`. It is committed, for review. Nothing else is written.

## Rules

1. **Never ask for or accept a key in chat.** If the user pastes one, do not use, repeat or store it; tell them to set it with `design-image.ps1 -SetKey <provider>` in their own terminal. Never print or log a key.
2. **The design plan is made at Opus high.** If this session is not on Opus at high effort, hand step 3 to a subagent with `model: "opus"`, `effort: "high"`, giving it the folder path and `brief.md`; it writes `design-plan.md` and the prompt files and reports in at most 10 lines.
3. **Design only what the input asks for.** No extra pages or features. Compact, the user's way of working first: typeahead and inline controls over long lists, no row per item where a field will do.
4. **Images are drafts for review**, not final assets. A failed image call (exit 1) is reported, not retried in a loop.

## Steps

1. **Folder.** `<yyyymmdd>` is today's date; `<slug>` is 2-5 lowercase words from the input joined by `-`. Make `design/<yyyymmdd>-<slug>/` with `prompts/` and `images/` in the project root (the git root if there is one, else the current folder). If it exists, add `-2`, `-3`.
2. **`brief.md`.** The input exactly as given. If it came from a plan: the plan path and the line range (or step) used, and those lines quoted. Also the options (`provider`, `count`, `dry-run`).
3. **`design-plan.md`** (at Opus high, rule 2), with these sections:
   - **Pages**: each page or screen, its purpose and who uses it.
   - **States**: for each page, empty, loading, error and full; what the user sees and can do in each.
   - **Components**: shared parts (forms, lists, dialogs, nav) and where each is used.
   - **Copy**: headings, labels, buttons, empty and error messages, word for word.
   - **Image prompts**: one per page or state, named `<page>-<state>`. Each is written to `prompts/<page>-<state>.txt` and quoted in the plan. A prompt describes layout, components, copy and visual style concretely (UI mockup, device or viewport, light theme unless the input says otherwise).
   - **Image commands**: filled in by step 4.
4. **Images.** For each prompt file run, from the project root:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/design-image.ps1 -PromptFile design/<yyyymmdd>-<slug>/prompts/<page>-<state>.txt -Out design/<yyyymmdd>-<slug>/images/<page>-<state> [-Provider <provider>] [-Count <n>]
   ```
   On macOS and Linux use `pwsh -File` in place of `powershell -NoProfile -ExecutionPolicy Bypass -File`. Add `-Provider` and `-Count` only when given in the input. Each prompt gets its own `images/<page>-<state>/` folder, because the script names images after the start of the prompt text and prompts of one page would overwrite each other.
   - With `dry-run`, run each command with `-DryRun` instead.
   - If a real run exits 2 (key missing or setup error), stop the real runs and run every command with `-DryRun`.
   - Under **Image commands** in `design-plan.md`, record each command line exactly as run (with `-DryRun` if used) and its exit code. After a dry run, also record: no images were made; set the key with `powershell -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/design-image.ps1 -SetKey <provider>` (macOS and Linux: `pwsh -File ...`) in your own terminal, then run the commands without `-DryRun`.
5. **`review.md`.** A short checklist for the user's notes, one line each with space to write:
   - [ ] Pages: all needed, none extra
   - [ ] States: empty, loading, error, full look right
   - [ ] Layout is compact; controls are where you expect them
   - [ ] Copy: wording, tone, spelling
   - [ ] Images match the plan (or: images still to make, after a dry run)
   - Notes:
6. **End** by printing the folder path and its files (one per line, `images/` included), and, after a dry run or exit 2, the `-SetKey` line for the user's terminal. Do not commit unless the user or the calling goal asks; the folder is meant to be committed for review.
