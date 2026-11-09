# Product ideas: <project name>

What `reddit-product-ideas` needs to know about this project. The skill reads this file, `sources.json` and `codebook.json` (all three in `.claude/product-ideas/`) at the start of every run.

## Site

- URL: https://example.com
- site-snapshot.mjs reads `<URL>/sitemap.xml` (a sitemap index too); a site without one gives only the home page and its links

## Audience and goal

<Two to five lines: who the site is for (places, origins, roles or segments), what it helps them do, and how it earns money (free, account, paid). The taggers and the report judge "fits the goal" against this.>

## Subject

- On-topic: <what makes a post count, in one line; the tagger decides>
- Off-topic: <what looks close but is not, for example other professions caught by a loose word>
- Job ads: <yes: kept apart under the codebook's jobAds theme / no: set "jobAds": null in codebook.json>

## Files to read (step 2)

Read with Read and Grep, never printed through the shell:
- `CLAUDE.md` (the first lines)
- <the design brief: flows, URLs, gating>
- <the product or business plan, pricing>
- <the open items of the build plan, launch list and open questions>
- <keyword research, search volumes (CSV) already paid for>
- <earlier research, among them earlier product-ideas runs (`<RUN parent>/*/report.json`)>

## Where things go

- RUN: `<research folder>/product-ideas/<yyyy-mm-dd>/` (small files, kept with the project's research)
- RAW: `<data folder>/research/reddit/<yyyy-mm-dd>/` (bulky public text; must be gitignored)

## Rules every proposal keeps

The project's own rules (rule 7 in the skill):
- <spelling: British or American English>
- <copy rules, for example no figures typed into copy>
- <data rules, for example no sample data>
- <money format, currency order>
- <gating: what stays behind an account or a payment, and where that is decided>
- Never propose something already built or already planned as new: mark it "already planned (<plan reference>)" or "built, but …".

## Run specifics

- quick: `--only <MainSubreddit> --max-requests 25 --comments 5`
- Focus words go to: <the subreddits for focus queries>, plus one sitewide search
- WebSearch examples: `site:<forum> <subject words>`, `site:quora.com <subject words>`
- Click test: 390 × 844, signed out, from the home page; gates: <account, pass, …> (labels in codebook.json `gateLabels`)
- Search volumes: <the CSV folder, or "a DataForSEO call in this run">
