// lib.mjs — helpers shared by the scripts: the sources.json filters, the codebook (themes, labels,
// kind rules, the off-topic and job-ads conventions), the username scrub and the text cap.
// chrome-reddit.js carries a copy of the filter, scrub and kind rules (it runs in a browser tab and
// cannot import); keep the two in step when one changes.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Run directly (for example with --help), it only says what it is.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log('lib.mjs — shared helpers for the reddit-product-ideas scripts (filters, codebook, scrub); not a command.\nThe commands: fetch-reddit.mjs, merge-posts.mjs, batch.mjs, tally.mjs, site-snapshot.mjs, render-report.mjs (each takes --help).');
}

// A filter entry is a regular expression matched on word boundaries, case-insensitive unless it
// starts with "cs:".
export function compileFilter(list = []) {
  return list.map((src) => {
    const cs = src.startsWith('cs:');
    const body = cs ? src.slice(3) : src;
    return { cs, re: new RegExp(`(?<![A-Za-z0-9])(${body})(?![A-Za-z0-9])`, cs ? 'g' : 'gi') };
  });
}

// Returns hits(name, text): the sorted distinct matches of filter `name` in `text`
// (lower-cased unless the entry is case-sensitive).
export function makeHits(filterLists = {}) {
  const filters = Object.fromEntries(Object.entries(filterLists).map(([k, v]) => [k, compileFilter(v)]));
  return function hits(name, text) {
    const found = new Set();
    for (const f of filters[name] ?? []) {
      for (const m of text.matchAll(f.re)) found.add(f.cs ? m[1] : m[1].toLowerCase());
    }
    return [...found].sort();
  };
}

// Every filter in sources.json gives the post a field "<name>Hits" (for example techHits).
export const hitsField = (name) => `${name}Hits`;

// { techHits: [...], placeHits: [...] } for every filter, in the order of sources.json.
export function allHits(filterNames, hits, both) {
  return Object.fromEntries(filterNames.map((n) => [hitsField(n), hits(n, both)]));
}

// True when every filter named in `require` has at least one hit in `both` (title + text).
export function meetsRequire(require, hits, both) {
  return require.every((r) => hits(r, both).length > 0);
}

// What a sitewide search (and a feed label that names no subreddit) must match:
// sources.search_require if set, else every filter in sources.filters.
export const searchRequire = (sources) => sources.search_require ?? Object.keys(sources.filters ?? {});

export function scrubUsers(s) {
  return s
    .replace(/(?:https?:\/\/)?(?:www\.|old\.)?reddit\.com\/(?:u|user)\/[A-Za-z0-9_-]+\/?/gi, 'a user')
    .replace(/(?<![A-Za-z0-9_/])\/?u\/[A-Za-z0-9_-]{2,}/g, 'a user');
}

export const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// ---------- the codebook ----------
//
// codebook.json (in the project's .claude/product-ideas/):
//   themes:      [{ slug, label, counts }]  the tags a post can get; label is what the report shows
//   offTopic:    the slug for posts off the subject (default "off-topic"); never counted
//   jobAds:      { theme, kind }: employers' job ads (default "employer-demand" and "hiring"); the
//                kind's posts are batched apart, the theme is kept out of the question bars; null = none
//   fields:      { origin, role, city, … }: extra fields a tagger fills in, and how
//   kinds:       [{ kind, in: "all" | "title", pattern }]: the kind hint, first match wins; pattern
//                is a regular expression (case-insensitive) on the title, or on title + text
//   defaultKind: the kind when no rule matches (default "other")
//   commentRank: the kinds whose posts get comments, best first (default: question, the other rule
//                kinds in order, then defaultKind; the job-ads kind never)
//   groupBlurbs: optional { S, U, C }: the line under each proposal group in the report
//   gateLabels:  optional { <gate>: "Account gate", … }: how the click test names the site's gates

export const GENERIC_QUESTION = '\\?|^\\s*(how|what|which|is|are|should|can|does|do|any|anyone|need advice)\\b';

export function readCodebook(file) {
  const raw = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const themes = (raw.themes ?? []).filter((t) => t && t.slug);
  const jobAds = raw.jobAds === null ? { theme: null, kind: null } : { theme: raw.jobAds?.theme ?? 'employer-demand', kind: raw.jobAds?.kind ?? 'hiring' };
  const kindRules = (raw.kinds?.length ? raw.kinds : [{ kind: 'question', in: 'title', pattern: GENERIC_QUESTION }])
    .map((k) => ({ kind: k.kind, in: k.in === 'title' ? 'title' : 'all', re: new RegExp(k.pattern, 'i') }));
  const defaultKind = raw.defaultKind ?? 'other';
  const ruleKinds = [...new Set(kindRules.map((k) => k.kind))];
  const commentRank = raw.commentRank ?? [
    ...(ruleKinds.includes('question') ? ['question'] : []),
    ...ruleKinds.filter((k) => k !== 'question' && k !== jobAds.kind),
    ...(ruleKinds.includes(defaultKind) ? [] : [defaultKind]),
  ].filter((k) => k !== jobAds.kind);
  return {
    file: file ?? null,
    themes,
    labels: Object.fromEntries(themes.filter((t) => t.label).map((t) => [t.slug, t.label])),
    offTopic: raw.offTopic ?? 'off-topic',
    jobAds,
    fields: raw.fields ?? {},
    kindRules,
    defaultKind,
    commentRank,
    groupBlurbs: raw.groupBlurbs ?? {},
    gateLabels: raw.gateLabels ?? {},
  };
}

// --codebook if given, else codebook.json next to sources.json if it exists, else none.
export function codebookPath(explicit, sourcesFile) {
  if (explicit) return explicit;
  if (!sourcesFile) return null;
  const sibling = path.join(path.dirname(path.resolve(sourcesFile)), 'codebook.json');
  return fs.existsSync(sibling) ? sibling : null;
}

export function makeKindOf(codebook) {
  return function kindOf(title, text) {
    const all = `${title} ${text}`;
    for (const r of codebook.kindRules) if (r.re.test(r.in === 'title' ? title : all)) return r.kind;
    return codebook.defaultKind;
  };
}
