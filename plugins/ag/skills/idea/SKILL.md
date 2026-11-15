---
name: idea
description: "Add an idea to the project's ideas list from the user's own words: give it an id (AGPL-IDEA-003), a short title and a description, a first-look SWOT and RAID, and a few questions; render ideas/ideas.html, open it at the new idea (ideas.html#AGPL-IDEA-003) for the user's comments, ask the main questions in the chat and record the answers. With an id first (/ag:idea AGPL-IDEA-003 <words>) it adds a comment to that idea or changes it. Pasted answer lines from the page's Copy answer (AGPL-IDEA-003 Q1 B, AGPL-IDEA-003: comment) are recorded too. Deep research is a separate step: /ag:idea-research. Use when the user asks for /ag:idea, to add, note or capture an idea, or pastes answer lines from the ideas page."
argument-hint: "<the idea in your words> | AGPL-IDEA-003 <comment or change> | <pasted answer lines>"
disable-model-invocation: true
---

# Add an idea

Ideas belong to the project, like its plans, and live in the `ideas/` folder at its root (the git root; the script never uses the home folder): `ideas/ideas.json` is the source, `ideas/ideas.html` is the page made from it. The script is `${CLAUDE_PLUGIN_ROOT}/scripts/ideas.mjs` (call it `IDEAS` below); run it from the project root. Never write `ideas.html` by hand.

## Input

`$ARGUMENTS` is one of:

- **New idea:** the idea in the user's words, as short or rough as they like.
- **An existing idea:** an id first (`AGPL-IDEA-003`, `IDEA-3` or `3`), then a comment or a change.
- **Answer lines** pasted from the page's **Copy answer**: lines such as `AGPL-IDEA-003 Q1 B`, `AGPL-IDEA-003 Q2: note`, `AGPL-IDEA-003: a comment`, `AGPL-IDEA-003 decision park: why`, `AGPL-IDEA-003 RQ1: answer`. See "Answer lines".

If `$ARGUMENTS` is empty, ask for the idea in one line and stop.

## New idea

1. **Read the project, briefly.** README, CLAUDE.md, the docs' index, `package.json` or its equivalent, and `node IDEAS list` for the ideas already there. Five minutes at most; this is a first look, not research.
2. **Look for a duplicate.** If an idea in the list is about the same thing, say which and ask whether to add these words to it as a comment (then go to "An existing idea") or keep a new idea.
3. **Draft** a JSON file in the system temp folder, in the shape of `${CLAUDE_PLUGIN_ROOT}/skills/idea/draft.example.json`:
   - `title`: 3 to 8 words, plain, says what it is.
   - `description`: 2 to 4 sentences: what it is, who it is for, why it matters, and what it builds on.
   - `raw`: the user's words, exactly as typed.
   - `kind`: `extension` if it builds on this project, `new` if it is something new (a new product, site or business).
   - `tags`: 1 to 3 short words.
   - `target`: one or two sentences on what is true when it is done. Leave it out if it is not yet clear; it becomes a question.
   - `swot`: a first look, 1 to 3 short points in each of `strengths`, `weaknesses`, `opportunities`, `threats`. These are judgements from what you know of the project, not researched facts; do not state numbers or market facts you have not checked.
   - `raid`: `risks` (each with `likelihood` and `impact`, low, medium or high, and a `mitigation`), `assumptions` (each with a `test`: how to check it cheaply), `issues` (problems that exist now), `dependencies`.
   - `questions`: 3 to 6 that would most change the idea, the ones only the user can answer (who it is for, scope, budget, timing, what counts as success). Give `options` (2 to 4) where the answer is a choice, with `recommended` as the index of the one you would pick, and `why` when the reason is not obvious.
4. **Add it:** `node IDEAS add --from <draft.json>` prints the new id and folder (`AGPL-IDEA-003 AGPL-IDEA-003-<slug>`). The first time, add `--project "<project name>" --code <CODE>`: the project code, 4 or 5 capital letters from its name (AgentsPlugin: `AGPL`), which every id and folder carries, so ideas of different projects never share an id. Without `--code` the script makes one from the name. Say the code in the reply; it cannot change once the list has ideas. It also writes `ideas/.gitignore`, which keeps raw research data out of git.
5. **Show it:** `node IDEAS render`, then `node IDEAS open --id <id>`. The page opens scrolled to the new idea, highlighted, with its SWOT and RAID open.
6. **Ask** with AskUserQuestion: up to 4 of the idea's questions that have options, the recommended option first with "(Recommended)" after its label; labels of at most 5 words. In the same message say the page is open and that anything else (comments, the questions without options, changes) can be written on the page and pasted back with **Copy answer**. If the user declines the question, stop there: the idea is saved and the page is open.
7. **Record the answers:** write them as answer lines (`<id> Q1 A`, `<id> Q2: their words` for "Other") to a temp file and run `node IDEAS record --from <file>`. Then, if an answer changes the idea (its title, description, target, SWOT or RAID), edit those fields in `ideas/ideas.json` directly and keep everything else as it is (id, folder, `raw`, dates, answers). Run `node IDEAS render --strict`; fix any warning it prints. Reopen with `node IDEAS open --id <id>`.
8. **Reply** in a few lines: the id and title, the page's path, what changed after the answers, and the next step: `/ag:idea-research <id>` for the deep research (should we do it: the value, the current state and the gap to the target, demand, what people say, competitors, full SWOT and RAID; how to build it comes later with `/ag:plan`).

## An existing idea

`$ARGUMENTS` starts with an id. Find it with `node IDEAS resolve <id>`; if it is not there, say so and show `node IDEAS list`.

- If the words are a comment, record it: write `<id>: <the words>` to a temp file and `node IDEAS record --from <file>`.
- If they ask for a change ("call it …", "make it about …", "drop the money part"), edit those fields in `ideas/ideas.json` and set `updated` to today. For a status ("park it", "we planned it") use `node IDEAS status <id> <status>`, with one of `new`, `discussed`, `researching`, `researched`, `planned`, `parked`, `dropped`. Keep the user's words as a comment too, so the history stays.
- Then `node IDEAS render --strict` and `node IDEAS open --id <id>`, and reply with what changed.

## Answer lines

Lines pasted from the ideas page or a research page. Save them, exactly as pasted, to a temp file and run `node IDEAS record --from <file>`. It records:

| Line | Recorded as |
|---|---|
| `AGPL-IDEA-003: text` | a comment, dated today |
| `AGPL-IDEA-003 Q2 B` or `AGPL-IDEA-003 Q2 B: note` | the answer to Q2: option B and the note |
| `AGPL-IDEA-003 Q2: text` | the answer to Q2 in the user's words |
| `AGPL-IDEA-003 decision park: why` | the user's call after research: `go`, `go-with-changes`, `park` or `drop`; `park` and `drop` also set the status to `parked` or `dropped` |
| `AGPL-IDEA-003 RQ1: text` | the answer to the research page's question RQ1 |

`IDEA-003` or just `3` works in place of `AGPL-IDEA-003`; an id with another project's code is refused. An idea that was `new` becomes `discussed`. The script prints what it recorded and any line it did not understand; ask about those lines rather than guessing.

Then act on what the answers say, as in step 7: change the idea's fields where an answer changes it. After `go` or `go-with-changes` the idea stays `researched`; suggest `/ag:plan` for it, and once a plan exists run `node IDEAS status <id> planned`. Render with `--strict`, open the page at the idea, and reply with what was recorded and changed.

## Rules

- The SWOT and RAID here are a first look and say so on the page. Facts, numbers, competitors and traffic belong to `/ag:idea-research`, where each has a source.
- No research calls here: no DataForSEO, no web searches. Reading the project's own files is fine.
- Never put the user's personal details (name, email) into the idea.
- An idea says what and why; how to build it is `/ag:plan`'s, after research and a go.
- Change only `ideas/`. Do not commit unless the user asks.
