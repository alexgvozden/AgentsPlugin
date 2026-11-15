// Checks on scripts/ideas.mjs, the script behind /ag:ideas, /ag:idea and /ag:idea-research.
// Run: node --test plugins/ag/tests

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addIdea, applyAnswers, checkIdeas, checkResearch, emptyList, ideasDir, linkResearch, main, md,
  parseAnswers, projectCode, renderIdeas, renderResearch, resolveId, setStatus, slugify,
} from '../scripts/ideas.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(here, '..', ...p), 'utf8'))
const draft = () => readJson('skills', 'idea', 'draft.example.json')
const example = () => readJson('skills', 'idea-research', 'research.example.json')

function listWithOne() {
  const data = emptyList('AgentsPlugin')
  const idea = addIdea(data, draft(), '2026-11-15')
  return { data, idea }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ag-ideas-test-'))
}

test('addIdea numbers ideas, makes the folder and numbers the questions', () => {
  const { data, idea } = listWithOne()
  assert.equal(idea.id, 'AGPL-IDEA-001')
  assert.equal(idea.folder, 'AGPL-IDEA-001-weekly-digest-of-goal-runs')
  assert.equal(idea.status, 'new')
  assert.deepEqual(idea.questions.map((q) => q.id), ['Q1', 'Q2', 'Q3'])
  assert.ok(idea.questions.every((q) => q.answer === null))
  assert.equal(addIdea(data, { title: 'Second', description: 'x' }).id, 'AGPL-IDEA-002')
  assert.deepEqual(checkIdeas(data), [])
  assert.throws(() => addIdea(data, { title: 'No description' }), /description/)
})

test('slugify is short, plain and cut at a word', () => {
  assert.equal(slugify('Café: a "new" idea!'), 'cafe-a-new-idea')
  const long = slugify('A very long title that goes on and on well past forty characters')
  assert.ok(long.length <= 40, long)
  assert.ok(!long.endsWith('-'))
  assert.equal(slugify('!!!'), 'idea')
})

test('resolveId takes AGPL-IDEA-003, IDEA-3, idea-3 and 3', () => {
  const data = emptyList('AgentsPlugin')
  for (let i = 0; i < 3; i++) addIdea(data, { title: `Idea ${i}`, description: 'x' })
  for (const ref of ['AGPL-IDEA-003', 'IDEA-3', 'idea-3', 'idea3', '3', '003']) assert.equal(resolveId(data, ref).id, 'AGPL-IDEA-003')
  assert.throws(() => resolveId(data, '9'), /no idea AGPL-IDEA-009/)
  assert.throws(() => resolveId(data, 'abc'), /not an idea id/)
  assert.equal(resolveId(data, 'agpl-idea-2').id, 'AGPL-IDEA-002')
  assert.throws(() => resolveId(data, 'SHOP-IDEA-003'), /idea of project SHOP; this list is AGPL/)
})

test('every id carries the project code, 4 or 5 letters', () => {
  assert.equal(projectCode('AgentsPlugin'), 'AGPL')
  assert.equal(projectCode('Tamarind'), 'TAMA')
  assert.equal(projectCode('my-shop-front-end'), 'MSFE')
  assert.equal(projectCode('Big Red Dog'), 'BIRD')
  assert.equal(projectCode('Go web'), 'GOWE')
  assert.throws(() => projectCode('Go'), /give --code/)
  const data = emptyList('Shop')
  data.code = 'SHOPX'
  assert.equal(addIdea(data, { title: 'One', description: 'x' }).id, 'SHOPX-IDEA-001')
  assert.deepEqual(checkIdeas(data), [])
  data.ideas[0].id = 'IDEA-001'
  assert.match(checkIdeas(data).join('\n'), /id must look like SHOPX-IDEA-003/)
  assert.deepEqual(parseAnswers('SHOPX-IDEA-001 Q1 B\nIDEA-001: hi\n1: yo').answers.map((a) => a.id), ['SHOPX-IDEA-001', 'IDEA-001', '1'])
})

test('parseAnswers reads every line the pages give', () => {
  const { answers, bad } = parseAnswers([
    'AGPL-IDEA-001: keep it small',
    'IDEA-001 Q1 B',
    'AGPL-IDEA-001 Q2 A: with estimates',
    '1 Q3: every project',
    'AGPL-IDEA-001 decision park: later',
    'AGPL-IDEA-001 RQ1: last week',
    '- AGPL-IDEA-001: a bullet',
    'bogus line',
    'AGPL-IDEA-001 Q2',
  ].join('\r\n'))
  assert.deepEqual(answers.map((a) => a.type), ['comment', 'q', 'q', 'q', 'decision', 'rq', 'comment'])
  assert.deepEqual(answers[2], { id: 'AGPL-IDEA-001', type: 'q', q: 'Q2', choice: 'A', text: 'with estimates' })
  assert.equal(answers[3].id, '1')
  assert.deepEqual(bad, ['bogus line', 'AGPL-IDEA-001 Q2'])
})

test('with a default id, lines may leave the id out', () => {
  const { answers, bad } = parseAnswers('Q1 A\nsome comment', 'AGPL-IDEA-002')
  assert.deepEqual(bad, [])
  assert.deepEqual(answers.map((a) => [a.id, a.type]), [['AGPL-IDEA-002', 'q'], ['AGPL-IDEA-002', 'comment']])
})

test('applyAnswers fills answers, comments and the decision', () => {
  const { data, idea } = listWithOne()
  const { answers } = parseAnswers('AGPL-IDEA-001 Q1 B: weekly\nAGPL-IDEA-001 Q3: all\nAGPL-IDEA-001: nice\nAGPL-IDEA-001 RQ1: x\nAGPL-IDEA-001 RQ1: y')
  const done = applyAnswers(data, answers, '2026-11-16')
  assert.equal(done.length, 5)
  assert.deepEqual(idea.questions[0].answer, { date: '2026-11-16', choice: 'B', option: 'On a schedule every Monday', text: 'weekly' })
  assert.equal(idea.questions[2].answer.text, 'all')
  assert.equal(idea.comments.at(-1).text, 'nice')
  assert.deepEqual(idea.researchAnswers, [{ q: 'RQ1', text: 'y', date: '2026-11-16' }])
  assert.equal(idea.status, 'discussed')
  assert.equal(idea.updated, '2026-11-16')
  assert.throws(() => applyAnswers(data, parseAnswers('AGPL-IDEA-001 Q9 A').answers), /no question Q9/)
  assert.throws(() => applyAnswers(data, parseAnswers('AGPL-IDEA-001 Q1 D').answers), /no option D/)
})

test('a decision to park or drop sets the status; go leaves it', () => {
  const { data, idea } = listWithOne()
  idea.status = 'researched'
  applyAnswers(data, parseAnswers('AGPL-IDEA-001 decision go').answers)
  assert.equal(idea.status, 'researched')
  applyAnswers(data, parseAnswers('AGPL-IDEA-001 decision park: not now').answers)
  assert.deepEqual([idea.status, idea.decision.call, idea.decision.text], ['parked', 'park', 'not now'])
  applyAnswers(data, parseAnswers('AGPL-IDEA-001 decision drop').answers)
  assert.equal(idea.status, 'dropped')
})

test('setStatus and linkResearch', () => {
  const { data, idea } = listWithOne()
  assert.equal(setStatus(data, '1', 'researching').status, 'researching')
  assert.throws(() => setStatus(data, '1', 'done'), /status must be one of/)
  linkResearch(data, idea, example(), '2026-11-15')
  assert.equal(idea.status, 'researched')
  assert.deepEqual(idea.research, {
    date: '2026-11-15', path: 'AGPL-IDEA-001-weekly-digest-of-goal-runs/research.html',
    summary: example().summary[0], verdict: 'go-with-changes', confidence: 'medium',
  })
  idea.status = 'planned'
  linkResearch(data, idea, example())
  assert.equal(idea.status, 'planned', 'a later status is kept')
  assert.throws(() => linkResearch(data, idea, null), /no research.json/)
})

test('the example research passes the checks', () => {
  const { idea } = listWithOne()
  assert.deepEqual(checkResearch(example(), idea), [])
})

test('the research checks catch missing sources, long quotes, handles and bad risks', () => {
  const { idea } = listWithOne()
  const r = example()
  r.facts.push({ text: 'Uncited fact' })
  r.facts.push({ text: 'Cites a source that is not there', sources: ['S99'] })
  r.voices.push({ kind: 'want', title: 't', url: 'https://example.com/2', date: '2026-10-01', point: 'p', quote: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone' })
  r.voices.push({ kind: 'want', title: 't', url: 'https://example.com/3', date: '2026-10-01', point: 'as /u/someone said' })
  r.raid.risks.push({ text: 'No levels' })
  r.sources.push({ id: 'S4', title: 'No date', url: 'https://example.com/x' })
  r.swot.threats.push({ text: 'Neither sources nor judgement' })
  const w = checkResearch(r, idea).join('\n')
  for (const want of [/Uncited fact|no source/i, /S99/, /20 at most/, /handle|user name|\/u\//i, /likelihood|impact/, /S4/, /Neither sources nor judgement|judgement/]) {
    assert.match(w, want)
  }
})

test('research answers "should we do it": value is required, build steps are refused', () => {
  const { idea } = listWithOne()
  const r = example()
  delete r.value
  r.path = [{ title: 'Build the page', effort: 'M' }]
  r.gap.points.push({ text: 'Add the script', effort: 'S' })
  r.size = { call: 'huge' }
  const w = checkResearch(r, idea).join('\n')
  for (const want of [/no "value"/, /"path".*\/ag:plan/, /effort or steps.*\/ag:plan/, /size\.call/]) assert.match(w, want)
  const html = renderResearch(example(), idea, 'Test')
  assert.match(html, /How it brings value/)
  assert.match(html, /What is missing/)
  assert.match(html, /Rough size, for the decision only/)
  assert.doesNotMatch(html, /How to get there/)
})

test('ideas belong to the project: the git root, never the home folder', () => {
  const home = tempDir()
  const project = path.join(home, 'proj')
  fs.mkdirSync(path.join(project, 'src'), { recursive: true })
  fs.mkdirSync(path.join(project, '.git'))
  // Not a real repository, so git fails and the current folder is used.
  assert.equal(ideasDir(undefined, project, home), path.join(project, 'ideas'))
  assert.equal(ideasDir('elsewhere', project, home), path.join(project, 'elsewhere'))
  assert.throws(() => ideasDir(undefined, home, home), /belong to a project/)
  // In a real repository, a subfolder still finds the root.
  const repo = path.resolve(here, '..', '..', '..')
  if (fs.existsSync(path.join(repo, '.git'))) assert.equal(ideasDir(undefined, path.join(repo, 'plugins', 'ag'), home).toLowerCase(), path.join(repo, 'ideas').toLowerCase())
})

test('md allows only code, bold and http links', () => {
  assert.equal(md('**b** `c` [x](https://a.b/c)'), '<b>b</b> <code>c</code> <a href="https://a.b/c" target="_blank" rel="noopener">x</a>')
  assert.equal(md('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
  assert.ok(!md('[x](javascript:alert(1))').includes('<a'))
})

test('the pages escape what the user typed', () => {
  const data = emptyList('AgentsPlugin')
  const idea = addIdea(data, { title: '<img src=x onerror=alert(1)>', description: 'd', raw: '</script><script>alert(1)</script>' })
  const html = renderIdeas(data, {})
  assert.ok(!html.includes('<img src=x'))
  assert.ok(!html.includes('</script><script>alert(1)'))
  assert.match(html, /id="AGPL-IDEA-001"/)
  const r = example()
  const page = renderResearch(r, idea, 'Test')
  assert.match(page, /\.\.\/ideas\.html#AGPL-IDEA-001/)
  assert.match(page, /Research says/)
})

test('the command line: add, record, render, link, open, resolve', () => {
  const dir = tempDir()
  const ideas = path.join(dir, 'ideas')
  const out = []
  const log = (s) => out.push(String(s))
  const draftFile = path.join(dir, 'draft.json')
  fs.writeFileSync(draftFile, JSON.stringify(draft()))
  assert.equal(main(['add', '--dir', ideas, '--from', draftFile, '--project', 'Test', '--code', 'agx'], log), 2, 'a 3-letter code is refused')
  assert.equal(main(['add', '--dir', ideas, '--from', draftFile, '--project', 'Test', '--code', 'agpl'], log), 0)
  assert.equal(out.at(-1), 'AGPL-IDEA-001 AGPL-IDEA-001-weekly-digest-of-goal-runs')
  assert.equal(main(['add', '--dir', ideas, '--from', draftFile, '--code', 'SHOP'], log), 2, 'the code stays once ideas exist')
  assert.match(out.at(-1), /code is AGPL/)
  assert.equal(fs.readFileSync(path.join(ideas, '.gitignore'), 'utf8').includes('*/data/'), true)

  const answers = path.join(dir, 'answers.txt')
  fs.writeFileSync(answers, 'Q1 A\nAGPL-IDEA-001 Q2\n')
  assert.equal(main(['record', '--dir', ideas, '--from', answers, '--id', '1'], log), 1, 'a line not understood gives 1')
  assert.ok(out.some((l) => l.startsWith('not understood: AGPL-IDEA-001 Q2')))

  assert.equal(main(['render', '--dir', ideas, '--strict'], log), 0)
  assert.ok(fs.existsSync(path.join(ideas, 'ideas.html')))

  const folder = path.join(ideas, 'AGPL-IDEA-001-weekly-digest-of-goal-runs')
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, 'research.json'), JSON.stringify(example()))
  assert.equal(main(['link', '--dir', ideas, '1'], log), 0)
  assert.equal(main(['render', '--dir', ideas, '--strict'], log), 0)
  assert.ok(fs.existsSync(path.join(folder, 'research.html')))
  const list = JSON.parse(fs.readFileSync(path.join(ideas, 'ideas.json'), 'utf8'))
  assert.equal(list.ideas[0].status, 'researched')

  assert.equal(main(['open', '--dir', ideas, '--id', '1', '--no-open'], log), 0)
  const redirect = out.at(-1)
  assert.match(fs.readFileSync(redirect, 'utf8'), /ideas\.html#AGPL-IDEA-001/)
  assert.equal(main(['open', '--dir', ideas, '--id', '1', '--research', '--no-open'], log), 0)
  assert.ok(out.at(-1).endsWith('research.html'))

  assert.equal(main(['resolve', '--dir', ideas, 'IDEA-1'], log), 0)
  assert.equal(JSON.parse(out.at(-1)).researchExists, true)
  assert.equal(main(['status', '--dir', ideas, '1', 'planned'], log), 0)
  assert.equal(main(['resolve', '--dir', ideas, '7'], log), 2, 'an unknown id gives 2')

  fs.rmSync(dir, { recursive: true, force: true })
})

test('the three skills point at the script and at each other', () => {
  const read = (n) => fs.readFileSync(path.join(here, '..', 'skills', n, 'SKILL.md'), 'utf8')
  for (const n of ['ideas', 'idea', 'idea-research']) {
    const t = read(n)
    assert.match(t, new RegExp(`^name: ${n}$`, 'm'))
    assert.match(t, /\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/ideas\.mjs/)
    assert.match(t, /disable-model-invocation: true/)
  }
  assert.match(read('idea'), /^## Answer lines$/m, '/ag:ideas and /ag:idea-research point at this section')
  const research = read('idea-research')
  for (const word of ['should we do it', 'Research, not planning', '/ag:plan', 'DataForSEO', 'at most 8 calls', '20 words', 'model: "sonnet"', 'effort: "high"', 'render --strict', 'node IDEAS link']) assert.ok(research.includes(word), word)
})
