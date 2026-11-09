---
name: reddit-product-ideas
description: "Find out what a site's audience actually asks (Reddit first, through RSS, then forums, Quora, Blind and other sites through the web, with Claude in Chrome as the fallback and for signed-in sites), compare it with the site's goal and what the site already says and links, and propose improvements in three groups: strategic (new features, content areas, audiences), UX/UI (things people need that the site hides or orders badly) and content (wording, answers, FAQ, no flow change). Every recommendation carries counted evidence and real links. The result is an interactive HTML presentation (report.html, rendered from report.json) with a pick button on every proposal. Where to look, the themes and the site's rules come from the project's .claude/product-ideas/ (sources.json, codebook.json, project.md); without them it drafts the three files from the project's docs and waits for approval. Proposes only; changes nothing on the site. Use when the user asks for /ag:reddit-product-ideas, product ideas from Reddit, what users ask, or improvements based on what people look for."
argument-hint: "[focus words] [months=12] [budget=95] [quick] [chrome] [no-browser] [refresh]"
---

# Reddit product ideas

Input: `$ARGUMENTS`, all optional:
- focus words (for example a city, a role or a topic): extra searches for them, and the report leads with them;
- `months=<n>` (default 12, or `window_months` in `sources.json`): how far back posts count;
- `budget=<n>` (default 95): the most Reddit requests this run makes, comment threads included (about 31 seconds each, so the default is about 50 minutes);
- `quick`: the main subreddit only, `budget=25` (about 13 minutes; the exact flags are in `project.md`);
- `chrome`: skip RSS and read Reddit through Claude in Chrome from the start (see "Chrome");
- `no-browser`: skip the click test in step 7 (Chrome as a data source still works);
- `refresh`: fetch again even when today's feeds are cached.

This skill researches and proposes. It never changes the site, the plans, the design or the data. The report, an interactive HTML presentation, is the product.

## The project's config

Everything project-specific lives in the project's `.claude/product-ideas/` (called CFG below):
- `sources.json`: where to look. The filters (regular expressions on word boundaries, case-insensitive unless an entry starts with `cs:`; every filter gives each post a field `<name>Hits`), the subreddits with their feeds, queries and `require` (the filters a post must match), the sitewide `searches` and their `search_require` (default: every filter), `window_months`, `site` and `other_sites`.
- `codebook.json`: what to tag. The `themes` (`slug`, `label` shown in the report, `counts`: what counts), `offTopic` (the slug never counted), `jobAds` (`{theme, kind}` for employers' job ads, or `null` when the subject has none), `fields` (extra fields a tagger fills in, such as origin, role or city, with how), `kinds` (the kind hint: `[{kind, in: "all"|"title", pattern}]`, first match wins) and `defaultKind`, and optional `groupBlurbs` and `gateLabels` for the report.
- `project.md`: the site's URL, audience and goal, what counts as on-topic, the files to read in step 2, where RUN and RAW go, the rules every proposal keeps, and run specifics (the `quick` flags, the subreddits for focus words, WebSearch examples, the click test's viewport and gates).

The scripts are in `${CLAUDE_PLUGIN_ROOT}/skills/reddit-product-ideas/scripts/` and take every project detail from these files or their arguments. Run any of them with `--help` for its usage.

### Step 0: read the config, or draft it

1. Read the three files with Read. Check that `sources.json` and `codebook.json` parse, that every subreddit's `require` names a filter, and that RAW is gitignored. Then go to step 1.
2. **If the folder or any file is missing**, do not fetch anything. Draft the missing files from the templates in `${CLAUDE_PLUGIN_ROOT}/skills/reddit-product-ideas/templates/` and the project itself:
   - read `CLAUDE.md`, the README, the design brief and the product plans (Read and Grep), and the live site's home page if the URL is known;
   - `project.md`: the URL, audience and goal, on-topic and off-topic, the files to read, RUN and RAW (a research folder that is kept, and a data folder that is gitignored), the project's own rules (spelling, copy, data, money, gating, "never propose built or planned work as new"), and the run specifics;
   - `sources.json`: filters for the subject and the places, 5 to 12 subreddits where the audience asks (the main one with `new` and `top` feeds and 10 to 16 queries, the others with `top` or queries alone), 5 to 8 sitewide searches in people's own words, and the other sites;
   - `codebook.json`: 15 to 25 themes that cover what the audience asks about (each with a short label and what counts), `off-topic`, the job-ads convention if the subject has job ads, the fields to count, and the kind rules from the template (keep `hiring`, `seeking` and `question` unless they make no sense for the subject).
3. Write the drafts into CFG, show the user the three files in short (the subreddits, the filters, the themes with labels, RUN and RAW, the rules), and **wait for approval or changes before the first run.** Never guess a subreddit that you have not seen named in the project or found by WebSearch; mark guesses as such.

## Where things go

- `RUN` is in `project.md` (for example `.planning/research/product-ideas/<yyyy-mm-dd>/`). It holds `site-brief.md`, `other-sources.jsonl`, `tags.jsonl`, `tally.md`, `tally.json`, `coverage.md`, `shots/`, `report.json` and `report.html` (the presentation, step 8). These files are small and are kept with the project's research.
- `RAW` is in `project.md` (for example `data/research/reddit/<yyyy-mm-dd>/`). It holds the feeds, `posts.jsonl`, `batches/` and `site.json`. It must be gitignored, because it is bulky public text.
- `URL` is the site's address from `project.md`.
- If the user did not ask for a commit, do not commit. Name the folder in the reply.

## Chrome (Claude in Chrome)

The user allows Claude in Chrome for this skill: their own Chrome, with their own sign-ins. Use it freely to find data:
- as the **fallback when Reddit RSS fails**: a block, the feeds being shut down, or rate limits that never clear (step 1);
- for **sites that refuse WebFetch** or show their threads only to signed-in readers, such as Quora, Blind and forums (step 3);
- to **read a thread in full** when the RSS text or comment feed is cut short.

How:
- **Who does it.** Browser work goes to a subagent with `model: "sonnet"`. If it cannot get through after 2 or 3 tries, stop it and take that step at Opus. The subagent reads the `claude-in-chrome` skill first.
- **Loading the tools.** It loads every tool it needs in one ToolSearch call: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__find,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__tabs_close_mcp`.
- **Tabs.** It calls `tabs_context_mcp` first and works in a new tab of its own. It closes that tab at the end.
- **Read only.** It never posts, comments, votes, joins, follows, messages, signs up or accepts anything. It triggers no dialogs. It does not change the user's settings on any site.
- **Reddit.** It opens `https://www.reddit.com` in its tab. Then it runs `${CLAUDE_PLUGIN_ROOT}/skills/reddit-product-ideas/scripts/chrome-reddit.js` through `javascript_tool`, once per group of about 10 feeds:
  - First it reads the file with Read and edits its `INPUT` block:
    - `filters`: copied as is from CFG `sources.json`.
    - `kinds` and `defaultKind`: copied as is from CFG `codebook.json`.
    - `feeds`: `{label, path, require?}`, using the same subreddits, feeds and queries as `sources.json`, each with that subreddit's `require` (and `search_require`, or every filter, for sitewide searches). Paths are `.json` listings, for example `/r/<Sub>/new.json?limit=100`, `/r/<Sub>/search.json?q=<q>&restrict_sr=on&sort=new&t=year&limit=100` or `/search.json?q=<q>&t=year&limit=100`. Labels are `<Sub>:new`, `<Sub>:top`, `<Sub>:search:<q>` or `search:<q>`; the merge reads each feed's filters from them.
    - `require`: the default for a feed without its own (an empty list keeps everything, so set it).
    - `months`.
  - Then it pastes the whole file into `javascript_tool`. The snippet reads Reddit's listing JSON from inside the signed-in tab, at about one request every 2.5 seconds. It returns posts in the same shape as `posts.jsonl`, with no authors.
  - The subagent saves each returned string, exactly as returned, as one line in its own file: `RAW/chrome-01.jsonl`, `RAW/chrome-02.jsonl` and so on. If a result says `truncated: true`, it uses fewer feeds per call.
  - A last call with `feeds: []` and `INPUT.comments` set to the top posts' links fetches their comments into another `chrome-NN.jsonl` file.
- **If Chrome refuses Reddit.** On 9 November 2026 Claude in Chrome refused to open reddit.com, with the message "This site is not allowed due to safety restrictions". That is a block in the extension. Do not route around it through another browser tool. Tell the user, carry on with what RSS got, and say so in the method note.
- **If the snippet fails** (Reddit changes its JSON, or the request is refused), the subagent reads the pages instead with `get_page_text`, using `old.reddit.com` search and thread pages, which are lighter. It writes the same line shape by hand: `id`, `sub`, `url`, `title`, `text`, `published`, `feeds: ["chrome:<label>"]`.
- **Joining.** `node "${CLAUDE_PLUGIN_ROOT}/skills/reddit-product-ideas/scripts/merge-posts.mjs" --sources .claude/product-ideas/sources.json --codebook .claude/product-ideas/codebook.json --out RAW/posts.jsonl RAW/posts-rss.jsonl RAW/chrome-*.jsonl` joins the RSS and Chrome posts:
  - It applies the same filters and `kind` hints to both (shared in `scripts/lib.mjs`), dedupes by id, attaches comments and drops any author field.
  - It checks the filters against the stored text, which is 700 characters by default. A post whose only matching word comes after that is dropped.
  - Before it runs, rename the RSS run's `posts.jsonl` to `posts-rss.jsonl`. With Chrome alone, pass only the Chrome file.
  - Steps 4 and 5 then work unchanged.
- **Other sites.** It searches on the site itself, or on the WebSearch results' links. It reads threads with `get_page_text` and writes one `other-sources.jsonl` line per thread (step 3). A sign-in the user already has is fine to use. If a site asks the subagent to sign in, solve a captcha or accept new terms, the subagent stops there and notes it.
- **Privacy.** The same rules hold: no usernames or handles in any file, and quotes of 20 words at most. The user's own account name, feed or messages never go into a file.

## Rules for facts

1. **Every number is counted, never estimated.** A count, share or trend comes from `tally.json`/`tally.md`. A page fact (words, links, depth, FAQ) comes from `site.json`. A search volume comes from the keyword data `project.md` names, or a DataForSEO call made in this run. Name the source file next to the number.
2. **Every example is a real link** from `posts.jsonl` or `other-sources.jsonl`, with its date. Never write a link from memory.
3. **Evidence levels** by on-topic posts across all sources:
   - 15 or more, from at least 2 places: **strong**.
   - 6 to 14: **medium**.
   - 3 to 5: **weak**. A weak signal can still be a recommendation if it fits the goal well; say so.
   - Fewer than 3: it goes to "Weak signals", not to the recommendations.
4. **Say what the numbers are.** RSS and Reddit's listings return about 100 posts per feed, so counts are posts found, not all posts on Reddit. Reddit leans to some groups of people and to people with problems. Write this once in the report's method note, not on every line.
5. **Keep people's questions apart from job ads** (when the codebook has `jobAds`). Posts of the job-ads kind show what employers want (roles, skills, pay). `question` and `seeking` posts show what the audience wants. Never add the two together.
6. **Privacy.** No usernames, no handles and no personal details. Quotes are 20 words at most and only where the exact wording matters (for example, the words people use for a page title). Otherwise paraphrase.
7. **The site's own rules hold in every proposal:** the list in `project.md` → "Rules every proposal keeps" (spelling, copy, data, money, gating). Always: never propose something that is already built or already planned as new. Mark it "already planned (<plan reference>)" or "built, but …".

## Steps

### 1. Start the Reddit fetch (background, it is slow)

Reddit's JSON API often answers 403 to scripts. Its RSS feeds work, but they allow about one request every 30 seconds without a login. The script waits as Reddit's headers tell it.

1. Dry run: `node "${CLAUDE_PLUGIN_ROOT}/skills/reddit-product-ideas/scripts/fetch-reddit.mjs" --sources .claude/product-ideas/sources.json --codebook .claude/product-ideas/codebook.json --site URL --out RAW --dry-run`. It prints the request count and the time.
2. For focus words, add their searches to a copy of `sources.json` in RAW: queries in the subreddits `project.md` names for focus words, and one sitewide search. Use that copy for the run (pass `--codebook` explicitly then, since the copy has no `codebook.json` beside it).
3. `quick` means the flags in `project.md` (usually `--only <MainSubreddit> --max-requests 25 --comments 5`). Do not add `--no-search` unless the user asks: it drops every search, the subreddit ones included, and leaves only the new and top feeds.
4. Run the fetch with `--max-requests <budget> --comments 25` in the background (Bash `run_in_background`). Tell the user it is running and roughly how long it takes. Comment threads come out of the same budget; the script keeps `--comments` of it aside for them.
5. The cache makes a rerun resume where it stopped. If the run ends with many 429s, rerun it once with the same arguments. `--max-requests 0` rebuilds `posts.jsonl` from the cache alone, with no request, for example after a change to the filters in `sources.json`.
6. `--only` writes `posts.jsonl` for those subreddits alone. The run the report uses is one without `--only`, except in `quick`, where that is the point.
7. **Fallback to Chrome.** RSS may be shut down or blocked one day. Watch the first feeds in `fetch-log.txt`, and switch to Chrome (see "Chrome") for the feeds RSS did not get when either of these happens:
   - 3 or more feeds in a row answer 403, 404 or 410, or come back empty or not as XML (an HTML page, a sign-in page);
   - the 429s do not clear after one rerun.

   Stop the RSS run first. Keep what it fetched (`posts-rss.jsonl`) and join the two sources with `merge-posts.mjs`. Report the switch to the user in one line, and say in the report's method note which feeds came from which source.

   With `chrome` in the arguments, skip RSS and start with Chrome. The `budget` limits the Chrome requests the same way.

### 2. Read the site while it runs (main thread)

1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/reddit-product-ideas/scripts/site-snapshot.mjs" --base URL --out RAW` in the background as well. It writes `site.json`/`site.md`: every page in the sitemap with its H1, H2s, word count, FAQ, inbound links, home/nav/footer links and click depth.
2. Read the goal and the plans: the files `project.md` lists under "Files to read", with Read and Grep (never print plan files through the shell). Include the earlier runs in RUN's parent folder (`*/report.json`).
3. Write `RUN/site-brief.md`, 80 lines at most. It is the taggers' and the report's view of the site:
   - the goal and audience (the codebook's fields: for example places, origins, roles);
   - what a visitor can do free, with an account and paid (tools, prices from the project's data, not typed);
   - the main pages by group, with their paths;
   - what is planned and not built, with references;
   - the last search-console facts if they are recent.

### 3. Other sites (main thread, while the fetch runs)

Run WebSearch in standard mode: at most 8 searches, sent together. Aim at the places in `sources.json` → `other_sites`, using the examples in `project.md`, plus the focus words.

Open at most 10 threads with WebFetch. Keep only threads from inside the time window that are on-topic as `project.md` defines it. Add one line per thread to `RUN/other-sources.jsonl`: `{id: url, source, url, date, title, themes, kind, <fields>}`, tagged with the codebook (the fields are the keys of `codebook.json` → `fields`).

If WebFetch is refused, or a site shows a thread only to signed-in readers (Quora, Blind and forums often do), read it through Chrome instead (see "Chrome"). The user's existing sign-ins may be used, read only. The Chrome subagent may also search inside these sites and open up to 15 more threads. Note in the method note which threads came through Chrome. If a site still refuses there (a new sign-in, a captcha or terms to accept), note it and move on.

### 4. Tag the posts (subagents, parallel)

When the fetch is done:
1. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/reddit-product-ideas/scripts/batch.mjs" --posts RAW/posts.jsonl --out RAW/batches --size 80 --codebook .claude/product-ideas/codebook.json`. Posts of the codebook's job-ads kind go into their own `batch-<kind>-XX.md` files.
2. Start one subagent per batch file with `model: "opus"` and `effort: "medium"`, at most 6 at a time. Give each:
   - the batch file's path;
   - `RUN/site-brief.md`;
   - the codebook as a table (from `codebook.json`: each theme's slug and what counts, then each field and how to fill it), and the on-topic and off-topic lines from `project.md`;
   - its output path `RAW/batches/tags-XX.jsonl`.
3. Each subagent writes one line per post: `{id, themes, kind?, <field>?, note?}`. The script's filters are loose on purpose (a broad word catches neighbouring subjects). The tagger decides what is on-topic and what is off-topic, and the script's `kind` is only a hint the tagger may correct.
   - Every post gets a line.
   - Posts off the subject, spam or an unrelated subject get `themes: ["<offTopic>"]`.
   - A theme outside the codebook is allowed if 3 or more posts need it. Its slug starts with `new-` and a `note` gives its meaning.
4. Job-ads batches get only the fields and the job-ads theme.
5. Join the outputs into `RUN/tags.jsonl`.
6. Check 10 random lines yourself against their posts. If more than 2 are wrong, fix the codebook wording and retag that batch.

### 5. Count

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/reddit-product-ideas/scripts/tally.mjs" --posts RAW/posts.jsonl --tags RUN/tags.jsonl --other RUN/other-sources.jsonl --codebook .claude/product-ideas/codebook.json --out RUN --recent-months 3`.

If the list of untagged posts is not empty, tag them and run it again.

### 6. Coverage map (main thread)

Write `RUN/coverage.md`. It has one row per theme and per field value (for example role, city) with 3 or more posts, in this order: theme, posts (tally), the page or pages that answer it (paths from `site.json`), then **coverage** and **prominence**.
- **Coverage** is `full`, `partial` or `none`. Judge it by reading the page's H1, H2s and FAQ in `site.json`, and open the page itself (curl, or a Read of its source) when the headings are not enough.
- **Prominence** is: on home or not, in nav or not, depth, inbound links.

Then mark the gaps:
- **Demand and no page.** This leads to a strategic proposal.
- **A page that's hard to find.** A theme in the top third by posts whose page has depth 3 or more, or 2 inbound links or fewer, or is not linked from home or nav. This leads to a UX proposal.
- **A page that misses the question.** The page exists, but its short answer, headings or FAQ do not answer how people ask it, or it uses other words. This leads to a content proposal.

### 7. Click test on a phone (Sonnet, optional)

Skip this step with `no-browser`. Take the 5 most asked themes from step 6. Start one subagent with `model: "sonnet"`, and give it the 5 questions in people's own words.

It uses the Playwright MCP tools, because their browser is clean and signed out as a new visitor would be. If Playwright is missing, it uses Claude in Chrome in a new tab. Before the test it checks that the user is signed out of the site in that browser. If not, it reports that and stops this step: it never signs the user out.

For each question, it starts at URL at the viewport `project.md` gives (390 × 844 by default), signed out, and tries to reach an answer the way a visitor would: no site search engine, no typed URLs. It reports:
- the clicks it took (stopping at 6);
- where it got stuck;
- whether a sign-up or payment gate stopped it (named as in `codebook.json` → `gateLabels`);
- one screenshot per question in `RUN/shots/`.

It never signs up, never pays and never submits a form. These clicks are UX evidence ("4 clicks and a gate to find the page"). Quote them as the subagent saw them.

### 8. Write the report (main thread)

The report is an interactive HTML presentation, `RUN/report.html`: one self-contained file (no CDN, no remote fonts or images), a slide per section and per proposal, opened straight from disk. You do not write the HTML. You write its content as `RUN/report.json`, and `render-report.mjs` turns that into the slides:

```
node "${CLAUDE_PLUGIN_ROOT}/skills/reddit-product-ideas/scripts/render-report.mjs" --report RUN/report.json --tally RUN/tally.json --codebook .claude/product-ideas/codebook.json --posts RAW/posts.jsonl --other RUN/other-sources.jsonl --out RUN/report.html --strict
```

Add `--lang <tag>` when the site is not British English (the default `en-GB` sets the page language and the number format).

The renderer checks the numbers and links as it goes and prints a warning for each problem it finds. Fix every warning before step 9. It checks:
- that a proposal's counts and share match `tally.json` when it names one theme;
- that its level fits its counts;
- that every example link is in `posts.jsonl` or `other-sources.jsonl`;
- that every quote has 20 words or fewer, and no username or handle appears;
- that each click-test screenshot exists;
- that ids run S, then U, then C, with at most 7 per group, and that every theme slug is in `tally.json`;
- that links are http(s) (anything else is shown as plain text).

With `--strict`, any warning makes it exit 1. It prints `N slides, M warnings → <path>`.

`scripts/report.example.json` (with `report.example.tally.json`) is a complete example of the shape. The presentation contains:
- the summary;
- a themes chart, where clicking a bar shows its examples;
- the click test with its screenshots;
- a divider and then one slide per proposal in each group;
- Already well covered, Weak signals and Method;
- a closing "Your picks" slide.

Each proposal has "Do it / Later / No" buttons. The choices are kept in the browser, and the closing slide copies them as a list. Keyboard: the arrow keys move between slides, `o` shows an overview, and every slide has its own address (`#S1`, `#method`). Text fields allow only `code`, **bold** and [links](https://…).

`report.json` holds the sections below, in this shape:

```
{ "title", "date": "yyyy-mm-dd", "window": {"from","to","months"}, "focus": [],
  "summary": {"lines": [], "findings": [3], "first": ["S1","U1","C1"]},
  "ask": {"top": 10, "notes": {"<theme>": "…"}, "examples": {"<theme>": {"title","url","date","source"}}},
  "themeLabels": {"new-…": "label"},
  "clickTest": [{"question","clicks","reached","gate": "<gate>"|null,"stuck","path": [],"shot": "shots/01.png"}],
  "groups": {"S": [proposal], "U": [proposal], "C": [proposal]},
  "covered": [{"theme","pages": [],"note"}], "weak": [{"text","links": []}], "method": [], "rerun": null | {"previous","changes": []} }
```

Notes on the shape:
- `ask.top` defaults to 10. `ask.notes` and `ask.examples` are keyed by theme slug.
- Theme labels come from `codebook.json`; `themeLabels` overrides the label of any theme, and names the `new-` ones. `groupBlurbs` and `gateLabels` in `report.json` override the codebook's in the same way.
- The codebook's job-ads theme and off-topic theme are left out of the theme bars; job ads get a line of their own.
- `clickTest[].gate` is a gate key from `codebook.json` → `gateLabels` (for example `account`), or null. `shot` is a path relative to `report.json`, or null.
- `evidence.note`, `planned` and `rerun` may be null.
- `"example": true` at the top shows an "example data" banner. Never set it in a real report.
- Picks are kept in localStorage under `product-ideas-picks:<date>`. "Copy list" gives one line per pick, such as `S1 <title> — Do it`.

The sections:

1. **Summary.** Five lines at most:
   - the window;
   - posts found and on-topic posts;
   - the 3 biggest findings;
   - the 3 proposals to do first.
2. **What people ask.** The top 10 themes from the tally, with count, share, trend and one example link each. Then the top values of each codebook field (for example roles, cities, origins).
3. **Strategic.** New features, new content areas, new audiences (the codebook's fields: new places, roles, origins). Each one says why it fits the goal in `site-brief.md`.
4. **UX/UI.** Things people need that the site has but hides or orders badly: depth, missing home or nav links, the click test, the order inside a page, gates in the wrong place.
5. **Content.** Changes without any change of flow or UI: answers, FAQ entries in people's own phrasing, missing facts (named with their data source), titles and headings in the words people use.
6. **Already well covered.** The themes the site answers well. Keep these as they are.
7. **Weak signals.** Fewer than 3 posts, or off the goal. One line each.
8. **Method.** Sources and the date of each; for Reddit, which feeds came through RSS and which through Chrome, and why; requests made and refused; RSS limits; threads read through Chrome on other sites; tagging by subagents with the spot check and the codebook (`.claude/product-ideas/codebook.json`); who did the click test. If this is a rerun, add what changed since the last report.

Each recommendation, at most 5 to 7 per group and the strongest first, is one `proposal` object:

```
{ "id": "S1", "title": "<short proposal>", "level": "strong"|"medium"|"weak",
  "evidence": { "themes": ["<slug>"], "count": n, "onTopic": n, "share": pct, "recentPerMonth": x, "earlierPerMonth": y,
                "places": ["r/<Sub>", "Blind"], "search": [{"phrase", "volume", "source": "<keyword data file>"}], "note": null },
  "examples": [{"title", "url", "date", "source"}],      // up to 3, real links from posts.jsonl / other-sources.jsonl
  "today": "<what exists, with paths and the site.json facts, or 'no page'>",
  "fits": "<why it fits the goal in site-brief.md>",      // S only
  "proposal": "<what to do, concrete; for UX, which page, which position, which link>",
  "where": ["<paths, components or plan files to change>"],
  "effort": "S"|"M"|"L", "planned": "<plan reference>" | null }
```

The counts come from `tally.json`, and the search volumes from the file named in `source`. Number the groups S, U and C (S1, U1, C1).

### 9. Check the facts (fresh subagent)

Start one subagent with `model: "opus"` and `effort: "high"`. It reads `report.json`, and the rendered `report.html` for how it reads. It checks every number and link against `tally.json`, `site.json`, `other-sources.jsonl`, `posts.jsonl` and the keyword files it names. It also checks that no username or handle appears and that every quote has 20 words or fewer. It reports the wrong lines.

Fix every wrong line it reports in `report.json`. If a number cannot be traced, the claim goes, or it moves to "Weak signals". Then render again with `--strict`, which must end with no warnings. Open `report.html` with the Playwright tools at 1440 × 900 and at 390 × 844, step through every slide, and confirm there are no console errors and no empty slides.

### 10. Reply

Start with the outcome:
- the number of on-topic posts and their window;
- the path to `report.html`, opened for the user (`start` on Windows, `open` on macOS), and a note that the "Do it / Later / No" picks are copied from its last slide;
- the top 2 or 3 proposals per group, one line each with their evidence count.

Then add what was skipped or refused, if anything: a site that refused, a budget that ran out, or a switch from RSS to Chrome. Offer to turn the chosen proposals into plan stories. Do not build anything.
