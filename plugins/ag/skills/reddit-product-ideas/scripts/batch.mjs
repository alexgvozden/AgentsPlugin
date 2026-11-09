#!/usr/bin/env node
// batch.mjs — split posts.jsonl into compact Markdown batches for tagging by a model.
//
// Usage:
//   node batch.mjs --posts <posts.jsonl> --out <dir>/batches [--size 80] [--codebook <codebook.json>]
//        [--skip-kind <kind>]
//
// Writes batch-01.md, batch-02.md, … (posts in posts.jsonl order). Kinds named in --skip-kind
// go to their own set, batch-<kind>-01.md, … (job ads still show which roles are wanted). The
// default is the codebook's job-ads kind (jobAds.kind), else "hiring".
// Old batch-*.md files in --out are replaced; nothing else there is touched.

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { readCodebook } from './lib.mjs';

const HELP = `batch.mjs — compact Markdown batches of posts for tagging

  --posts <file>       posts.jsonl from fetch-reddit.mjs
  --out <dir>          output folder for batch-XX.md files
  --size <n>           posts per batch (default 80)
  --codebook <file>    codebook.json (its jobAds.kind is the default --skip-kind)
  --skip-kind <a,b>    kinds that go into separate batch-<kind>-XX.md files (default: the
                       codebook's job-ads kind, else hiring; "" for none)
  -h, --help           this help`;

const { values: opt } = parseArgs({
  options: {
    posts: { type: 'string' },
    out: { type: 'string' },
    size: { type: 'string', default: '80' },
    codebook: { type: 'string' },
    'skip-kind': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (opt.help || !opt.posts || !opt.out) {
  console.log(HELP);
  process.exit(opt.help ? 0 : 1);
}

const size = Math.max(1, Number(opt.size));
const defaultSkip = opt.codebook ? readCodebook(opt.codebook).jobAds.kind ?? '' : 'hiring';
const skipKinds = (opt['skip-kind'] ?? defaultSkip).split(',').map((s) => s.trim()).filter(Boolean);
const outDir = path.resolve(opt.out);
const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s = '') => String(s).replace(/\s+/g, ' ').trim();

const posts = fs.readFileSync(opt.posts, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

function render(p) {
  const lines = [`### ${p.id} · r/${p.sub} · ${p.kind} · ${(p.published ?? '').slice(0, 10)}`, '', `**${oneLine(p.title)}**`];
  const text = oneLine(p.text);
  if (text) lines.push('', cap(text, 700));
  const comments = (p.comments ?? []).slice(0, 3).map((c) => `> ${cap(oneLine(c.text), 200)}`);
  if (comments.length) lines.push('', comments.join('\n>\n'));
  return lines.join('\n');
}

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (/^batch-([a-z0-9-]+-)?\d+\.md$/.test(f)) fs.unlinkSync(path.join(outDir, f));

const groups = [{ prefix: 'batch', name: 'main', posts: posts.filter((p) => !skipKinds.includes(p.kind)) }];
for (const k of skipKinds) groups.push({ prefix: `batch-${k}`, name: k, posts: posts.filter((p) => p.kind === k) });

let files = 0;
for (const g of groups) {
  const total = Math.ceil(g.posts.length / size);
  for (let i = 0; i < total; i++) {
    const chunk = g.posts.slice(i * size, (i + 1) * size);
    const name = `${g.prefix}-${String(i + 1).padStart(2, '0')}.md`;
    const head = `# ${g.prefix} ${i + 1} of ${total}: posts ${i * size + 1}–${i * size + chunk.length} of ${g.posts.length}${g.name === 'main' ? '' : ` (kind: ${g.name})`}\n`;
    fs.writeFileSync(path.join(outDir, name), `${head}\n${chunk.map(render).join('\n\n')}\n`);
    console.log(`${path.join(outDir, name)}  ${chunk.length} posts`);
    files++;
  }
}
console.log(`\n${posts.length} posts → ${files} files (${groups.map((g) => `${g.name} ${g.posts.length}`).join(', ')})`);
