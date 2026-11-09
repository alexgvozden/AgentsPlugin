#!/usr/bin/env node
// merge-posts.mjs — merge posts files from fetch-reddit.mjs (RSS) and chrome-reddit.js (Chrome)
// into one posts.jsonl with the same filters and kind hints whatever the source.
//
// Usage:
//   node merge-posts.mjs --sources <sources.json> --out <posts.jsonl> [--codebook <codebook.json>]
//        <in1.jsonl> [in2.jsonl …] [--months N]
//
// A line of an input file is either a post, or a whole chrome-reddit.js result object
// ({posts:[…], comments:[{id, comments:[…]}]}), which is expanded; its comments are attached to
// the post with that id. Posts are deduplicated by id (feeds merged, the longer text kept, comments
// kept if either copy has them, score/numComments kept). The "<filter>Hits" fields and the kind are
// worked out again from title + text; a post is kept when it meets the `require` of at least one
// of its feeds (feed label "Sub:…" → that subreddit's require in sources.json, "search:…" → the
// sitewide require: sources.search_require, else every filter; a label with neither → the post's
// subreddit entry, else the sitewide require) and is inside the window. Any author field is dropped.

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { makeHits, allHits, meetsRequire, searchRequire, readCodebook, codebookPath, makeKindOf } from './lib.mjs';

const HELP = `merge-posts.mjs — merge RSS and Chrome posts files into one posts.jsonl

  --sources <file>   sources.json (filters, subreddits' require, window_months)
  --out <file>       merged posts.jsonl to write
  --codebook <file>  codebook.json (kind rules; default: codebook.json next to sources.json)
  --months <n>       keep posts published within n months (default: sources.window_months)
  <in.jsonl> …       posts.jsonl from fetch-reddit.mjs and chrome-*.jsonl from chrome-reddit.js
  -h, --help         this help`;

const { values: opt, positionals: inputs } = parseArgs({
  allowPositionals: true,
  options: {
    sources: { type: 'string' },
    out: { type: 'string' },
    codebook: { type: 'string' },
    months: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (opt.help || !opt.sources || !opt.out || !inputs.length) {
  console.log(HELP);
  process.exit(opt.help ? 0 : 1);
}

const sources = JSON.parse(fs.readFileSync(opt.sources, 'utf8'));
const months = Number(opt.months ?? sources.window_months ?? 12);
const hits = makeHits(sources.filters ?? {});
const filterNames = Object.keys(sources.filters ?? {});
const kindOf = makeKindOf(readCodebook(codebookPath(opt.codebook, opt.sources)));
const BOTH = searchRequire(sources);
const subRequire = new Map((sources.subreddits ?? []).map((s) => [s.name.toLowerCase(), s.require ?? []]));

const isChrome = (label) => label.startsWith('chrome:');
function requireFor(label, sub) {
  const l = isChrome(label) ? label.slice(7) : label;
  if (l.startsWith('search:')) return BOTH;
  const first = l.split(':')[0].toLowerCase();
  if (subRequire.has(first)) return subRequire.get(first);
  return subRequire.get(String(sub ?? '').toLowerCase()) ?? BOTH;
}

// ---------- read ----------

const posts = new Map();
const pendingComments = new Map();
const perFile = [];

function addPost(p) {
  const { author, ...post } = p; // never keep a username
  post.feeds = [...new Set(post.feeds ?? [])];
  const old = posts.get(post.id);
  if (!old) { posts.set(post.id, post); return; }
  old.feeds = [...new Set([...old.feeds, ...post.feeds])];
  if ((post.text ?? '').length > (old.text ?? '').length) old.text = post.text;
  if ((post.title ?? '').length > (old.title ?? '').length) old.title = post.title;
  for (const k of ['sub', 'url', 'published']) if (!old[k] && post[k]) old[k] = post[k];
  for (const k of ['score', 'numComments']) if (post[k] != null && (old[k] == null || post[k] > old[k])) old[k] = post[k];
  if ((post.comments?.length ?? 0) > (old.comments?.length ?? 0)) {
    old.comments = post.comments;
    old.commentCount = post.commentCount ?? post.comments.length;
  }
}

for (const file of inputs) {
  const stat = { file: path.basename(file), lines: 0, posts: 0, commentSets: 0, bad: 0 };
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    stat.lines++;
    let obj;
    try { obj = JSON.parse(line); } catch (err) { stat.bad++; console.warn(`warn: ${file} line ${i + 1} is not JSON (${err.message})`); return; }
    if (!obj.id && (Array.isArray(obj.posts) || Array.isArray(obj.comments))) {
      for (const p of obj.posts ?? []) if (p?.id) { addPost(p); stat.posts++; }
      for (const c of obj.comments ?? []) if (c?.id && c.comments?.length) { pendingComments.set(c.id, c.comments); stat.commentSets++; }
    } else if (obj.id) {
      addPost(obj);
      stat.posts++;
    } else stat.bad++;
  });
  perFile.push(stat);
}

let commentsAttached = 0;
let commentsOrphan = 0;
for (const [id, list] of pendingComments) {
  const p = posts.get(id);
  if (!p) { commentsOrphan++; continue; }
  const comments = list.map(({ author, ...c }) => c);
  if (comments.length > (p.comments?.length ?? 0)) {
    p.comments = comments;
    p.commentCount = comments.length;
  }
  commentsAttached++;
}

// ---------- filter again ----------

const cutoff = new Date();
cutoff.setMonth(cutoff.getMonth() - months);
const merged = posts.size;
const dropped = { window: 0, filter: 0 };
const kept = [];
for (const p of posts.values()) {
  const published = new Date(p.published);
  if (Number.isNaN(published.getTime()) || published < cutoff) { dropped.window++; continue; }
  p.published = published.toISOString();
  const both = `${p.title ?? ''} ${p.text ?? ''}`;
  Object.assign(p, allHits(filterNames, hits, both));
  p.kind = kindOf(p.title ?? '', p.text ?? '');
  const labels = p.feeds.length ? p.feeds : [''];
  if (!labels.some((l) => meetsRequire(requireFor(l, p.sub), hits, both))) { dropped.filter++; continue; }
  kept.push(p);
}

kept.sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));
fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
fs.writeFileSync(opt.out, kept.map((p) => JSON.stringify(p)).join('\n') + (kept.length ? '\n' : ''));

// ---------- summary ----------

const countBy = (fn) => {
  const m = {};
  for (const p of kept) { const k = fn(p); m[k] = (m[k] ?? 0) + 1; }
  return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
};
const origin = (p) => {
  const c = p.feeds.some(isChrome);
  const r = p.feeds.some((f) => !isChrome(f));
  return c && r ? 'both' : c ? 'chrome' : 'rss';
};
console.log([
  ...perFile.map((s) => `Input ${s.file}: ${s.lines} lines, ${s.posts} posts${s.commentSets ? `, ${s.commentSets} comment sets` : ''}${s.bad ? `, ${s.bad} unreadable` : ''}`),
  `Merged (distinct ids): ${merged}`,
  `Dropped: ${dropped.filter} by filter, ${dropped.window} outside the window (${months} months, from ${cutoff.toISOString().slice(0, 10)})`,
  `Comment sets attached: ${commentsAttached}${commentsOrphan ? `; ${commentsOrphan} for posts not in the inputs (ignored)` : ''}`,
  `Kept: ${kept.length}`,
  `By sub: ${countBy((p) => p.sub)}`,
  `By source: ${countBy(origin)}`,
  `By kind: ${countBy((p) => p.kind)}`,
  `Output: ${path.resolve(opt.out)}`,
].join('\n'));
