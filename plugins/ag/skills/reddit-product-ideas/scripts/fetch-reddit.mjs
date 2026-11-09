#!/usr/bin/env node
// fetch-reddit.mjs — polite Reddit research fetcher (RSS/Atom only; the JSON API answers 403 here).
//
// Usage:
//   node fetch-reddit.mjs --sources <sources.json> --out <dir> [--codebook <codebook.json>]
//        [--site <url>] [--months N] [--comments 25] [--max-requests 80]
//        [--only Sub1,Sub2,_search] [--no-search] [--refresh] [--dry-run]
//
// Reads the subreddits, feeds, queries and filters from sources.json, fetches each feed at most
// once per rate-limit window, caches every body in <out>/feeds/ (a rerun resumes from the cache),
// keeps the posts inside the window that pass the filters, fetches comments for the most useful
// ones and writes <out>/posts.jsonl. The kind hint comes from the codebook's kind rules. Usernames
// are never stored: <author> is ignored and /u/name mentions become "a user".

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeHits, allHits, meetsRequire, searchRequire, scrubUsers, cap, readCodebook, codebookPath, makeKindOf } from './lib.mjs';

const REDDIT = 'https://www.reddit.com';
const MIN_GAP_MS = 2000;
const EST_SECONDS_PER_REQUEST = 31;

const HELP = `fetch-reddit.mjs — fetch Reddit feeds (RSS) for product research

  --sources <file>      sources.json (subreddits, feeds, queries, filters, searches)
  --out <dir>           output folder (feeds/ cache, posts.jsonl, fetch-log.txt)
  --codebook <file>     codebook.json (kind rules, job-ads kind; default: codebook.json next to
                        sources.json, else a plain question/other hint)
  --site <url>          the site the research is for, named in the User-Agent
                        (default: sources.site, else none)
  --months <n>          keep posts published within n months (default: sources.window_months)
  --comments <n>        fetch comments for up to n posts (default 25; 0 = none)
  --max-requests <n>    stop after n network requests (default 80; cached feeds do not count;
                        --comments of them are kept for the comment requests;
                        0 rebuilds posts.jsonl from the cache without any request)
  --only <a,b>          only these subreddits; add _search to include the sitewide searches
  --no-search           skip all searches (per subreddit and sitewide); listing feeds only
  --refresh             ignore the cache and fetch again
  --dry-run             print the planned URLs, count and estimated time, then exit
  -h, --help            this help

Pacing: at least 2 s between requests; when x-ratelimit-remaining drops below 1 the next request
waits x-ratelimit-reset + 1 s (about 30 s unauthenticated); a 429 is retried up to 3 times.`;

const { values: opt } = parseArgs({
  options: {
    sources: { type: 'string' },
    out: { type: 'string' },
    codebook: { type: 'string' },
    site: { type: 'string' },
    months: { type: 'string' },
    comments: { type: 'string', default: '25' },
    'max-requests': { type: 'string', default: '80' },
    only: { type: 'string' },
    'no-search': { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opt.help || !opt.sources || !opt.out) {
  console.log(HELP);
  process.exit(opt.help ? 0 : 1);
}

const sources = JSON.parse(fs.readFileSync(opt.sources, 'utf8'));
const months = Number(opt.months ?? sources.window_months ?? 12);
const maxComments = Number(opt.comments);
const maxRequests = Number(opt['max-requests']);
const outDir = path.resolve(opt.out);
const feedsDir = path.join(outDir, 'feeds');
const only = opt.only ? new Set(opt.only.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) : null;

const codebook = readCodebook(codebookPath(opt.codebook, opt.sources));
const kindOf = makeKindOf(codebook);
const site = opt.site ?? sources.site ?? '';
const UA = `product-research/1.0${site ? ` (+${site})` : ''}`;

// ---------- filters ----------

const hits = makeHits(sources.filters ?? {});
const filterNames = Object.keys(sources.filters ?? {});

// ---------- plan ----------

const topWindow = months <= 1 ? 'month' : months <= 12 ? 'year' : 'all';

function feedUrl(sub, feed) {
  if (feed === 'top') return `${REDDIT}/r/${sub}/top/.rss?t=${topWindow}&limit=100`;
  return `${REDDIT}/r/${sub}/${feed}/.rss?limit=100`;
}

const lanes = [];
for (const s of sources.subreddits ?? []) {
  if (only && !only.has(s.name.toLowerCase())) continue;
  const lane = [];
  for (const f of s.feeds ?? []) lane.push({ label: `${s.name}:${f}`, url: feedUrl(s.name, f), require: s.require ?? [] });
  if (!opt['no-search']) {
    for (const q of s.queries ?? []) {
      lane.push({
        label: `${s.name}:search:${q}`,
        url: `${REDDIT}/r/${s.name}/search.rss?q=${encodeURIComponent(q)}&restrict_sr=on&sort=new&t=${topWindow}&limit=100`,
        require: s.require ?? [],
      });
    }
  }
  if (lane.length) lanes.push(lane);
}
if (!opt['no-search'] && (!only || only.has('_search'))) {
  const lane = (sources.searches ?? []).map((q) => ({
    label: `search:${q}`,
    url: `${REDDIT}/search.rss?q=${encodeURIComponent(q)}&t=${topWindow}&limit=100`,
    require: searchRequire(sources),
  }));
  if (lane.length) lanes.push(lane);
}

// Interleave: every lane's first feed, then every lane's second, and so on, so a budget cut
// still touches every subreddit (the sitewide searches are one lane of their own).
const plan = [];
for (let i = 0; lanes.some((l) => i < l.length); i++) for (const l of lanes) if (i < l.length) plan.push(l[i]);

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const cachePath = (url) => path.join(feedsDir, `${sha1(url)}.xml`);
const isCached = (url) => !opt.refresh && fs.existsSync(cachePath(url));

if (opt['dry-run']) {
  let uncached = 0;
  for (const [i, f] of plan.entries()) {
    const c = isCached(f.url);
    if (!c) uncached++;
    console.log(`${String(i + 1).padStart(3)}  ${c ? '(cached) ' : ''}${f.label}\n     ${f.url}`);
  }
  const net = Math.min(uncached, maxRequests);
  const withComments = Math.min(uncached + maxComments, maxRequests);
  console.log(`\nFeeds planned: ${plan.length} (${plan.length - uncached} cached, ${uncached} to fetch)`);
  console.log(`Window: ${months} months (top/search t=${topWindow}); comments for up to ${maxComments} posts; budget ${maxRequests} requests`);
  console.log(`Estimated time: feeds ${fmtDur(net * EST_SECONDS_PER_REQUEST)}; with comments up to ${fmtDur(withComments * EST_SECONDS_PER_REQUEST)} (${EST_SECONDS_PER_REQUEST} s per request)`);
  process.exit(0);
}

// ---------- text helpers ----------

function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos|nbsp);/gi, (m, g) => {
    const k = g.toLowerCase();
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' }[k];
  });
}

function htmlToText(html = '') {
  let s = decodeEntities(html);
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|blockquote|pre)>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/\s+/g, ' ').trim();
  // Reddit's trailer: "submitted by /u/name [link] [comments]"
  s = s.replace(/\s*submitted by\s*(?:\/?u\/[A-Za-z0-9_-]+|\[deleted\])?\s*(?:\[link\])?\s*(?:\[comments\])?\s*$/i, '');
  return scrubUsers(s).trim();
}

function parseEntries(xml) {
  const entries = [];
  for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const get = (re) => (e.match(re) ?? [])[1];
    entries.push({
      id: (get(/<id>([^<]*)<\/id>/) ?? '').trim(),
      title: scrubUsers(decodeEntities(decodeEntities(get(/<title[^>]*>([\s\S]*?)<\/title>/) ?? '')).replace(/\s+/g, ' ').trim()),
      link: decodeEntities(get(/<link\b[^>]*href="([^"]*)"/) ?? ''),
      published: (get(/<published>([^<]*)<\/published>/) ?? get(/<updated>([^<]*)<\/updated>/) ?? '').trim(),
      sub: get(/<category\b[^>]*term="([^"]*)"/) ?? '',
      html: get(/<content\b[^>]*>([\s\S]*?)<\/content>/) ?? '',
    });
  }
  return entries;
}

// ---------- polite fetching ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  return m ? `${m} min ${Math.round(sec % 60)} s` : `${Math.round(sec)} s`;
}

fs.mkdirSync(feedsDir, { recursive: true });
const logFile = path.join(outDir, 'fetch-log.txt');
const indexFile = path.join(feedsDir, 'index.jsonl');
const log = (line) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);

let requests = 0;
let cachedReused = 0;
let nextAt = 0;
let netTotal = 0; // for the progress counter
const waits = [];

async function politeGet(url, label, limit) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (requests >= limit) return { status: 'budget' };
    const wait = Math.max(0, nextAt - Date.now());
    if (wait) await sleep(wait);
    requests++;
    let res = null;
    let body = '';
    let status = 0;
    let error = '';
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.5' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      status = res.status;
      body = await res.text();
    } catch (err) {
      error = err.message;
    }
    const h = (k) => parseFloat(res?.headers.get(k) ?? '');
    const remaining = h('x-ratelimit-remaining');
    const reset = h('x-ratelimit-reset');
    let gap = MIN_GAP_MS;
    if (!Number.isNaN(remaining) && remaining < 1) gap = Math.max(gap, ((Number.isNaN(reset) ? 60 : reset) + 1) * 1000);
    const retryable = status === 429 || status === 0 || status >= 500;
    if (status === 429) {
      const ra = h('retry-after');
      const s = !Number.isNaN(ra) ? ra : !Number.isNaN(reset) ? reset : 60;
      gap = Math.max(gap, (s + 1) * 1000);
    } else if (retryable) gap = Math.max(gap, 10000);
    nextAt = Date.now() + gap;
    waits.push(wait);
    const entries = status === 200 ? (body.match(/<entry\b/g) ?? []).length : 0;
    const line = `[${requests}/${netTotal}] ${status || 'ERR'} entries=${entries} waited=${(wait / 1000).toFixed(0)}s remaining=${Number.isNaN(remaining) ? '?' : remaining} reset=${Number.isNaN(reset) ? '?' : reset}s ${label}${error ? ` (${error})` : ''}${retryable && attempt < 3 ? ` — retry ${attempt + 1}/3` : ''}`;
    console.log(line);
    log(`${line} ${url}`);
    if (retryable && attempt < 3) continue;
    return { status, body, entries };
  }
  return { status: 429 };
}

async function getFeed(feed, limit = maxRequests) {
  const file = cachePath(feed.url);
  if (isCached(feed.url)) {
    cachedReused++;
    return { body: fs.readFileSync(file, 'utf8'), cached: true };
  }
  const r = await politeGet(feed.url, feed.label, limit);
  if (r.status === 'budget') return { body: null, budget: true };
  fs.appendFileSync(indexFile, `${JSON.stringify({ url: feed.url, label: feed.label, status: r.status, entries: r.entries ?? 0, fetchedAt: new Date().toISOString() })}\n`);
  if (r.status !== 200) return { body: null };
  fs.writeFileSync(file, r.body);
  return { body: r.body };
}

// ---------- run ----------

const cutoff = new Date();
cutoff.setMonth(cutoff.getMonth() - months);

netTotal = Math.min(plan.filter((f) => !isCached(f.url)).length + maxComments, maxRequests);
log(`start: ${plan.length} feeds, budget ${maxRequests}, months ${months}${only ? `, only ${[...only].join(',')}` : ''}`);

const seen = new Set();
const posts = new Map();
let budgetHit = false;
const failed = [];

// The feeds leave room in the budget for the comment requests (at least one feed request).
// --max-requests 0 rebuilds posts.jsonl from the cache alone.
const feedBudget = maxRequests > 0 ? Math.max(1, maxRequests - Math.max(0, maxComments)) : 0;
for (const feed of plan) {
  const { body, budget } = await getFeed(feed, feedBudget);
  if (budget) { budgetHit = true; continue; }
  if (!body) { failed.push(feed.label); continue; }
  for (const e of parseEntries(body)) {
    if (!e.id.startsWith('t3_')) continue;
    seen.add(e.id);
    const published = new Date(e.published);
    if (Number.isNaN(published.getTime()) || published < cutoff) continue;
    const text = cap(htmlToText(e.html), 2000);
    const both = `${e.title} ${text}`;
    const ok = meetsRequire(feed.require, hits, both);
    const existing = posts.get(e.id);
    if (existing) {
      if (ok && !existing.feeds.includes(feed.label)) existing.feeds.push(feed.label);
      continue;
    }
    if (!ok) continue;
    posts.set(e.id, {
      id: e.id,
      sub: e.sub,
      url: e.link,
      title: e.title,
      text,
      published: published.toISOString(),
      kind: kindOf(e.title, text),
      ...allHits(filterNames, hits, both),
      feeds: [feed.label],
    });
  }
}

// Comments for the most useful posts.
// The kinds in the codebook's commentRank, best first; the job-ads kind never gets comments.
const KIND_RANK = Object.fromEntries(codebook.commentRank.map((k, i) => [k, i]));
const candidates = [...posts.values()]
  .filter((p) => p.kind in KIND_RANK && p.url)
  .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.feeds.length - a.feeds.length || b.text.length - a.text.length || b.published.localeCompare(a.published))
  .slice(0, Math.max(0, maxComments));

let commentsFetched = 0;
for (const p of candidates) {
  const url = `${p.url.replace(/\/?$/, '/')}.rss?limit=100`;
  const { body, budget } = await getFeed({ url, label: `comments:${p.id}` });
  if (budget) { budgetHit = true; continue; }
  if (!body) { failed.push(`comments:${p.id}`); continue; }
  const comments = [];
  for (const e of parseEntries(body)) {
    if (e.id.startsWith('t3_')) continue; // the post itself
    const text = htmlToText(e.html);
    if (!text || /^\[(deleted|removed)\]$/i.test(text)) continue;
    const d = new Date(e.published);
    comments.push({ text: cap(text, 600), date: Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10) });
  }
  p.commentCount = comments.length;
  p.comments = comments;
  commentsFetched++;
}

const sorted = [...posts.values()].sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));
fs.writeFileSync(path.join(outDir, 'posts.jsonl'), sorted.map((p) => JSON.stringify(p)).join('\n') + (sorted.length ? '\n' : ''));

// ---------- summary ----------

const countBy = (key) => {
  const m = {};
  for (const p of sorted) m[p[key]] = (m[p[key]] ?? 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ');
};
const span = sorted.length ? `${sorted.at(-1).published.slice(0, 10)} to ${sorted[0].published.slice(0, 10)}` : 'none';
const realWaits = waits.filter((w) => w > 0);
const summary = [
  '',
  `Requests made: ${requests} (budget ${maxRequests}${budgetHit ? ', reached: rerun to continue from the cache' : ''})`,
  `Cached feeds reused: ${cachedReused}`,
  `Average wait before a request: ${realWaits.length ? (realWaits.reduce((a, b) => a + b, 0) / realWaits.length / 1000).toFixed(1) : '0'} s`,
  `Failed feeds: ${failed.length ? failed.join(' | ') : 'none'}`,
  `Posts seen: ${seen.size}; kept: ${sorted.length} (window ${months} months, from ${cutoff.toISOString().slice(0, 10)})`,
  `Kept by sub: ${countBy('sub') || '-'}`,
  `Kept by kind: ${countBy('kind') || '-'}`,
  `Date span: ${span}`,
  `Comments fetched for: ${commentsFetched} posts (${sorted.reduce((a, p) => a + (p.commentCount ?? 0), 0)} comments)`,
  `Output: ${path.join(outDir, 'posts.jsonl')}`,
];
console.log(summary.join('\n'));
log(`end: ${summary.slice(1).join(' / ')}`);
