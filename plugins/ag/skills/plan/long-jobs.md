# Long jobs: batch processing, crawling, imports, backfills

Set by the user on 12 November 2026: "never allow planning for 2 hours runs without results and always try to process reasonable amount of batches and see results, not to have to restart all from scratch if something fails, and keep already loaded data and process it faster to continue with new algorithm or fixed issues".

A **long job** is a step whose run, not its code, takes the time: crawling or scraping, API fetches, data loads and imports, backfills and migrations over many rows, model or LLM runs over many items, file conversions. A plan never has one as a single run of an hour or two with nothing to look at. The plan and the goal skills, `/ag:plan` and the planner agents follow this file; a step with a long job writes the fields in section 9 into the plan.

## 1. Stages, with the raw data kept

- The job is split into stages, each its own command: **fetch** (network: slow, rate-limited, may cost money) → **raw store** → **process** (parse, clean, match, score, run the model) → **load** (write to the app's tables, publish).
- Fetch saves each response untouched (HTML, JSON, file) with its key (URL or id), fetch time, status code and a content hash, in the project's database or a git-ignored folder (`data/raw/...`, compressed). A rerun never edits or deletes raw data.
- Process reads only the raw store, never the network. A new algorithm or a fix reruns process over the raw data: minutes, not hours.
- Each processed row records the version that made it (`algo_version`, or for LLM work a hash of model, prompt and settings). `--reprocess` redoes only rows made by an older version, or all of them when asked.
- Slow or paid calls inside processing (LLM, geocoding, enrichment APIs) are cached by a hash of their input, model and prompt version, so a rerun pays only for what changed.

## 2. A work list with a status per item

- The job's items are a manifest (a table, or a JSONL file beside the raw store): key, stage, status (`pending`, `done`, `failed`, `skipped`), attempts, last error, times. Not a single "last item done" pointer, which breaks with parallel workers and out-of-order failures.
- Items run in a stable order (by id or URL), so batches can be repeated.
- Every write is idempotent: upsert by key; a file is written to a temporary name and renamed. A crash leaves no half record.
- Resuming is the default: the same command again picks up `pending` items and `failed` ones with attempts left, and skips `done`.

## 3. Batches and early results

- **Batch 0 is a sample** of 20 to 50 items (or a fixed sample spread over the range), run in the foreground. It prints counts, a few real outputs, how often each important field is filled, errors by kind and the measured rate (items per minute). The step's acceptance is checked on it (for example "at least 95% of pages parsed, title and salary filled in at least 80%"). The full run starts only when it passes; if it fails, the code is fixed and batch 0 runs again from the raw data.
- From the measured rate the job prints the time the whole run will take. Batches are sized to take about 5 to 15 minutes.
- After every batch the job prints one line (done, failed, skipped, rate, time left, errors by kind) to its log and its progress file, and its results so far can be looked at (rows in the table, or a results file).
- No job runs more than about 20 minutes without printing results. A run expected to take more than about 30 minutes in total is said so in the plan, runs in the background (section 8), and is split into steps if it can be (for example one source or one region at a time).

## 4. Failures

- One bad item never stops the job: the error is recorded on the item and the job goes on.
- Timeouts, HTTP 429 and 5xx are retried with exponential backoff and jitter, honouring `Retry-After`, up to 3 to 5 attempts; then the item is `failed` with its error. `--only-failed` retries just those after a fix.
- **Error budget:** the job stops itself, and prints why, when a batch's failure rate passes a set limit (for example 10%), or on an authentication, quota or billing error. It does not run through the whole list making the same error.
- Every network call has a timeout. Nothing waits without a limit.

## 5. Crawling and outside APIs

- An official API, bulk export, sitemap or feed comes before scraping pages.
- robots.txt and the site's terms are followed. Requests are rate-limited per host (about 1 per second unless the site allows more), with limited concurrency and a generic user agent that names no person.
- The raw store is the cache: a page fetched within its freshness window is not fetched again; a refetch uses `ETag` or `If-Modified-Since`.
- Paid APIs and outward actions stay within the goal's limits; the plan names the cost per batch and a cap.

## 6. Databases: backfills and migrations

- Batches go by key range (`where id > :last order by id limit :n`), not `OFFSET`, in short transactions, with a short pause between batches on a live database.
- A schema change is kept apart from its data: add the column, backfill in batches, switch the reads, then drop the old one, each its own step.
- A destructive change has a backup or snapshot first and a `--dry-run` that counts what would change.

## 7. The command

Every long-job script takes the same flags: `--limit N`, `--batch-size N`, `--concurrency N`, `--only-failed`, `--reprocess` (from the raw data, no fetching), `--since` or `--ids` for a subset, and `--dry-run`. Resuming needs no flag. It logs to a file, prints its line at the end of every batch, and ends with a summary: totals, failures by kind, where the results are.

## 8. Running it inside a goal

- Batch 0 runs in the foreground. The full run runs in the background (the shell tool's background option or a detached process), writing its log and progress file under `.claude/goal-prompt/<run-id>/logs/` or the job's data folder. No tool call waits on a long job: shell calls time out at 10 minutes.
- While it runs it is an entry in `running` in `.claude/goal-progress.json` (`kind: "job"`, the title, `since`, a `note` with the latest batch line), with one `log` line about every 15 minutes or per batch, whichever is less often. It is removed when the job ends.
- The job stops itself on its error budget, so nothing has to watch it. The main thread reads its progress file when it next acts, goes on with steps on other files meanwhile, and is told when the process exits.
- The step stays `doing` with counts in its note until the run has finished and its acceptance holds on the full data; then it is `done`.

## 9. What the plan writes for a step with a long job

- The stages and the command for each; where the raw data and the manifest are kept.
- Batch 0: its size and the acceptance checked on it.
- Batch size, the measured or estimated rate, and the expected total time (foreground or background).
- Retries, the error budget, and for crawling and paid APIs the rate limits and the cost cap.
- The commands to resume, retry failures (`--only-failed`) and reprocess from the raw data (`--reprocess`).
