---
name: design
description: "Plan a UI design from a plan or a short description and make its images with Gemini or OpenAI, all in the project under design/<yyyymmdd>-<slug>/ (brief.md, design-plan.md, prompts/, images/, review.md, review.html), committed so the user can review it; review.html, with every image on one page, opens in the browser. The design plan (pages, states, components, copy, one image prompt per page or state) is made at Opus high. Images come from design-image.ps1; with dry-run or without an image key it records the -DryRun commands instead. Never asks for or accepts a key in chat. Use when the user asks for /ag:design, a design, mockups or design images for a page or feature, or when a goal step adds a new page."
argument-hint: "<plan path [lines] | short description> [provider=gemini|openai] [count=<n>] [dry-run]"
---

# Design

Input: `$ARGUMENTS`: a plan path (optionally with a line range or step) or a short description, and optionally `provider=gemini|openai`, `count=<n>` (images per prompt, default 1) and `dry-run`. If empty, ask for a description or plan path (never for a key).

Folders this skill writes, in the current project only: `design/<yyyymmdd>-<slug>/` with `brief.md`, `design-plan.md`, `prompts/`, `images/`, `review.md` and `review.html` (when images were made). It is committed, for review; the review spec goes to the system temp folder. Nothing else is written.

## Rules

1. **Never ask for or accept a key in chat.** If the user pastes one, do not use, repeat or store it; tell them to set it in their own terminal with `powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.claude\ag\ag-key.ps1 set <provider>` (macOS and Linux: `pwsh -File ~/.claude/ag/ag-key.ps1 set <provider>`). Never print or log a key.
2. **The design plan is made at Opus high**, or at Fable 5.2 high when fable planning is on: the project's `.claude/ag.json` has `"fablePlanning": true` (set with `/ag:fable-planning on`; a missing file or key means off). If this session is not on that model at high effort, hand step 3 to a fresh `ag:opus-planner` subagent (or `ag:fable-planner` when fable planning is on), called with that `subagent_type` and no `model` parameter, so it runs pinned on Opus 5.5 (`claude-opus-5-5`) or Fable 5.2 (`claude-fable-5-2`) at high effort, giving it the folder path and `brief.md`; it writes `design-plan.md` and the prompt files and reports in at most 10 lines.
3. **Design only what the input asks for.** No extra pages or features. Compact, the user's way of working first: typeahead and inline controls over long lists, no row per item where a field will do.
4. **Images are drafts for review**, not final assets. A failed image call (exit 1) is reported, not retried in a loop.

## Steps

1. **Folder.** `<yyyymmdd>` is today's date; `<slug>` is 2-5 lowercase words from the input joined by `-`. Make `design/<yyyymmdd>-<slug>/` with `prompts/` and `images/` in the project root (the git root if there is one, else the current folder). If it exists, add `-2`, `-3`.
2. **`brief.md`.** The input exactly as given. If it came from a plan: the plan path and the line range (or step) used, and those lines quoted. Also the options (`provider`, `count`, `dry-run`).
3. **`design-plan.md`** (at Opus high, or Fable high with fable planning on; rule 2), with these sections:
   - **Pages**: each page or screen, its purpose and who uses it.
   - **States**: for each page, empty, loading, error and full; what the user sees and can do in each.
   - **Components**: shared parts (forms, lists, dialogs, nav) and where each is used.
   - **Copy**: headings, labels, buttons, empty and error messages, word for word.
   - **Image prompts**: one per page or state, named `<page>-<state>`. Each is written to `prompts/<page>-<state>.txt` and quoted in the plan. A prompt describes layout, components, copy and visual style concretely (UI mockup, device or viewport, light theme unless the input says otherwise).
   - **Image commands**: filled in by step 4.
4. **Images.** First the key, when the user ran `/ag:design` themselves without `dry-run`. Check the provider's key; this makes no API call and never prints the key:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/design-image.ps1 -Where [<provider>]
   ```
   Without a provider it checks the default one. If the last line ends with `<provider> key: not set`, tell the user (shown for Gemini; name the missing one):

   > The Gemini key for the design images is not set. To set it, run this in your own terminal, not in this chat:
   > `powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.claude\ag\ag-key.ps1 set gemini`
   > (macOS and Linux: `pwsh -File ~/.claude/ag/ag-key.ps1 set gemini`)

   and ask: "I've set it; go on" (run `-Where` again, and ask again if it is still not set) / "Go on without images" (run the commands below with `-DryRun`). Called from a goal, do not check or ask: the goal carries the choice (`dry-run` or not).

   Then, for each prompt file run, from the project root:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/design-image.ps1 -PromptFile design/<yyyymmdd>-<slug>/prompts/<page>-<state>.txt -Out design/<yyyymmdd>-<slug>/images/<page>-<state> [-Provider <provider>] [-Count <n>]
   ```
   On macOS and Linux use `pwsh -File` in place of `powershell -NoProfile -ExecutionPolicy Bypass -File`. Add `-Provider` and `-Count` only when given in the input. Each prompt gets its own `images/<page>-<state>/` folder, because the script names images after the start of the prompt text and prompts of one page would overwrite each other.
   - With `dry-run`, or when the user chose to go on without images, run each command with `-DryRun` instead.
   - If a real run exits 2 (key missing or setup error), stop the real runs and run every command with `-DryRun`.
   - Under **Image commands** in `design-plan.md`, record each command line exactly as run (with `-DryRun` if used) and its exit code. After a dry run, also record: no images were made; set the key with `powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.claude\ag\ag-key.ps1 set <provider>` (macOS and Linux: `pwsh -File ~/.claude/ag/ag-key.ps1 set <provider>`) in your own terminal, then run the commands without `-DryRun`.
5. **`review.md`.** A short checklist for the user's notes, one line each with space to write:
   - [ ] Pages: all needed, none extra
   - [ ] States: empty, loading, error, full look right
   - [ ] Layout is compact; controls are where you expect them
   - [ ] Copy: wording, tone, spelling
   - [ ] Images match the plan (or: images still to make, after a dry run)
   - Notes:
6. **`review.html`**, when images were made: the user cannot click images open from the chat, so they go on one page in the browser. Write a spec to the system temp folder (`<temp>/ag-review/design-<slug>.json`, not into the project): `title` "Design: <slug>", `intro` the brief in one or two lines, one item per image (`path` relative to the project root, `caption` `<page>-<state>`, `look` that state's line from **States**), and as `questions` the lines of `review.md` without their boxes. Then, from the project root:
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File ${CLAUDE_PLUGIN_ROOT}/scripts/review-page.ps1 -Spec <spec> -Out design/<yyyymmdd>-<slug>/review.html -Link [-NoOpen]
   ```
   (macOS and Linux: `pwsh -File`). `-Link` links the images by relative path, so the committed page stays small and works from the folder. It opens in the browser; called from a goal, add `-NoOpen` (the run shows the design on its own review page at the next gate). After a dry run there are no images and no `review.html`.
7. **End** by printing the folder path and its files (one per line, `images/` included), the `review.html` line the script printed and its numbered list, and ask the user to answer in the chat by number. After a dry run or exit 2, print the `ag-key.ps1 set <provider>` line (step 4) for the user's terminal. Do not commit unless the user or the calling goal asks; the folder is meant to be committed for review.
