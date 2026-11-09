#!/usr/bin/env node
// render-report.mjs — turn report.json (+ tally.json) into ONE self-contained, interactive HTML
// slide presentation (report.html): no external requests, works opened from disk.
//
// Usage:
//   node render-report.mjs --report RUN/report.json --tally RUN/tally.json --out RUN/report.html
//        [--codebook .claude/product-ideas/codebook.json] [--posts RAW/posts.jsonl]
//        [--other RUN/other-sources.jsonl] [--lang en-GB] [--strict]
//
// Theme names come from report.themeLabels, then the codebook's labels, then the slug itself.
// The codebook's off-topic and job-ads themes are kept out of the question bars.
//
// Every string from the JSON is HTML-escaped; only http(s) URLs become links. The checks below
// print warnings; with --strict any warning makes the script exit 1 (the file is still written).

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { readCodebook } from './lib.mjs';

const HELP = `render-report.mjs — report.json + tally.json → one interactive HTML presentation

  --report <file>   report.json (the contract is in SKILL.md)
  --tally <file>    tally.json from tally.mjs
  --out <file>      the HTML file to write (e.g. RUN/report.html)
  --codebook <file> codebook.json: theme labels, the off-topic and job-ads themes
  --posts <file>    optional posts.jsonl: every example link must be found in it (or in --other)
  --other <file>    optional other-sources.jsonl: links found here count as well
  --lang <tag>      language of the page and its number format (default en-GB)
  --strict          exit 1 when there is any warning
  -h, --help        this help

Checks (warnings): proposal ids (form, duplicates, S/U/C numbering in order, at most 7 a group);
level against the counts (strong 15+ posts from 2+ places, medium 6–14, weak 3–5); with one
evidence theme, count/share/onTopic against tally.json; with --posts/--other, links not found
there; quotes over 20 words; usernames (u/…, /user/…) and @handles; click-test screenshots
missing next to the report.`;

const { values: opt } = parseArgs({
  options: {
    report: { type: 'string' },
    tally: { type: 'string' },
    out: { type: 'string' },
    codebook: { type: 'string' },
    posts: { type: 'string' },
    other: { type: 'string' },
    lang: { type: 'string', default: 'en-GB' },
    strict: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (opt.help || !opt.report || !opt.tally || !opt.out) {
  console.log(HELP);
  process.exit(opt.help ? 0 : 1);
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`error: cannot read ${label} ${file} (${err.message})`);
    process.exit(1);
  }
}
function readJsonl(file, label) {
  const out = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try { out.push(JSON.parse(line)); } catch (err) { console.warn(`warn: ${label} line ${i + 1} is not JSON (${err.message})`); }
  });
  return out;
}

const report = readJson(opt.report, 'report');
const tally = readJson(opt.tally, 'tally');
const codebook = readCodebook(opt.codebook);
const LANG = opt.lang;
const reportDir = path.dirname(path.resolve(opt.report));
const totals = tally.totals ?? {};
const tallyThemes = Array.isArray(tally.themes) ? tally.themes : [];
const themeBySlug = new Map(tallyThemes.map((t) => [t.theme, t]));
const GROUPS = [
  { key: 'S', name: 'Strategic', slide: 'group-S', blurb: report.groupBlurbs?.S ?? codebook.groupBlurbs.S ?? 'New features, content areas and audiences.' },
  { key: 'U', name: 'UX/UI', slide: 'group-U', blurb: report.groupBlurbs?.U ?? codebook.groupBlurbs.U ?? 'Things people need that the site has but hides or orders badly.' },
  { key: 'C', name: 'Content', slide: 'group-C', blurb: report.groupBlurbs?.C ?? codebook.groupBlurbs.C ?? 'Answers, FAQ, missing facts and wording; no change of flow.' },
];
const groups = report.groups ?? {};
const proposals = GROUPS.flatMap((g) => (Array.isArray(groups[g.key]) ? groups[g.key] : []).map((p) => ({ ...p, group: g.key })));

// ---------------------------------------------------------------- checks

const warnings = [];
const warn = (msg) => warnings.push(msg);

// ids, numbering, group size
{
  const keys = Object.keys(groups);
  const expected = GROUPS.map((g) => g.key).filter((k) => keys.includes(k));
  if (keys.some((k) => !GROUPS.some((g) => g.key === k))) warn(`groups: unknown group key(s) ${keys.filter((k) => !'SUC'.includes(k) || k.length !== 1).join(', ')} (only S, U, C)`);
  else if (keys.join() !== expected.join()) warn(`groups: not in the order S, U, C (found ${keys.join(', ')})`);
  const seen = new Set();
  for (const g of GROUPS) {
    const list = Array.isArray(groups[g.key]) ? groups[g.key] : [];
    if (groups[g.key] != null && !Array.isArray(groups[g.key])) warn(`groups.${g.key}: not a list`);
    if (list.length > 7) warn(`groups.${g.key}: ${list.length} proposals (at most 7)`);
    list.forEach((p, i) => {
      const id = p?.id;
      if (typeof id !== 'string' || !/^[SUC][1-9][0-9]*$/.test(id)) warn(`groups.${g.key}[${i}]: badly formed id ${JSON.stringify(id)}`);
      else if (id[0] !== g.key) warn(`${id}: sits in group ${g.key}`);
      else if (id !== `${g.key}${i + 1}`) warn(`${id}: out of order (expected ${g.key}${i + 1} at this place)`);
      if (seen.has(id)) warn(`${id}: duplicate id`);
      seen.add(id);
      if (!p?.title) warn(`${id ?? `groups.${g.key}[${i}]`}: no title`);
    });
  }
}

// evidence levels and the tally
const expectedLevel = (count, places) => (count >= 15 && places >= 2 ? 'strong' : count >= 6 ? 'medium' : count >= 3 ? 'weak' : null);
for (const p of proposals) {
  const ev = p.evidence ?? {};
  const count = Number(ev.count);
  const places = Array.isArray(ev.places) ? ev.places.length : 0;
  if (!['strong', 'medium', 'weak'].includes(p.level)) warn(`${p.id}: level ${JSON.stringify(p.level)} is not strong, medium or weak`);
  if (!Number.isFinite(count)) warn(`${p.id}: evidence.count missing`);
  else {
    const want = expectedLevel(count, places);
    if (want == null) warn(`${p.id}: ${count} posts is fewer than 3; it belongs in Weak signals`);
    else if (p.level !== want) warn(`${p.id}: level "${p.level}" but ${count} posts from ${places} place(s) is "${want}"`);
  }
  if (ev.onTopic != null && totals.onTopic != null && Number(ev.onTopic) !== totals.onTopic) warn(`${p.id}: onTopic ${ev.onTopic} ≠ tally totals.onTopic ${totals.onTopic}`);
  const themes = Array.isArray(ev.themes) ? ev.themes : [];
  for (const t of themes) if (!themeBySlug.has(t)) warn(`${p.id}: theme "${t}" is not in tally.json`);
  if (themes.length === 1 && themeBySlug.has(themes[0])) {
    const t = themeBySlug.get(themes[0]);
    if (Number(ev.count) !== t.count) warn(`${p.id}: count ${ev.count} ≠ tally ${t.theme} count ${t.count}`);
    if (ev.share != null && Number(ev.share) !== t.share) warn(`${p.id}: share ${ev.share} ≠ tally ${t.theme} share ${t.share}`);
    if (ev.recentPerMonth != null && Number(ev.recentPerMonth) !== t.recentPerMonth) warn(`${p.id}: recentPerMonth ${ev.recentPerMonth} ≠ tally ${t.recentPerMonth}`);
    if (ev.earlierPerMonth != null && Number(ev.earlierPerMonth) !== t.earlierPerMonth) warn(`${p.id}: earlierPerMonth ${ev.earlierPerMonth} ≠ tally ${t.earlierPerMonth}`);
  }
  if (Array.isArray(p.examples) && p.examples.length > 3) warn(`${p.id}: ${p.examples.length} examples (up to 3)`);
  if (p.effort != null && !['S', 'M', 'L'].includes(p.effort)) warn(`${p.id}: effort ${JSON.stringify(p.effort)} is not S, M or L`);
}
for (const id of report.summary?.first ?? []) if (!proposals.some((p) => p.id === id)) warn(`summary.first: ${id} is not a proposal`);

// links against posts.jsonl / other-sources.jsonl
function normUrl(u) {
  try {
    const x = new URL(String(u).trim());
    let host = x.hostname.toLowerCase();
    if (/(^|\.)reddit\.com$/.test(host)) host = 'reddit.com';
    else host = host.replace(/^www\./, '');
    return `${host}${decodeURIComponent(x.pathname).replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return String(u).trim().replace(/\/+$/, '').toLowerCase();
  }
}
const allLinks = [];
proposals.forEach((p) => (p.examples ?? []).forEach((l) => allLinks.push([`${p.id} example`, l])));
(report.weak ?? []).forEach((w, i) => (w.links ?? []).forEach((l) => allLinks.push([`weak[${i}]`, l])));
Object.entries(report.ask?.examples ?? {}).forEach(([k, l]) => allLinks.push([`ask.examples.${k}`, l]));
if (opt.posts || opt.other) {
  const known = new Set();
  if (opt.posts) for (const p of readJsonl(opt.posts, 'posts')) if (p.url) known.add(normUrl(p.url));
  if (opt.other) for (const o of readJsonl(opt.other, 'other')) for (const u of [o.url, o.id]) if (u) known.add(normUrl(u));
  for (const [where, l] of allLinks) if (l?.url && !known.has(normUrl(l.url))) warn(`${where}: link not in posts/other sources: ${l.url}`);
}
for (const [where, l] of allLinks) if (l?.url && !safeUrl(l.url)) warn(`${where}: not an http(s) link, shown as text: ${l.url}`);

// quotes, usernames, handles (every string of the report)
function walk(v, at, fn) {
  if (typeof v === 'string') fn(v, at);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`, fn));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k, fn);
}
walk(report, '', (s, at) => {
  const isUrl = /(^|\.)(url|shot)$/.test(at);
  const text = s.replace(/`[^`]*`/g, ' ');
  if (!isUrl) {
    for (const m of text.matchAll(/“([^”]*)”|"([^"]*)"/g)) {
      const words = (m[1] ?? m[2]).trim().split(/\s+/).filter(Boolean).length;
      if (words > 20) warn(`${at}: quote of ${words} words (20 at most)`);
    }
  }
  const user = text.match(/(?<![A-Za-z0-9_])u\/[A-Za-z0-9_-]{2,}/) ?? text.match(/\/user\/[A-Za-z0-9_-]+/i);
  if (user) warn(`${at}: looks like a username (${user[0]})`);
  if (!isUrl) {
    for (const m of text.matchAll(/(?<![\w.@])@(\w[\w.]{1,})/g)) {
      if (text[m.index + m[0].length] === '/') continue; // a package scope such as @types/node
      warn(`${at}: looks like a handle (${m[0]})`);
      break;
    }
  }
});

// click-test screenshots
(report.clickTest ?? []).forEach((c, i) => {
  if (c?.shot && !fs.existsSync(path.resolve(reportDir, c.shot))) warn(`clickTest[${i}]: screenshot ${c.shot} not found next to the report`);
});

// ---------------------------------------------------------------- formatting helpers

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function safeUrl(u) {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u.trim())) return null;
  try { const x = new URL(u.trim()); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; }
}
const extLink = (url, inner) => {
  const ok = safeUrl(url);
  return ok ? `<a href="${esc(ok)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
};
// The inline subset: `code`, **bold**, [text](https://…). Everything else is plain text.
function inline(s) {
  const str = String(s ?? '');
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let out = '';
  let last = 0;
  for (const m of str.matchAll(re)) {
    out += esc(str.slice(last, m.index));
    if (m[1] != null) out += `<code>${esc(m[1])}</code>`;
    else if (m[2] != null) out += `<strong>${esc(m[2])}</strong>`;
    else out += safeUrl(m[4]) ? extLink(m[4], esc(m[3])) : esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(str.slice(last));
}
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m || +m[2] < 1 || +m[2] > 12) return esc(iso ?? '');
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}
const num = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? '–' : Number(n).toLocaleString(LANG));
const plural = (n, one, many) => `${num(n)} ${Number(n) === 1 ? one : many}`;
const domId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '-');

function label(slug) {
  if (report.themeLabels?.[slug]) return String(report.themeLabels[slug]);
  if (codebook.labels[slug]) return String(codebook.labels[slug]);
  const s = String(slug).replace(/^new-/, '').replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function trend(t) {
  const r = t?.recentPerMonth;
  const e = t?.earlierPerMonth;
  if (r == null || e == null) return { mark: '–', word: 'no trend', long: 'Too short a period for a trend' };
  const long = `${num(r)} a month in the recent period against ${num(e)} before`;
  if (e === 0 ? r > 0 : r / e >= 1.25) return { mark: '↑', word: 'rising', long };
  if (r / e <= 0.8) return { mark: '↓', word: 'falling', long };
  return { mark: '→', word: 'steady', long };
}
const LEVEL = { strong: 'Strong evidence', medium: 'Medium evidence', weak: 'Weak evidence' };
const EFFORT = { S: 'Small', M: 'Medium', L: 'Large' };
const levelBadge = (lv) => {
  const n = { strong: 3, medium: 2, weak: 1 }[lv] ?? 0;
  return `<span class="badge level level-${esc(lv)}"><span class="dots" aria-hidden="true">${'●'.repeat(n)}${'○'.repeat(3 - n)}</span>${esc(LEVEL[lv] ?? lv ?? 'No level')}</span>`;
};
const srcLink = (l) => {
  if (!l) return '';
  const meta = [l.source, l.date ? fmtDate(l.date) : null].filter(Boolean);
  return `${extLink(l.url, esc(l.title || l.url || 'Link'))}${meta.length ? ` <span class="meta">${meta.map((x, i) => (i === meta.length - 1 && l.date ? x : esc(x))).join(' · ')}</span>` : ''}`;
};
const recentMonths = totals.recentMonths ?? 3;

// ---------------------------------------------------------------- slides

const slides = [];
const add = (id, tab, title, html, cls = '') => slides.push({ id, tab, title, html, cls });

// 1. Summary
{
  const s = report.summary ?? {};
  const w = report.window ?? {};
  const firsts = (s.first ?? []).map((id) => proposals.find((p) => p.id === id)).filter(Boolean);
  add('summary', 'summary', 'Summary', `
    ${report.example ? '<p class="example-flag">Example data: made up to show the layout</p>' : ''}
    <p class="kicker">Research report · ${fmtDate(report.date)}</p>
    <h1>${inline(report.title ?? 'What people ask')}</h1>
    <p class="lede">Window: ${fmtDate(w.from)} to ${fmtDate(w.to)}${w.months ? ` (${plural(w.months, 'month', 'months')})` : ''}${(report.focus ?? []).length ? ` · Focus: ${(report.focus).map((f) => `<span class="chip">${esc(f)}</span>`).join(' ')}` : ''}</p>
    <div class="tiles">
      <div class="tile"><span class="tile-label">Posts found</span><span class="tile-value">${num(totals.postsInFile)}</span></div>
      <div class="tile"><span class="tile-label">On-topic posts</span><span class="tile-value">${num(totals.onTopic)}</span></div>
      <div class="tile"><span class="tile-label">Threads from other sites</span><span class="tile-value">${num(totals.otherSources)}</span></div>
    </div>
    ${(s.lines ?? []).map((l) => `<p>${inline(l)}</p>`).join('')}
    <div class="cols">
      <section><h2>Biggest findings</h2><ol class="findings">${(s.findings ?? []).map((f) => `<li>${inline(f)}</li>`).join('')}</ol></section>
      <section><h2>Do first</h2><ul class="first">${firsts.map((p) => `<li><a href="#${esc(p.id)}"><span class="pid">${esc(p.id)}</span> ${inline(p.title)}</a></li>`).join('') || '<li class="muted">None named</li>'}</ul></section>
    </div>`);
}

// 2. What people ask
{
  const top = Number(report.ask?.top) || 10;
  const asked = tallyThemes.filter((t) => t.theme !== codebook.jobAds.theme && t.theme !== codebook.offTopic);
  const shown = asked.slice(0, top);
  const jobAds = codebook.jobAds.theme ? themeBySlug.get(codebook.jobAds.theme) : null;
  const max = Math.max(1, ...shown.map((t) => t.count));
  const rows = shown.map((t, i) => {
    const tr = trend(t);
    const tip = `${label(t.theme)}: ${plural(t.count, 'post', 'posts')}, ${num(t.share)}% of on-topic; ${tr.long}; ${plural(t.other ?? 0, 'thread', 'threads')} from other sites`;
    return `<li><button type="button" class="bar-row" data-theme="${esc(domId(t.theme))}" aria-controls="theme-${esc(domId(t.theme))}" aria-expanded="${i === 0}" data-tip="${esc(tip)}" aria-label="${esc(tip)}. Show examples">
      <span class="bar-label">${esc(label(t.theme))}</span>
      <span class="bar-track"><span class="bar" style="width:${Math.max(1, Math.round((t.count / max) * 82))}%"></span><span class="bar-value">${num(t.count)}</span></span>
      <span class="bar-share">${num(t.share)}%</span>
      <span class="bar-trend"><span aria-hidden="true">${tr.mark}</span> ${tr.word}</span>
      <span class="bar-other">${t.other ? `+${num(t.other)} other ${t.other === 1 ? 'site' : 'sites'}` : ''}</span>
    </button></li>`;
  }).join('');
  const panels = shown.map((t, i) => {
    const tr = trend(t);
    const note = report.ask?.notes?.[t.theme];
    const pick = report.ask?.examples?.[t.theme];
    return `<div class="theme-panel" id="theme-${esc(domId(t.theme))}" ${i === 0 ? '' : 'hidden'}>
      <h3>${esc(label(t.theme))}</h3>
      <p>${plural(t.count, 'post', 'posts')}, ${num(t.share)}% of on-topic posts. ${esc(tr.long)} (${tr.word}). ${t.other ? `${plural(t.other, 'thread', 'threads')} from other sites, counted apart.` : ''}</p>
      ${(t.bySub ?? []).length ? `<p class="muted">Most from ${t.bySub.map(([k, v]) => `${esc(/[/.]/.test(k) ? k : 'r/' + k)} (${num(v)})`).join(', ')}</p>` : ''}
      ${note ? `<p>${inline(note)}</p>` : ''}
      ${pick ? `<p><strong>Example:</strong> ${srcLink(pick)}</p>` : ''}
      ${(t.examples ?? []).length ? `<ul class="links">${t.examples.map((e) => `<li>${extLink(e.url, esc(e.title))} <span class="meta">${fmtDate(e.date)}${e.kind ? ` · ${esc(e.kind)}` : ''}</span></li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');
  // The fields tally.json lists (role, city, origin, …); an older tally without "fields" has the three.
  const dimList = Array.isArray(tally.fields) && tally.fields.length
    ? tally.fields.filter((f) => f && f.key)
    : [{ key: 'roles', title: 'Roles' }, { key: 'cities', title: 'Cities' }, { key: 'origins', title: 'Origins' }].filter((d) => tally[d.key]);
  const dim = (title, list) => {
    const items = (list ?? []).slice(0, 8);
    const m = Math.max(1, ...items.map((d) => d.count));
    return `<section class="dim"><h3>${title}</h3>${items.length ? `<ul>${items.map((d) => `<li><span class="dim-name">${esc(d.value)}</span><span class="dim-track"><span class="dim-bar" style="width:${Math.max(2, Math.round((d.count / m) * 100))}%"></span></span><span class="dim-value">${num(d.count)}${d.other ? ` <span class="muted">+${num(d.other)}</span>` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">None tagged</p>'}</section>`;
  };
  add('ask', 'ask', 'What people ask', `
    <h2 class="slide-title">What people ask</h2>
    <p class="lede">The top ${num(shown.length)} themes among ${num(totals.onTopic)} on-topic posts. Bars are post counts; the share is of on-topic posts; the trend compares the last ${num(recentMonths)} months with the months before, per month. Threads from other sites (${num(totals.otherSources)} in all) are counted apart. Choose a theme to see its examples.</p>
    <div class="ask-grid">
      <ol class="bars" aria-label="Themes by number of posts">${rows}</ol>
      <div class="theme-panels" aria-live="polite">${panels}</div>
    </div>
    ${jobAds ? `<p class="muted">Job ads are kept apart from questions: ${plural(jobAds.count, 'post', 'posts')} tagged as ${esc(String(codebook.jobAds.theme).replace(/-/g, ' '))}${(tally.jobAds?.roles ?? []).length ? `; most for ${tally.jobAds.roles.slice(0, 5).map((d) => `${esc(d.value)} (${num(d.count)})`).join(', ')}` : ''}.</p>` : ''}
    ${totals.duplicates ? `<p class="muted small">${plural(totals.duplicates, 'copy', 'copies')} of the same post (cross-posts and reposts) are counted once.</p>` : ''}
    <div class="dims">${dimList.map((d) => dim(esc(d.title), tally[d.key])).join('')}</div>
    <p class="muted small">Counts from tally.json; a grey “+n” is threads from other sites.</p>`);
}

// 3. Click test
{
  const list = report.clickTest ?? [];
  const gateName = (g) => String(report.gateLabels?.[g] ?? codebook.gateLabels[g] ?? `${String(g).charAt(0).toUpperCase()}${String(g).slice(1)} gate`);
  const cards = list.map((c, i) => {
    const shotOk = c.shot && /^[^:]+$/.test(c.shot) && fs.existsSync(path.resolve(reportDir, c.shot));
    const shot = shotOk
      ? `<button type="button" class="shot-btn" data-src="${esc(c.shot.replace(/\\/g, '/'))}" aria-label="Enlarge the screenshot for question ${i + 1}"><img class="shot" src="${esc(c.shot.replace(/\\/g, '/'))}" alt="Phone screenshot: where question ${i + 1} ended" loading="lazy"></button>`
      : `<div class="shot-missing">${c.shot ? 'Screenshot not found' : 'No screenshot'}</div>`;
    return `<article class="card click-card">
      <h3>“${esc(c.question)}”</h3>
      <dl class="facts">
        <div><dt>Clicks</dt><dd>${c.clicks == null ? '–' : num(c.clicks)}${Number(c.clicks) >= 6 ? ' (stopped)' : ''}</dd></div>
        <div><dt>Answer reached</dt><dd>${c.reached ? '<span aria-hidden="true">✓</span> Yes' : '<span aria-hidden="true">✗</span> No'}</dd></div>
        <div><dt>Gate</dt><dd>${c.gate ? esc(gateName(c.gate)) : 'None'}</dd></div>
      </dl>
      ${(c.path ?? []).length ? `<p class="path">${c.path.map((p) => `<span>${esc(p)}</span>`).join('<span class="sep" aria-hidden="true"> › </span>')}</p>` : ''}
      ${c.stuck ? `<p><strong>Stuck:</strong> ${inline(c.stuck)}</p>` : ''}
      ${shot}
    </article>`;
  }).join('');
  add('clicks', 'clicks', 'Phone click test', `
    <h2 class="slide-title">Phone click test</h2>
    <p class="lede">The most asked questions, tried as a signed-out visitor on a 390 × 844 phone, from the home page, without search or typed URLs (stopping at 6 clicks).</p>
    ${list.length ? `<div class="cards">${cards}</div>` : '<p class="muted">The click test was not run this time.</p>'}`);
}

// 4. Groups and proposals
for (const g of GROUPS) {
  const list = proposals.filter((p) => p.group === g.key);
  add(g.slide, g.key, g.name, `
    <p class="kicker">Group ${g.key}</p>
    <h2 class="slide-title big">${g.name}</h2>
    <p class="lede">${g.blurb}</p>
    ${list.length ? `<ol class="plist">${list.map((p) => `<li><a href="#${esc(p.id)}"><span class="pid">${esc(p.id)}</span><span class="ptitle">${inline(p.title)}</span></a>${levelBadge(p.level)}<span class="badge">Effort: ${esc(EFFORT[p.effort] ?? p.effort ?? '–')}</span><span class="pick-state" data-id="${esc(p.id)}"></span></li>`).join('')}</ol>` : '<p class="muted">No proposals in this group.</p>'}`, 'divider');
  for (const p of list) {
    const ev = p.evidence ?? {};
    const tr = trend(ev);
    const evLine = [
      `${plural(ev.count, 'post', 'posts')}${ev.onTopic != null ? ` of ${num(ev.onTopic)} on-topic` : ''}${ev.share != null ? ` (${num(ev.share)}%)` : ''}`,
      ev.recentPerMonth != null && ev.earlierPerMonth != null ? `${num(ev.recentPerMonth)} a month in the last ${num(recentMonths)} months against ${num(ev.earlierPerMonth)} before <span class="trendmark">(<span aria-hidden="true">${tr.mark}</span> ${tr.word})</span>` : null,
      (ev.places ?? []).length ? esc(ev.places.join(', ')) : null,
    ].filter(Boolean).join(' · ');
    const field = (name, body) => (body ? `<section class="field"><h3>${name}</h3>${body}</section>` : '');
    add(p.id, g.key, `${p.id} · ${p.title ?? ''}`, `
      <header class="phead">
        <p class="kicker">${g.name} · ${esc(p.id)}</p>
        <h2 class="slide-title">${inline(p.title)}</h2>
        <p class="badges">${levelBadge(p.level)}<span class="badge">Effort: ${esc(EFFORT[p.effort] ?? p.effort ?? '–')}</span>${(ev.themes ?? []).map((t) => `<span class="chip">${esc(label(t))}</span>`).join('')}</p>
      </header>
      <div class="evidence">
        <p class="evline">${evLine}</p>
        ${(ev.search ?? []).length ? `<p class="small">Search demand: ${ev.search.map((s) => `${num(s.volume)} a month for “${esc(s.phrase)}” <span class="meta">(${esc(s.source)})</span>`).join('; ')}</p>` : ''}
        ${ev.note ? `<p class="small">${inline(ev.note)}</p>` : ''}
        ${(p.examples ?? []).length ? `<ul class="links">${p.examples.map((l) => `<li>${srcLink(l)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="fields">
        ${field('The site today', p.today ? `<p>${inline(p.today)}</p>` : '')}
        ${g.key === 'S' ? field('Why it fits', p.fits ? `<p>${inline(p.fits)}</p>` : '') : ''}
        ${field('Proposal', p.proposal ? `<p>${inline(p.proposal)}</p>` : '')}
        ${field('Where', (p.where ?? []).length ? `<ul class="where">${p.where.map((w) => `<li><code>${esc(w)}</code></li>`).join('')}</ul>` : '')}
        ${field('Already planned', `<p>${p.planned ? inline(p.planned) : 'No'}</p>`)}
      </div>
      <div class="picks" role="group" aria-label="Your pick for ${esc(p.id)}">
        <button type="button" class="pick" data-id="${esc(p.id)}" data-choice="do" aria-pressed="false">Do it</button>
        <button type="button" class="pick" data-id="${esc(p.id)}" data-choice="later" aria-pressed="false">Later</button>
        <button type="button" class="pick" data-id="${esc(p.id)}" data-choice="no" aria-pressed="false">No</button>
      </div>`, 'proposal');
  }
}

// 5. Covered, weak, method, picks
add('covered', 'more', 'Already well covered', `
  <h2 class="slide-title">Already well covered</h2>
  <p class="lede">Themes the site answers well. Keep these as they are.</p>
  ${(report.covered ?? []).length ? `<ul class="covered">${report.covered.map((c) => {
    const t = themeBySlug.get(c.theme);
    return `<li><h3>${esc(label(c.theme))}${t ? ` <span class="meta">${plural(t.count, 'post', 'posts')}</span>` : ''}</h3>
      ${(c.pages ?? []).length ? `<p>${c.pages.map((pg) => `<code>${esc(pg)}</code>`).join(' ')}</p>` : ''}
      ${c.note ? `<p>${inline(c.note)}</p>` : ''}</li>`;
  }).join('')}</ul>` : '<p class="muted">None listed.</p>'}`);
add('weak', 'more', 'Weak signals', `
  <h2 class="slide-title">Weak signals</h2>
  <p class="lede">Fewer than 3 posts, or off the goal. Worth watching, not building.</p>
  ${(report.weak ?? []).length ? `<ul class="weak">${report.weak.map((w) => `<li>${inline(w.text)}${(w.links ?? []).length ? `<ul class="links">${w.links.map((l) => `<li>${srcLink(l)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}`);
add('method', 'more', 'Method', `
  <h2 class="slide-title">Method</h2>
  <ul class="method">${(report.method ?? []).map((m) => `<li>${inline(m)}</li>`).join('')}</ul>
  ${report.rerun ? `<h3>Since the last report (${fmtDate(report.rerun.previous)})</h3><ul>${(report.rerun.changes ?? []).map((c) => `<li>${inline(c)}</li>`).join('')}</ul>` : ''}`);
add('picks', 'more', 'Your picks', `
  <h2 class="slide-title">Your picks</h2>
  <p class="lede">What you chose on each proposal, kept in this browser. Copy the list to paste it into a message or a plan.</p>
  <div id="picks-list" class="picks-list"></div>
  <p><button type="button" class="btn" id="copy-picks">Copy list</button> <span id="copy-status" class="muted" role="status" aria-live="polite"></span></p>
  <noscript><p>The picks need JavaScript.</p></noscript>`);

// ---------------------------------------------------------------- page

const TABS = [
  ['summary', 'Summary', 'summary'], ['ask', 'Asks', 'ask'], ['clicks', 'Click test', 'clicks'],
  ['S', 'Strategic', 'group-S'], ['U', 'UX/UI', 'group-U'], ['C', 'Content', 'group-C'], ['more', 'More', 'covered'],
];
const data = {
  title: report.title ?? '',
  date: report.date ?? '',
  storageKey: `product-ideas-picks:${report.date ?? 'undated'}`,
  proposals: proposals.map((p) => ({ id: p.id, title: String(p.title ?? ''), group: p.group })),
  groups: GROUPS.map((g) => ({ key: g.key, name: g.name })),
};
const dataJson = JSON.stringify(data).replace(/</g, '\\u003c'); // < as \u003c, so no </script> can end the block

const CSS = `
:root{color-scheme:light;--bg:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--axis:#898781;--line:#e1e0d9;--bar:#2a78d6;--track:#eceae4;--link:#1c5cab;--focus:#1c5cab;--chip:#eeede8;--sel:#184f95;--selink:#ffffff;
--font:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--mono:ui-monospace,"Cascadia Mono",Consolas,monospace}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--axis:#898781;--line:#2c2c2a;--bar:#3987e5;--track:#262624;--link:#86b6ef;--focus:#86b6ef;--chip:#2a2a28;--sel:#86b6ef;--selink:#0b0b0b}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:400 18px/1.55 var(--font);display:flex;flex-direction:column;height:100vh;height:100dvh}
a{color:var(--link);text-underline-offset:2px}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:4px}
code{font:0.85em var(--mono);background:var(--chip);padding:0.1em 0.35em;border-radius:4px;overflow-wrap:anywhere}
h1{font-size:2.5rem;line-height:1.15;margin:0.2em 0 0.4em;font-weight:650;letter-spacing:-0.01em}
h2{font-size:1.25rem;margin:1.2em 0 0.5em}
h3{font-size:1.05rem;margin:0 0 0.4em}
.slide-title{font-size:2rem;line-height:1.2;margin:0.1em 0 0.5em;font-weight:650}
.slide-title.big{font-size:3rem}
.kicker{margin:0;color:var(--ink2);font-size:0.85rem;letter-spacing:0.06em;text-transform:uppercase}
.lede{font-size:1.1rem;color:var(--ink2);max-width:60rem}
.muted{color:var(--ink2)}
.small{font-size:0.9rem}
.meta{color:var(--ink2);font-size:0.85em;white-space:nowrap}
.example-flag{display:inline-block;margin:0 0 1rem;padding:0.25rem 0.7rem;border:1px dashed var(--ink2);border-radius:6px;font-size:0.85rem;color:var(--ink2)}
.topbar{display:flex;align-items:center;gap:1rem;padding:0.5rem 1.25rem;border-bottom:1px solid var(--line);background:var(--surface)}
.topbar .brand{font-weight:650;font-size:0.95rem;white-space:nowrap}
.tabs{display:flex;gap:0.25rem;overflow-x:auto;flex:1;scrollbar-width:none}
.tabs a{padding:0.35rem 0.75rem;border-radius:999px;text-decoration:none;color:var(--ink2);font-size:0.95rem;white-space:nowrap}
.tabs a:hover{background:var(--chip);color:var(--ink)}
.tabs a[aria-current="true"]{background:var(--sel);color:var(--selink)}
.progress{height:3px;background:var(--line)}
.progress span{display:block;height:100%;width:0;background:var(--bar);transition:width .2s}
#deck{flex:1;min-height:0;position:relative}
.slide{height:100%;overflow-y:auto;padding:2.5rem 2rem 3rem;outline:none}
html.js .slide{display:none}
html.js .slide.is-current{display:block}
.slide-inner{max-width:1100px;margin:0 auto}
.divider .slide-inner{padding-top:6vh}
.navbar{display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0.5rem 1.25rem;border-top:1px solid var(--line);background:var(--surface);font-size:0.95rem}
.navbar .count{color:var(--ink2);font-variant-numeric:tabular-nums}
.btn{font:inherit;font-size:0.95rem;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:0.4rem 0.9rem;cursor:pointer}
.btn:hover{border-color:var(--ink2)}
.btn[disabled]{opacity:0.4;cursor:default}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:0.1rem 0.6rem;font-size:0.85rem;margin:0 0.25rem 0.25rem 0}
.badge{display:inline-flex;align-items:center;gap:0.35rem;border:1px solid var(--line);border-radius:999px;padding:0.1rem 0.65rem;font-size:0.85rem;margin:0 0.35rem 0.35rem 0;white-space:nowrap;color:var(--ink)}
.badge .dots{letter-spacing:0.05em;font-size:0.75rem}
.tiles{display:flex;flex-wrap:wrap;gap:1rem;margin:1.5rem 0}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:0.9rem 1.2rem;min-width:11rem}
.tile-label{display:block;color:var(--ink2);font-size:0.9rem}
.tile-value{display:block;font-size:2.4rem;font-weight:650;line-height:1.2}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:2rem}
.findings li,.first li{margin-bottom:0.5rem}
.first{list-style:none;padding:0}
.first a{text-decoration:none}
.first a:hover .ptitle,.first a:hover{text-decoration:underline}
.pid{display:inline-block;min-width:2.4rem;font-weight:650;color:var(--ink)}
.ask-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:2rem;align-items:start;margin-top:1rem}
.bars{list-style:none;margin:0;padding:0}
.bar-row{display:grid;grid-template-columns:13rem minmax(0,1fr) 3.5rem 6rem;grid-template-areas:"label track share trend" ". other other other";align-items:center;column-gap:0.75rem;width:100%;text-align:left;font:inherit;font-size:0.95rem;color:var(--ink);background:none;border:0;border-radius:8px;padding:0.3rem 0.4rem;cursor:pointer}
.bar-row:hover,.bar-row[aria-expanded="true"]{background:var(--chip)}
.bar-label{grid-area:label}
.bar-track{grid-area:track;display:flex;align-items:center;gap:0.4rem;min-width:0}
.bar{display:block;height:20px;background:var(--bar);border-radius:0 4px 4px 0}
.bar-value{font-variant-numeric:tabular-nums;font-weight:600}
.bar-share{grid-area:share;color:var(--ink2);text-align:right;font-variant-numeric:tabular-nums}
.bar-trend{grid-area:trend;color:var(--ink2);white-space:nowrap}
.bar-other{grid-area:other;color:var(--ink2);font-size:0.8rem}
.bar-other:empty{display:none}
.theme-panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1rem 1.2rem}
.theme-panel p{margin:0.3rem 0 0.6rem}
.links{padding-left:1.1rem;margin:0.4rem 0}
.links li{margin-bottom:0.35rem}
.dims{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.5rem;margin-top:2rem}
.dim ul{list-style:none;margin:0;padding:0}
.dim li{display:grid;grid-template-columns:minmax(0,9rem) minmax(0,1fr) auto;align-items:center;gap:0.5rem;font-size:0.9rem;margin-bottom:0.3rem}
.dim-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dim-track{display:block}
.dim-bar{display:block;height:8px;border-radius:0 4px 4px 0;background:var(--bar)}
.dim-value{font-variant-numeric:tabular-nums}
#tip{position:fixed;z-index:30;max-width:22rem;padding:0.45rem 0.7rem;border-radius:8px;background:var(--ink);color:var(--bg);font-size:0.85rem;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.2)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.25rem}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1rem 1.2rem}
.facts{display:flex;flex-wrap:wrap;gap:0.5rem 1.5rem;margin:0.5rem 0}
.facts div{min-width:5rem}
.facts dt{color:var(--ink2);font-size:0.8rem}
.facts dd{margin:0;font-weight:600}
.path{font-size:0.85rem;color:var(--ink2)}
.shot-btn{display:block;padding:0;border:1px solid var(--line);border-radius:8px;background:none;cursor:zoom-in;overflow:hidden;max-width:100%}
.shot{display:block;width:100%;max-height:340px;object-fit:cover;object-position:top}
.shot-missing{display:flex;align-items:center;justify-content:center;height:120px;border:1px dashed var(--line);border-radius:8px;color:var(--ink2);font-size:0.9rem}
.plist{list-style:none;padding:0;margin:1.5rem 0}
.plist li{display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;padding:0.8rem 0;border-bottom:1px solid var(--line)}
.plist a{flex:1 1 22rem;text-decoration:none;font-size:1.15rem;display:flex;gap:0.5rem}
.plist a:hover .ptitle{text-decoration:underline}
.pick-state{font-size:0.85rem;font-weight:600}
.pick-state:empty{display:none}
.phead .badges{margin:0}
.evidence{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--bar);border-radius:8px;padding:0.8rem 1.1rem;margin:1rem 0 1.25rem}
.evline{font-size:1.05rem;margin:0 0 0.4rem}
.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem 2rem}
.field p{margin:0}
.field h3{font-size:0.85rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink2);margin-bottom:0.3rem}
.where{list-style:none;padding:0;margin:0}
.where li{margin-bottom:0.2rem}
.picks{display:flex;gap:0.6rem;margin-top:1.75rem;flex-wrap:wrap}
.pick{font:inherit;font-weight:600;padding:0.55rem 1.3rem;border-radius:999px;border:2px solid var(--line);background:var(--surface);color:var(--ink);cursor:pointer}
.pick:hover{border-color:var(--ink2)}
.pick[aria-pressed="true"]{background:var(--sel);border-color:var(--sel);color:var(--selink)}
.pick[aria-pressed="true"]::before{content:"✓ "}
.covered,.weak,.method{padding-left:1.1rem}
.covered li,.weak>li,.method li{margin-bottom:0.9rem}
.picks-list h3{margin-top:1.2rem}
.picks-list ul{list-style:none;padding:0;margin:0}
.picks-list li{display:flex;gap:0.75rem;padding:0.35rem 0;border-bottom:1px solid var(--line)}
.picks-list .choice{margin-left:auto;font-weight:600;white-space:nowrap}
.picks-list .none{color:var(--ink2);font-weight:400}
#overview{position:fixed;inset:0;z-index:20;background:var(--bg);overflow-y:auto;padding:1.5rem}
#overview h2{margin:0 0 1rem}
.ov-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.75rem;list-style:none;padding:0;margin:0}
.ov-grid button{width:100%;height:100%;min-height:5.5rem;text-align:left;font:inherit;font-size:0.95rem;padding:0.7rem 0.9rem;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);cursor:pointer}
.ov-grid button:hover{border-color:var(--ink2)}
.ov-grid button[aria-current="true"]{border:2px solid var(--sel)}
.ov-grid .n{display:block;color:var(--ink2);font-size:0.8rem}
#lightbox{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:1rem}
[hidden]{display:none!important}
#lightbox img{max-width:100%;max-height:100%;border-radius:8px;background:#fff}
#lightbox .btn{position:absolute;top:1rem;right:1rem}
[hidden]{display:none!important}
@media (max-width:760px){
 body{font-size:16px}
 h1{font-size:1.8rem}.slide-title{font-size:1.5rem}.slide-title.big{font-size:2.1rem}
 .topbar{padding:0.4rem 0.6rem;gap:0.5rem}.topbar .brand{display:none}
 .slide{padding:0.75rem 0.6rem 2rem}
 .slide-inner{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:1.1rem 1rem}
 .divider .slide-inner{padding-top:1.1rem}
 .tile{min-width:0;flex:1 1 8rem;padding:0.6rem 0.8rem}.tile-value{font-size:1.8rem}
 .cols,.ask-grid,.fields,.dims{grid-template-columns:1fr;gap:1rem}
 .bar-row{grid-template-columns:minmax(0,1fr) 3.2rem 5.5rem;grid-template-areas:"label share trend" "track track track" "other other other";row-gap:0.2rem}
 .navbar{padding:0.4rem 0.6rem}
 .navbar .hint{display:none}
 .cards{grid-template-columns:1fr}
}
@media print{
 body{display:block;height:auto;background:#fff;color:#000;font-size:12pt}
 .topbar,.navbar,.progress,#overview,#lightbox,#tip,.picks,#copy-picks,.btn{display:none!important}
 #deck{overflow:visible}
 html.js .slide,.slide{display:block!important;height:auto;overflow:visible;padding:0;page-break-after:always;break-after:page}
 .slide:last-child{page-break-after:auto;break-after:auto}
 .slide-inner{max-width:none;border:0;background:none}
 .theme-panel[hidden]{display:none!important}
 a{color:#000}
 a[href^="http"]::after{content:" (" attr(href) ")";font-size:0.8em;word-break:break-all;color:#333}
 .bar,.dim-bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

// The browser side. Serialised with toString(), so it must not use anything from this module.
function clientMain() {
  const data = JSON.parse(document.getElementById('report-data').textContent);
  const slides = Array.from(document.querySelectorAll('.slide'));
  const ids = slides.map((s) => s.id);
  const tabs = Array.from(document.querySelectorAll('.tabs a'));
  const ovButtons = Array.from(document.querySelectorAll('#overview [data-go]'));
  const overview = document.getElementById('overview');
  const lightbox = document.getElementById('lightbox');
  const tip = document.getElementById('tip');
  const prevBtn = document.getElementById('prev');
  const nextBtn = document.getElementById('next');
  let current = -1;

  function show(i, focus) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (i === current) return;
    if (current >= 0) slides[current].classList.remove('is-current');
    current = i;
    const s = slides[i];
    s.classList.add('is-current');
    s.scrollTop = 0;
    document.getElementById('count').textContent = (i + 1) + ' / ' + slides.length;
    document.getElementById('bar').style.width = ((i + 1) / slides.length * 100) + '%';
    tabs.forEach((t) => t.setAttribute('aria-current', t.dataset.tab === s.dataset.tab ? 'true' : 'false'));
    ovButtons.forEach((b) => b.setAttribute('aria-current', Number(b.dataset.go) === i ? 'true' : 'false'));
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === slides.length - 1;
    if (location.hash !== '#' + s.id) {
      try { history.replaceState(null, '', '#' + s.id); } catch (e) { /* file:// in some browsers */ }
    }
    hideTip();
    if (focus) s.focus({ preventScroll: true });
  }
  function fromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const i = ids.indexOf(id);
    show(i >= 0 ? i : (current >= 0 ? current : 0), current >= 0);
  }
  window.addEventListener('hashchange', fromHash);
  prevBtn.addEventListener('click', () => show(current - 1, true));
  nextBtn.addEventListener('click', () => show(current + 1, true));

  // Overview
  const ovToggle = document.getElementById('ov-toggle');
  function setOverview(open) {
    overview.hidden = !open;
    ovToggle.setAttribute('aria-expanded', String(open));
    if (open) { const b = ovButtons[current]; if (b) b.focus(); }
    else ovToggle.focus();
  }
  ovToggle.addEventListener('click', () => setOverview(overview.hidden));
  document.getElementById('ov-close').addEventListener('click', () => setOverview(false));
  ovButtons.forEach((b) => b.addEventListener('click', () => { overview.hidden = true; ovToggle.setAttribute('aria-expanded', 'false'); show(Number(b.dataset.go), true); }));

  // Lightbox
  let lbReturn = null;
  function openLightbox(src, alt, from) {
    const img = lightbox.querySelector('img');
    img.src = src; img.alt = alt || '';
    lightbox.hidden = false; lbReturn = from;
    lightbox.querySelector('.btn').focus();
  }
  function closeLightbox() { lightbox.hidden = true; if (lbReturn) lbReturn.focus(); }
  document.querySelectorAll('.shot-btn').forEach((b) => b.addEventListener('click', () => {
    const img = b.querySelector('img');
    openLightbox(b.dataset.src, img ? img.alt : '', b);
  }));
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox || e.target.closest('.btn')) closeLightbox(); });
  document.querySelectorAll('img.shot').forEach((img) => img.addEventListener('error', () => {
    const ph = document.createElement('div');
    ph.className = 'shot-missing';
    ph.textContent = 'Screenshot not found';
    const host = img.closest('.shot-btn') || img;
    host.replaceWith(ph);
  }));

  // Keys
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (!lightbox.hidden) { if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); } return; }
    if (!overview.hidden) {
      if (e.key === 'Escape' || e.key === 'o' || e.key === 'O') { e.preventDefault(); setOverview(false); }
      return;
    }
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    const onControl = tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY';
    let go = null;
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': go = current + 1; break;
      case 'ArrowLeft': case 'PageUp': go = current - 1; break;
      case ' ': if (onControl) return; go = e.shiftKey ? current - 1 : current + 1; break;
      case 'Home': go = 0; break;
      case 'End': go = slides.length - 1; break;
      case 'o': case 'O': e.preventDefault(); setOverview(true); return;
      default: return;
    }
    e.preventDefault();
    show(go, true);
  });

  // Swipe
  let sx = null; let sy = 0;
  const deck = document.getElementById('deck');
  deck.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
  deck.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx; const dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) show(current + (dx < 0 ? 1 : -1), false);
  }, { passive: true });

  // Theme bars: details and tooltip
  const rows = Array.from(document.querySelectorAll('.bar-row'));
  rows.forEach((r) => r.addEventListener('click', () => {
    rows.forEach((o) => {
      const on = o === r;
      o.setAttribute('aria-expanded', String(on));
      const p = document.getElementById(o.getAttribute('aria-controls'));
      if (p) p.hidden = !on;
    });
  }));
  function showTip(el) {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const b = el.querySelector('.bar') || el;
    const r = b.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right + 10)) + 'px';
    tip.style.top = Math.max(8, r.top - tip.offsetHeight - 6) + 'px';
  }
  function hideTip() { tip.hidden = true; }
  rows.forEach((r) => {
    r.addEventListener('mouseenter', () => showTip(r));
    r.addEventListener('mouseleave', hideTip);
    r.addEventListener('focus', () => showTip(r));
    r.addEventListener('blur', hideTip);
  });
  document.querySelectorAll('.slide').forEach((s) => s.addEventListener('scroll', hideTip, { passive: true }));

  // Picks
  const CHOICES = { do: 'Do it', later: 'Later', no: 'No' };
  let picks = {};
  try { picks = JSON.parse(localStorage.getItem(data.storageKey) || '{}') || {}; } catch (e) { picks = {}; }
  function save() { try { localStorage.setItem(data.storageKey, JSON.stringify(picks)); } catch (e) { /* storage off */ } }
  function paint() {
    document.querySelectorAll('.pick').forEach((b) => b.setAttribute('aria-pressed', String(picks[b.dataset.id] === b.dataset.choice)));
    document.querySelectorAll('.pick-state').forEach((s) => { s.textContent = CHOICES[picks[s.dataset.id]] ? '✓ ' + CHOICES[picks[s.dataset.id]] : ''; });
    const list = document.getElementById('picks-list');
    list.textContent = '';
    let any = false;
    data.groups.forEach((g) => {
      const items = data.proposals.filter((p) => p.group === g.key);
      if (!items.length) return;
      const h = document.createElement('h3'); h.textContent = g.name; list.appendChild(h);
      const ul = document.createElement('ul');
      items.forEach((p) => {
        const li = document.createElement('li');
        const a = document.createElement('a'); a.href = '#' + p.id; a.textContent = p.id + ' ' + p.title.replace(/\*\*|`/g, '');
        const c = document.createElement('span'); c.className = 'choice';
        if (CHOICES[picks[p.id]]) { c.textContent = CHOICES[picks[p.id]]; any = true; } else { c.textContent = 'Not chosen'; c.classList.add('none'); }
        li.appendChild(a); li.appendChild(c); ul.appendChild(li);
      });
      list.appendChild(ul);
    });
    document.getElementById('copy-picks').disabled = !any;
  }
  document.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.id;
    if (picks[id] === b.dataset.choice) delete picks[id]; else picks[id] = b.dataset.choice;
    save(); paint();
  }));
  function listText() {
    const lines = [data.title + ' (' + data.date + '): picks'];
    data.groups.forEach((g) => data.proposals.filter((p) => p.group === g.key && CHOICES[picks[p.id]])
      .forEach((p) => lines.push(p.id + ' ' + p.title.replace(/\*\*|`/g, '') + ' — ' + CHOICES[picks[p.id]])));
    return lines.join('\n');
  }
  const status = document.getElementById('copy-status');
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    status.textContent = ok ? 'Copied.' : 'Copy did not work here; select the list above instead.';
  }
  document.getElementById('copy-picks').addEventListener('click', () => {
    const text = listText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { status.textContent = 'Copied.'; }, () => fallbackCopy(text));
    } else fallbackCopy(text);
  });

  paint();
  fromHash();
}

const html = `<!doctype html>
<html lang="${esc(LANG)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<link rel="icon" href="data:,">
<title>${esc(report.title ?? 'Report')} · ${fmtDate(report.date)}</title>
<script>document.documentElement.classList.add('js')</script>
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <span class="brand">Product ideas · ${fmtDate(report.date)}</span>
  <nav class="tabs" aria-label="Sections">${TABS.map(([tab, name, target]) => `<a href="#${target}" data-tab="${tab}">${name}</a>`).join('')}</nav>
  <button type="button" class="btn" id="ov-toggle" aria-expanded="false" aria-controls="overview" title="Overview (o)">Overview</button>
</header>
<div class="progress" aria-hidden="true"><span id="bar"></span></div>
<main id="deck">
${slides.map((s) => `<section class="slide ${s.cls}" id="${esc(s.id)}" data-tab="${esc(s.tab)}" tabindex="-1" aria-label="${esc(s.title.replace(/\*\*|`/g, ''))}"><div class="slide-inner">${s.html}</div></section>`).join('\n')}
</main>
<footer class="navbar">
  <button type="button" class="btn" id="prev" aria-label="Previous slide">← Back</button>
  <span class="count" id="count" aria-live="polite"></span>
  <span class="hint muted small">← → to move · o for the overview</span>
  <button type="button" class="btn" id="next" aria-label="Next slide">Next →</button>
</footer>
<div id="overview" hidden role="region" aria-label="All slides">
  <h2>All slides <button type="button" class="btn" id="ov-close">Close</button></h2>
  <ol class="ov-grid">${slides.map((s, i) => `<li><button type="button" data-go="${i}"><span class="n">${i + 1}</span>${esc(s.title.replace(/\*\*|`/g, ''))}</button></li>`).join('')}</ol>
</div>
<div id="lightbox" hidden role="region" aria-label="Screenshot"><img alt=""><button type="button" class="btn">Close</button></div>
<div id="tip" hidden role="presentation"></div>
<script type="application/json" id="report-data">${dataJson}</script>
<script>(${clientMain.toString()})();</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
fs.writeFileSync(opt.out, html);
for (const w of warnings) console.warn(`warn: ${w}`);
console.log(`${slides.length} slides, ${warnings.length} warning${warnings.length === 1 ? '' : 's'} → ${path.resolve(opt.out)}`);
if (opt.strict && warnings.length) process.exit(1);
