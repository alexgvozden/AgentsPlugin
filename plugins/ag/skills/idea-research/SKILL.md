---
name: idea-research
description: "Deep research on one idea from the project's ideas list (/ag:idea-research AGPL-IDEA-003). It answers \"should we do it?\": how it brings value, and what discovery finds. It does not plan how to build it; that is /ag:plan, after a go. For an idea that builds on the project: the current state from the code and docs, the target state, the gap between them, and the value, with demand and risks. For something new: full structured market research. Both use search demand and traffic from DataForSEO (capped calls, cost noted), what people say on Reddit, forums and the web (quotes of 20 words or fewer, no user names), competitors with pricing and traffic, a sourced SWOT and RAID, facts, and the cheapest experiments to test it. Every number and claim has a source. The result is the idea's own HTML page (ideas/AGPL-IDEA-003-slug/research.html, rendered from research.json) with a verdict and a Decide bar; it is fact-checked, checked at desktop and phone width, and linked from ideas.html. Use when the user asks for /ag:idea-research, or to research an idea from the list."
argument-hint: "<AGPL-IDEA-003 | 3> [quick] [no-seo] [no-browser] [market=<country>] [budget=<dollars>]"
disable-model-invocation: true
---

# Research an idea

Research answers one question: **should we do it?** It finds out how the idea brings value, for whom, and what is true today (discovery: the current state, demand, what people say, competitors, SWOT and RAID), and ends with a verdict. It does **not** plan how to build it: no build steps, no file-by-file changes, no design, no architecture, no task estimates. That is `/ag:plan`'s job, after a `go`. Where research finds something the plan will need (a missing data field, a constraint), it records it as a fact, an issue or a dependency, not as a step.

The script is `${CLAUDE_PLUGIN_ROOT}/scripts/ideas.mjs` (call it `IDEAS` below); run it from the project root. The research goes in `ideas/<AGPL-IDEA-003-slug>/research.json`, and the script renders `research.html` next to it. Raw data (DataForSEO answers, Reddit feeds, notes) goes in `ideas/<AGPL-IDEA-003-slug>/data/`, which `ideas/.gitignore` keeps out of git. Never write the HTML by hand.

## Input

`$ARGUMENTS`: the idea's id first (`AGPL-IDEA-003`, `IDEA-3` or `3`), then any of:

- `quick`: fewer sources (about half of each cap below), no Chrome, one fact-check pass. For a first look.
- `no-seo`: no DataForSEO calls. Demand and traffic come out of the page, and the method says why.
- `no-browser`: no Claude in Chrome, and no Playwright check of the page.
- `market=<country>`: the market for search volumes and competitors (default: the market the project's docs name, else United Kingdom and United States, English).
- `budget=<dollars>`: the most to spend on DataForSEO in this run (default 1.00).

Without an id, run `node IDEAS list`, ask which idea, and stop.

## 1. Get ready

1. `node IDEAS resolve <id>` prints the idea's id, title, status, kind, folder and research paths. If the id is not in the list, say so and show `node IDEAS list`.
2. Read the idea in `ideas/ideas.json`: description, `raw` (the user's words), target, first-look SWOT and RAID, the questions **with their answers**, comments and any decision. The answers set the research's scope: who it is for, the budget, the market, what counts as success. If a question that changes the research is still open (for example who it is for), ask it now with AskUserQuestion, up to 2 questions, the recommended option first; record the answers as in `/ag:idea` ("Answer lines").
3. If `research.json` already exists, this is a rerun: keep the old file as `data/research-<date>.json`, and say in the method what changed.
4. `node IDEAS status <id> researching`, then `node IDEAS render`.
5. **The mode** is the idea's `kind`:
   - `extension` (builds on this project): the main questions are where the project is now, what the target is, what is missing between them, and whether the value is worth that gap. Market work is lighter: demand for what the idea adds, and the 2 to 4 tools people use for the same job today.
   - `new` (something new): full market research. Who has the problem and how often, demand and its trend, competitors and their prices and traffic, what people say, ways to reach people, and a cheap way to test it. The "current" section is what the project and the user already have that helps (code, skills, sites, audience); the "gap" is what is missing to reach a first version and its first users, as found, not as steps.
6. Write a one-paragraph **brief** to `data/brief.md`: the idea in two sentences, the mode, the user's answers that matter, the market, 5 to 10 seed phrases people would search for, likely competitors, and likely subreddits or forums. Every subagent below gets this brief. It never contains the user's name, email or other personal details.

## 2. Research, in parallel

Start these subagents in one message, each with `model: "opus"` and `effort: "high"`, each given the brief, the paths it writes to, and the rules at the end of this file. Each returns a short report and writes its findings, with sources, to its own file in `data/`. In `quick` mode, the same subagents with half the caps.

### A. Current state, gap and value (`data/current.md`)

Reads the project: README, CLAUDE.md, docs, plans, the code the idea touches, `git log` for recent work in that area. It writes:

- **Current:** what exists today that the idea builds on, each point with `where` (file paths or docs).
- **Target:** what has to be true when the idea is done, from the idea's target and the user's answers, written as outcomes the user would notice, not as features to build.
- **Gap:** what is missing between current and target, as found (data that is not recorded, a page that does not exist, an audience the project does not reach). Not steps and not how to close it.
- **Value:** who gains what and why it matters, the levers that make the value real, and 1 to 3 signs that would show it works. A point resting on a source cites it; reasoning is marked as judgement.
- **Size:** one rough call, `small`, `medium` or `large`, with one sentence why, so the verdict can weigh value against cost. Never a breakdown; the plan makes the real estimate.
- **Issues and dependencies** for the RAID that the code shows (for example a missing data field, or a library the idea needs).

For a `new` idea it covers what the project and the user already have that helps, and what is missing to reach a first version and first users. It does not research the market, and it writes no build steps.

### B. Demand and traffic (`data/demand.md`, raw answers in `data/seo-*.json`)

Skip with `no-seo`. Uses `mcp__dataforseo__api_request` (load it, and `mcp__dataforseo__docs_search` if an endpoint's fields are unclear, in one ToolSearch call). It may make **at most 8 calls** and stop when the `budget` is reached; every answer carries a `cost`, which it adds up. Usual calls, in this order:

1. `keywords_data/google_ads/search_volume/live` for the seed phrases (one call, up to 20 phrases): volume, CPC, competition, the 12-month trend.
2. `dataforseo_labs/google/keyword_ideas/live` (or `related_keywords/live`) for 1 or 2 of the best seeds: the phrases people actually use, with volumes. Keep the 10 to 20 that fit the idea.
3. `serp/google/organic/live/advanced` for the 1 or 2 main phrases: who ranks today. That names competitors for C.
4. `dataforseo_labs/google/bulk_traffic_estimation/live` for up to 10 competitor domains (from step 3 and from C): estimated monthly organic traffic.
5. For a `new` idea, `dataforseo_labs/google/competitors_domain/live` for the strongest competitor, if calls are left.

It saves each answer, exactly as returned, as `data/seo-<n>-<short-name>.json`, and lists in `demand.md` every call with its endpoint, inputs, location, language and cost, and the total. Volumes are the provider's monthly estimates; say so once. A phrase with no data is listed as "no data", never guessed.

### C. What people say (`data/voices.md`, raw feeds in `data/reddit/`)

- **Reddit through RSS.** Write `data/reddit-sources.json` with `window_months` (12), `searches` (3 to 6 of the seed phrases, sitewide) and `subreddits` (up to 4, each `{name, queries}` with 1 or 2 queries). Run `node "${CLAUDE_PLUGIN_ROOT}/skills/reddit-product-ideas/scripts/fetch-reddit.mjs" --sources data/reddit-sources.json --out data/reddit --comments 10 --max-requests 25` from the idea's folder, in the background; it waits about 30 seconds between requests, so it takes up to 15 minutes. Run it with `--dry-run` first to see the plan. It writes `data/reddit/posts.jsonl`.
- **The web.** WebSearch for the seed phrases with words like "how do I", "alternative to", "recommend", "is there a tool", "review", and on forums, Hacker News, Quora, Stack Exchange, Product Hunt, app stores and blogs. Open at most 15 threads or pages with WebFetch.
- **Chrome.** If RSS is blocked or empty, or a site shows a thread only to signed-in readers, the subagent hands those links to one subagent with `model: "sonnet"` that uses Claude in Chrome (see "Chrome"). Skip with `no-browser` or `quick`.
- It reads what came back and keeps 6 to 15 **voices** that bear on the idea: people who want it (`want`), have the problem (`pain`), use something else for it (`uses`), or doubt it (`doubt`). Each has a title, the url, the site, the date, the point in one sentence, and at most one quote of 20 words or fewer. It counts how many threads it read and how many were on topic, and notes the main themes with their counts.

### D. Competitors and market (`data/competitors.md`)

Finds 3 to 8 products, sites or tools that do the same job (including "do it by hand" or a spreadsheet, where that is what people use). For each: name, url, what it does in one line, pricing from its own pricing page (with the date read), strengths and weaknesses for this idea, and its traffic from B if B got it. For a `new` idea it also covers the market: who pays, how much, the size where a source states it (never a guess), trends, and ways to reach people (communities, search, marketplaces). It records every source with its url and the date.

## 3. Put it together (`research.json`)

Wait for all four. Then write `research.json` in the shape of `${CLAUDE_PLUGIN_ROOT}/skills/idea-research/research.example.json` (an example with made-up data; use the shape, never its content):

- `id`, `date` (today), `mode` (`extension` or `new`).
- `verdict`: `call` (`go`, `go-with-changes`, `park` or `drop`), `confidence` (`low`, `medium`, `high`), `why` in one or two sentences. With `go-with-changes`, `why` says which changes.
- `summary`: 3 to 5 lines, the most important first. The first line is shown on the ideas list, so it must stand alone.
- `current`, `target`, `gap`: from A, each `{text, points}`; a point may have `where` and `sources`.
- `value`: from A, `{text, points, measures}`: who gains what, and how we would know it works. With C and D, check it against what people say and use.
- `size`: from A, `{call, text}`, `call` is `small`, `medium` or `large`. There is no `path` and no step list: `render --strict` warns if one appears.
- `demand`: from B; `text` says what the numbers mean for the idea, `where` names the provider, the location and the language; `keywords` with `phrase`, `volume`, `cpc`, `competition`, `trend` (12 numbers, oldest first) and `sources`.
- `voices`: from C, with `kind`, `title`, `url`, `source`, `date`, `point`, `quote`.
- `competitors`: from D, with `traffic {value, note, sources}` where B has it.
- `swot`: 2 to 5 points in each part. A point that rests on facts lists its `sources`; a point that is your reasoning says `"judgement": true`. Start from the idea's first-look SWOT; keep, change or drop each point, and say in the method what research changed.
- `raid`: `risks` (each with `likelihood`, `impact` and a `mitigation`), `assumptions` (each with a `test`), `issues`, `dependencies`. Start from the idea's first-look RAID in the same way.
- `facts`: 4 to 10 facts the decision rests on, each with sources.
- `experiments`: 1 to 3 of the cheapest ways to test the riskiest assumption, each with `measure` and `cost`.
- `questions`: up to 4 questions for the user that the research raised (RQ1, RQ2 … on the page), each with `why`.
- `sources`: every source, numbered `S1`, `S2` …; a web source has `url` and the `date` read, a file or data source has `path` (a data file relative to `ideas/`, a project file relative to the project root) and `kind` (for example `DataForSEO`, `code`, `Reddit`).
- `method`: what was done: the subagents, the DataForSEO calls with the total cost, the Reddit feeds and threads read, the sites read through Chrome, what was refused or skipped, and the limits of the data.

Render: `node IDEAS render --strict`. It checks that there is a `value`, that no build steps or efforts crept in, that every claim cites a source that exists, every web source has a url and a date, every risk has likelihood and impact, every quote has 20 words or fewer, and no user name or handle appears. Fix every warning until it exits 0.

## 4. Check the facts

Start one subagent with `model: "opus"` and `effort: "high"`. It reads `research.json`, `research.html` and the files in `data/`. It checks every number against the raw DataForSEO answers, every quote and date against its thread, a sample of 5 web sources against their pages, every price against the pricing page, and that each SWOT point marked with sources is what those sources say. It reports the wrong lines and the claims that have no source.

Fix every line it reports. A claim that cannot be traced goes, or becomes a `judgement` in the SWOT. Render again with `--strict`.

## 5. Check the page

Skip with `no-browser`. Playwright cannot open `file:` pages, so serve the `ideas` folder: `python -m http.server <free port> --bind 127.0.0.1` in the background. Open `research.html` with the Playwright tools at 1440 × 900 and at 390 × 844. Confirm there are no console errors (a missing favicon does not count) and no sideways scrolling at 390. Save one screenshot at each width under `.playwright-mcp/` in the project, named `<id>-research-1440.png` and `<id>-research-390.png`. Stop the server.

## 6. Link it and show it

1. `node IDEAS link <id>`: it copies the verdict and the first summary line into the list and sets the status to `researched`.
2. `node IDEAS render --strict`.
3. Show it to the user: one review page with both screenshots side by side and the research page itself, `powershell -NoProfile -ExecutionPolicy Bypass -File $HOME/.claude/ag/review-page.ps1 -Title "<id> research" "<research.html>|Research page" "<1440 png>|Desktop" "<390 png>|Phone"` (macOS and Linux: `pwsh -File`). Without screenshots, `node IDEAS open --id <id> --research`.
4. **Reply** in a few lines: the verdict and its confidence, the summary, the DataForSEO cost, what was skipped or refused, and the research questions, numbered. Say how to answer: the page's **Decide** bar and **Copy answer** give lines such as `AGPL-IDEA-003 decision go-with-changes: …` and `AGPL-IDEA-003 RQ1: …`, recorded as in `/ag:idea` ("Answer lines"). After a `go`, offer `/ag:plan` for the idea.

## Chrome

Claude in Chrome is the user's own Chrome, with their own sign-ins. Use it only to read.

- Browser work goes to a subagent with `model: "sonnet"`. If it cannot get through a page after 2 or 3 tries, stop it and take that step at Opus. It reads the `claude-in-chrome` skill first and loads every tool it needs in one ToolSearch call: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__find,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__tabs_close_mcp`.
- It works in a new tab and closes it at the end. It opens at most 15 pages. It never posts, votes, signs in, signs up, accepts terms or solves a captcha; where a site asks for any of that, it notes the site and moves on.
- For Reddit it uses `old.reddit.com` search and thread pages, which are lighter. If Chrome refuses reddit.com ("This site is not allowed due to safety restrictions"), that is a block in the extension: do not route around it; note it in the method.
- It writes what it read to `data/chrome-notes.md`: per page the url, the date, the title and the points, with quotes of 20 words or fewer and no user names.

## Rules

1. **Every number and claim has a source.** A volume, CPC, traffic or price comes from a DataForSEO answer in `data/` or a page read in this run, cited by its source id. Never estimate a number and present it as found. If there is no data, write "no data".
2. **Facts and judgements are kept apart.** Reasoning is fine, but it is marked: `"judgement": true` in the SWOT, and words like "likely" or "we think" elsewhere.
3. **Privacy.** No user names, handles or personal details from any site, in any file. Quotes are 20 words or fewer, and only where the exact words matter; otherwise paraphrase. The user's own name, email, accounts and project names never go into a search query, a DataForSEO request or a fetched URL; describe the idea in general words instead.
4. **Cost.** DataForSEO costs money: at most 8 calls and the `budget`, the total noted in the method and the reply. Reddit RSS: at most 25 requests. WebFetch: at most 15 pages per subagent.
5. **Say what the data is.** Search volumes are estimates for one market; Reddit and forums lean to people with problems; traffic is an estimate. Say each once in the method, not on every line.
6. **Research, not planning.** The page answers "should we do it, and how does it bring value". It has no build steps, no task list, no design or architecture and no effort per task; one rough `size` is the only cost it gives. What the plan will need goes in as facts, issues or dependencies. After a `go`, `/ag:plan` decides how.
7. **Change only `ideas/`** (and the screenshots in `.playwright-mcp/`). Build nothing. Do not commit unless the user asks.
