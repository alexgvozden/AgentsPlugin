#!/usr/bin/env node
// tally.mjs — count the tags so every number in the report comes from a script, not a guess.
//
// Usage:
//   node tally.mjs --posts <posts.jsonl> --tags <tags.jsonl> [--other <other-sources.jsonl>]
//        --out <dir> [--codebook <codebook.json>] [--recent-months 3]
//
// tags.jsonl:          {id, themes:[slug…], kind?, <field>?…, note?}  (one per post)
// other-sources.jsonl: {id (url), source, url, date, title, themes, kind?, <field>?…}
// The fields counted are the codebook's "fields" (default role, city, origin). Themes [] or
// [<the codebook's offTopic slug, default "off-topic">] count as tagged but are left out of the
// shares. Other sources are counted in a column of their own, never merged with the Reddit counts.
// "Recent" means the last --recent-months before the newest post in posts.jsonl (so a rerun on
// the same data gives the same numbers); each period's per-month rate is shown so trends are fair.
// Writes <out>/tally.md and <out>/tally.json.

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { readCodebook } from './lib.mjs';

const HELP = `tally.mjs — counts per theme and per field (role, city, origin, …)

  --posts <file>          posts.jsonl from fetch-reddit.mjs
  --tags <file>           tags.jsonl (one line per tagged post)
  --other <file>          optional other-sources.jsonl (non-Reddit evidence)
  --out <dir>             output folder (tally.md, tally.json)
  --codebook <file>       codebook.json (the off-topic slug and the fields to count;
                          default off-topic and role, city, origin)
  --recent-months <n>     length of the "recent" period (default 3)
  -h, --help              this help`;

const { values: opt } = parseArgs({
  options: {
    posts: { type: 'string' },
    tags: { type: 'string' },
    other: { type: 'string' },
    out: { type: 'string' },
    codebook: { type: 'string' },
    'recent-months': { type: 'string', default: '3' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (opt.help || !opt.posts || !opt.tags || !opt.out) {
  console.log(HELP);
  process.exit(opt.help ? 0 : 1);
}

const DAY = 86400000;
const MONTH_DAYS = 30.44;
const recentMonths = Number(opt['recent-months']);
const codebook = readCodebook(opt.codebook);
const fieldNames = Object.keys(codebook.fields).length ? Object.keys(codebook.fields) : ['role', 'city', 'origin'];
// The usual fields keep their plural names in tally.json (roles, cities, origins).
const PLURAL = { role: 'roles', city: 'cities', origin: 'origins', country: 'countries' };
const plural = (f) => PLURAL[f] ?? `${f}s`;
const title = (f) => plural(f).charAt(0).toUpperCase() + plural(f).slice(1);

function readJsonl(file, label) {
  const out = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try { out.push(JSON.parse(line)); } catch (err) { console.warn(`warn: ${label} line ${i + 1} is not JSON (${err.message})`); }
  });
  return out;
}

const posts = readJsonl(opt.posts, 'posts');
const postById = new Map(posts.map((p) => [p.id, p]));
const tagLines = readJsonl(opt.tags, 'tags');
const others = opt.other ? readJsonl(opt.other, 'other') : [];

const tags = new Map();
const unknown = [];
for (const t of tagLines) {
  if (!t.id) { console.warn('warn: tag line without id'); continue; }
  if (!postById.has(t.id)) { unknown.push(t.id); continue; }
  if (tags.has(t.id)) console.warn(`warn: ${t.id} tagged twice; the later line wins`);
  tags.set(t.id, t);
}
if (unknown.length) console.warn(`warn: ${unknown.length} tag ids not in posts: ${unknown.slice(0, 20).join(', ')}${unknown.length > 20 ? ' …' : ''}`);

const cleanThemes = (themes) => [...new Set((Array.isArray(themes) ? themes : []).map((s) => String(s).trim()).filter((s) => s && s !== codebook.offTopic))];

// Rows: one per tagged Reddit post.
const rows = [];
for (const [id, t] of tags) {
  const p = postById.get(id);
  rows.push({
    id, sub: p.sub, url: p.url, title: p.title, date: (p.published ?? '').slice(0, 10), time: Date.parse(p.published),
    kind: t.kind ?? p.kind, themes: cleanThemes(t.themes), ...Object.fromEntries(fieldNames.map((f) => [f, t[f]])),
  });
}
const onTopic = rows.filter((r) => r.themes.length);
const otherRows = others.map((o) => ({ ...o, themes: cleanThemes(o.themes) }));

// Periods: from the oldest post in the file to the newest; "recent" = the last N months of it.
const times = posts.map((p) => Date.parse(p.published)).filter((t) => !Number.isNaN(t));
const newest = times.length ? Math.max(...times) : Date.now();
const oldest = times.length ? Math.min(...times) : Date.now();
const cutoff = newest - recentMonths * MONTH_DAYS * DAY;
const recentSpanMonths = Math.min(recentMonths, (newest - oldest) / DAY / MONTH_DAYS);
const earlierSpanMonths = Math.max(0, (cutoff - oldest) / DAY / MONTH_DAYS);
const rate = (n, months) => (months >= 0.5 ? Math.round((n / months) * 10) / 10 : null);

const byName = (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
function countBy(list, fn) {
  const m = new Map();
  for (const x of list) for (const k of [].concat(fn(x) ?? [])) if (k != null && k !== '') m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort(byName);
}
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

function stats(matching, otherCount) {
  const recent = matching.filter((r) => r.time >= cutoff).length;
  const earlier = matching.length - recent;
  return {
    count: matching.length,
    share: pct(matching.length, onTopic.length),
    recent, recentPerMonth: rate(recent, recentSpanMonths),
    earlier, earlierPerMonth: rate(earlier, earlierSpanMonths),
    other: otherCount,
  };
}

// Themes
const themeNames = new Set([...onTopic.flatMap((r) => r.themes), ...otherRows.flatMap((o) => o.themes)]);
const themes = [...themeNames].map((name) => {
  const matching = onTopic.filter((r) => r.themes.includes(name));
  const examples = [...matching]
    .sort((a, b) => (a.kind === 'question' ? 0 : 1) - (b.kind === 'question' ? 0 : 1) || b.time - a.time || (a.id < b.id ? -1 : 1))
    .slice(0, 5)
    .map((r) => ({ id: r.id, title: r.title, date: r.date, url: r.url, kind: r.kind }));
  return {
    theme: name,
    ...stats(matching, otherRows.filter((o) => o.themes.includes(name)).length),
    bySub: countBy(matching, (r) => r.sub).slice(0, 3),
    byKind: countBy(matching, (r) => r.kind),
    examples,
  };
}).sort((a, b) => b.count - a.count || b.other - a.other || (a.theme < b.theme ? -1 : 1));

// Each field (role, city, origin, …): grouped case-insensitively, shown with the most common spelling.
function dimension(field) {
  const groups = new Map();
  const add = (val, isOther, row) => {
    if (val == null || String(val).trim() === '') return;
    const v = String(val).trim();
    const key = v.toLowerCase();
    if (!groups.has(key)) groups.set(key, { spellings: new Map(), rows: [], other: 0 });
    const g = groups.get(key);
    g.spellings.set(v, (g.spellings.get(v) ?? 0) + 1);
    if (isOther) g.other++; else g.rows.push(row);
  };
  for (const r of onTopic) add(r[field], false, r);
  for (const o of otherRows) if (o.themes.length) add(o[field], true, o);
  return [...groups.values()].map((g) => ({
    value: [...g.spellings.entries()].sort(byName)[0][0],
    ...stats(g.rows, g.other),
  })).sort((a, b) => b.count - a.count || b.other - a.other || (a.value < b.value ? -1 : 1));
}
const dims = fieldNames.map((f) => ({ field: f, title: title(f), values: dimension(f) }));

const untagged = posts.filter((p) => !tags.has(p.id)).map((p) => p.id);
const dates = rows.map((r) => r.date).filter(Boolean).sort();
const totals = {
  postsInFile: posts.length,
  tagged: rows.length,
  untagged: untagged.length,
  untaggedIds: untagged.slice(0, 20),
  unknownTagIds: unknown,
  onTopic: onTopic.length,
  offTopic: rows.length - onTopic.length,
  otherSources: otherRows.length,
  bySub: countBy(onTopic, (r) => r.sub),
  byKind: countBy(onTopic, (r) => r.kind),
  dateSpan: dates.length ? [dates[0], dates.at(-1)] : null,
  recentFrom: new Date(cutoff).toISOString().slice(0, 10),
  recentMonths: Math.round(recentSpanMonths * 10) / 10,
  earlierMonths: Math.round(earlierSpanMonths * 10) / 10,
};

fs.mkdirSync(path.resolve(opt.out), { recursive: true });
fs.writeFileSync(path.join(opt.out, 'tally.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(), totals, themes,
  ...Object.fromEntries(dims.map((d) => [plural(d.field), d.values])),
  fields: dims.map((d) => ({ field: d.field, key: plural(d.field), title: d.title })),
}, null, 2)}\n`);

// ---------- markdown ----------

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const pairs = (list) => list.map(([k, v]) => `${k} ${v}`).join(', ');
const r1 = (x) => (x == null ? '–' : String(x));

const md = [
  '# Tally',
  '',
  `Posts in file: ${totals.postsInFile}; tagged: ${totals.tagged}; untagged: ${totals.untagged}${untagged.length ? ` (${totals.untaggedIds.join(', ')}${untagged.length > 20 ? ' …' : ''})` : ''}; on-topic: ${totals.onTopic}; off-topic: ${totals.offTopic}.`,
  unknown.length ? `Tag ids not in posts (ignored): ${unknown.length}.` : '',
  `Other sources (separate column, not in the Reddit counts): ${totals.otherSources}.`,
  `On-topic by sub: ${pairs(totals.bySub) || '–'}`,
  `On-topic by kind: ${pairs(totals.byKind) || '–'}`,
  `Date span (tagged): ${totals.dateSpan ? `${totals.dateSpan[0]} to ${totals.dateSpan[1]}` : '–'}. Recent = from ${totals.recentFrom} (${totals.recentMonths} months); earlier = ${totals.earlierMonths} months before that. Shares are of on-topic posts.`,
  '',
  '## Themes',
  '',
  '| theme | posts | share % | recent | /month | earlier | /month | other sources | top subs | kinds |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
  ...themes.map((t) => `| ${cell(t.theme)} | ${t.count} | ${t.share} | ${t.recent} | ${r1(t.recentPerMonth)} | ${t.earlier} | ${r1(t.earlierPerMonth)} | ${t.other} | ${cell(pairs(t.bySub))} | ${cell(pairs(t.byKind))} |`),
  '',
  '### Examples per theme',
  '',
  ...themes.filter((t) => t.examples.length).flatMap((t) => [
    `**${t.theme}**`,
    ...t.examples.map((e) => `- ${e.date} · ${e.kind} · [${cell(e.title)}](${e.url})`),
    '',
  ]),
];
for (const { title: heading, values: list } of dims) {
  md.push(`## ${heading}`, '');
  if (!list.length) { md.push('None tagged.', ''); continue; }
  md.push('| value | posts | share % | recent | /month | earlier | /month | other sources |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  md.push(...list.map((d) => `| ${cell(d.value)} | ${d.count} | ${d.share} | ${d.recent} | ${r1(d.recentPerMonth)} | ${d.earlier} | ${r1(d.earlierPerMonth)} | ${d.other} |`), '');
}
md.push('A "/month" of – means the period is shorter than half a month, too short for a rate.');
fs.writeFileSync(path.join(opt.out, 'tally.md'), `${md.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')}\n`);

console.log(`posts ${totals.postsInFile}, tagged ${totals.tagged}, untagged ${totals.untagged}, on-topic ${totals.onTopic}, themes ${themes.length}, ${dims.map((d) => `${plural(d.field)} ${d.values.length}`).join(', ')}, other sources ${totals.otherSources}`);
console.log(`Wrote ${path.join(path.resolve(opt.out), 'tally.md')} and tally.json`);
