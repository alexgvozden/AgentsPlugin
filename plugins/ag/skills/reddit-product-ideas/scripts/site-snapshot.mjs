#!/usr/bin/env node
// site-snapshot.mjs — snapshot the live site's structure so coverage claims rest on facts.
//
// Usage:
//   node site-snapshot.mjs --base https://example.com --out <dir> [--max 150] [--gap 300]
//
// Reads <base>/sitemap.xml (a sitemap index too), fetches the home page and up to --max pages
// (--gap ms apart) and records per page: status, title, meta description, canonical, robots,
// H1s, the first 15 H2s, words in <main>, internal links in <main>, FAQ and JSON-LD types.
// From the home page: header nav and footer links. Computed: inbound links, linked from home,
// in nav, in footer, click depth from "/". Writes <out>/site.json and <out>/site.md.

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const HELP = `site-snapshot.mjs — structure of the live site for the reddit-product-ideas skill

  --base <url>   site origin (e.g. https://example.com); also named in the User-Agent
  --out <dir>    output folder (site.json, site.md)
  --max <n>      at most n pages, the home page included (default 150)
  --gap <ms>     pause between page requests (default 300)
  -h, --help     this help`;

const { values: opt } = parseArgs({
  options: {
    base: { type: 'string' },
    out: { type: 'string' },
    max: { type: 'string', default: '150' },
    gap: { type: 'string', default: '300' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (opt.help || !opt.base || !opt.out) {
  console.log(HELP);
  process.exit(opt.help ? 0 : 1);
}

const base = new URL(opt.base);
const origin = base.origin;
const UA = `product-research/1.0 (+${origin})`;
const max = Number(opt.max);
const gap = Number(opt.gap);
const outDir = path.resolve(opt.out);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- helpers ----------

function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos|nbsp|rsquo|lsquo|ldquo|rdquo|ndash|mdash|hellip|middot|pound|times);/gi, (m, g) => {
    const k = g.toLowerCase();
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', middot: '·', pound: '£', times: '×' }[k];
  });
}

function attrs(tag) {
  const a = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return a;
}

function textOf(html = '') {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function normPath(href, pageUrl) {
  if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
  let u;
  try { u = new URL(href, pageUrl); } catch { return null; }
  if (u.origin !== origin) return null;
  let p = u.pathname.replace(/\/+$/, '');
  return p || '/';
}

function linksIn(html, pageUrl) {
  const set = new Set();
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const p = normPath(attrs(m[0]).href, pageUrl);
    if (p) set.add(p);
  }
  return [...set].sort();
}

function allTags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi'))].map((m) => textOf(m[1]));
}

function jsonLdTypes(html) {
  const types = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      if (v['@type']) [].concat(v['@type']).forEach((t) => types.add(String(t)));
      for (const k of Object.keys(v)) if (k !== '@type') walk(v[k]);
    }
  };
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { types.add('(invalid JSON-LD)'); }
  }
  return [...types].sort();
}

function regions(html) {
  const mainStart = html.search(/<main\b/i);
  const mainEndIdx = html.lastIndexOf('</main>');
  const hasMain = mainStart >= 0 && mainEndIdx > mainStart;
  const main = hasMain ? html.slice(mainStart, mainEndIdx) : (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) ?? [, html])[1];
  const before = hasMain ? html.slice(0, mainStart) : html;
  const after = hasMain ? html.slice(mainEndIdx) : html;
  const header = (before.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i) ?? [])[1] ?? '';
  const footerStart = after.search(/<footer\b/i);
  const footerEnd = after.lastIndexOf('</footer>');
  const footer = footerStart >= 0 && footerEnd > footerStart ? after.slice(footerStart, footerEnd) : '';
  return { main, header, footer, hasMain };
}

async function get(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    return { status: res.status, finalUrl: res.url, body: await res.text() };
  } catch (err) {
    return { status: 0, finalUrl: url, body: '', error: err.message };
  }
}

// ---------- sitemap ----------

async function sitemapUrls(url, depth = 0) {
  const r = await get(url);
  if (r.status !== 200) {
    console.warn(`sitemap ${url}: ${r.status || r.error}`);
    return [];
  }
  const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decodeEntities(m[1]));
  if (/<sitemapindex\b/i.test(r.body) && depth < 2) {
    const out = [];
    for (const l of locs) out.push(...(await sitemapUrls(l, depth + 1)));
    return out;
  }
  return locs;
}

// ---------- run ----------

const fromSitemap = await sitemapUrls(`${origin}/sitemap.xml`);
const paths = ['/'];
for (const loc of fromSitemap) {
  let u;
  try { u = new URL(loc); } catch { continue; }
  const p = u.pathname.replace(/\/+$/, '') || '/';
  if (!paths.includes(p)) paths.push(p);
}
const sitemapCount = paths.length;
const toFetch = paths.slice(0, max);
console.log(`Sitemap: ${fromSitemap.length} URLs (${sitemapCount} distinct paths incl. /); fetching ${toFetch.length}`);

const pages = [];
let nav = [];
let footer = [];
for (const [i, p] of toFetch.entries()) {
  if (i) await sleep(gap);
  const url = origin + p;
  const r = await get(url);
  const html = r.body;
  const head = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) ?? [, html])[1];
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const linkTags = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const reg = regions(html);
  const words = textOf(reg.main).split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const types = jsonLdTypes(html);
  const details = (reg.main.match(/<details\b/gi) ?? []).length;
  const finalPath = normPath(r.finalUrl, url);
  const page = {
    path: p,
    status: r.status,
    ...(finalPath && finalPath !== p ? { redirectsTo: finalPath } : {}),
    title: textOf((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? ''),
    description: metas.find((m) => m.name?.toLowerCase() === 'description')?.content ?? null,
    canonical: linkTags.find((l) => l.rel?.toLowerCase() === 'canonical')?.href ?? null,
    robots: metas.find((m) => m.name?.toLowerCase() === 'robots')?.content ?? null,
    h1: allTags(html, 'h1'),
    h2: allTags(reg.main, 'h2').slice(0, 15),
    words,
    hasMain: reg.hasMain,
    links: linksIn(reg.main, r.finalUrl || url).filter((l) => l !== p),
    faq: { details, jsonLd: types.includes('FAQPage'), present: details > 0 || types.includes('FAQPage') },
    jsonLdTypes: types,
  };
  if (p === '/') {
    nav = linksIn(reg.header, url);
    footer = linksIn(reg.footer, url);
  }
  pages.push(page);
  console.log(`[${i + 1}/${toFetch.length}] ${r.status || r.error} ${p} · ${words} words · ${page.links.length} links`);
}

// ---------- computed ----------

const home = pages.find((pg) => pg.path === '/');
const navSet = new Set(nav);
const footerSet = new Set(footer);
const homeLinks = new Set(home?.links ?? []);
const linkMap = new Map(pages.map((pg) => [pg.path, pg.links]));

const depth = new Map([['/', 0]]);
const queue = ['/'];
while (queue.length) {
  const cur = queue.shift();
  const next = [...(linkMap.get(cur) ?? []), ...nav, ...footer];
  for (const n of next) {
    if (!depth.has(n)) {
      depth.set(n, depth.get(cur) + 1);
      queue.push(n);
    }
  }
}

for (const pg of pages) {
  pg.inbound = pages.filter((o) => o.path !== pg.path && o.links.includes(pg.path)).length;
  pg.onHome = homeLinks.has(pg.path);
  pg.inNav = navSet.has(pg.path);
  pg.inFooter = footerSet.has(pg.path);
  pg.depth = depth.has(pg.path) ? depth.get(pg.path) : null;
}
pages.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

fs.mkdirSync(outDir, { recursive: true });
const snapshot = { base: origin, fetchedAt: new Date().toISOString(), sitemapPaths: sitemapCount, nav, footer, pages };
fs.writeFileSync(path.join(outDir, 'site.json'), `${JSON.stringify(snapshot, null, 2)}\n`);

// ---------- markdown ----------

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const yes = (b) => (b ? 'yes' : '');
const ok = pages.filter((p) => p.status === 200);
const lines = [
  `# Site snapshot: ${origin}`,
  '',
  `Fetched ${snapshot.fetchedAt.slice(0, 10)}. Sitemap paths (incl. /): ${sitemapCount}; pages fetched: ${pages.length}${pages.length < sitemapCount ? ` (capped by --max ${max})` : ''}.`,
  '',
  `- Status 200: ${ok.length}; other: ${pages.length - ok.length}${pages.length - ok.length ? ` (${pages.filter((p) => p.status !== 200).map((p) => `${p.path} ${p.status}`).join(', ')})` : ''}`,
  `- With FAQ: ${ok.filter((p) => p.faq.present).length}; without H1: ${ok.filter((p) => !p.h1.length).length}; more than one H1: ${ok.filter((p) => p.h1.length > 1).length}`,
  `- No inbound main-content link: ${ok.filter((p) => p.path !== '/' && !p.inbound).length}; not in nav or footer either: ${ok.filter((p) => p.path !== '/' && !p.inbound && !p.inNav && !p.inFooter).length}`,
  `- Unreachable from / (over main, nav and footer links of the fetched pages): ${ok.filter((p) => p.depth === null).length}`,
  `- Median words in main: ${ok.length ? ok.map((p) => p.words).sort((a, b) => a - b)[Math.floor(ok.length / 2)] : 0}`,
  '',
  `Nav (${nav.length}): ${nav.join(', ') || 'none found'}`,
  '',
  `Footer (${footer.length}): ${footer.join(', ') || 'none found'}`,
  '',
  '| path | H1 | words | FAQ | inbound | home | nav | footer | depth |',
  '| --- | --- | ---: | --- | ---: | --- | --- | --- | ---: |',
  ...pages.map((p) =>
    `| ${cell(p.path)}${p.status !== 200 ? ` (${p.status})` : ''} | ${cell(p.h1.join(' / '))} | ${p.words} | ${p.faq.present ? (p.faq.details ? `${p.faq.details}${p.faq.jsonLd ? '+LD' : ''}` : 'LD') : ''} | ${p.inbound} | ${yes(p.onHome)} | ${yes(p.inNav)} | ${yes(p.inFooter)} | ${p.depth ?? '–'} |`),
  '',
  'FAQ column: number of <details> in main, "+LD"/"LD" = FAQPage JSON-LD. Inbound counts other fetched pages whose main links here.',
];
fs.writeFileSync(path.join(outDir, 'site.md'), `${lines.join('\n')}\n`);
console.log(`\nWrote ${path.join(outDir, 'site.json')} and site.md (${pages.length} pages, nav ${nav.length}, footer ${footer.length})`);
