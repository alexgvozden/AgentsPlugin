---
name: ideas
description: "Open the project's ideas list: one HTML page (ideas/ideas.html) with every idea's id, title, description, status, first-look SWOT and RAID, questions, comments and a link to its research page. With an id (AGPL-IDEA-003 or 3) it opens the list at that idea. It renders the page from ideas/ideas.json first, so the page is always current. Pasted answer lines from the page's Copy answer are recorded with /ag:idea. Use when the user asks for /ag:ideas, to see or list the ideas, or to open one idea."
argument-hint: "[AGPL-IDEA-003 | 3]"
disable-model-invocation: true
---

# Ideas list

Shows the ideas kept in the project's `ideas/` folder. New ideas come from `/ag:idea <your words>`; research comes from `/ag:idea-research <id>`.

The script is `${CLAUDE_PLUGIN_ROOT}/scripts/ideas.mjs` (call it `IDEAS` below). Run it from the project root; it uses `./ideas` unless `--dir` says otherwise.

## Input

`$ARGUMENTS` is empty, or one idea id: `AGPL-IDEA-003`, `IDEA-3`, `idea-3` or `3`.

## Steps

1. If `ideas/ideas.json` does not exist, say there are no ideas yet and that `/ag:idea <your words>` adds the first one. Stop.
2. Render: `node IDEAS render`. It rewrites `ideas/ideas.html` and every research page from the JSON files. It prints warnings for anything malformed; list them in the reply, but still open the page.
3. Open the page in the browser:
   - no id: `node IDEAS open`
   - an id: `node IDEAS open --id <id>`. It opens the list scrolled to that idea, highlighted and expanded. (Windows drops the `#AGPL-IDEA-003` part when opening a file, so the script opens a small redirect page in the temp folder that goes on to `ideas.html#AGPL-IDEA-003`.)
   - If the id is not in the list, the script says so; reply with `node IDEAS list` instead.
4. Reply in a few lines:
   - the page's path;
   - one line per idea, newest first: id, title, status, and the research verdict if there is one (from `node IDEAS list` and the page);
   - how to answer: write on the page, press **Copy answer**, paste the lines in the chat (they look like `AGPL-IDEA-003 Q1 B`, `AGPL-IDEA-003: a comment`). When such lines come back, record them as in `/ag:idea` ("Answer lines").

Change nothing else. This command only shows the list.
