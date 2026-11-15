// Checks on scripts/plan-page.mjs, the page and answer lines of /ag:plan.
// Run: node --test plugins/ag/tests

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyAnswers, blocks, checkPlan, headingRef, inline, main, newPlanPath, openTarget, pageOf,
  parseAnswers, parsePlan, refsOf, renderPlan, statusClass,
} from '../scripts/plan-page.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const exampleFile = path.join(here, '..', 'skills', 'plan', 'plan.example.md')
const example = () => fs.readFileSync(exampleFile, 'utf8')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ag-plan-test-'))

test('the example plan reads with phases, steps, questions and no warnings', () => {
  const plan = parsePlan(example(), exampleFile)
  assert.equal(plan.title, 'Saved searches')
  assert.deepEqual(refsOf(plan), ['PLAN', 'Goal', 'Context', 'Solution design', 'Architecture', 'High-level design', 'Screens (UX and UI)', 'Technical implementation', 'P1', '1.1', '1.2', 'P2', '2.1', '2.1-ui', 'Later', 'Where the run stands', 'Q1', 'Q2'])
  assert.equal(plan.questions.length, 2)
  assert.deepEqual(plan.questions[0].options.map((o) => [o.letter, o.rec]), [['A', true], ['B', false], ['C', false]])
  assert.equal(plan.questions[1].options.find((o) => o.rec).letter, 'B', 'Default: B marks option B')
  assert.deepEqual(checkPlan(plan), [])
})

test('heading refs match the goal-progress bar', () => {
  assert.deepEqual([headingRef('Phase 2: The page'), headingRef('1.2 API routes'), headingRef('Step 3.1: x'), headingRef('S16. Search'), headingRef('Context')].map((h) => [h.ref, h.kind]),
    [['P2', 'phase'], ['1.2', 'step'], ['Step 3.1', 'step'], ['S16', 'step'], ['Context', 'section']])
  assert.equal(headingRef('2026 roadmap').kind, 'section', 'a year is not a step id')
})

test('status words map to page states', () => {
  assert.deepEqual(['done 2026-11-15', '✅', 'shown 2026-11-14', 'waiting for you: copy', 'blocked: key', 'in progress', 'todo', 'later'].map(statusClass),
    ['done', 'done', 'shown', 'waiting', 'blocked', 'running', 'todo', 'other'])
})

test('a tracker table gives a status to steps without a Status line', () => {
  const plan = parsePlan('# T\n\n| ID | Step | Status |\n|---|---|---|\n| 1.1 | a | ✅ |\n\n## 1.1 First\n\nText.\n', 't.md')
  assert.equal(plan.all.find((n) => n.ref === '1.1').status, '✅')
})

test('checks warn on duplicate refs, missing status, questions without id or default', () => {
  const plan = parsePlan('# T\n\n## 1.1 A\n\n## 1.1 B\n\nStatus: todo\n\n## Open questions\n\n- Which colour?\n  - A. Red\n  - B. Blue\n', 't.md')
  const w = checkPlan(plan).join('\n')
  assert.match(w, /"1\.1" is used by 2/)
  assert.match(w, /step 1\.1 has no status/)
  assert.match(w, /has no id/)
  assert.match(w, /Q1 has no default/)
})

test('markdown is escaped and links are safe', () => {
  assert.equal(inline('<b>x</b> `a<b>` **bold**'), '&lt;b&gt;x&lt;/b&gt; <code>a&lt;b&gt;</code> <b>bold</b>')
  assert.doesNotMatch(inline('[x](javascript:alert(1))'), /<a /)
  assert.match(inline('[docs](docs/a.md)'), /<a href="docs\/a.md">docs<\/a>/)
  const html = blocks(['- [x] done', '- [ ] open', '  - nested', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '```', '<script>', '```'])
  assert.match(html, /class="box on"/)
  assert.match(html, /<ul><li>nested<\/li><\/ul>/)
  assert.match(html, /<td>1<\/td><td>2<\/td>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>/)
})

test('the page has every ref, the questions, the answer bar and no raw plan html', () => {
  const plan = parsePlan(example().replace('Signed-in users', 'Signed-in <img src=x onerror=alert(1)> users'), exampleFile)
  const html = renderPlan(plan, { rel: 'plans/20261115-saved-searches/plan.md', generated: '2026-11-15' })
  for (const r of ['P1', '1.1', '1.2', 'P2', '2.1', '2.1-ui', 'Q1', 'Q2']) assert.ok(html.includes(`id="r-${r}"`), r)
  assert.match(html, /data-pick="Q1" data-v="A"/)
  assert.match(html, /data-pick="PLAN" data-v="ok"/)
  assert.match(html, /data-note="1\.2"/)
  assert.match(html, /id="copy"/)
  assert.match(html, /"ag-plan:plans\/20261115-saved-searches\/plan.md"/)
  assert.doesNotMatch(html, /<img src=x/)
})

test('the page folds, has contents and Open all, and draws the example diagrams', () => {
  const html = renderPlan(parsePlan(example(), exampleFile), { rel: 'plans/x/plan.md', generated: '2026-11-15' })
  assert.match(html, /<details class="fold" open><summary><h2>/)
  assert.match(html, /<aside class="toc">[\s\S]*href="#r-Solution_design"/)
  assert.match(html, /id="openall"/)
  assert.match(html, /id="closeall"/)
  assert.equal((html.match(/<svg class="mm"/g) || []).length, 2, 'a flowchart and a sequence diagram')
  assert.match(html, /<details class="mm-src">/)
})

test('diagrams escape their labels and other kinds fall back to their source', () => {
  const flow = blocks(['```mermaid', 'flowchart TD', '  A["<script>x</script>"] -->|"a&b"| B{ok?}', '```'])
  assert.match(flow, /<svg class="mm"/)
  assert.doesNotMatch(flow, /<script>/)
  assert.match(flow, /&lt;script&gt;/)
  const seq = blocks(['```mermaid', 'sequenceDiagram', '  A->>B: hi', '  loop every day', '    B-->>A: ok', '  end', '```'])
  assert.match(seq, /<svg class="mm"/)
  const pie = blocks(['```mermaid', 'pie title Pets', '  "Dogs" : 3', '```'])
  assert.doesNotMatch(pie, /<svg/)
  assert.match(pie, /class="mm-none"/)
  assert.match(pie, /pie title Pets/)
})

test('images become figures and unsafe image links are dropped', () => {
  const fig = blocks(['![Account page, desktop](../../design/20261115-saved/images/account.png)'])
  assert.match(fig, /<figure class="img"><a class="imga" href="..\/..\/design\/20261115-saved\/images\/account.png"[^>]*><img src="[^"]+" alt="Account page, desktop"/)
  assert.match(fig, /<figcaption>Account page, desktop<\/figcaption>/)
  const bad = inline('![x](javascript:alert(1)) ![y](data:text/html,1)')
  assert.doesNotMatch(bad, /<img/)
  assert.match(bad, /\[image: x\]/)
})

test('a plan with many steps starts with its steps closed', () => {
  const src = '# Big\n\n## Phase 1: All\n\nStatus: todo\n\n' + Array.from({ length: 16 }, (_, i) => `### 1.${i + 1} Step\n\nStatus: todo\n`).join('\n')
  const html = renderPlan(parsePlan(src, 'big.md'), { rel: 'big.md', generated: '2026-11-15' })
  assert.match(html, /id="r-P1"[^>]*><details class="fold" open>/)
  assert.match(html, /id="r-1\.1"[^>]*><details class="fold"><summary>/)
})

test('answer lines are read by kind; unknown lines are kept', () => {
  const plan = parsePlan(example(), exampleFile)
  const a = parseAnswers('Plan: plans/x/plan.md\nPLAN changes: fewer phases\nPLAN ok\nQ1 B\nQ2 A: daily\nQ1: my words\n2.1-ui: also 768\n2.1: drop delete\nWhere the run stands: x\nhello', plan)
  assert.equal(a.plan, 'plans/x/plan.md')
  assert.deepEqual(a.items.map((x) => [x.kind, x.ref, x.option ?? x.call ?? null, x.text]), [
    ['call', 'PLAN', 'changes', 'fewer phases'], ['call', 'PLAN', 'ok', ''], ['answer', 'Q1', 'B', ''], ['answer', 'Q2', 'A', 'daily'],
    ['answer', 'Q1', null, 'my words'], ['comment', '2.1-ui', null, 'also 768'], ['comment', '2.1', null, 'drop delete'], ['comment', 'Where the run stands', null, 'x'],
  ])
  assert.deepEqual(a.unknown, ['hello'])
})

test('recording puts answers under their question and the rest in Feedback, twice over', () => {
  const plan = parsePlan(example(), exampleFile)
  const r1 = applyAnswers(plan, parseAnswers('Q1 C: tight\nPLAN ok\n1.2: rate limit', plan), '2026-11-15')
  assert.match(r1.text, /  - C\. 5\n  - \*\*Answer 2026-11-15:\*\* C \(5\); tight\n- \*\*Q2\.\*\*/)
  assert.match(r1.text, /## Feedback\n\n- 2026-11-15 · PLAN ok\n- 2026-11-15 · 1\.2: rate limit — open\n$/)
  const plan2 = parsePlan(r1.text, exampleFile)
  assert.equal(plan2.questions[0].answers.length, 1)
  assert.deepEqual(plan2.questions[0].options.map((o) => o.letter), ['A', 'B', 'C'], 'an answer is not an option')
  const r2 = applyAnswers(plan2, parseAnswers('P2: later', plan2), '2026-11-16')
  assert.match(r2.text, /1\.2: rate limit — open\n- 2026-11-16 · P2: later — open\n$/)
  assert.equal(r2.text.match(/## Feedback/g).length, 1)
})

test('recording keeps CRLF line ends and answers heading questions', () => {
  const src = '# T\r\n\r\n## Open questions\r\n\r\n### Q1. Colour?\r\n\r\n- A. Red (recommended)\r\n- B. Blue\r\n\r\n## Later\r\n'
  const plan = parsePlan(src, 't.md')
  const { text } = applyAnswers(plan, parseAnswers('Q1 B', plan), '2026-11-15')
  assert.ok(!/[^\r]\n/.test(text), 'every line ends in CRLF')
  assert.match(text, /- B\. Blue\r\n\r\n\*\*Answer 2026-11-15:\*\* B \(Blue\)\r\n\r\n## Later/)
})

test('a question or option the plan lacks is reported, not invented', () => {
  const plan = parsePlan(example(), exampleFile)
  const r = applyAnswers(plan, parseAnswers('Q9 A\nQ1 F', plan), '2026-11-15')
  assert.match(r.notes.join('\n'), /Q9: the plan has no such question/)
  assert.match(r.notes.join('\n'), /option F is not one of A, B, C/)
})

test('new plans get their own folder in the plans root the project uses', () => {
  const root = tmp()
  assert.equal(path.relative(root, newPlanPath(root, 'Saved searches for users!', '2026-11-15')).split(path.sep).join('/'), 'plans/20261115-saved-searches-for-users/plan.md')
  fs.mkdirSync(path.join(root, '.planning'))
  assert.match(newPlanPath(root, 'x y', '2026-11-15').split(path.sep).join('/'), /\.planning\/20261115-x-y\/plan\.md$/)
  fs.mkdirSync(path.join(root, '.planning', '20261115-x-y'))
  assert.match(newPlanPath(root, 'x y', '2026-11-15').split(path.sep).join('/'), /20261115-x-y-2\/plan\.md$/)
  assert.equal(pageOf(path.join('a', 'plan.md')), path.join('a', 'plan.html'))
  assert.equal(pageOf(path.join('a', 'PLAN-x.md')), path.join('a', 'PLAN-x.html'))
})

test('render, open at a ref and record from the command line', () => {
  const dir = path.join(tmp(), 'plans', '20261115-saved')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'plan.md')
  fs.writeFileSync(file, example())
  const log = []
  assert.equal(main(['render', file, '--strict'], (x) => log.push(x)), 0)
  assert.ok(fs.existsSync(path.join(dir, 'plan.html')))
  const redirect = openTarget(file, '1.2')
  assert.match(fs.readFileSync(redirect, 'utf8'), /plan\.html#r-1\.2/)
  assert.throws(() => openTarget(file, '9.9'), /not a step/)
  const answers = path.join(dir, 'a.txt')
  fs.writeFileSync(answers, 'Q2 A\n1.1: use uuid\nwhat?\n')
  log.length = 0
  assert.equal(main(['record', file, '--from', answers], (x) => log.push(x)), 0)
  assert.match(log.join('\n'), /2 recorded, 1 not understood/)
  assert.match(fs.readFileSync(file, 'utf8'), /1\.1: use uuid — open/)
  assert.equal(main(['nope'], () => {}), 2)
})
