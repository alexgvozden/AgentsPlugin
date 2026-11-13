// Checks on the text of the goal-prompt skills. Run: node --test plugins/ag/tests
//
// The /goal Stop hook grades only the runner's "met when" condition, so a way the run
// can end that the condition does not name is a loop: every stop is blocked and the run
// asks or answers "waiting" again and again (Oct 22, 2026: a pause written beside the
// condition; Nov 14, 2026: a question the user declined with no text). These tests read
// the runner each skill hands out and check that every end is named.
//
// They live here, not in hooks/, because `claude plugin test` loads only code files,
// with no file system, so it cannot read a SKILL.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILLS = ['goal-prompt', 'goal-prompt-3rdparty', 'goal-prompt-haiku', 'goal-prompt-sonnet']
const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, '..', 'skills', name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n')

function runner(text) {
  const section = text.slice(text.indexOf('### 6. Write the runner'))
  const start = section.indexOf('\n/goal ')
  const end = section.indexOf('\n```', start)
  assert.ok(start > 0 && end > start, 'no fenced /goal runner under "### 6. Write the runner"')
  return section.slice(start + 1, end)
}

const condition = (run) => run.slice(run.indexOf('The goal is met'), run.indexOf('\nRules: '))

function rule7(text) {
  const start = text.indexOf('7. **Phase close:**')
  assert.ok(start > 0, 'no rule 7 in "How this plan is run"')
  return text.slice(start, text.indexOf('\n', start))
}

// Every way a run can end, and what the met condition must say for that end to count.
const ENDS = [
  { end: 'every phase done', words: ['every phase is done', 'progress is "done"'] },
  { end: 'the user answers pause', words: ['answered "pause"', 'progress is "waiting"', '"Where the run stands" is printed'] },
  { end: 'the user declines or dismisses a question with no text', words: ['declined a question with no text', 'progress is "waiting"'] },
  { end: 'a phase is blocked', words: ['"blocked: <reason>"', 'progress is "blocked"'] },
]

for (const name of SKILLS) {
  const text = read(name)
  const run = runner(text)

  test(`${name}: the runner fits the 3,800-character budget`, () => {
    assert.ok(run.startsWith('/goal '))
    assert.ok(run.includes('\nRules: '))
    const n = [...run].length
    assert.ok(n <= 3800, `${n} characters`)
  })

  test(`${name}: the met condition names every way the run can end`, () => {
    const met = condition(run)
    for (const { end, words } of ENDS)
      for (const w of words) assert.ok(met.includes(w), `no met outcome for "${end}" (missing: ${w})`)
  })

  test(`${name}: every question has an end for a decline and is never asked again`, () => {
    assert.ok(run.includes('AskUserQuestion'))
    assert.ok(run.includes('a declined question is a pause, never asked again'), 'runner Phases line')
    const r7 = rule7(text)
    assert.ok(r7.includes('AskUserQuestion'))
    assert.ok(r7.includes('declined or dismissed with no text is a pause'), 'rule 7')
    assert.ok(r7.includes('never asks it again'), 'rule 7')
    assert.ok(r7.includes('a decline with text is the answer'), 'rule 7')
  })

  test(`${name}: the run never ends to wait and is pasted once`, () => {
    assert.ok(run.includes('never end the turn to wait'))
    for (const bad of [/until then[^.]*stop/i, /after each gate/i, /paste[^.]*again to continue/i, /end the turn and wait/i])
      assert.ok(!bad.test(run), `runner has "${(run.match(bad) || [''])[0]}"`)
  })

  test(`${name}: the principle, the hand-over check and the output name the declined question`, () => {
    assert.ok(text.includes('paused by the user (answered "pause", or declined or dismissed the question with no text)'), 'principle')
    assert.ok(text.includes('paused by the user\'s answer or a declined question, blocked) is one of the "met when" outcomes'), 'check 2')
    assert.ok(text.includes('you answer pause or decline the question'), 'output')
    assert.ok(text.includes('the user says pause or declines the question'), 'description')
  })
}

// 3rdparty's Phases line also names launcher runs, so only its gate part is compared.
test('the four skills share one met condition and one gate rule', () => {
  const conds = SKILLS.map((n) => condition(runner(read(n))))
  const phases = SKILLS.map((n) => {
    const line = runner(read(n)).split('\n').find((l) => l.startsWith('Phases: ')) || ''
    return line.slice(line.indexOf('If the phase has a gate'))
  })
  assert.ok(phases[0].length > 50, 'no gate rule in the Phases line')
  for (const c of conds) assert.equal(c, conds[0])
  for (const p of phases) assert.equal(p, phases[0])
})
